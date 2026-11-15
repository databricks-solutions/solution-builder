# Databricks notebook source
"""
Final setup task: record every resolved resource ID
  * in <catalog>.<schema>.demo_resources (key, value) — the App reads it at startup
    (server/services/resources.ts), so no Genie space id is ever hand-edited into the app config;
  * as the job's exit JSON (for humans / scripts: `databricks jobs get-run-output`).
Also grants the app SP CAN_RUN on the Genie space.
"""

# COMMAND ----------

import json

names = ["catalog", "schema", "app_name", "dashboard_id", "warehouse_id", "genie_space_id", "agent_mlflow_experiment_path"]
for n in names:
    dbutils.widgets.text(n, "", n)
vals = {n: dbutils.widgets.get(n) for n in names}
if vals["genie_space_id"].startswith("{{"):
    raise RuntimeError(f"genie_space_id task-value substitution did not fire: {vals['genie_space_id']}")

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.api_client.do("GET", f"/api/2.0/apps/{vals['app_name']}")["service_principal_client_id"]
w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{vals['genie_space_id']}",
                body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
vals["agent_mlflow_experiment_path"] = vals["agent_mlflow_experiment_path"] or f"/Shared/solution_builder/{vals['app_name']}-agent-traces"
vals["churn_model"] = f"{vals['catalog']}.{vals['schema']}.player_churn_model@champion"
vals["ltv_model"] = f"{vals['catalog']}.{vals['schema']}.player_ltv_model@champion"

s = f"`{vals['catalog']}`.`{vals['schema']}`"
spark.createDataFrame([(k, v) for k, v in vals.items()], "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.demo_resources")
spark.sql(f"COMMENT ON TABLE {s}.demo_resources IS 'Resource IDs created by the setup job (Genie space, dashboard, models) — read by the app at startup.'")
print(json.dumps(vals, indent=2))
dbutils.notebook.exit(json.dumps(vals))
