# Databricks notebook source
"""
Deploy the demo's Genie Space — reference script for a DAB setup-job task.

Loads a committed Genie space JSON (curated questions + curated SQLs + story
instructions), substitutes the catalog/schema, then creates or updates the
space via the SDK. Idempotent: searches by title, updates if present, creates
if not.

═══════════════════════════════════════════════════════════════════════════
GOTCHAS — proven the hard way; do NOT "simplify" these away:
  • list_spaces PAGINATION: unlike most SDK list_* methods, w.genie.list_spaces
    returns a GenieListSpacesResponse OBJECT (.spaces list + .next_page_token),
    NOT a generator. You MUST loop on next_page_token or you'll only see the
    first page and create duplicate spaces on large workspaces.
  • LOAD-FROM-JSON: the curated questions/SQLs are large; keep them in a JSON
    file rather than inlining. Substitute catalog.schema with a literal
    string-replace (the same qualifier appears in table identifiers AND inside
    SQL bodies, so a JSON-tree walk would miss the SQL ones).
  • WAIT-ONLY-ON-CREATE is N/A here (Genie spaces are ready immediately), but
    the pattern matters for KA/MAS — see those scripts.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest in databricks.yml).

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema:  Schema name
- warehouse_id: SQL warehouse the Genie space uses

Outputs (via dbutils.jobs.taskValues.set):
- genie_space_id: the resolved space ID (consumed by the MAS task)
"""

# COMMAND ----------

# ⚠️ EDIT PER DEMO: the space's display title (used for idempotent lookup) and
# its description. Alternatively read these from the JSON config below.
SPACE_TITLE = "<Demo> Operations Analytics"
SPACE_DESCRIPTION = (
    "Operations assistant for the demo. Walk the curated questions in order "
    "on a cold start."
)

# ⚠️ EDIT PER DEMO: the qualifier baked into the committed genie_space.json
# (the catalog.schema the JSON was authored against). We literal-replace this
# with the deployed catalog.schema. Keep them in sync with your committed JSON.
SRC_QUALIFIER = "<source_catalog>.<source_schema>"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")

catalog      = dbutils.widgets.get("catalog")
schema       = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")

assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

print(f"Deploying Genie Space: '{SPACE_TITLE}'")
print(f"  catalog.schema: {catalog}.{schema}")
print(f"  warehouse:      {warehouse_id}")

# COMMAND ----------

import json
import os
from databricks.sdk import WorkspaceClient

# Locate genie_space.json. This path is the DEMO's — it assumes the committed
# config lives at src/genie/genie_space.json relative to the bundle root.
# Adjust the trailing path if your demo stores it elsewhere.
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path   = f"/Workspace{bundle_root}/src/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    serialized = f.read()

# Substitute the authored catalog.schema with the deployed one. Literal
# string-replace is faster + safer than walking the JSON tree — the same
# prefix appears in table identifiers AND inside SQL bodies.
DST_QUALIFIER = f"{catalog}.{schema}"
n = serialized.count(SRC_QUALIFIER)
substituted = serialized.replace(SRC_QUALIFIER, DST_QUALIFIER)
print(f"Substituted {n} occurrences of {SRC_QUALIFIER} → {DST_QUALIFIER}")

# Validate it still parses cleanly.
space_payload = json.loads(substituted)
print(f"data_sources.tables: {len(space_payload['data_sources']['tables'])}")
print(f"sample_questions:    {len(space_payload['config']['sample_questions'])}")
print(f"example_sqls:        {len(space_payload['instructions']['example_question_sqls'])}")

# COMMAND ----------

w = WorkspaceClient()

# Search by title — paginate through pages of GenieListSpacesResponse.
# (Unlike most SDK list_* methods, this returns a response object with a
# .spaces list + next_page_token, NOT a generator.)
existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE:
            existing_id = sp.space_id
            print(f"Found existing space: {existing_id}")
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating space {existing_id}…")
    w.genie.update_space(
        space_id=existing_id,
        warehouse_id=warehouse_id,
        serialized_space=substituted,
    )
    space_id = existing_id
else:
    print("Creating new space…")
    created = w.genie.create_space(
        warehouse_id=warehouse_id,
        title=SPACE_TITLE,
        description=SPACE_DESCRIPTION,
        serialized_space=substituted,
    )
    space_id = created.space_id

print(f"Genie space ready: {space_id}")

# COMMAND ----------

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
print(f"task value set: genie_space_id = {space_id}")
