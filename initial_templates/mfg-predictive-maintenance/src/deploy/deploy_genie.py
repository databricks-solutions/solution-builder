"""Create (or update) the Genie agent from genie/genie_space.json (serialized-v2) + the plant manuals volume
(filled by upload_manuals), then wait until every manual is indexed. Idempotent by title + catalog.schema.
The committed JSON uses manufacturing.predictive_maintenance_copilot; it is rewritten to the target."""
import argparse
import json

from databricks.sdk import WorkspaceClient

TITLE = "TechRobotics Plant Reliability Genie"
DESCRIPTION = ("Ask about OEE, unplanned downtime, MTBF, failure history, maintenance work orders, "
               "ML failure-risk scores and spare parts for TechRobotics Greenville Plant 2.")

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", required=True)
ap.add_argument("--schema", required=True)
ap.add_argument("--warehouse-id", required=True)
ap.add_argument("--parent-path", required=True)
ap.add_argument("--config", required=True)
a, _ = ap.parse_known_args()

path = a.config if a.config.startswith("/Workspace") else "/Workspace" + a.config
raw = open(path).read().replace("manufacturing.predictive_maintenance_copilot", f"{a.catalog}.{a.schema}")
space = json.loads(raw)
space["data_sources"]["tables"].sort(key=lambda t: t["identifier"])
# Documents: the dedicated manuals volume (the WHOLE volume is indexed) is a Genie data source.
DOCS_VOLUME = "manuals"
documents_volume = f"/Volumes/{a.catalog}/{a.schema}/{DOCS_VOLUME}"
space["data_sources"]["volumes"] = [{"path": documents_volume, "description": [
    "TechRobotics Greenville Plant 2 maintenance library (8 PDF manuals): engineering standard ES-ROB-014 (FANUC M-20iD "
    "reducer lubrication, approved greases), CAPA-0117 (RA-203 J3 reducer failure root cause), RP-VIB-002 vibration "
    "severity & response, MPS-004 maintenance planning & downtime cost, SOW-CIS-2025 contractor PM scope, MM-PRS-009 "
    "servo press, TS-CNC-021 coolant troubleshooting, SAF-LOTO-003 lockout. Use it for approved lubricants, failure "
    "symptoms, corrective procedures and durations, not for numbers. Cite the document code and section."]}]
serialized = json.dumps(space)
w = WorkspaceClient()

# Reuse only OUR space: same title AND built on this catalog.schema. A fork of this template deployed into another
# schema of the same workspace must get its own space, never repoint (hijack) an existing one.
existing = None
tok = None
while not existing:
    r = w.genie.list_spaces(page_size=200, page_token=tok)
    for s in r.spaces or []:
        if s.title != TITLE:
            continue
        full = w.genie.get_space(space_id=s.space_id, include_serialized_space=True)
        if f"{a.catalog}.{a.schema}." in (full.serialized_space or ""):
            existing = s.space_id
            break
    tok = r.next_page_token
    if not tok:
        break
if existing:
    w.genie.update_space(existing, serialized_space=serialized, title=TITLE, description=DESCRIPTION,
                         warehouse_id=a.warehouse_id)
    sid = existing
    print("updated", sid)
else:
    sid = w.genie.create_space(a.warehouse_id, serialized, title=TITLE, description=DESCRIPTION,
                               parent_path=a.parent_path).space_id
    print("created", sid)
# Documents: the volume listed in data_sources.volumes is indexed for content search (enabled automatically when a
# create/update ADDS the volume). Wait for the index (private API; PENDING / RUNNING → SUCCEEDED) so the first
# document question never hits `volume_content_search_failed`. Documents are answered in Agent mode only.
import os
import time
from databricks.sdk.errors import NotFound

volume_id = w.volumes.read(f"{a.catalog}.{a.schema}.{DOCS_VOLUME}").volume_id

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
    w.genie.update_space(space_id=sid, warehouse_id=a.warehouse_id, serialized_space=json.dumps(no_volumes))
    w.genie.update_space(space_id=sid, warehouse_id=a.warehouse_id, serialized_space=serialized)

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
print(json.dumps({"genie_space_id": sid, "documents_volume": documents_volume}))
