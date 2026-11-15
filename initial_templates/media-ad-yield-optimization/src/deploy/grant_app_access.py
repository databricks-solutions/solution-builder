# Databricks notebook source
"""
Give the App's service principal everything it needs, so the app works for every viewer:
  * Unity Catalog: USE CATALOG / USE SCHEMA / SELECT on the demo schema, READ VOLUME on the docs volume
    (the app reads Delta through the SQL warehouse to seed its Lakebase mirror and run live analysis)
  * CAN_RUN on the Genie agent

Parameters: catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name, space_id = (dbutils.widgets.get(k) for k in
                                                    ("catalog", "schema", "app_name", "genie_space_id"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.ad_sales_library TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)


if space_id and not space_id.startswith("{{"):
    w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{space_id}",
                    body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
    print(f"CAN_RUN on Genie space {space_id} → {sp}")
