# Databricks notebook source
"""
Grant the App's service principal Unity Catalog access to the demo schema: SELECT (the app
reads Delta via the SQL warehouse at boot to seed its Lakebase mirror) and MODIFY on the
write-back table liveops_schedule (Schedule button + Reset demo), plus CAN_RUN on the Genie
space (the agent's Genie tool falls back to the app SP when the viewer's token is rejected).

Parameters: catalog, schema, app_name
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name = (dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

sp = WorkspaceClient().api_client.do("GET", f"/api/2.0/apps/{app_name}")["service_principal_client_id"]  # REST: works on any SDK version
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG `{catalog}` TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA `{catalog}`.`{schema}` TO `{sp}`",
    f"GRANT MODIFY ON TABLE `{catalog}`.`{schema}`.liveops_schedule TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)
