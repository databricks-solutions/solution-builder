# Databricks notebook source
"""
Export the resolved demo resource IDs as the job's exit value.

Final task of luxebeauty_setup. Collects everything downstream consumers
need — the bundle-resolved IDs (passed in via base_parameters) plus the
SDK-created Genie/KA/MAS IDs (passed in via {{tasks.*.values.*}}) — and
emits them as a single JSON via dbutils.notebook.exit().

A local script (app/scripts/finalize_app.sh) reads this JSON back through
`databricks jobs get-run-output` → notebook_output.result, then writes the
app's env + redeploys. The exit JSON doubles as the demo's resources.json
manifest.

Parameters (base_parameters in databricks.yml):
- catalog, schema, app_name, dashboard_id, pipeline_id, warehouse_id
- genie_space_id, ka_endpoint_name, mas_endpoint_name (from task values)
"""

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

# Derived/static.
resources = {
    "catalog":                     vals["catalog"],
    "schema":                      vals["schema"],
    "app_name":                    vals["app_name"],
    "dashboard_id":                vals["dashboard_id"],
    "pipeline_id":                 vals["pipeline_id"],
    "warehouse_id":                vals["warehouse_id"],
    "genie_space_id":              vals["genie_space_id"],
    "ka_endpoint_name":            vals["ka_endpoint_name"],
    "mas_endpoint_name":           vals["mas_endpoint_name"],
    "ml_model_name":               f"{vals['catalog']}.{vals['schema']}.customer_premium_classifier",
    "pdf_volume_path":             f"/Volumes/{vals['catalog']}/{vals['schema']}/manufacturing_reports",
    "agent_mlflow_experiment_path": f"/Shared/solution_builder/{vals['app_name']}-agent-traces",
}

print("Exporting resources:")
for k, v in resources.items():
    print(f"  {k} = {v}")

# COMMAND ----------

dbutils.notebook.exit(json.dumps(resources))
