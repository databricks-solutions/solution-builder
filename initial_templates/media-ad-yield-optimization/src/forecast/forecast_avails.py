"""
Avails forecast with the ai_forecast() AI Function.

Forecasts daily avails (sellable impressions) per inventory product for the next 75 days from the
inventory_daily history (ai_forecast, clamped to the trailing same-weekday baseline — see BAND below), and writes <catalog>.<schema>.gold_avails_forecast. ai_forecast runs on a
SQL warehouse (Pro / serverless), so this task sends the statement through the SQL Statement
Execution API instead of the job's own Spark session.

    python forecast_avails.py --catalog media_advertising --schema ad_yield_optimization --warehouse-id <id>
"""
import argparse
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", required=True)
ap.add_argument("--schema", required=True)
ap.add_argument("--warehouse-id", required=True)
args, _ = ap.parse_known_args()
fqs = f"{args.catalog}.{args.schema}"

# ai_forecast alone is not stable enough to drive the spare-avails math: with the same history it can return very
# different totals from one call / one history day to the next (Crest+ Live Sports October: 15M vs 40M for ~46M of
# trailing run-rate). So the published forecast is ai_forecast GUARD-RAILED by a deterministic baseline — the trailing
# 4-week same-weekday average — clamped to baseline x [1 - BAND, 1 + BAND]. ai_forecast still shapes the curve inside
# the band; the raw value is kept in ai_forecast_raw for transparency.
BAND = 0.10
SQL = f"""
CREATE OR REPLACE TABLE {fqs}.gold_avails_forecast
COMMENT 'Daily avails forecast per inventory product for the next 75 days: ai_forecast() over inventory_daily, clamped to +/-{int(BAND*100)}% of the trailing 4-week same-weekday average (baseline_avails) so spare-avails math is stable. avails_forecast = the forecast used everywhere; ai_forecast_raw = the unclamped ai_forecast point; avails_lower / avails_upper = prediction interval.'
AS
WITH ai AS (
  SELECT f.product_id, CAST(f.ds AS DATE) AS forecast_date,
         GREATEST(f.avails_forecast, 0) AS ai_fc, GREATEST(f.avails_lower, 0) AS ai_lo, GREATEST(f.avails_upper, 0) AS ai_hi
  FROM AI_FORECAST(
    TABLE(SELECT product_id, CAST(inventory_date AS TIMESTAMP) AS ds, CAST(avails AS DOUBLE) AS avails
          FROM {fqs}.inventory_daily),
    horizon   => date_add(current_date(), 75),
    time_col  => 'ds',
    value_col => 'avails',
    group_col => 'product_id'
  ) f
  WHERE CAST(f.ds AS DATE) >= current_date()
),
baseline AS (
  SELECT product_id, dayofweek(inventory_date) AS dow, AVG(avails) AS base
  FROM {fqs}.inventory_daily
  WHERE inventory_date >= date_sub(current_date(), 28) AND inventory_date < current_date()
  GROUP BY product_id, dayofweek(inventory_date)
),
blended AS (
  SELECT ai.*, b.base, LEAST(GREATEST(ai.ai_fc, b.base * {1 - BAND}), b.base * {1 + BAND}) AS fc
  FROM ai JOIN baseline b ON b.product_id = ai.product_id AND b.dow = dayofweek(ai.forecast_date)
)
SELECT product_id, forecast_date,
       CAST(fc AS BIGINT)                      AS avails_forecast,
       CAST(LEAST(ai_lo, fc) AS BIGINT)        AS avails_lower,
       CAST(GREATEST(ai_hi, fc) AS BIGINT)     AS avails_upper,
       CAST(ai_fc AS BIGINT)                   AS ai_forecast_raw,
       CAST(base AS BIGINT)                    AS baseline_avails,
       current_timestamp()                     AS forecast_run_at
FROM blended
"""

w = WorkspaceClient()
r = w.statement_execution.execute_statement(statement=SQL, warehouse_id=args.warehouse_id, wait_timeout="50s")
while r.status.state in (StatementState.PENDING, StatementState.RUNNING):
    time.sleep(5)
    r = w.statement_execution.get_statement(r.statement_id)
if r.status.state != StatementState.SUCCEEDED:
    raise RuntimeError(f"ai_forecast failed: {r.status.error}")
n = w.statement_execution.execute_statement(statement=f"SELECT COUNT(*) FROM {fqs}.gold_avails_forecast",
                                            warehouse_id=args.warehouse_id, wait_timeout="50s")
print(f"gold_avails_forecast rows: {n.result.data_array[0][0]}")
