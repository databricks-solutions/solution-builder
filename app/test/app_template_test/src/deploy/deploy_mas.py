# Databricks notebook source
"""
Deploy the LuxeBeauty Multi-Agent Supervisor.

Reads `src/supervisor_agent/supervisor_agent.json` for the MAS shape
(display_name, description, instructions + 2 tool stubs). Substitutes the
Genie space_id + KA endpoint name from upstream taskValues, then creates
or updates the MAS via REST (`/api/2.0/multi-agent-supervisors`).

Idempotent.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest).

Parameters:
- catalog, schema (unused for content but kept for log clarity)
- genie_space_id  (from deploy_genie taskValue)
- ka_endpoint_name (from deploy_ka taskValue)

Outputs (taskValues):
- mas_endpoint_name
- mas_tile_id
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")
dbutils.widgets.text("genie_space_id", "", "Genie Space ID")
dbutils.widgets.text("ka_endpoint_name", "", "KA Endpoint Name")

catalog          = dbutils.widgets.get("catalog")
schema           = dbutils.widgets.get("schema")
genie_space_id   = dbutils.widgets.get("genie_space_id")
ka_endpoint_name = dbutils.widgets.get("ka_endpoint_name")
assert genie_space_id, "genie_space_id missing — deploy_genie didn't run?"
assert ka_endpoint_name, "ka_endpoint_name missing — deploy_ka didn't run?"

print(f"Genie:  {genie_space_id}")
print(f"KA:     {ka_endpoint_name}")

# COMMAND ----------

import json
import os
import re
import time
import requests
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path   = f"/Workspace{bundle_root}/src/supervisor_agent/supervisor_agent.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    cfg = json.load(f)

sa_meta = cfg["supervisor_agent"]
MAS_NAME = sa_meta["display_name"]
description  = sa_meta.get("description", "")
instructions = sa_meta.get("instructions", "")

# Build the agents list. Tool order matches the existing config (KA first,
# then Genie); the agent ordering is arbitrary at the API level — the
# `description` field is what the MAS LLM uses to pick between them.
agents = []
for tool in cfg["tools"]:
    if tool["tool_type"] == "knowledge_assistant":
        agents.append({
            "name": tool["tool_id"],
            "description": tool["description"],
            "agent_type": "serving_endpoint",
            "serving_endpoint": {"name": ka_endpoint_name},
        })
    elif tool["tool_type"] == "genie_space":
        agents.append({
            "name": tool["tool_id"],
            "description": tool["description"],
            "agent_type": "genie",
            "genie_space": {"id": genie_space_id},
        })

print(f"Configured {len(agents)} agents: {[a['name'] for a in agents]}")

# COMMAND ----------

def _request(method, path, body=None, params=None):
    headers = w.config.authenticate()
    if body:
        headers["Content-Type"] = "application/json"
    resp = requests.request(method, f"{w.config.host}{path}", headers=headers,
                            json=body, params=params, timeout=300)
    if resp.status_code >= 400:
        try: msg = resp.json().get("message", resp.text)
        except Exception: msg = resp.text
        raise Exception(f"{method} {path}: {msg}")
    return resp.json() if resp.text else {}

def _sanitize(name):
    name = re.sub(r"[^a-zA-Z0-9_-]", "_", name.replace(" ", "_"))
    return re.sub(r"_+", "_", name).strip("_") or "supervisor_agent"

sanitized_name = _sanitize(MAS_NAME)

# COMMAND ----------

# Find existing MAS by sanitized name.
existing_id = None
page_token  = None
while True:
    params = {"filter": f"name_contains={sanitized_name}&&tile_type=MAS"}
    if page_token: params["page_token"] = page_token
    resp = _request("GET", "/api/2.0/tiles", params=params)
    for t in resp.get("tiles", []):
        if t.get("name") == sanitized_name:
            existing_id = t["tile_id"]
            print(f"Found existing MAS: {existing_id}")
            break
    if existing_id or not resp.get("next_page_token"):
        break
    page_token = resp["next_page_token"]

# COMMAND ----------

if existing_id:
    payload = {
        "tile_id": existing_id,
        "name": sanitized_name,
        "description": description,
        "instructions": instructions,
        "agents": agents,
    }
    _request("PATCH", f"/api/2.0/multi-agent-supervisors/{existing_id}", payload)
    tile_id = existing_id
    was_created = False
    print(f"MAS updated: {tile_id}")
else:
    payload = {
        "name": sanitized_name,
        "description": description,
        "instructions": instructions,
        "agents": agents,
    }
    resp = _request("POST", "/api/2.0/multi-agent-supervisors", payload)
    tile_id = resp.get("multi_agent_supervisor", {}).get("tile", {}).get("tile_id", "")
    was_created = True
    print(f"MAS created: {tile_id}")

# COMMAND ----------

# Only wait for ONLINE on first creation. On updates we exit immediately —
# the endpoint re-provisions async and downstream tasks tolerate a
# briefly-503 endpoint.
def wait_online(tile_id, timeout_s=900, interval=20):
    elapsed = 0
    while elapsed < timeout_s:
        try:
            r = _request("GET", f"/api/2.0/multi-agent-supervisors/{tile_id}")
            mas = r.get("multi_agent_supervisor", {})
            state = mas.get("status", {}).get("endpoint_status", "UNKNOWN")
            if state == "ONLINE":
                print("MAS is ONLINE")
                return True
            if state in ("FAILED", "OFFLINE"):
                raise Exception(f"MAS endpoint {state}")
            print(f"  state={state} elapsed={elapsed}s")
        except Exception as e:
            if "not found" not in str(e).lower(): raise
        time.sleep(interval); elapsed += interval
    print(f"WARN: timeout after {timeout_s}s — continuing anyway")
    return False

if was_created:
    print("MAS newly created — waiting for first-time provisioning…")
    wait_online(tile_id)
else:
    print("MAS already existed — skipping wait (re-provisioning runs async).")

# COMMAND ----------

# The deployed endpoint name follows the convention "mas-<short-id>-endpoint"
# (same shape as KA's). Save both for the app config.
mas_endpoint_name = f"mas-{tile_id.split('-')[0]}-endpoint"

dbutils.jobs.taskValues.set(key="mas_tile_id", value=tile_id)
dbutils.jobs.taskValues.set(key="mas_endpoint_name", value=mas_endpoint_name)
print(f"task values: mas_tile_id={tile_id} mas_endpoint_name={mas_endpoint_name}")
