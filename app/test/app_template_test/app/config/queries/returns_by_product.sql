-- FORK CHECKLIST — replace this file (or delete it) for your demo.
-- See `daily_refund_trend.sql` header for the full instructions.
-- Top 10 products by return count (LuxeBeauty).
SELECT
  product_name,
  CAST(COUNT(*) AS BIGINT) AS return_count,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM ai_demo_gen.demo_luxebeauty_test.silver_returns
GROUP BY product_name
ORDER BY return_count DESC
LIMIT 10
