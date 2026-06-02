-- Gold Layer — analytics + ML feeds.

-- gold_daily_returns: daily time series (kept for the existing app analytics queries).
CREATE OR REFRESH MATERIALIZED VIEW gold_daily_returns
COMMENT '90-day daily return revenue with bad-lot vs normal split'
AS
SELECT
  CAST(return_date AS DATE)                                          AS return_date,
  SUM(refund_amount_usd)                                             AS total_refund_usd,
  COUNT(*)                                                           AS return_count,
  SUM(CASE WHEN is_bad_lot THEN refund_amount_usd ELSE 0 END)        AS bad_lot_refund_usd,
  SUM(CASE WHEN is_bad_lot THEN 1 ELSE 0 END)                        AS bad_lot_return_count,
  SUM(CASE WHEN NOT is_bad_lot THEN refund_amount_usd ELSE 0 END)    AS normal_refund_usd,
  SUM(CASE WHEN NOT is_bad_lot THEN 1 ELSE 0 END)                    AS normal_return_count
FROM silver_returns
WHERE return_date >= DATEADD(day, -90, current_date())
GROUP BY CAST(return_date AS DATE);

-- gold_daily_summary: (date, region, category) — required by `mv_returns`
-- metric view per spec 02-uc-governance.md.
CREATE OR REFRESH MATERIALIZED VIEW gold_daily_summary
COMMENT 'Daily orders + revenue + returns broken down by (region, category) — powers mv_returns metric view + dashboard KPIs/trend'
AS
WITH orders_d AS (
  SELECT
    CAST(o.order_date AS DATE) AS date,
    o.region,
    p.category,
    COUNT(*)                                       AS order_count,
    SUM(o.unit_price_usd * o.quantity)             AS revenue_usd,
    SUM(o.quantity)                                AS items_sold
  FROM bronze_orders o
  JOIN bronze_products p ON p.product_id = o.product_id
  GROUP BY 1, 2, 3
),
returns_d AS (
  SELECT
    CAST(return_date AS DATE) AS date,
    region,
    category,
    COUNT(*)                   AS return_count,
    SUM(refund_amount_usd)     AS returns_usd
  FROM silver_returns
  GROUP BY 1, 2, 3
)
SELECT
  o.date,
  o.region,
  o.category,
  o.order_count,
  o.items_sold,
  o.revenue_usd,
  COALESCE(r.return_count, 0)  AS return_count,
  COALESCE(r.returns_usd, 0.0) AS returns_usd
FROM orders_d o
LEFT JOIN returns_d r
  ON r.date = o.date AND r.region = o.region AND r.category = o.category;

-- gold_returns_by_lot: per-lot aggregates for root-cause investigation.
-- Spec contract (01-lakeflow.md): dims = lot_id, product_id, product_name,
-- category, region, facility, production_date. Metrics = units_sold,
-- return_count, total_refund_usd, return_rate.
CREATE OR REFRESH MATERIALIZED VIEW gold_returns_by_lot
COMMENT 'Per-lot return summary — sorted by return rate for anomaly detection'
AS
SELECT
  sl.lot_id,
  sl.product_id,
  sl.product_name,
  sl.category,
  -- region pulled from the bronze order facts (lots themselves have no region).
  -- Most lots sell across regions; pick the dominant one per lot for the dim.
  (SELECT o.region
   FROM bronze_orders o
   WHERE o.lot_id = sl.lot_id
   GROUP BY o.region ORDER BY COUNT(*) DESC LIMIT 1) AS region,
  sl.facility,
  sl.production_date,
  sl.order_count AS units_sold,
  sl.return_count,
  sl.total_refund_usd,
  -- return_rate as a fraction (0-1) per the spec; the SQL casts to 0-100 pct.
  CASE WHEN sl.order_count > 0 THEN sl.return_count * 1.0 / sl.order_count ELSE 0.0 END AS return_rate,
  sl.return_rate_pct,
  sl.avg_anger_score,
  sl.is_bad_lot
FROM silver_lots sl
WHERE sl.return_count > 0;

-- gold_customer_returns: pending bad-lot returns for the operations queue.
-- Carries customer geo (city/lat/lng) so the bubble map query stays single-table.
CREATE OR REFRESH MATERIALIZED VIEW gold_customer_returns
COMMENT 'Pending bad-lot returns for the operations queue (with customer geo)'
AS
SELECT
  r.return_id, r.customer_id,
  c.first_name, c.last_name, c.email,
  r.country, r.city, r.customer_lat, r.customer_lng,
  r.region,
  r.product_id, r.product_name,
  r.lot_id, r.refund_amount_usd, r.return_date,
  r.anger_score, r.return_reason, r.customer_comment, r.status
FROM silver_returns r
JOIN silver_customers c ON r.customer_id = c.customer_id
WHERE r.is_bad_lot = TRUE AND r.status = 'pending';

-- gold_customer_features: one row per customer, training/scoring input for
-- the premium classifier (per spec 03-ml-premium.md). Aggregates the
-- behavioral features the model needs + carries the premium_status label
-- on the labeled subset. NULL rows are the unlabeled cohort to score.
CREATE OR REFRESH MATERIALIZED VIEW gold_customer_features
COMMENT 'Per-customer features + premium_status label (NULL on the unlabeled cohort)'
AS
WITH order_agg AS (
  SELECT customer_id,
         COUNT(*) AS total_orders_lifetime,
         SUM(unit_price_usd * quantity) AS total_spend_lifetime,
         MAX(CAST(order_date AS DATE))  AS last_order_date
  FROM bronze_orders GROUP BY customer_id
),
return_agg AS (
  SELECT customer_id,
         COUNT(*) AS returns_lifetime,
         AVG(anger_score) AS avg_anger_score_lifetime
  FROM silver_returns GROUP BY customer_id
),
anger_90d AS (
  SELECT customer_id, AVG(anger_score) AS avg_anger_score_last_90d
  FROM silver_returns
  WHERE return_date >= DATEADD(day, -90, current_date())
  GROUP BY customer_id
)
SELECT
  c.customer_id,
  c.region,
  c.country,
  c.loyalty_tier,
  c.tenure_months,
  c.premium_status,
  COALESCE(oa.total_orders_lifetime, 0)         AS total_orders_lifetime,
  COALESCE(oa.total_spend_lifetime, 0.0)        AS total_spend_lifetime,
  COALESCE(ra.returns_lifetime, 0)              AS returns_lifetime,
  CASE WHEN COALESCE(oa.total_orders_lifetime, 0) > 0
       THEN COALESCE(ra.returns_lifetime, 0) * 1.0 / oa.total_orders_lifetime
       ELSE 0.0
  END                                           AS lifetime_return_rate,
  COALESCE(a90.avg_anger_score_last_90d, 0.0)   AS avg_anger_score_last_90d,
  DATEDIFF(current_date(), oa.last_order_date)  AS days_since_last_order
FROM silver_customers c
LEFT JOIN order_agg  oa  ON c.customer_id = oa.customer_id
LEFT JOIN return_agg ra  ON c.customer_id = ra.customer_id
LEFT JOIN anger_90d  a90 ON c.customer_id = a90.customer_id;
