# Databricks notebook source
"""
Final setup task: publish every resolved resource ID
  * as <catalog>.<schema>.app_config (key, value) — the app reads it at boot, so it needs no
    post-job env editing (env vars in app.yaml still win when set), and
  * as the job's exit JSON (handy for `databricks jobs get-run-output`).
"""

# COMMAND ----------

import json

names = ["catalog", "schema", "app_name", "dashboard_id", "warehouse_id", "genie_space_id", "documents_volume", "lakebase_project_id",
         "agent_mlflow_experiment_path"]
for n in names:
    dbutils.widgets.text(n, "", n)
vals = {n: dbutils.widgets.get(n) for n in names}
for k in ("genie_space_id", "documents_volume"):
    if vals[k].startswith("{{"):
        raise RuntimeError(f"{k} task-value substitution did not fire: {vals[k]}")
vals["agent_mlflow_experiment_path"] = vals["agent_mlflow_experiment_path"] or f"/Shared/solution_builder/{vals['app_name']}-agent-traces"
fqs = f"{vals['catalog']}.{vals['schema']}"
spark.createDataFrame([(k, v) for k, v in vals.items()], "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fqs}.app_config")
spark.sql(f"COMMENT ON TABLE {fqs}.app_config IS 'Resource IDs resolved by the setup job (Genie agent, documents volume, dashboard). Read by the Ad Yield Copilot app at boot.'")
print(json.dumps(vals, indent=2))
dbutils.notebook.exit(json.dumps(vals))
