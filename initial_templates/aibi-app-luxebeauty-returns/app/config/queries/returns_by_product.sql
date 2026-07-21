-- FORK CHECKLIST — replace this file (or delete it) for your demo.
-- See `daily_refund_trend.sql` header for the full instructions.
-- Top 10 products by return count (LuxeBeauty).
-- @param catalog STRING = retail_consumer_goods
-- @param schema STRING = luxebeauty_demo
SELECT
  product_name,
  CAST(COUNT(*) AS BIGINT) AS return_count,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_returns')
GROUP BY product_name
ORDER BY return_count DESC
LIMIT 10
