# Databricks notebook source
"""
Grant the App's service principal what it needs when it runs as itself (boot-time Delta → Lakebase
sync, and the SP fallback when a viewer's OBO token is rejected):
  * Unity Catalog: USE CATALOG / USE SCHEMA / SELECT on the demo schema, READ VOLUME on the policy docs,
    EXECUTE on the schema (UC model)
  * CAN_RUN on the Genie agent

Parameters: catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name, genie_space_id = (dbutils.widgets.get(k) for k in
                                                          ("catalog", "schema", "app_name", "genie_space_id"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.iam import AccessControlRequest, PermissionLevel

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT, EXECUTE ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.trade_policy_docs TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)


if genie_space_id and not genie_space_id.startswith("{{"):
    w.permissions.update("genie", genie_space_id, access_control_list=[
        AccessControlRequest(service_principal_name=sp, permission_level=PermissionLevel.CAN_RUN)])
    print(f"CAN_RUN on Genie space {genie_space_id} -> {sp}")
