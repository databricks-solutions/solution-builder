# Databricks notebook source
"""
Give the App's service principal what it needs (the app runs every query as its SP):
  * Unity Catalog: USE CATALOG / USE SCHEMA / SELECT on the demo schema, MODIFY on the three write-back
    tables (case_decisions, case_audit_log, sar_drafts), READ VOLUME on the policy docs (searched by Genie)
  * CAN_RUN on the Genie agent (data questions + the SAR agent's policy search)
The SP id is read at run time (`bundle deploy` creates the app, so it exists before this job runs).

Parameters: catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name, space_id = (dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name", "genie_space_id"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
fq = f"{catalog}.{schema}"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {fq} TO `{sp}`",
    f"GRANT MODIFY ON TABLE {fq}.case_decisions TO `{sp}`",
    f"GRANT MODIFY ON TABLE {fq}.case_audit_log TO `{sp}`",
    f"GRANT MODIFY ON TABLE {fq}.sar_drafts TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {fq}.aml_policy_docs TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

# COMMAND ----------

if space_id and not space_id.startswith("{{"):
    w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{space_id}",
                    body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
    print(f"CAN_RUN on Genie space {space_id} -> {sp}")
