# Databricks notebook source
"""
Deploy the LuxeBeauty Genie Agent (tables + documents volume).

Loads `src/genie/genie_space.json` (curated questions + curated SQLs + story
instructions + the PDF documents volume) and substitutes the catalog/schema before
sending to the API. Idempotent: searches by title, updates if present, creates if not.

Documents: the PDFs in the `manufacturing_reports` volume are attached to the agent as
`data_sources.volumes`. Content search is enabled automatically on create/update; this
task waits for the volume index to reach SUCCEEDED so the first document question never
hits `volume_content_search_failed`. Runs AFTER upload_pdfs (the index needs the PDFs).

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest in databricks.yml).

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema:  Schema name
- warehouse_id: SQL warehouse the Genie space uses

Outputs (via dbutils.jobs.taskValues.set):
- genie_space_id:   the resolved space ID (consumed by export_resources)
- documents_volume: /Volumes/<catalog>/<schema>/manufacturing_reports
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")
dbutils.widgets.text("title", "LuxeBeauty Operations Analytics", "Genie space title")
dbutils.widgets.text("parent_path", "", "Workspace folder for the space")

catalog      = dbutils.widgets.get("catalog")
schema       = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")

assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

SPACE_TITLE = dbutils.widgets.get("title") or "LuxeBeauty Operations Analytics"
PARENT_PATH = dbutils.widgets.get("parent_path")
print(f"Deploying Genie Space: '{SPACE_TITLE}'")
print(f"  catalog.schema: {catalog}.{schema}")
print(f"  warehouse:      {warehouse_id}")

# COMMAND ----------

import json
import os
import time
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound

# Locate genie_space.json (sibling dir genie/ relative to this notebook).
# Bundle files root: the job passes ${workspace.file_path}; fallback = 3 levels above this notebook.
dbutils.widgets.text("files_root", "", "Bundle files root")
_files_root = dbutils.widgets.get("files_root")
if _files_root:
    bundle_root = _files_root.removeprefix("/Workspace")
else:
    notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
    bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path))).removeprefix("/Workspace")
config_path   = f"/Workspace{bundle_root}/src/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    serialized = f.read()

# Substitute catalog/schema. The committed file uses the reference values verbatim
# so we do a literal string-replace (faster + safer than walking the JSON
# tree — the same prefix appears in table identifiers AND inside SQL bodies).
SRC_QUALIFIER = "retail_consumer_goods.luxebeauty_demo"
DST_QUALIFIER = f"{catalog}.{schema}"
SRC_VOLUME_PREFIX = "/Volumes/retail_consumer_goods/luxebeauty_demo/"
DST_VOLUME_PREFIX = f"/Volumes/{catalog}/{schema}/"
DOCS_VOLUME = "manufacturing_reports"
substituted = (serialized
               .replace(SRC_QUALIFIER, DST_QUALIFIER)
               .replace(SRC_VOLUME_PREFIX, DST_VOLUME_PREFIX))
print(f"Substituted {serialized.count(SRC_QUALIFIER)} occurrences of {SRC_QUALIFIER} → {DST_QUALIFIER}")
print(f"Substituted {serialized.count(SRC_VOLUME_PREFIX)} occurrences of {SRC_VOLUME_PREFIX} → {DST_VOLUME_PREFIX}")

# Validate it still parses cleanly — and keep data_sources.tables sorted by identifier (the API rejects an
# unsorted list, and a catalog/schema rename can change the order).
space_payload = json.loads(substituted)
space_payload["data_sources"]["tables"].sort(key=lambda t: t["identifier"])
substituted = json.dumps(space_payload)
documents_volume = f"{DST_VOLUME_PREFIX}{DOCS_VOLUME}"
volumes = space_payload["data_sources"].get("volumes", [])
assert [v["path"] for v in volumes] == [documents_volume], f"data_sources.volumes must be [{documents_volume}], got {volumes}"
print(f"data_sources.volumes: {[v['path'] for v in volumes]}")
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
        if sp.title != SPACE_TITLE:
            continue
        # Only reuse OUR space: another install with the same title may exist elsewhere in the workspace.
        if PARENT_PATH:
            got = (w.api_client.do("GET", f"/api/2.0/genie/spaces/{sp.space_id}").get("parent_path") or "").removeprefix("/Workspace")
            if got != PARENT_PATH.removeprefix("/Workspace"):
                print(f"Skipping same-title space {sp.space_id} in {got}")
                continue
        existing_id = sp.space_id
        print(f"Found existing space: {existing_id}")
        break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

description = (
    "LuxeBeauty Operations Assistant. Tracks the production-incident-driven "
    "refunds spike, surfaces customer feedback, reports per-customer premium "
    "tiering for the retention flow, and answers policy / SOP / incident "
    "questions from the attached PDF documents. Walk the curated questions in "
    "order on a cold start."
)

volume_id = w.volumes.read(f"{catalog}.{schema}.{DOCS_VOLUME}").volume_id

def _index_exists():
    try:
        w.api_client.do("GET", f"/api/2.0/volume-indexes/{volume_id}")
        return True
    except NotFound:
        return False

if existing_id:
    # Content search is only enabled when an update ADDS the volume. A failed
    # earlier attach (e.g. workspace preview off) still saves the volume on the
    # space, so a plain re-run would be a no-op update and never index. Detach
    # first in that case so the real update re-attaches it (and surfaces the
    # real error, e.g. VOLUME_INDEX_FEATURE_PREVIEW_NOT_ENABLED).
    if not _index_exists():
        no_volumes = json.loads(substituted)
        no_volumes["data_sources"].pop("volumes", None)
        print("No volume index yet — detaching the volume before re-attaching it…")
        w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id,
                             serialized_space=json.dumps(no_volumes))
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
        description=description,
        serialized_space=substituted,
        **({"parent_path": PARENT_PATH} if PARENT_PATH else {}),
    )
    space_id = created.space_id

print(f"Genie space ready: {space_id}")

# COMMAND ----------

# Wait for the documents volume index. Content search is enabled by create/update-space; the
# index endpoint is undocumented (GET /api/2.0/volume-indexes/{volume_id}). PENDING/RUNNING →
# SUCCEEDED; any other state is a failure. NOT_FOUND is expected for a few seconds after the
# space references the volume, so it gets a short grace window.
INDEX_TIMEOUT_S = 30 * 60
INDEX_GRACE_S   = 5 * 60
POLL_S          = 30

print(f"Waiting for content index of {documents_volume} (volume_id={volume_id})…")
n_docs = len([f for f in os.listdir(documents_volume) if not f.startswith(".")])

started = time.time()
while True:
    elapsed = int(time.time() - started)
    try:
        idx = w.api_client.do("GET", f"/api/2.0/volume-indexes/{volume_id}")
    except NotFound:
        if elapsed > INDEX_GRACE_S:
            raise RuntimeError(f"volume index still NOT_FOUND after {elapsed}s — is the volume attached to the agent?")
        print(f"  [{elapsed}s] index not visible yet, retrying…")
        time.sleep(POLL_S)
        continue
    state  = idx.get("state", "UNKNOWN")
    counts = idx.get("file_state_counts", {})
    print(f"  [{elapsed}s] state={state} files={counts} (need {n_docs})")
    done = int((counts or {}).get("success_files") or 0)
    # SUCCEEDED alone is not enough: a stale index (left by an earlier attach) can report SUCCEEDED with no files.
    if state == "SUCCEEDED" and done >= n_docs:
        break
    if state == "SUCCEEDED" and elapsed > 10 * 60:
        raise RuntimeError(f"volume index SUCCEEDED but only {done}/{n_docs} files indexed (watermark "
                           f"{idx.get('index_watermark_time')}) — stale index: point the agent at a fresh volume")
    if state not in ("PENDING", "RUNNING"):
        raise RuntimeError(f"volume index state={state}: {idx.get('error', idx)}")
    if elapsed > INDEX_TIMEOUT_S:
        raise RuntimeError(f"volume index not SUCCEEDED after {elapsed}s (last state={state})")
    time.sleep(POLL_S)
print(f"Documents indexed: {documents_volume}")

# COMMAND ----------

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
dbutils.jobs.taskValues.set(key="documents_volume", value=documents_volume)
print(f"task value set: genie_space_id = {space_id}, documents_volume = {documents_volume}")
