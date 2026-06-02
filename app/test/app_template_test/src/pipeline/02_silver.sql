-- Silver Layer — cleaned + ai_classify anger score + customer geo denorm.

-- silver_returns: each return carries customer city/lat/lng + region/country
-- in-row so the bubble map query (lotCityBreakdown) doesn't need a re-join.
CREATE OR REFRESH MATERIALIZED VIEW silver_returns
COMMENT 'Cleaned returns enriched with ai_classify anger score + customer geo (city/lat/lng denormalized)'
CLUSTER BY (return_date)
AS
SELECT
  r.return_id,
  r.order_id,
  r.customer_id,
  r.product_id,
  p.product_name,
  p.category,
  r.lot_id,
  r.facility,
  CAST(r.return_date AS TIMESTAMP) AS return_date,
  CAST(o.order_date AS DATE)       AS order_date,
  r.refund_amount_usd,
  r.return_reason,
  r.customer_comment       AS return_reason_text,
  r.customer_comment,
  CASE ai_classify(r.customer_comment,
        ARRAY('very_angry','angry','neutral','satisfied'))
    WHEN 'very_angry' THEN 1.0
    WHEN 'angry'      THEN 0.7
    WHEN 'neutral'    THEN 0.3
    ELSE 0.1
  END                              AS anger_score,
  r.country,
  c.city,
  c.customer_lat,
  c.customer_lng,
  r.region,
  r.status,
  r.is_bad_lot
FROM bronze_returns r
JOIN bronze_products p       ON r.product_id  = p.product_id
LEFT JOIN bronze_customers c ON r.customer_id = c.customer_id
LEFT JOIN bronze_orders o    ON r.order_id    = o.order_id;

-- silver_customers: cleaned + lifetime metrics (fed into gold_customer_features).
CREATE OR REFRESH MATERIALIZED VIEW silver_customers
COMMENT 'Cleaned customers with lifetime order and return metrics (carries premium_status label for ML)'
AS
SELECT
  c.customer_id,
  c.first_name,
  c.last_name,
  c.email,
  c.country,
  c.city,
  c.customer_lat,
  c.customer_lng,
  c.region,
  c.loyalty_tier,
  c.premium_status,
  CAST(c.registration_date AS DATE)                              AS registration_date,
  COALESCE(o_agg.total_orders, 0)                                AS total_orders,
  COALESCE(o_agg.lifetime_value_usd, 0.0)                        AS lifetime_value_usd,
  COALESCE(o_agg.avg_order_value, 0.0)                           AS avg_order_value,
  COALESCE(r_agg.total_returns, 0)                               AS total_returns,
  CASE
    WHEN COALESCE(o_agg.total_orders, 0) > 0
    THEN COALESCE(r_agg.total_returns, 0) * 1.0 / o_agg.total_orders
    ELSE 0.0
  END                                                            AS return_rate,
  DATEDIFF(current_date(), CAST(c.registration_date AS DATE))    AS days_since_first_order,
  DATEDIFF(current_date(), CAST(c.registration_date AS DATE)) / 30 AS tenure_months
FROM bronze_customers c
LEFT JOIN (
  SELECT customer_id,
         COUNT(*) AS total_orders,
         SUM(unit_price_usd) AS lifetime_value_usd,
         AVG(unit_price_usd) AS avg_order_value
  FROM bronze_orders GROUP BY customer_id
) o_agg ON c.customer_id = o_agg.customer_id
LEFT JOIN (
  SELECT customer_id, COUNT(*) AS total_returns
  FROM bronze_returns GROUP BY customer_id
) r_agg ON c.customer_id = r_agg.customer_id;

-- silver_lots: lot-level aggregates with avg anger.
CREATE OR REFRESH MATERIALIZED VIEW silver_lots
COMMENT 'Production lot summary with return metrics + avg anger'
AS
WITH scored_returns AS (
  SELECT lot_id, return_id, refund_amount_usd,
    CASE ai_classify(customer_comment, ARRAY('very_angry','angry','neutral','satisfied'))
      WHEN 'very_angry' THEN 1.0
      WHEN 'angry'      THEN 0.7
      WHEN 'neutral'    THEN 0.3
      ELSE 0.1
    END AS anger_score
  FROM bronze_returns
),
order_agg  AS (SELECT lot_id, COUNT(order_id) AS order_count FROM bronze_orders GROUP BY lot_id),
return_agg AS (
  SELECT lot_id, COUNT(return_id) AS return_count,
         SUM(refund_amount_usd)   AS total_refund_usd,
         AVG(anger_score)         AS avg_anger_score
  FROM scored_returns GROUP BY lot_id
)
SELECT
  l.lot_id, l.product_id, p.product_name, p.category,
  l.facility, CAST(l.production_date AS DATE) AS production_date,
  l.units_produced, l.quality_status,
  COALESCE(ra.return_count, 0) AS return_count,
  COALESCE(oa.order_count, 0)  AS order_count,
  CASE WHEN COALESCE(oa.order_count, 0) > 0
       THEN COALESCE(ra.return_count, 0) * 100.0 / oa.order_count
       ELSE 0.0
  END AS return_rate_pct,
  COALESCE(ra.total_refund_usd, 0.0) AS total_refund_usd,
  COALESCE(ra.avg_anger_score, 0.0)  AS avg_anger_score,
  (l.quality_status = 'FAILED')      AS is_bad_lot
FROM bronze_production_lots l
JOIN bronze_products p  ON l.product_id  = p.product_id
LEFT JOIN order_agg oa  ON l.lot_id = oa.lot_id
LEFT JOIN return_agg ra ON l.lot_id = ra.lot_id;

-- silver_orders — order-level view with the columns the app's sync expects:
-- order_id, customer_id, order_date, region, total_usd, status.
-- bronze_orders is per-line-item (one row per product), so we aggregate.
CREATE OR REFRESH MATERIALIZED VIEW silver_orders
COMMENT 'Order-level totals (sum of unit_price * quantity across line items) for the Lakebase mirror'
AS
SELECT
  o.order_id,
  MAX(o.customer_id)              AS customer_id,
  MAX(CAST(o.order_date AS DATE)) AS order_date,
  MAX(o.region)                   AS region,
  SUM(o.unit_price_usd * o.quantity) AS total_usd,
  -- bronze_orders has no order-level status in this synth; emit NULL so the
  -- sync's expected column exists. The app's drawer treats it as optional.
  CAST(NULL AS STRING)            AS status
FROM bronze_orders o
GROUP BY o.order_id;
