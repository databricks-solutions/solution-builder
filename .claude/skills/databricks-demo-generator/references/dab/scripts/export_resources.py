# Databricks notebook source
"""
Export the resolved demo resource IDs as the job's exit value — reference
script for the FINAL task of the DAB setup job.

Collects everything downstream consumers need — the bundle-resolved IDs
(passed in via base_parameters) plus the SDK-created Genie/KA/MAS IDs (passed
in via {{tasks.*.values.*}}) — and emits them as a single JSON via
dbutils.notebook.exit().

═══════════════════════════════════════════════════════════════════════════
WHY exit() (not taskValues): the local finalize_app.sh reads this JSON back
through `databricks jobs get-run-output` → notebook_output.result, then writes
the app's env + redeploys. The exit value IS retrievable post-run; task-values
are not (cleanly) retrievable from outside the job. This same JSON doubles as
the demo's resources.json manifest.

GUARD: if {{task.values}} substitution didn't fire, the widget value is the
literal template string ("{{...}}"). We fail loudly rather than export garbage
that would silently break the app's config.

Parameters (base_parameters in databricks.yml):
- catalog, schema, app_name, dashboard_id, pipeline_id, warehouse_id
- genie_space_id, ka_endpoint_name, mas_endpoint_name (from task values)
"""

# COMMAND ----------

# ⚠️ EDIT PER DEMO: the derived names below are conventions specific to this
# demo's assets. Rename the model and volume to match what your pipeline/ML
# task actually created, and adjust the experiment-path convention if needed.
ML_MODEL_BASENAME = "<demo_ml_model>"          # e.g. customer_premium_classifier
PDF_VOLUME_BASENAME = "<demo_documents_volume>"  # the UC volume holding RAG PDFs

# COMMAND ----------

import json

names = [
    "catalog", "schema", "app_name",
    "dashboard_id", "pipeline_id", "warehouse_id",
    "genie_space_id", "ka_endpoint_name", "mas_endpoint_name",
]
for n in names:
    dbutils.widgets.text(n, "", n)

vals = {n: dbutils.widgets.get(n) for n in names}

# Guard: if task-value substitution didn't fire, the value is the literal
# template string — fail loudly rather than export garbage.
for k in ("genie_space_id", "ka_endpoint_name", "mas_endpoint_name"):
    v = vals[k]
    if v.startswith("{{") and v.endswith("}}"):
        raise RuntimeError(f"{k}={v!r} — task value substitution didn't fire.")

# Derived/static. The derived entries (ml_model_name, pdf_volume_path,
# agent_mlflow_experiment_path) follow this demo's naming conventions.
resources = {
    "catalog":                      vals["catalog"],
    "schema":                       vals["schema"],
    "app_name":                     vals["app_name"],
    "dashboard_id":                 vals["dashboard_id"],
    "pipeline_id":                  vals["pipeline_id"],
    "warehouse_id":                 vals["warehouse_id"],
    "genie_space_id":               vals["genie_space_id"],
    "ka_endpoint_name":             vals["ka_endpoint_name"],
    "mas_endpoint_name":            vals["mas_endpoint_name"],
    "ml_model_name":                f"{vals['catalog']}.{vals['schema']}.{ML_MODEL_BASENAME}",
    "pdf_volume_path":              f"/Volumes/{vals['catalog']}/{vals['schema']}/{PDF_VOLUME_BASENAME}",
    "agent_mlflow_experiment_path": f"/Shared/solution_builder/{vals['app_name']}-agent-traces",
}

print("Exporting resources:")
for k, v in resources.items():
    print(f"  {k} = {v}")

# COMMAND ----------

dbutils.notebook.exit(json.dumps(resources))
