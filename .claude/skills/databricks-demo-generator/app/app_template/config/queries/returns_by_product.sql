-- Top 10 products by return count (LuxeBeauty).
SELECT
  product_name,
  CAST(COUNT(*) AS BIGINT) AS return_count,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM ai_demo_gen.demo_demo_project.silver_returns
GROUP BY product_name
ORDER BY return_count DESC
LIMIT 10
