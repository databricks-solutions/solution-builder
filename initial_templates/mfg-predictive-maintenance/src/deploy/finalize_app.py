"""Last setup task: wire the app to what the job created, with no hand-copied IDs.

  * looks up the Genie agent (by title + catalog.schema) — the same idempotent lookup deploy_genie uses;
  * grants the app's service principal USE CATALOG / USE SCHEMA / SELECT / EXECUTE / READ VOLUME on the demo schema
    (the manuals the Genie agent searches) and CAN_RUN on the Genie agent (the SP id is read at run time: it differs per workspace);
  * writes <catalog>.<schema>.demo_resources (key, value) — the app reads it at boot (server/services/resources.ts).
"""
import argparse
import json

from databricks.sdk import WorkspaceClient
from pyspark.sql import SparkSession

ap = argparse.ArgumentParser()
for k in ("catalog", "schema", "app-name", "dashboard-id", "warehouse-id", "genie-title",
          "agent-mlflow-experiment-path"):
    ap.add_argument(f"--{k}", required=True)
a, _ = ap.parse_known_args()

w = WorkspaceClient()
spark = SparkSession.getActiveSession() or SparkSession.builder.getOrCreate()

# Same scoped lookup as deploy_genie: only OUR space (built on this catalog.schema), never a fork's.
space_id, tok = None, None
while not space_id:
    r = w.genie.list_spaces(page_size=200, page_token=tok)
    space_id = next((s.space_id for s in r.spaces or [] if s.title == a.genie_title and f"{a.catalog}.{a.schema}." in
                     (w.genie.get_space(space_id=s.space_id, include_serialized_space=True).serialized_space or "")), None)
    tok = r.next_page_token
    if not tok:
        break
if not space_id:
    raise SystemExit(f"Genie space {a.genie_title!r} not found (deploy_genie should have created it)")

sp = w.apps.get(name=a.app_name).service_principal_client_id
if not sp:
    raise SystemExit(f"App {a.app_name} has no service principal yet (run `bundle deploy` first)")
s = f"`{a.catalog}`.`{a.schema}`"
for stmt in [
    f"GRANT USE CATALOG ON CATALOG `{a.catalog}` TO `{sp}`",
    f"GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA {s} TO `{sp}`",
    f"GRANT READ VOLUME ON VOLUME {s}.manuals TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)
w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{space_id}",
                body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
print(f"CAN_RUN on Genie space {space_id} -> {sp}")

vals = {
    "catalog": a.catalog, "schema": a.schema, "app_name": a.app_name, "dashboard_id": a.dashboard_id,
    "warehouse_id": a.warehouse_id, "genie_space_id": space_id,
    "documents_volume": f"/Volumes/{a.catalog}/{a.schema}/manuals", "agent_mlflow_experiment_path": a.agent_mlflow_experiment_path,
    "ml_model": f"{a.catalog}.{a.schema}.failure_risk_model@champion",
}
spark.createDataFrame(list(vals.items()), "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.demo_resources")
spark.sql(f"COMMENT ON TABLE {s}.demo_resources IS 'Resource IDs created by the setup job (Genie agent, documents "
          f"volume, dashboard, model) - read by the app at startup.'")
print(json.dumps(vals, indent=2))
