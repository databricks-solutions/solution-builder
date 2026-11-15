# Databricks notebook source
"""
Final setup task: record every resolved resource ID
  * in <catalog>.<schema>.demo_resources (key, value) — the App reads it at startup, so no ID is ever
    hand-edited into the app config (the bundle only passes DEMO_CATALOG / DEMO_SCHEMA / DASHBOARD_ID);
  * as the job's exit JSON (`databricks jobs get-run-output`).
"""

# COMMAND ----------

import json

names = ["catalog", "schema", "app_name", "dashboard_id", "warehouse_id", "genie_space_id", "documents_volume"]
for n in names:
    dbutils.widgets.text(n, "", n)
vals = {n: dbutils.widgets.get(n) for n in names}
for k in ("genie_space_id", "documents_volume"):
    if not vals[k] or vals[k].startswith("{{"):
        raise RuntimeError(f"{k} task-value substitution did not fire: {vals[k]!r}")
vals["ml_model"] = f"{vals['catalog']}.{vals['schema']}.aml_alert_risk_model@champion"

s = f"{vals['catalog']}.{vals['schema']}"
spark.createDataFrame([(k, v) for k, v in vals.items()], "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.demo_resources")
spark.sql(f"COMMENT ON TABLE {s}.demo_resources IS 'Resource IDs created by the setup job (Genie agent, documents volume, dashboard, model) — read by the app at startup.'")
print(json.dumps(vals, indent=2))
dbutils.notebook.exit(json.dumps(vals))
