"""
Give the App's service principal what it needs (DAB spark_python_task, runs after deploy_genie):
  * Unity Catalog: USE CATALOG / USE SCHEMA / SELECT on the demo schema (the app reads Delta via the SQL warehouse at
    boot to seed its Lakebase worklist mirror, and reads demo_resources) + MODIFY on retention_decisions (the Delta
    write-back of every accept/decline);
  * CAN_RUN on the Genie space (the chat agent's ask_data tool falls back to the app SP when the viewer's token can't
    reach it).
The app SP is read at run time (`apps.get(app_name)`): `bundle deploy` creates the app, so the SP already exists.

Parameters: --catalog --schema --app_name --warehouse_id --genie_space_id
"""
import argparse

from databricks.sdk import WorkspaceClient
from databricks.sdk.runtime import spark

ap = argparse.ArgumentParser()
for k in ("catalog", "schema", "app_name", "warehouse_id", "genie_space_id"):
    ap.add_argument(f"--{k}", default="")
a, _ = ap.parse_known_args()
assert a.catalog and a.schema and a.app_name, "catalog + schema + app_name are required"
assert a.genie_space_id and not a.genie_space_id.startswith("{{"), f"genie_space_id task value missing: {a.genie_space_id!r}"

w = WorkspaceClient()
sp = w.apps.get(name=a.app_name).service_principal_client_id
assert sp, f"App {a.app_name} has no service principal yet"
fq = f"`{a.catalog}`.`{a.schema}`"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG `{a.catalog}` TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {fq} TO `{sp}`",
    f"GRANT MODIFY ON TABLE {fq}.retention_decisions TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{a.genie_space_id}",
                body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
print(f"CAN_RUN on Genie space {a.genie_space_id} -> {sp}")
