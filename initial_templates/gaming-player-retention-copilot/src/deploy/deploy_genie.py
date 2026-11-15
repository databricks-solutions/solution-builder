# Databricks notebook source
"""
Create or update the Hollowspire live-ops Genie space from genie/genie_space.json (serialized-v2).
DAB notebook_task (widgets); also runnable locally:
    DATABRICKS_CONFIG_PROFILE=<your-profile> python src/deploy/deploy_genie.py --catalog gaming \
        --schema player_retention_copilot --warehouse_id <id> --parent_path "/Shared/gaming-player-retention-copilot/..."
Idempotent: looks the space up by exact title and updates it. Sets the task value `genie_space_id`.
"""
import json
import os

SPACE_TITLE = "Hollowspire - Season 7 Live-Ops and Player Retention"
SPACE_DESCRIPTION = (
    "Ask why Hollowspire's retention dropped after the Season 7 launch (2026-08-18): the stage 7-4 Drowned Warden "
    "difficulty spike, 5-8 minute ranked queues in APAC and OCE after the queue split, and harassment of new players "
    "in the cross-play Raid Finder (AI Functions over chat). Covers D1/D7/D30 cohorts, DAU/ARPDAU, the stage funnel, "
    "matchmaking, the churn + LTV model scores with SHAP drivers, at-risk segments, past live-ops interventions and "
    "the interventions scheduled from the Live-Ops Console."
)

try:
    dbutils  # noqa: F821  (notebook task)
    for k in ("catalog", "schema", "warehouse_id", "parent_path"):
        dbutils.widgets.text(k, "", k)  # noqa: F821
    args = {k: dbutils.widgets.get(k) for k in ("catalog", "schema", "warehouse_id", "parent_path")}  # noqa: F821
    # A notebook task runs with the notebook's folder (…/files/src/deploy) as the working directory.
    root = os.path.dirname(os.path.dirname(os.getcwd()))
except NameError:
    import argparse
    ap = argparse.ArgumentParser()
    for k in ("catalog", "schema", "warehouse_id", "parent_path"):
        ap.add_argument(f"--{k}", default="")
    args = vars(ap.parse_known_args()[0])
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from databricks.sdk import WorkspaceClient  # noqa: E402

assert args["catalog"] and args["schema"] and args["warehouse_id"], "catalog + schema + warehouse_id are required"
raw = open(f"{root}/genie/genie_space.json").read()
payload = json.loads(raw.replace("{{CATALOG}}", args["catalog"]).replace("{{SCHEMA}}", args["schema"]))
payload["data_sources"]["tables"] = sorted(payload["data_sources"]["tables"], key=lambda t: t["identifier"])
serialized = json.dumps(payload)

# Plain REST (works with whatever databricks-sdk version the notebook runtime ships).
w = WorkspaceClient()
# Reuse only OUR space: same title AND built on this catalog.schema. A fork of this template deployed into another
# schema of the same workspace must get its own space, never repoint (hijack) an existing one.
existing_id, token = None, None
while not existing_id:
    resp = w.api_client.do("GET", "/api/2.0/genie/spaces", query={"page_size": 200, **({"page_token": token} if token else {})})
    for sp in resp.get("spaces", []):
        if sp.get("title") != SPACE_TITLE:
            continue
        full = w.api_client.do("GET", f"/api/2.0/genie/spaces/{sp['space_id']}", query={"include_serialized_space": "true"})
        if f"{args['catalog']}.{args['schema']}." in (full.get("serialized_space") or ""):
            existing_id = sp["space_id"]
            break
    token = resp.get("next_page_token")
    if not token:
        break

if existing_id:
    w.api_client.do("PATCH", f"/api/2.0/genie/spaces/{existing_id}", body={
        "warehouse_id": args["warehouse_id"], "serialized_space": serialized, "description": SPACE_DESCRIPTION})
    space_id = existing_id
    print(f"updated Genie space {space_id}")
else:
    body = {"warehouse_id": args["warehouse_id"], "serialized_space": serialized, "title": SPACE_TITLE,
            "description": SPACE_DESCRIPTION}
    if args["parent_path"]:
        body["parent_path"] = args["parent_path"]
    space_id = w.api_client.do("POST", "/api/2.0/genie/spaces", body=body)["space_id"]
    print(f"created Genie space {space_id}")

try:
    dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)  # noqa: F821
except NameError:
    pass
