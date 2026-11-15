# Databricks notebook source
"""
Grant the App's service principal what it needs when it runs as itself (boot-time Delta → Lakebase
sync, and the SP fallback when a viewer's OBO token lacks a scope):
  * Unity Catalog: USE CATALOG / USE SCHEMA / SELECT on the demo schema (tables + vector indexes)
    and READ VOLUME on the standards_guide volume
  * CAN_RUN on the Genie agent
  * CAN_USE on the demo's Vector Search endpoint (VS has no user scope → the app always queries it as its SP)

Parameters: catalog, schema, app_name, genie_space_id, vector_search_endpoint
"""

# COMMAND ----------

for k in ("catalog", "schema", "app_name", "genie_space_id", "vector_search_endpoint"):
    dbutils.widgets.text(k, "", k)
catalog, schema, app_name, genie_space_id = (
    dbutils.widgets.get(k) for k in ("catalog", "schema", "app_name", "genie_space_id"))
assert catalog and schema and app_name

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp = w.apps.get(name=app_name).service_principal_client_id
assert sp, f"App {app_name} has no service principal yet"
for stmt in [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp}`",
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.standards_guide TO `{sp}`",
]:
    print(stmt)
    spark.sql(stmt)

if genie_space_id and not genie_space_id.startswith("{{"):
    w.api_client.do("PATCH", f"/api/2.0/permissions/genie/{genie_space_id}",
                    body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_RUN"}]})
    print(f"CAN_RUN on Genie space {genie_space_id} → {sp}")
vs_endpoint = dbutils.widgets.get("vector_search_endpoint")
if vs_endpoint:
    ep_id = w.vector_search_endpoints.get_endpoint(vs_endpoint).id
    w.api_client.do("PATCH", f"/api/2.0/permissions/vector-search-endpoints/{ep_id}",
                    body={"access_control_list": [{"service_principal_name": sp, "permission_level": "CAN_USE"}]})
    print(f"CAN_USE on Vector Search endpoint {vs_endpoint} → {sp}")
