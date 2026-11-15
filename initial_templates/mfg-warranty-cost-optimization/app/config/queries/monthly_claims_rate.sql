-- Monthly claims per 1,000 bikes in service, total vs motor-controller water ingress (AI-classified). Complete months only.
-- @param catalog STRING = manufacturing
-- @param schema STRING = warranty_copilot
SELECT CAST(month AS STRING) AS month,
       ROUND(1000 * SUM(claims) / SUM(units_in_service), 2) AS claims_per_1k,
       ROUND(1000 * SUM(controller_water_claims) / SUM(units_in_service), 2) AS water_ingress_per_1k,
       ROUND(SUM(warranty_cost), 0) AS warranty_cost
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_monthly_kpis')
WHERE NOT is_partial_month AND month >= add_months(date_trunc('MONTH', current_date()), -12)
GROUP BY month ORDER BY month
