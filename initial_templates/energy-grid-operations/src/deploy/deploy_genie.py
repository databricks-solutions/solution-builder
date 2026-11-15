#!/usr/bin/env python
"""
Create or update the demo's Genie space from genie/genie_space.json (serialized v2).

Runs as a DAB spark_python_task (setup job) or locally:
    DATABRICKS_CONFIG_PROFILE=<your-profile> python src/deploy/deploy_genie.py \
        --catalog energy_utilities --schema grid_operations_copilot \
        --warehouse_id <your-warehouse-id> \
        --parent_path "/Shared/energy-grid-operations/ENERGY-Grid-Operations-Copilot"

Idempotent: reuses (updates) the space with this exact title that is built on <catalog>.<schema>; creates it otherwise
(a fork in another schema of the same workspace gets its own space).

GOTCHAS (kept on purpose):
  • data_sources.tables MUST be sorted by identifier ("Invalid export proto").
  • The TITLE becomes a workspace item → no '/' in it.
  • list_spaces returns a response object — paginate on next_page_token.
  • Never trash a space by title match; only by the exact id you created.
"""
import argparse
import json
import os

from databricks.sdk import WorkspaceClient

SPACE_TITLE = "Grid Ops Copilot - MREC heat-wave overload"
SPACE_DESCRIPTION = (
    "Control-room analytics for Midwest Regional Electric Cooperative: transformer loading and the 48 h "
    "temperature-aware load forecast, asset health (DGA, hot-spot), costed relief options (demand response, "
    "feeder switching, DER dispatch), critical facilities, and SAIDI/SAIFI reliability. Start with: "
    "'Which transformers are at risk of overload tomorrow?'"
)

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", required=True)
ap.add_argument("--schema", required=True)
ap.add_argument("--warehouse_id", required=True)
ap.add_argument("--parent_path", default="")
ap.add_argument("--config", default="")
args, _ = ap.parse_known_args()

here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
config_path = args.config or os.path.join(here, "..", "..", "genie", "genie_space.json")
raw = open(config_path).read().replace("{{CATALOG}}", args.catalog).replace("{{SCHEMA}}", args.schema)
payload = json.loads(raw)
payload["data_sources"]["tables"] = sorted(payload["data_sources"]["tables"], key=lambda t: t["identifier"])
serialized = json.dumps(payload)

w = WorkspaceClient()
# Reuse only OUR space: same title AND built on this catalog.schema. A fork of this template deployed into another
# schema of the same workspace must get its own space, never repoint (hijack) an existing one.
existing = None
token = None
while not existing:
    resp = w.genie.list_spaces(page_size=200, page_token=token)
    for sp in resp.spaces or []:
        if sp.title != SPACE_TITLE:
            continue
        full = w.genie.get_space(space_id=sp.space_id, include_serialized_space=True)
        if f"{args.catalog}.{args.schema}." in (full.serialized_space or ""):
            existing = sp.space_id
            break
    token = getattr(resp, "next_page_token", None)
    if not token:
        break

if existing:
    w.genie.update_space(space_id=existing, warehouse_id=args.warehouse_id, serialized_space=serialized,
                         title=SPACE_TITLE, description=SPACE_DESCRIPTION)
    space_id = existing
    print(f"updated Genie space {space_id}")
else:
    kw = dict(warehouse_id=args.warehouse_id, serialized_space=serialized, title=SPACE_TITLE,
              description=SPACE_DESCRIPTION)
    if args.parent_path:
        kw["parent_path"] = args.parent_path
    space_id = w.genie.create_space(**kw).space_id
    print(f"created Genie space {space_id}")

print(f"GENIE_SPACE_ID={space_id}")
if os.environ.get("DATABRICKS_RUNTIME_VERSION"):  # inside a job: surface the id to downstream tasks
    from databricks.sdk.runtime import dbutils
    dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
