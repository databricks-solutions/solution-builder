#!/usr/bin/env python
"""
Final setup task (DAB spark_python_task):
  1. Grant the App's service principal what it needs (read at run time — its client id differs per workspace):
       USE CATALOG / USE SCHEMA / SELECT on the demo schema, MODIFY on operator_actions (write-back),
       CAN_RUN on the Genie space (the ask_data tool runs as the viewer; this covers the SP fallback).
  2. Record every resolved resource id in <catalog>.<schema>.demo_resources (key, value). The App reads it at
     boot, so no id is ever hand-copied into app config.

Parameters: --catalog --schema --app_name --genie_space_id --dashboard_id --warehouse_id --agent_mlflow_experiment_path
"""
import argparse
import json

from databricks.sdk import WorkspaceClient
from pyspark.sql import SparkSession

ap = argparse.ArgumentParser()
for k in ("catalog", "schema", "app_name", "genie_space_id", "dashboard_id", "warehouse_id", "agent_mlflow_experiment_path"):
    ap.add_argument(f"--{k}", default="")
vals = vars(ap.parse_known_args()[0])
if not vals["genie_space_id"] or vals["genie_space_id"].startswith("{{"):
    raise RuntimeError(f"genie_space_id task-value substitution did not fire: {vals['genie_space_id']!r}")

spark = SparkSession.builder.getOrCreate()
w = WorkspaceClient()
sp = w.apps.get(name=vals["app_name"]).service_principal_client_id
assert sp, f"App {vals['app_name']} has no service principal yet (run `bundle deploy` first)"
s = f"`{vals['catalog']}`.`{vals['schema']}`"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG `{vals['catalog']}` TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {s} TO `{sp}`",
    f"GRANT MODIFY ON TABLE {s}.`operator_actions` TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)
w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{vals['genie_space_id']}",
                body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
print(f"CAN_RUN on Genie space {vals['genie_space_id']} -> {sp}")

vals["app_service_principal"] = sp
spark.createDataFrame(list(vals.items()), "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.`demo_resources`")
spark.sql(f"COMMENT ON TABLE {s}.`demo_resources` IS 'Resource ids created by the setup job (Genie space, dashboard, ...) - read by the app at startup.'")
print(json.dumps(vals, indent=2))
