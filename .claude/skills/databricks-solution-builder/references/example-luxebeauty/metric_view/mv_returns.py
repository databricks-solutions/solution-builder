# Databricks notebook source
# MAGIC %md
# MAGIC # Deploy `mv_returns` metric view
# MAGIC
# MAGIC Single self-contained file: SQL template inline, params from widgets
# MAGIC (job) or env (local). `CREATE OR REPLACE VIEW` so re-runs are safe.
# MAGIC
# MAGIC Metric views have **no PySpark API** — the only way to create one is the
# MAGIC `CREATE … WITH METRICS LANGUAGE YAML` SQL below, run via `spark.sql(...)`.
# MAGIC
# MAGIC Dual-mode:
# MAGIC - **Job / Databricks notebook** — reads widgets, uses runtime `spark`.
# MAGIC - **Local** — reads `DEMO_CATALOG` / `DEMO_SCHEMA` env vars and builds a
# MAGIC   serverless `DatabricksSession` via **databricks-connect** for live MV
# MAGIC   creation against the workspace.

# COMMAND ----------

import os

IN_NOTEBOOK = "dbutils" in dir()

if IN_NOTEBOOK:
    dbutils.widgets.text("catalog", "", "Catalog")
    dbutils.widgets.text("schema",  "", "Schema")
    CATALOG = dbutils.widgets.get("catalog")
    SCHEMA  = dbutils.widgets.get("schema")
else:
    CATALOG = os.environ.get("DEMO_CATALOG")  # e.g. <your-catalog>
    SCHEMA  = os.environ.get("DEMO_SCHEMA")   # e.g. <your-schema>

assert CATALOG and SCHEMA, "catalog + schema are required (widgets in-job, DEMO_CATALOG/DEMO_SCHEMA env locally)"
print(f"Target: {CATALOG}.{SCHEMA}.mv_returns")

# COMMAND ----------

# Spark session — reuse runtime's, else build a databricks-connect serverless
# session for live metric-view creation from a local machine.
try:
    spark  # noqa: F821
except NameError:
    from databricks.connect import DatabricksSession
    spark = DatabricksSession.builder.serverless(True).getOrCreate()

# COMMAND ----------

# mv_returns — semantic layer over gold_daily_summary. Powers dashboard KPI
# tiles + AI_FORECAST + Genie headline answers (`return_rate`, `refund_rate`).
#
# Ratio measures use SUM(...) / NULLIF(SUM(...), 0) — NOT MEASURE(x)/MEASURE(y)
# — so the engine computes at the filtered slice level (correct under any
# dashboard filter) and avoids div-by-zero on empty slices.
sql = f"""
CREATE OR REPLACE VIEW {CATALOG}.{SCHEMA}.mv_returns
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1

source: {CATALOG}.{SCHEMA}.gold_daily_summary

dimensions:
  - name: date
    expr: date
  - name: region
    expr: region
  - name: category
    expr: category

measures:
  - name: total_revenue
    expr: SUM(revenue_usd)
  - name: total_refunds
    expr: SUM(returns_usd)
  - name: order_count
    expr: SUM(order_count)
  - name: return_count
    expr: SUM(return_count)
  - name: return_rate
    expr: "SUM(return_count) / NULLIF(SUM(order_count), 0)"
  - name: refund_rate
    expr: "SUM(returns_usd) / NULLIF(SUM(revenue_usd), 0)"
$$
"""

print(f"Creating metric view: {CATALOG}.{SCHEMA}.mv_returns")
spark.sql(sql)
print("Metric view created.")

# COMMAND ----------

# Smoke check — every measure resolves end-to-end.
spark.sql(f"""
  SELECT MEASURE(`total_revenue`)  AS total_revenue,
         MEASURE(`total_refunds`)  AS total_refunds,
         MEASURE(`order_count`)    AS order_count,
         MEASURE(`return_count`)   AS return_count,
         MEASURE(`return_rate`)    AS return_rate,
         MEASURE(`refund_rate`)    AS refund_rate
  FROM {CATALOG}.{SCHEMA}.mv_returns
""").show(truncate=False)
