# Databricks notebook source
"""
Grant the App's service principal UC privileges so it can read the demo
data via SQL warehouse + read PDFs from the manufacturing_reports volume.

Without these grants the app's first /api/config call crashes with:
  INSUFFICIENT_PERMISSIONS: User does not have USE CATALOG on Catalog ...

Granted:
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers all gold_* / silver_* / mv_returns reads)
  - READ_VOLUME on manufacturing_reports
  - CAN_RUN on the Genie Agent (the app asks it questions in Agent mode, on behalf of the user; it falls back to
    its SP when the user's token is rejected)

Idempotent — repeated grants are no-ops.

Parameters:
- catalog, schema, app_name, genie_space_id
"""

# COMMAND ----------

dbutils.widgets.text("catalog",  "", "Catalog")
dbutils.widgets.text("schema",   "", "Schema")
dbutils.widgets.text("app_name", "", "App name")
for _k in ("genie_space_id",):
    dbutils.widgets.text(_k, "", _k)

catalog  = dbutils.widgets.get("catalog")
schema   = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
assert catalog and schema and app_name

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
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.manufacturing_reports TO `{sp_client_id}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.raw_data TO `{sp_client_id}`",
    # Future-proofing: model + ML predictions table read.
    f"GRANT EXECUTE ON FUNCTION {catalog}.{schema}.customer_premium_classifier TO `{sp_client_id}`",
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

print("Grants applied.")

# COMMAND ----------

# Genie Agent permission for the app SP.
def _set(path, level):
    w.api_client.do("PATCH", path, body={"access_control_list": [
        {"service_principal_name": sp_client_id, "permission_level": level}]})
    print(f"  {level} on {path} → {sp_client_id}")

space_id = dbutils.widgets.get("genie_space_id")
if space_id and not space_id.startswith("{{"):
    _set(f"/api/2.0/permissions/genie/{space_id}", "CAN_RUN")
