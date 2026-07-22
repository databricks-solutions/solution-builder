-- =====================================================================
-- gold_opex_forecast — the AI_FORECAST projection (01-lakeflow.md Section C)
-- =====================================================================
-- Projects monthly operating-expense actuals to fiscal year-end with the AI_FORECAST
-- table-valued function, then UNIONs the historical actual months (series_type =
-- 'actual') with the forecast months (series_type = 'forecast'), carrying budget on
-- every row so the dashboard can plot actual/forecast against budget on one axis.
--
-- Runs on a SQL WAREHOUSE (DAB sql_task). AI_FORECAST is disabled on
-- databricks-connect serverless, which is why generate_data.py builds only the
-- ACTUAL months of gold_opex_monthly and this task extends them here.
--
-- Target: ~$824.8M projected vs ~$820M budget => ~$4.8M over. The Nursing Contract
-- Labor ramp (Q2+) is what pushes the forecast above budget; AI_FORECAST extends the
-- rising monthly actual trend naturally.
--
-- {{CATALOG}} / {{SCHEMA}} are substituted by the DAB sql_task parameters.

CREATE OR REPLACE TABLE `{{CATALOG}}`.`{{SCHEMA}}`.gold_opex_forecast
COMMENT 'Monthly operating expense: actual months (series_type=actual) unioned with the AI_FORECAST projection to fiscal year-end (series_type=forecast), with budget on every row and a confidence band (opex_upper/opex_lower, populated only on forecast rows). Summed forecast lands ~$824.8M vs ~$820M budget => the ~$4.8M board-headline miss.'
AS
WITH actuals AS (
  SELECT fiscal_month, actual_opex_usd, budget_opex_usd
  FROM `{{CATALOG}}`.`{{SCHEMA}}`.gold_opex_monthly
),
-- monthly budget for the WHOLE fiscal year (so forecast months can carry budget too)
budget_all AS (
  SELECT fiscal_month, SUM(budget_usd) AS budget_opex_usd
  FROM `{{CATALOG}}`.`{{SCHEMA}}`.budget
  GROUP BY fiscal_month
),
-- project the remaining months of the fiscal year from the actual trend
-- (the projection carries a confidence band: *_upper / *_lower)
fc AS (
  SELECT fiscal_month,
         actual_opex_usd_forecast AS forecast_opex_usd,
         actual_opex_usd_upper    AS opex_upper,
         actual_opex_usd_lower    AS opex_lower
  FROM AI_FORECAST(
    TABLE(SELECT fiscal_month, actual_opex_usd FROM actuals),
    horizon => (SELECT LAST_DAY(MAX(fiscal_month)) FROM budget_all),
    time_col => 'fiscal_month',
    value_col => 'actual_opex_usd'
  )
),
-- actual months: forecast_opex_usd = the actual (so the KPI sums a full year);
-- no confidence band on elapsed months
actual_rows AS (
  SELECT a.fiscal_month,
         a.actual_opex_usd,
         a.actual_opex_usd AS forecast_opex_usd,
         CAST(NULL AS DOUBLE) AS opex_upper,
         CAST(NULL AS DOUBLE) AS opex_lower,
         a.budget_opex_usd,
         'actual' AS series_type
  FROM actuals a
),
-- forecast months: no actual, forecast + band from AI_FORECAST, budget from budget_all
forecast_rows AS (
  SELECT fc.fiscal_month,
         CAST(NULL AS DOUBLE) AS actual_opex_usd,
         fc.forecast_opex_usd,
         fc.opex_upper,
         fc.opex_lower,
         b.budget_opex_usd,
         'forecast' AS series_type
  FROM fc
  JOIN budget_all b USING (fiscal_month)
  WHERE fc.fiscal_month > (SELECT MAX(fiscal_month) FROM actuals)
)
SELECT * FROM actual_rows
UNION ALL
SELECT * FROM forecast_rows
ORDER BY fiscal_month;
