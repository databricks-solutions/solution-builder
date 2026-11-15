# Databricks notebook source
"""
Deploy the demo's Genie Agent (tables + documents volume) — DAB setup-job task (environment_key: sdk).

Reads the committed serialized Genie space (../../genie/genie_space.json, the
serialized_space v2 export format), substitutes {{CATALOG}}/{{SCHEMA}}, then
creates or updates the space via the SDK. Idempotent: looks up by title AND <catalog>.<schema>
(serialized_space), updates if present, creates if not.

Documents: copies the policy library (src/policy_docs, synced by the bundle) into the dedicated
volume <catalog>.<schema>.<docs_volume>, which genie_space.json lists in data_sources.volumes.
Adding the volume enables content search; the task then waits for the volume index to reach
SUCCEEDED, so the first document question never hits `volume_content_search_failed`. Documents
are answered in Agent mode only (POST /api/2.0/genie/agents/{id}/responses).

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
- catalog, schema, warehouse_id, parent_path (workspace folder for a NEW space; optional)

Outputs (dbutils.jobs.taskValues):
- genie_space_id
- documents_volume: /Volumes/<catalog>/<schema>/<docs_volume>
"""

# COMMAND ----------

# EDIT PER DEMO: the space title (hyphen, no '/') used for idempotent lookup, and the documents volume
# (dedicated: the whole volume is indexed) + the bundle folder its files come from.
SPACE_TITLE = "AML-SAR Copilot - Compliance Analytics"
SPACE_DESCRIPTION = (
    "Ask about AML alert volumes, false-positive rates, SAR filing SLAs and the entity networks "
    "behind the open queue at Northwind Federal Bank (fictional), and about the bank's AML policy library."
)
DOCS_VOLUME = "aml_policy_docs"
DOCS_DIR = "src/policy_docs"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")
dbutils.widgets.text("parent_path", "", "Parent folder")
parent_path = dbutils.widgets.get("parent_path")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

# COMMAND ----------

import json
import os
import shutil
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound

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
documents_volume = f"/Volumes/{catalog}/{schema}/{DOCS_VOLUME}"
assert [v["path"] for v in payload["data_sources"].get("volumes", [])] == [documents_volume], \
    f"data_sources.volumes must be exactly [{documents_volume}]"
print(f"tables: {len(payload['data_sources']['tables'])}, volumes: [{documents_volume}], "
      f"sample_questions: {len(payload['config']['sample_questions'])}")

# COMMAND ----------

# Documents → the dedicated volume (before the space references it, so the first index sees every file).
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.{DOCS_VOLUME} "
          "COMMENT 'Documents searched by the Genie agent (the whole volume is indexed)'")
src_dir = f"/Workspace{demo_root}/{DOCS_DIR}"
for f in sorted(os.listdir(src_dir)):
    shutil.copy(os.path.join(src_dir, f), f"{documents_volume}/{f}")
    print("copied", f)

# COMMAND ----------

w = WorkspaceClient()

# Idempotent lookup by exact title (paginate the response object).
# Reuse only OUR space: same title AND built on this catalog.schema. A fork of this template deployed into another
# schema of the same workspace must get its own space, never repoint (hijack) an existing one.
existing_id = None
page_token = None
while not existing_id:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title != SPACE_TITLE:
            continue
        full = w.genie.get_space(space_id=sp.space_id, include_serialized_space=True)
        if f"{catalog}.{schema}." in (full.serialized_space or ""):
            existing_id = sp.space_id
            break
    page_token = getattr(resp, "next_page_token", None)
    if not page_token:
        break

# COMMAND ----------

volume_id = w.volumes.read(f"{catalog}.{schema}.{DOCS_VOLUME}").volume_id

def _index():
    try:
        return w.api_client.do("GET", f"/api/2.0/volume-indexes/{volume_id}")
    except NotFound:
        return None

if existing_id:
    # Content search is only enabled when an update ADDS the volume. A failed earlier attach (e.g. the
    # workspace preview was off) still saves the volume on the space, so a plain re-run would be a no-op
    # and never index. Detach first in that case so the real update re-attaches it.
    if _index() is None:
        no_volumes = json.loads(serialized)
        no_volumes["data_sources"].pop("volumes", None)
        print("No volume index yet — detaching the volume before re-attaching it…")
        w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id,
                             serialized_space=json.dumps(no_volumes))
    print(f"Updating existing space {existing_id}…")
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=serialized)
    space_id = existing_id
else:
    print("Creating new space…")
    kwargs = dict(warehouse_id=warehouse_id, serialized_space=serialized,
                  title=SPACE_TITLE, description=SPACE_DESCRIPTION)
    if parent_path:
        kwargs["parent_path"] = parent_path
    created = w.genie.create_space(**kwargs)
    space_id = created.space_id

print(f"Genie agent ready: {space_id}")

# COMMAND ----------

# Wait for the documents index (private API; PENDING / RUNNING → SUCCEEDED). NOT_FOUND is normal for a few
# seconds right after the space references the volume.
n_docs = len([f for f in os.listdir(documents_volume) if not f.startswith(".")])
started = time.time()
while True:
    elapsed = int(time.time() - started)
    idx = _index()
    if idx is None:
        if elapsed > 5 * 60:
            raise RuntimeError(f"volume index still NOT_FOUND after {elapsed}s — is the volume attached to the agent?")
        print(f"  [{elapsed}s] index not visible yet…")
    else:
        state = idx.get("state", "UNKNOWN")
        done = int((idx.get("file_state_counts") or {}).get("success_files") or 0)
        print(f"  [{elapsed}s] state={state} files={idx.get('file_state_counts', {})} (need {n_docs})")
        # SUCCEEDED alone is not enough: a stale index (e.g. left by an earlier attach) reports SUCCEEDED with no files.
        if state == "SUCCEEDED" and done >= n_docs:
            break
        if state == "SUCCEEDED" and elapsed > 10 * 60:
            raise RuntimeError(f"volume index SUCCEEDED but only {done}/{n_docs} files indexed (watermark "
                               f"{idx.get('index_watermark_time')}) — stale index: point the agent at a fresh volume")
        if state not in ("PENDING", "RUNNING"):
            raise RuntimeError(f"volume index state={state}: {idx.get('error', idx)}")
        if elapsed > 30 * 60:
            raise RuntimeError(f"volume index not SUCCEEDED after {elapsed}s")
    time.sleep(30)
print(f"Documents indexed: {documents_volume}")

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
dbutils.jobs.taskValues.set(key="documents_volume", value=documents_volume)
