# Databricks notebook source
"""
Export the resolved demo resource IDs as the job's exit value — reference
script for the FINAL task of a full DAB setup job (app + KA + MAS demos).

This AI/BI demo has no app / pipeline / KA / MAS, so it is NOT wired into
databricks.yml (the setup job ends after deploy_genie). It is kept here as the
reference pattern for demos that DO need to collect SDK-created IDs and emit
them as a single JSON via dbutils.notebook.exit() — which the local
finalize step reads back through `databricks jobs get-run-output` →
notebook_output.result. This same JSON doubles as the demo's resources.json.

GUARD: if {{task.values}} substitution didn't fire, the widget value is the
literal template string ("{{...}}"). We fail loudly rather than export garbage.

Parameters (base_parameters in databricks.yml):
- catalog, schema, dashboard_id, warehouse_id
- genie_space_id (from task values)
"""

# COMMAND ----------

import json

names = [
    "catalog", "schema",
    "dashboard_id", "warehouse_id",
    "genie_space_id",
]
for n in names:
    dbutils.widgets.text(n, "", n)

vals = {n: dbutils.widgets.get(n) for n in names}

# Guard: if task-value substitution didn't fire, the value is the literal
# template string — fail loudly rather than export garbage.
for k in ("genie_space_id",):
    v = vals[k]
    if v.startswith("{{") and v.endswith("}}"):
        raise RuntimeError(f"{k}={v!r} — task value substitution didn't fire.")

resources = {
    "catalog":          vals["catalog"],
    "schema":           vals["schema"],
    "dashboard_id":     vals["dashboard_id"],
    "warehouse_id":     vals["warehouse_id"],
    "genie_space_id":   vals["genie_space_id"],
    "metric_view_name": f"{vals['catalog']}.{vals['schema']}.genomics_metrics",
}

print("Exporting resources:")
for k, v in resources.items():
    print(f"  {k} = {v}")

# COMMAND ----------

dbutils.notebook.exit(json.dumps(resources))
