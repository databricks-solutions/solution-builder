# Databricks notebook source
"""
Give the App's service principal what it needs — so the app works for every viewer, even when the
viewer's own token lacks a scope:
  * Unity Catalog: USE CATALOG / USE SCHEMA / SELECT on the demo schema (the app reads Delta via the SQL
    warehouse at boot to seed its Lakebase caseload mirror, and reads demo_resources), READ VOLUME on policy_manual
  * CAN_RUN on the Genie agent

Parameters: catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name, space_id = (dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name", "genie_space_id"))
assert catalog and schema and app_name
for k, v in (("genie_space_id", space_id),):
    if not v or v.startswith("{{"):
        raise RuntimeError(f"{k} task-value substitution did not fire: {v!r}")

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.policy_manual TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

# COMMAND ----------

w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{space_id}",
                body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
print(f"CAN_RUN on Genie space {space_id} → {sp}")
