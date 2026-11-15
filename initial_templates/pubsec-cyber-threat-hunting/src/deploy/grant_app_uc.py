# Databricks notebook source
"""
Grant the App's service principal Unity Catalog read access to the demo schema (the app
reads Delta via the SQL warehouse at boot to seed its Lakebase lead-queue mirror, and the investigation agent queries the logs).

Also: CAN_RUN on the Genie agent (SP fallback; it also answers from the IR playbook volume).

Parameters: catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name = (dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.ir_playbook TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

# The investigation agent + chat dock fall back to the app SP when the viewer's token is rejected:
# let the SP run the Genie agent (tables + the IR playbook).
space = dbutils.widgets.get("genie_space_id")
if space and not space.startswith("{{"):
    from databricks.sdk.service.iam import AccessControlRequest, PermissionLevel
    w.permissions.update("genie", space, access_control_list=[AccessControlRequest(service_principal_name=sp, permission_level=PermissionLevel.CAN_RUN)])
    print(f"CAN_RUN on Genie space {space} → {sp}")
