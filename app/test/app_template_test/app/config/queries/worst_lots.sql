-- FORK CHECKLIST — replace this file (or delete it) for your demo.
-- See `daily_refund_trend.sql` header for the full instructions.
-- Worst production lots by return rate (LuxeBeauty).
SELECT
  lot_id,
  product_name,
  facility,
  region,
  CAST(return_count AS BIGINT) AS return_count,
  CAST(units_sold AS BIGINT) AS units_sold,
  CAST(ROUND(return_rate * 100, 1) AS DOUBLE) AS return_rate_pct,
  CAST(ROUND(total_refund_usd, 2) AS DOUBLE) AS total_refund_usd
FROM ai_demo_gen.demo_luxebeauty_test.gold_returns_by_lot
ORDER BY return_rate DESC
LIMIT 20
