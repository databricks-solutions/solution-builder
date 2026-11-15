# Databricks notebook source
"""
Final setup task: record every resolved resource ID in <catalog>.<schema>.demo_resources (key, value) — the app
reads it at boot (app/server/services/resources.ts), so no Genie id is ever copied by hand into the app config —
and also emit it as the job's exit JSON (handy for `databricks jobs get-run-output`).
"""

# COMMAND ----------

import json

names = ["catalog", "schema", "app_name", "dashboard_id", "warehouse_id", "genie_space_id", "documents_volume", "pipeline_id",
         "agent_mlflow_experiment_path"]
for n in names:
    dbutils.widgets.text(n, "", n)
vals = {n: dbutils.widgets.get(n) for n in names}
for k in ("genie_space_id", "documents_volume"):
    if not vals[k] or vals[k].startswith("{{"):
        raise RuntimeError(f"{k} task-value substitution did not fire: {vals[k]!r}")
vals["ml_model"] = f"{vals['catalog']}.{vals['schema']}.cell_kpi_anomaly_model@champion"

fqs = f"`{vals['catalog']}`.`{vals['schema']}`"
spark.createDataFrame(list(vals.items()), "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fqs}.demo_resources")
spark.sql(f"COMMENT ON TABLE {fqs}.demo_resources IS 'Resource IDs created by the setup job (Genie agent, documents "
          f"volume, dashboard, pipeline, model) - read by the NOC Copilot app at startup.'")
print(json.dumps(vals, indent=2))
dbutils.notebook.exit(json.dumps(vals))
