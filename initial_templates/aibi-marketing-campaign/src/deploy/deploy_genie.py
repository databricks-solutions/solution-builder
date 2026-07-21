# Databricks notebook source
"""
Deploy the demo's Genie Space — DAB setup-job task (environment_key: sdk_latest).

Reads the committed serialized Genie space (../../genie/genie_space.json, the
serialized_space v2 export format), substitutes {{CATALOG}}/{{SCHEMA}}, then
creates or updates the space via the SDK. Idempotent: looks up by title, updates
if present, creates if not.

GOTCHAS (proven the hard way — do NOT "simplify" away):
  • data_sources.tables MUST be sorted by identifier, or create_space fails with
    "Invalid export proto: data_sources.tables must be sorted by identifier".
  • The space TITLE becomes a workspace item and CANNOT contain '/'. Use a hyphen
    ("AI-BI", not "AI/BI") or create_space fails "Workspace items cannot contain
    the '/' character".
  • list_spaces PAGINATION: w.genie.list_spaces returns a response OBJECT
    (.spaces + .next_page_token), NOT a generator — loop on next_page_token.
  • Only ever trash a space by the EXACT space_id you just created — never by a
    title substring match (it will catch pre-existing spaces).

REQUIRES: databricks-sdk>=0.114.0.

Parameters (base_parameters):
- catalog, schema, warehouse_id

Outputs (dbutils.jobs.taskValues):
- genie_space_id
"""

# COMMAND ----------

# EDIT PER DEMO: the space title (hyphen, no '/') used for idempotent lookup.
SPACE_TITLE = "AI-BI - Marketing Campaign effectiveness"
SPACE_DESCRIPTION = (
    "Explore multi-channel marketing performance across TikTok, Instagram, Google "
    "Ads and Email. Ask WHY revenue and conversions dropped in late 2025 - Genie "
    "traces it to the failing Q4 Growth Push campaign, the underperforming Fall "
    "Sale - v2 (DE/FR) creative, and the affected markets (Germany & France), while "
    "spend stayed flat."
)

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

# COMMAND ----------

import json
import os

from databricks.sdk import WorkspaceClient

# genie_space.json lives at the demo root under genie/. This task file is at
# src/deploy/deploy_genie.py, so the config is two dirs up + genie/.
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
demo_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path = f"/Workspace{demo_root}/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    raw = f.read()

raw = raw.replace("{{CATALOG}}", catalog).replace("{{SCHEMA}}", schema)
payload = json.loads(raw)  # validate + let us re-sort tables
# Ensure data_sources.tables are sorted by identifier (required by the API).
payload["data_sources"]["tables"] = sorted(
    payload["data_sources"]["tables"], key=lambda t: t["identifier"]
)
serialized = json.dumps(payload)
print(f"tables: {len(payload['data_sources']['tables'])}, "
      f"sample_questions: {len(payload['config']['sample_questions'])}")

# COMMAND ----------

w = WorkspaceClient()

# Idempotent lookup by exact title (paginate the response object).
existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE:
            existing_id = sp.space_id
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating existing space {existing_id}…")
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=serialized)
    space_id = existing_id
else:
    print("Creating new space…")
    created = w.genie.create_space(
        warehouse_id=warehouse_id, serialized_space=serialized,
        title=SPACE_TITLE, description=SPACE_DESCRIPTION,
    )
    space_id = created.space_id

print(f"Genie space ready: {space_id}")
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
