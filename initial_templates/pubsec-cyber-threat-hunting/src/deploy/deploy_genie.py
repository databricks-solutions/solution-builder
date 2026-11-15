# Databricks notebook source
"""
Create (or update) the "Cascadia SOC - Threat Hunting" Genie space from
src/genie/genie_space.json (serialized-v2: tables, instructions, sample questions,
example SQL). Idempotent: looks the space up by title.

Parameters: catalog, schema, warehouse_id, parent_path.  Task value out: genie_space_id
"""

# COMMAND ----------

for k in ("catalog", "schema", "warehouse_id", "parent_path"):
    dbutils.widgets.text(k, "", k)
catalog, schema = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
warehouse_id, parent_path = dbutils.widgets.get("warehouse_id"), dbutils.widgets.get("parent_path")
assert catalog and schema and warehouse_id

SPACE_TITLE = "Cascadia SOC - Threat Hunting"
DESCRIPTION = ("Ask about the Cascadia Department of Revenue's security telemetry and SOC performance: MTTD / MTTR by incident category, "
               "alert volume and true-positive rate per detection rule, ATT&CK detection coverage, password-spray scoping, UEBA risk, DNS / VPN / EDR hunting.")

# COMMAND ----------

import json
import os

from databricks.sdk import WorkspaceClient

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
serialized = open(f"/Workspace{bundle_root}/src/genie/genie_space.json").read()
serialized = serialized.replace("cybersecurity.threat_hunting_copilot", f"{catalog}.{schema}")
payload = json.loads(serialized)
payload["data_sources"]["tables"] = sorted(payload["data_sources"]["tables"], key=lambda t: t["identifier"])
payload["instructions"]["example_question_sqls"] = sorted(payload["instructions"].get("example_question_sqls", []), key=lambda e: e["id"])
# Documents: the dedicated volume (filled by the upload task; the WHOLE volume is indexed) is a Genie data source.
DOCS_VOLUME = 'ir_playbook'
documents_volume = f"/Volumes/{catalog}/{schema}/{DOCS_VOLUME}"
payload["data_sources"]["volumes"] = [{"path": documents_volume, "description": ["CDOR CSOC incident-response playbook (6 Markdown chapters, PB-1..PB-6): severity matrix + escalation and notification deadlines (FTI \u2192 IRS Safeguards / TIGTA 24h), identity compromise, phishing / malware / web, lateral movement, collection & exfiltration, impact + ATT&CK mapping and containment actions. Use it for severity / notification / response-step questions, not for numbers. Cite the playbook section (e.g. PB-1.2)."]}]
serialized = json.dumps(payload)

w = WorkspaceClient()
existing_id, token = None, None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=token)
    existing_id = next((s.space_id for s in (resp.spaces or []) if s.title == SPACE_TITLE), None)
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    token = resp.next_page_token

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
import os
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
