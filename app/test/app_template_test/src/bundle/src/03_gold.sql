-- Gold Layer — analytics + ML feeds. Each MV is consumed by the dashboard,
-- Genie, or the ML script — nothing here is intermediate.

-- gold_daily_summary: (date, region, category) — powers `mv_returns`
-- metric view per spec 02-uc-governance.md and the dashboard KPI/trend.
-- raw_orders is order-level (order_id, customer_id, order_date, region,
-- total_usd, n_items) and raw_order_items carries the per-line
-- (product_id, quantity, unit_price_usd, line_total_usd) — so we join the
-- two to roll up by (date, region, category).
CREATE OR REFRESH MATERIALIZED VIEW gold_daily_summary
COMMENT 'Daily orders + revenue + returns broken down by (region, category) — powers mv_returns metric view + dashboard KPIs/trend'
AS
WITH orders_d AS (
  -- silver_order_items already carries order_date / region / category in-row
  -- so this rollup is a single GROUP BY, no joins.
  SELECT
    order_date                  AS date,
    region,
    category,
    COUNT(DISTINCT order_id)    AS order_count,
    SUM(line_total_usd)         AS revenue_usd,
    SUM(quantity)               AS items_sold
  FROM silver_order_items
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

-- gold_customer_returns: pending bad-lot returns for the operations queue.
-- Inlines what used to be silver_customers — joins raw_customers directly
-- to pull first/last name + email.
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
JOIN retail_consumer_goods.luxebeauty_demo.raw_customers c
  ON r.customer_id = c.customer_id
WHERE r.is_bad_lot = TRUE AND r.status = 'pending';

-- gold_customer_features: one row per customer, training/scoring input for
-- the premium classifier (per spec 03-ml-premium.md). Inlines what used to
-- be silver_customers — pulls premium_status + tenure from raw_customers
-- directly, computes behavioral features from raw_orders + silver_returns.
CREATE OR REFRESH MATERIALIZED VIEW gold_customer_features
COMMENT 'Per-customer features + premium_status label (NULL on the unlabeled cohort)'
AS
WITH order_agg AS (
  -- Per-customer order rollup. raw_orders is order-level (carries
  -- customer_id + order_date + total_usd) so we read it directly — no
  -- need to re-join silver_order_items just for these three metrics.
  -- Spec § "Premium-classifier features": total_orders_lifetime =
  -- COUNT(DISTINCT order_id), total_spend_lifetime = SUM(line_total_usd)
  -- — both equivalent at order-grain since total_usd = SUM(line_total).
  SELECT customer_id,
         COUNT(*)                       AS total_orders_lifetime,
         SUM(total_usd)                 AS total_spend_lifetime,
         MAX(CAST(order_date AS DATE))  AS last_order_date
  FROM retail_consumer_goods.luxebeauty_demo.raw_orders
  GROUP BY customer_id
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
  DATEDIFF(current_date(), CAST(c.registration_date AS DATE)) / 30 AS tenure_months,
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
FROM retail_consumer_goods.luxebeauty_demo.raw_customers c
LEFT JOIN order_agg  oa  ON c.customer_id = oa.customer_id
LEFT JOIN return_agg ra  ON c.customer_id = ra.customer_id
LEFT JOIN anger_90d  a90 ON c.customer_id = a90.customer_id;
