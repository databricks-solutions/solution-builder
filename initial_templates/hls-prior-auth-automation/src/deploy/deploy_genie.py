# Databricks notebook source
"""
Deploy the MedVault Prior Authorization Genie space — DAB setup-job task.

Reads genie/genie_space.json (serialized_space v2), substitutes {{CATALOG}}/{{SCHEMA}},
sorts data_sources.tables (required), then creates or updates the space (looked up by
exact title), parented in the demo's workspace folder. Title has no '/'.

Parameters: catalog, schema, warehouse_id, parent_path (workspace folder)
Output task value: genie_space_id
"""

# COMMAND ----------

import json
import os

from databricks.sdk import WorkspaceClient

SPACE_TITLE = "MedVault Prior Authorization Operations"
SPACE_DESCRIPTION = (
    "Ask about MedVault Health Plan's prior-authorization operations (synthetic data): CMS-0057-F "
    "turnaround (72h expedited / 7-day standard), SLA breaches, pend and denial rates by practice group "
    "and service, first-pass-clean (auto-approval candidate) rate, the auto-approval pilot, and the "
    "open queue's AI pre-review lanes."
)

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")
dbutils.widgets.text("parent_path", "", "Workspace folder for the space")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
parent_path = dbutils.widgets.get("parent_path") or None
assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

# COMMAND ----------

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
demo_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
with open(f"/Workspace{demo_root}/genie/genie_space.json") as f:
    raw = f.read().replace("{{CATALOG}}", catalog).replace("{{SCHEMA}}", schema)
payload = json.loads(raw)
payload["data_sources"]["tables"] = sorted(payload["data_sources"]["tables"], key=lambda t: t["identifier"])
# Documents: the dedicated volume (filled by the upload task; the WHOLE volume is indexed) is a Genie data source.
DOCS_VOLUME = 'policy_docs'
documents_volume = f"/Volumes/{catalog}/{schema}/{DOCS_VOLUME}"
payload["data_sources"]["volumes"] = [{"path": documents_volume, "description": ["MedVault Health Plan medical policy library (12 Markdown documents): 11 medical policies (MV-RAD-014 lumbar MRI, MV-RAD-022, MV-CAR-005, MV-ORT-007, MV-ORT-011, MV-SLP-003, MV-DME-019, MV-PHM-042, MV-ONC-012, MV-GAS-002, MV-REH-009 \u2014 coverage criteria, required documentation, auto-approval eligibility) and the UM program description MV-UM-000 (who may deny, gold carding, CMS-0057-F turnaround). Use it for policy questions, not for numbers. Cite the policy id and section."]}]
serialized = json.dumps(payload)

w = WorkspaceClient()
# Reuse only OUR space: same title AND built on this catalog.schema. A fork of this template deployed into another
# schema of the same workspace must get its own space, never repoint (hijack) an existing one.
existing_id, page_token = None, None
while not existing_id:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in resp.spaces or []:
        if sp.title != SPACE_TITLE:
            continue
        full = w.genie.get_space(space_id=sp.space_id, include_serialized_space=True)
        if f"{catalog}.{schema}." in (full.serialized_space or ""):
            existing_id = sp.space_id
            break
    page_token = getattr(resp, "next_page_token", None)
    if not page_token:
        break

if existing_id:
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=serialized,
                         title=SPACE_TITLE, description=SPACE_DESCRIPTION)
    space_id = existing_id
else:
    space_id = w.genie.create_space(warehouse_id=warehouse_id, serialized_space=serialized, title=SPACE_TITLE,
                                    description=SPACE_DESCRIPTION, parent_path=parent_path).space_id
print(f"Genie space ready: {space_id}")
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)

# COMMAND ----------

# Documents: the volume listed in data_sources.volumes is indexed for content search (enabled automatically when a
# create/update ADDS the volume). Wait for the index (private API; PENDING / RUNNING → SUCCEEDED) so the first
# document question never hits `volume_content_search_failed`. Documents are answered in Agent mode only.
import time
from databricks.sdk.errors import NotFound

volume_id = w.volumes.read(f"{catalog}.{schema}.{DOCS_VOLUME}").volume_id

def _index():
    try:
        return w.api_client.do("GET", f"/api/2.0/volume-indexes/{volume_id}")
    except NotFound:
        return None

time.sleep(15)  # NOT_FOUND is normal for a few seconds after the space first references the volume
if _index() is None:
    # A failed earlier attach (e.g. the workspace preview was off) still saves the volume on the space, so the
    # update above was a no-op for it and never indexed. Detach, then re-attach to enable content search.
    print("No volume index — detaching + re-attaching the documents volume…")
    no_volumes = json.loads(serialized)
    no_volumes["data_sources"].pop("volumes", None)
    w.genie.update_space(space_id=space_id, warehouse_id=warehouse_id, serialized_space=json.dumps(no_volumes))
    w.genie.update_space(space_id=space_id, warehouse_id=warehouse_id, serialized_space=serialized)

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
dbutils.jobs.taskValues.set(key="documents_volume", value=documents_volume)
