-- Daily refund $ trend (last 30 days).
SELECT
  return_date,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM ai_demo_gen.demo_demo_project.silver_returns
WHERE return_date >= date_sub(current_date(), 30)
GROUP BY return_date
ORDER BY return_date
