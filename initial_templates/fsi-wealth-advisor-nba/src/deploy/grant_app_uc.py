# Databricks notebook source
"""
Grant the App's service principal Unity Catalog read access to the demo schema (the app
reads Delta via the SQL warehouse at boot to seed its Lakebase Morning Book mirror; it also INSERTs the advisor decisions into advisor_decisions).

Parameters: catalog, schema, app_name
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name = (dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

sp = WorkspaceClient().apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.policy_docs TO `{sp}`",
    f"GRANT MODIFY ON TABLE {catalog}.{schema}.advisor_decisions TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

# The chat agent's ask_data tool calls the Genie space: CAN_RUN for the app SP (the app retries as its SP when the
# viewer's token can't reach it).
dbutils.widgets.text("genie_space_id", "", "genie_space_id")
space_id = dbutils.widgets.get("genie_space_id")
if space_id and not space_id.startswith("{{"):
    WorkspaceClient().api_client.do("PATCH", f"/api/2.0/permissions/genie/{space_id}",
        body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
    print(f"CAN_RUN on Genie space {space_id} -> {sp}")
