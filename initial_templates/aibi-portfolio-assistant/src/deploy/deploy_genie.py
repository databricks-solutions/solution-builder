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

# Default space title (hyphen, no '/') used for idempotent lookup. Overridable via the
# `space_title` task param (bundle var genie_space_title) — it must be unique in the workspace.
DEFAULT_SPACE_TITLE = "AI-BI - Portfolio Assistant: Concentrated in the AI trade"
SPACE_DESCRIPTION = (
    "A wealth manager's flagship AI Growth Fund is beating its benchmark (the "
    "Nasdaq-100) by riding the real AI rally - but a series of reorganizations, "
    "capped by a major AI pivot on Aug 4 2025, left it dangerously concentrated "
    "(~77% core-AI). Ask Genie WHY it's winning, watch concentration step up over "
    "time, then quantify the risk with Value at Risk and Sharpe."
)

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")
dbutils.widgets.text("parent_path", "", "Workspace folder for the space (optional)")
dbutils.widgets.text("space_title", "", "Space title (optional)")
parent_path = dbutils.widgets.get("parent_path").strip()
SPACE_TITLE = dbutils.widgets.get("space_title").strip() or DEFAULT_SPACE_TITLE
assert "/" not in SPACE_TITLE, "Genie space title cannot contain '/'"
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
# notebookPath() may or may not carry the /Workspace prefix (it does when the bundle
# root_path is under /Workspace/...) — normalize so we never build /Workspace/Workspace.
if demo_root.startswith("/Workspace/"):
    demo_root = demo_root[len("/Workspace"):]
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

# Idempotent lookup: exact title AND the space's tables all live in OUR catalog.schema.
# Scoping by tables matters on shared workspaces, where other users' installs of the same
# template (same title, different schema) already exist — we must never update theirs.
own_prefix = f"{catalog}.{schema}.".lower()

def _is_ours(space_id):
    try:
        sp = w.genie.get_space(space_id=space_id, include_serialized_space=True)
        tables = json.loads(sp.serialized_space or "{}").get("data_sources", {}).get("tables", [])
        return bool(tables) and all(t["identifier"].lower().replace("`", "").startswith(own_prefix) for t in tables)
    except Exception as e:  # no access / unreadable → not ours
        print(f"  skip {space_id}: {e}")
        return False

existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE and _is_ours(sp.space_id):
            existing_id = sp.space_id
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating existing space {existing_id}…")
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=serialized,
                         description=SPACE_DESCRIPTION)
    space_id = existing_id
else:
    print("Creating new space…")
    kwargs = dict(warehouse_id=warehouse_id, serialized_space=serialized,
                  title=SPACE_TITLE, description=SPACE_DESCRIPTION)
    if parent_path:
        kwargs["parent_path"] = parent_path
    created = w.genie.create_space(**kwargs)
    space_id = created.space_id

print(f"Genie space ready: {space_id}")
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
