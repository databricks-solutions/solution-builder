-- FORK CHECKLIST — replace this file (or delete it) for your demo.
-- See `daily_refund_trend.sql` header for the full instructions.
-- Worst production lots by return rate (LuxeBeauty).
-- units_sold + region come from silver_order_items (the per-line fact —
-- lot_id + region live there; raw_orders is order-level and has neither);
-- return aggregates come from silver_returns.
-- Every table is referenced via IDENTIFIER(:catalog || '.' || :schema || '.t')
-- so the query resolves on any workspace; :catalog/:schema are bound at runtime
-- and sampled at typegen via the @param annotations below.
-- @param catalog STRING = retail_consumer_goods
-- @param schema STRING = luxebeauty_demo
WITH order_agg AS (
  SELECT lot_id, SUM(quantity) AS units_sold
  FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_order_items')
  GROUP BY lot_id
),
return_agg AS (
  SELECT lot_id,
         COUNT(return_id)        AS return_count,
         SUM(refund_amount_usd)  AS total_refund_usd
  FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_returns')
  GROUP BY lot_id
),
lot_region AS (
  SELECT lot_id, region FROM (
    SELECT lot_id, region,
           ROW_NUMBER() OVER (PARTITION BY lot_id ORDER BY COUNT(*) DESC) AS rn
    FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_order_items')
    GROUP BY lot_id, region
  ) WHERE rn = 1
)
SELECT
  l.lot_id,
  p.product_name,
  l.facility,
  lr.region,
  CAST(COALESCE(ra.return_count, 0) AS BIGINT) AS return_count,
  CAST(COALESCE(oa.units_sold, 0)   AS BIGINT) AS units_sold,
  CAST(ROUND(
    CASE WHEN COALESCE(oa.units_sold, 0) > 0
         THEN COALESCE(ra.return_count, 0) * 100.0 / oa.units_sold
         ELSE 0.0 END, 1) AS DOUBLE) AS return_rate_pct,
  CAST(ROUND(COALESCE(ra.total_refund_usd, 0.0), 2) AS DOUBLE) AS total_refund_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.raw_production_lots') l
JOIN IDENTIFIER(:catalog || '.' || :schema || '.raw_products') p
  ON l.product_id = p.product_id
LEFT JOIN order_agg  oa ON l.lot_id = oa.lot_id
LEFT JOIN return_agg ra ON l.lot_id = ra.lot_id
LEFT JOIN lot_region lr ON l.lot_id = lr.lot_id
WHERE COALESCE(ra.return_count, 0) > 0
ORDER BY return_rate_pct DESC
LIMIT 20
