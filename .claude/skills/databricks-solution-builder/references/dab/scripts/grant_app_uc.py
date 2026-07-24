# Databricks notebook source
"""
Grant the App's service principal UC privileges — reference script for a DAB
setup-job task.

The app reads the demo's data via SQL warehouse + reads RAG PDFs from a UC
volume. Without these grants the app's first /api/config call crashes with:
  INSUFFICIENT_PERMISSIONS: User does not have USE CATALOG on Catalog ...

Granted to the app SP:
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers every gold_*/silver_*/mv_* read)
  - READ_VOLUME on the demo's volume(s)
  - EXECUTE on the ML model/function (wrapped in try/warn — the model may not
    be registered yet on an early run; future-proofing grant, not fatal)

═══════════════════════════════════════════════════════════════════════════
WHY auto-resolve the SP: the grant target is the app's service-principal
client_id (a UUID). We resolve it via w.apps.get(app_name) rather than passing
it as a parameter — more robust against config drift. UC grants are issued as
SQL via spark.sql (easier than the SDK for GRANT statements).

Idempotent — repeated grants no-op.

Parameters:
- catalog, schema, app_name
"""

# COMMAND ----------

# ⚠️ EDIT PER DEMO: the volumes + model/function the app needs. List every UC
# volume the app reads (RAG PDFs, raw data, …) and the ML model/function it
# scores against. Names are this demo's — rename to match your assets.
DEMO_VOLUMES = ["<demo_documents_volume>", "<demo_raw_data_volume>"]
DEMO_MODEL_FUNCTION = "<demo_ml_model>"   # e.g. customer_premium_classifier

# COMMAND ----------

dbutils.widgets.text("catalog",  "", "Catalog")
dbutils.widgets.text("schema",   "", "Schema")
dbutils.widgets.text("app_name", "", "App name")

catalog  = dbutils.widgets.get("catalog")
schema   = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
assert catalog and schema and app_name

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Resolve the app SP's client_id (UUID grant target). Auto-resolving is more
# robust against config drift than passing it as a parameter.
app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
assert sp_client_id, f"App '{app_name}' has no service_principal_client_id"
print(f"App SP: {sp_client_id}")

# COMMAND ----------

# UC grants are SQL — easier to issue via spark.sql than the SDK.
grants = [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp_client_id}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp_client_id}`",
]
grants += [
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.{vol} TO `{sp_client_id}`"
    for vol in DEMO_VOLUMES
]
# Model/function read (may not exist yet — EXECUTE grant is wrapped below).
grants.append(
    f"GRANT EXECUTE ON FUNCTION {catalog}.{schema}.{DEMO_MODEL_FUNCTION} TO `{sp_client_id}`"
)

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
