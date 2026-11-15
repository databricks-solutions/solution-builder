# Databricks notebook source
"""
Final setup task: record every resolved resource ID
  * in <catalog>.<schema>.demo_resources (key, value) — the App reads it at startup, so the app needs no
    hand-edited IDs: the bundle only passes it DEMO_CATALOG / DEMO_SCHEMA / DASHBOARD_ID;
  * as the job's exit JSON (for humans / scripts: `databricks jobs get-run-output`).
"""

# COMMAND ----------

import json

names = ["catalog", "schema", "app_name", "dashboard_id", "warehouse_id", "genie_space_id", "documents_volume", "agent_mlflow_experiment_path"]
for n in names:
    dbutils.widgets.text(n, "", n)
vals = {n: dbutils.widgets.get(n) for n in names}
for k in ("genie_space_id", "documents_volume"):
    if vals[k].startswith("{{"):
        raise RuntimeError(f"{k} task-value substitution did not fire: {vals[k]}")
vals["agent_mlflow_experiment_path"] = vals["agent_mlflow_experiment_path"] or f"/Shared/solution_builder/{vals['app_name']}-agent-traces"

s = f"{vals['catalog']}.{vals['schema']}"
spark.createDataFrame([(k, v) for k, v in vals.items()], "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.demo_resources")
spark.sql(f"COMMENT ON TABLE {s}.demo_resources IS 'Resource IDs created by the setup job (Genie agent, documents volume, dashboard) — read by the app at startup.'")
print(json.dumps(vals, indent=2))
dbutils.notebook.exit(json.dumps(vals))
