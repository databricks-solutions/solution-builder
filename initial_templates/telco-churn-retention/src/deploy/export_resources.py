"""
Final setup task (DAB spark_python_task): record every resolved resource ID
  * in <catalog>.<schema>.demo_resources (key, value) — the App reads it at startup (app/server/services/resources.ts),
    so no ID is ever copied by hand into the app config: the bundle only passes DEMO_CATALOG / DEMO_SCHEMA /
    DASHBOARD_ID;
  * as the task's output (printed JSON, visible in `databricks jobs get-run-output`).
"""
import argparse
import json

from databricks.sdk.runtime import spark

names = ["catalog", "schema", "app_name", "dashboard_id", "warehouse_id", "genie_space_id", "agent_mlflow_experiment_path"]
ap = argparse.ArgumentParser()
for n in names:
    ap.add_argument(f"--{n}", default="")
a, _ = ap.parse_known_args()
vals = {n: getattr(a, n) for n in names}
if not vals["genie_space_id"] or vals["genie_space_id"].startswith("{{"):
    raise RuntimeError(f"genie_space_id task-value substitution did not fire: {vals['genie_space_id']!r}")
vals["ml_model"] = f"{vals['catalog']}.{vals['schema']}.churn_risk_model@champion"

fq = f"`{vals['catalog']}`.`{vals['schema']}`"
spark.createDataFrame([(k, v) for k, v in vals.items()], "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.demo_resources")
spark.sql(f"COMMENT ON TABLE {fq}.demo_resources IS 'Resource IDs created by the setup job (Genie space, dashboard, model) — read by the app at startup.'")
print(json.dumps(vals, indent=2))
