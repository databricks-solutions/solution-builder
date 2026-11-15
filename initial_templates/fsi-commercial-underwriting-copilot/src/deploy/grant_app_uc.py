# Databricks notebook source
"""
Grant the App's service principal what it needs:
  * Unity Catalog: read the demo schema (boot-time Delta → Lakebase sync, analytics charts), MODIFY the uw_decisions
    write-back table the desk issues decisions to, and read the submission_docs (PDF viewer) + uw_guidelines volumes.
  * Genie: CAN_RUN on the Genie agent.

Parameters: catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name, genie = (dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name", "genie_space_id"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT MODIFY ON TABLE {catalog}.{schema}.uw_decisions TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.submission_docs TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.uw_guidelines TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

if genie and not genie.startswith("{{"):
    w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{genie}",
                    body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
    print(f"CAN_RUN on Genie {genie} → {sp}")
