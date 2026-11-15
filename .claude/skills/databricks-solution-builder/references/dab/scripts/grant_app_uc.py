# Databricks notebook source
"""
Grant the App's service principal access to the demo data, the documents
volume and the Genie agent.

Without these grants the app's first /api/config call crashes with:
  INSUFFICIENT_PERMISSIONS: User does not have USE CATALOG on Catalog ...

Granted:
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers all gold_* / silver_* / mv_returns reads)
  - READ_VOLUME on the documents volume (the PDF documents the Genie agent reads)
  - READ_VOLUME on the raw data volume
  - EXECUTE on the ML model/function (wrapped in try/warn: model may not exist yet)
  - CAN_RUN on the Genie agent (the app asks it questions in Agent mode)

Idempotent — Postgres no-ops repeated grants; the permissions PATCH merges.

Parameters:
- catalog, schema, app_name, genie_space_id (from deploy_genie taskValue)
"""

# COMMAND ----------

dbutils.widgets.text("catalog",  "", "Catalog")
dbutils.widgets.text("schema",   "", "Schema")
dbutils.widgets.text("app_name", "", "App name")
dbutils.widgets.text("genie_space_id", "", "Genie space ID")

catalog  = dbutils.widgets.get("catalog")
schema   = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
genie_space_id = dbutils.widgets.get("genie_space_id")
assert catalog and schema and app_name and genie_space_id, "catalog, schema, app_name, genie_space_id are required"

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Resolve the app SP's client_id (UUID grant target). Could be passed as
# a parameter too, but auto-resolving is more robust against config drift.
app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
assert sp_client_id, f"App '{app_name}' has no service_principal_client_id"
print(f"App SP: {sp_client_id}")

# COMMAND ----------

# UC grants are SQL — easier to issue via spark.sql than the SDK.
grants = [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp_client_id}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp_client_id}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.<demo_documents_volume> TO `{sp_client_id}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.<demo_raw_volume> TO `{sp_client_id}`",
    # Future-proofing: model + ML predictions table read.
    f"GRANT EXECUTE ON FUNCTION {catalog}.{schema}.<demo_ml_model> TO `{sp_client_id}`",
]

for stmt in grants:
    print(f"  {stmt}")
    try:
        spark.sql(stmt)
    except Exception as e:
        # EXECUTE-on-function may fail if the model isn't registered yet;
        # treat as warning so we don't break the job over a future-proofing
        # grant.
        if "EXECUTE" in stmt:
            print(f"  WARN: {e}")
        else:
            raise

print("UC grants applied.")

# COMMAND ----------

# CAN_RUN on the Genie agent. Genie is not a bundle-bindable app resource here
# (the app is deployed separately), so grant it through the permissions API.
# The grant is additive: the PATCH merges into the existing ACL.
w.api_client.do(
    "PATCH",
    f"/api/2.0/permissions/genie/{genie_space_id}",
    body={"access_control_list": [{
        "service_principal_name": sp_client_id,
        "permission_level": "CAN_RUN",
    }]},
)
print(f"Genie agent {genie_space_id}: CAN_RUN granted to app SP.")
