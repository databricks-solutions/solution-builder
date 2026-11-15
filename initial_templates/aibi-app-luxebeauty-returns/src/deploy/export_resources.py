# Databricks notebook source
"""
Final setup task: record every resolved resource ID
  * in <catalog>.<schema>.demo_resources (key, value) — the App reads it at boot
    (app/server/lib/demo-resources.ts), so the app needs no hand-edited IDs: the bundle only passes it
    DEMO_CATALOG / DEMO_SCHEMA / DASHBOARD_ID / PIPELINE_ID; the Genie id / app URL / Lakebase project uid come
    from this table;
  * as the job's exit JSON (for humans / scripts: `databricks jobs get-run-output`).

Parameters (base_parameters in databricks.yml):
- catalog, schema, app_name, dashboard_id, pipeline_id, warehouse_id, lakebase_project, agent_mlflow_experiment_path
- genie_space_id, documents_volume (from task values)
"""

# COMMAND ----------

import json
from databricks.sdk import WorkspaceClient

names = [
    "catalog", "schema", "app_name",
    "dashboard_id", "pipeline_id", "warehouse_id", "lakebase_project", "agent_mlflow_experiment_path",
    "genie_space_id", "documents_volume",
]
for n in names:
    dbutils.widgets.text(n, "", n)
vals = {n: dbutils.widgets.get(n) for n in names}

# Guard: if task-value substitution didn't fire, the value is the literal template string.
for k in ("genie_space_id", "documents_volume"):
    if not vals[k] or vals[k].startswith("{{"):
        raise RuntimeError(f"{k}={vals[k]!r} — task value substitution didn't fire.")

w = WorkspaceClient()
app_url = w.apps.get(name=vals["app_name"]).url or ""
# The Lakebase UI deep link uses the project UID, not the slug.
lakebase_project_id = ""
if vals["lakebase_project"]:
    try:
        proj = w.api_client.do("GET", f"/api/2.0/postgres/projects/{vals['lakebase_project']}")
        lakebase_project_id = proj.get("uid", "") or ""
    except Exception as e:  # deep link only — never fail the job over it
        print(f"WARN: could not resolve Lakebase project uid: {e}")

resources = {
    **vals,
    "app_url":             app_url,
    "lakebase_project_id": lakebase_project_id,
    "ml_model_name":       f"{vals['catalog']}.{vals['schema']}.customer_premium_classifier",
    "pdf_volume_path":     f"/Volumes/{vals['catalog']}/{vals['schema']}/manufacturing_reports",
}

s = f"{vals['catalog']}.{vals['schema']}"
spark.createDataFrame([(k, str(v)) for k, v in resources.items()], "key STRING, value STRING") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.demo_resources")
spark.sql(f"COMMENT ON TABLE {s}.demo_resources IS 'Resource IDs created by the setup job (Genie Agent, documents volume, dashboard, pipeline) — read by the app at boot.'")

print(json.dumps(resources, indent=2))
dbutils.notebook.exit(json.dumps(resources))
