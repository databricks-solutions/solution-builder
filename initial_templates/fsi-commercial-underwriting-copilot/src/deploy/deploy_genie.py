# Databricks notebook source
"""
Create (or update) the "Tidewell Commercial Underwriting - Portfolio & Queue" Genie space from
src/genie/genie_space.json (serialized-v2: tables, instructions, sample questions,
example SQL). Idempotent: reuses the space with this title built on <catalog>.<schema>.

Parameters: catalog, schema, warehouse_id, parent_path.  Task value out: genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "warehouse_id", "parent_path"):
    dbutils.widgets.text(k, "", k)
catalog, schema = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
warehouse_id, parent_path = dbutils.widgets.get("warehouse_id"), dbutils.widgets.get("parent_path")
assert catalog and schema and warehouse_id

SPACE_TITLE = "Tidewell Commercial Underwriting - Portfolio & Queue"
DESCRIPTION = ("Ask about Tidewell's commercial property book and today's underwriting queue: loss ratio by segment, state, roof age "
               "and quarter (2024-Q3 to 2026-Q2), perils, brokers and hit ratios, the 24 submissions waiting for review with their "
               "triage lane, discrepancies and ML risk, and the decisions the desk has issued.")

# COMMAND ----------

import json
import os

from databricks.sdk import WorkspaceClient

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))  # <root>/src/deploy/deploy_genie
serialized = open(f"/Workspace{bundle_root}/genie/genie_space.json").read()
serialized = serialized.replace("financial_services.commercial_underwriting_copilot", f"{catalog}.{schema}")
payload = json.loads(serialized)
payload["data_sources"]["tables"] = sorted(payload["data_sources"]["tables"], key=lambda t: t["identifier"])
payload["instructions"]["example_question_sqls"] = sorted(payload["instructions"].get("example_question_sqls", []), key=lambda e: e["id"])
# Documents: the dedicated volume (filled by the upload task; the WHOLE volume is indexed) is a Genie data source.
DOCS_VOLUME = 'uw_guidelines'
documents_volume = f"/Volumes/{catalog}/{schema}/{DOCS_VOLUME}"
payload["data_sources"]["volumes"] = [{"path": documents_volume, "description": ["Tidewell Specialty Insurance underwriting guideline library (6 Markdown documents): TSI-UW-01 commercial property & package guidelines, appetite bulletin TSI-UW-B-2026-07 (hail-belt habitational roof age), TSI-RATE-03 rating manual, TSI-AUTH-02 authority & referral matrix, TSI-DOC-04 documentation standards, TSI-CAT-05 catastrophe / wind & hail. Use it for appetite, rating, authority and documentation questions, not for numbers. Cite the document ID and section."]}]
serialized = json.dumps(payload)

w = WorkspaceClient()
# Reuse only OUR space: same title AND built on this catalog.schema. A fork of this template deployed into another
# schema of the same workspace must get its own space, never repoint (hijack) an existing one.
existing_id, token = None, None
while not existing_id:
    resp = w.genie.list_spaces(page_size=200, page_token=token)
    for sp in (resp.spaces or []):
        if sp.title != SPACE_TITLE:
            continue
        full = w.genie.get_space(space_id=sp.space_id, include_serialized_space=True)
        if f"{catalog}.{schema}." in (full.serialized_space or ""):
            existing_id = sp.space_id
            break
    token = getattr(resp, "next_page_token", None)
    if not token:
        break

if existing_id:
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=serialized,
                         title=SPACE_TITLE, description=DESCRIPTION)
    space_id = existing_id
else:
    kwargs = dict(warehouse_id=warehouse_id, title=SPACE_TITLE, description=DESCRIPTION, serialized_space=serialized)
    if parent_path:
        kwargs["parent_path"] = parent_path
    space_id = w.genie.create_space(**kwargs).space_id
print(f"Genie space: {space_id}")
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
