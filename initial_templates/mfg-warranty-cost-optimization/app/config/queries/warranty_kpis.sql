-- Headline warranty KPIs for the VP Quality: claims per 1,000 bikes in service (last 3 complete months, monthly avg),
-- warranty cost + cost per bike in service (last 12 months), supplier recovery rate (last 4 settled quarters).
-- @param catalog STRING = manufacturing
-- @param schema STRING = warranty_copilot
WITH m AS (
  SELECT month, SUM(claims) AS claims, SUM(units_in_service) AS units, SUM(warranty_cost) AS cost
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_monthly_kpis') GROUP BY month
),
recent AS (
  SELECT ROUND(1000 * SUM(claims) / SUM(units), 1) AS claims_per_1k_3m FROM m
  WHERE month >= add_months(date_trunc('MONTH', current_date()), -3) AND month < date_trunc('MONTH', current_date())
),
prior AS (
  SELECT ROUND(1000 * SUM(claims) / SUM(units), 1) AS claims_per_1k_prior FROM m
  WHERE month >= add_months(date_trunc('MONTH', current_date()), -15) AND month < add_months(date_trunc('MONTH', current_date()), -3)
),
yr AS (
  SELECT ROUND(SUM(cost), 0) AS warranty_cost_12m, ROUND(SUM(cost) / AVG(units), 2) AS cost_per_bike_12m FROM m
  WHERE month >= add_months(date_trunc('MONTH', current_date()), -12)
),
rec AS (
  SELECT ROUND(100 * SUM(recovered_amount) / SUM(supplier_attributable_cost), 1) AS recovery_rate_pct,
         ROUND(SUM(supplier_attributable_cost - recovered_amount), 0) AS unrecovered_cost
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_supplier_recovery')
  WHERE status = 'settled' AND quarter >= concat(year(add_months(current_date(), -12)), '-Q', quarter(add_months(current_date(), -12)))
)
SELECT recent.claims_per_1k_3m, prior.claims_per_1k_prior, yr.warranty_cost_12m, yr.cost_per_bike_12m,
       rec.recovery_rate_pct, rec.unrecovered_cost
FROM recent, prior, yr, rec
