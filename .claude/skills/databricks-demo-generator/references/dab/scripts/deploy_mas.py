# Databricks notebook source
"""
Deploy Multi-Agent Supervisor (MAS) - Reference script for DAB workflow task.
REQUIRES: databricks-sdk>=0.102.0 (use sdk_latest environment)

Creates or updates a Multi-Agent Supervisor using direct REST API calls.
The MAS API is not yet fully in the SDK, so we use authenticated HTTP requests.
Idempotent: safe to re-run.

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema: Schema name
- genie_space_id: Genie Space ID from upstream deploy_genie task
- ka_tile_id: Knowledge Assistant tile ID from upstream deploy_ka task

Outputs (via dbutils.jobs.taskValues.set):
- mas_tile_id: The created/updated MAS tile ID
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("genie_space_id", "", "Genie Space ID")
dbutils.widgets.text("ka_tile_id", "", "KA Tile ID")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
genie_space_id = dbutils.widgets.get("genie_space_id")
ka_tile_id = dbutils.widgets.get("ka_tile_id")

MAS_NAME = "Demo Supervisor Agent"  # Customize for your demo
print(f"Deploying Multi-Agent Supervisor: '{MAS_NAME}'")
print(f"  Genie Space ID: {genie_space_id}")
print(f"  KA Tile ID: {ka_tile_id}")

# COMMAND ----------

import re
import time
import requests
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

description = f"Intelligent routing for {catalog}.{schema} queries"
instructions = """Route queries to the appropriate specialist:
- Data questions, metrics, SQL queries -> Data Explorer (Genie)
- Documentation, guides, how-to questions -> Knowledge Assistant
When uncertain, prefer Data Explorer for quantitative questions and Knowledge Assistant for conceptual questions."""


def _request(method: str, path: str, body: dict = None, params: dict = None) -> dict:
    """Make authenticated HTTP request to Databricks API."""
    url = f"{w.config.host}{path}"
    headers = w.config.authenticate()
    if body:
        headers["Content-Type"] = "application/json"

    resp = requests.request(method, url, headers=headers, json=body, params=params, timeout=300)

    if resp.status_code >= 400:
        try:
            err = resp.json().get("message", resp.text)
        except Exception:
            err = resp.text
        raise Exception(f"{method} {path}: {err}")

    return resp.json() if resp.text else {}


def _sanitize_name(name: str) -> str:
    """Sanitize name to alphanumeric with hyphens/underscores."""
    name = re.sub(r"[^a-zA-Z0-9_-]", "_", name.replace(" ", "_"))
    name = re.sub(r"_+", "_", name).strip("_")
    return name or "supervisor_agent"

# COMMAND ----------

# Build agent list from upstream task outputs
agents = []

if genie_space_id:
    agents.append({
        "name": "Data_Explorer",
        "description": "Use for SQL queries, data analysis, metrics, and quantitative questions",
        "agent_type": "genie",
        "genie_space": {"id": genie_space_id},
    })

if ka_tile_id:
    agents.append({
        "name": "Knowledge_Assistant",
        "description": "Use for documentation, guides, how-to, and conceptual questions",
        "agent_type": "serving_endpoint",
        "serving_endpoint": {"name": f"ka-{ka_tile_id.split('-')[0]}-endpoint"},
    })

if not agents:
    raise Exception("No agents configured. Provide at least genie_space_id or ka_tile_id.")

print(f"Configured {len(agents)} agents")

# COMMAND ----------

# Check whether the MAS already exists
existing_id = None
sanitized_name = _sanitize_name(MAS_NAME)
page_token = None

print("Searching for existing Supervisor Agents...")
while True:
    params = {"filter": f"name_contains={sanitized_name}&&tile_type=MAS"}
    if page_token:
        params["page_token"] = page_token

    resp = _request("GET", "/api/2.0/tiles", params=params)

    for t in resp.get("tiles", []):
        if t.get("name") == sanitized_name:
            existing_id = t["tile_id"]
            print(f"  Found: {t.get('name')} ({existing_id})")
            break

    if existing_id or not resp.get("next_page_token"):
        break
    page_token = resp["next_page_token"]

# COMMAND ----------

if existing_id:
    print(f"Updating existing Supervisor Agent: {existing_id}")

    payload = {
        "tile_id": existing_id,
        "name": sanitized_name,
        "description": description,
        "instructions": instructions,
        "agents": agents,
    }

    resp = _request("PATCH", f"/api/2.0/multi-agent-supervisors/{existing_id}", payload)
    tile_id = existing_id
    print(f"Supervisor Agent updated: {tile_id}")
else:
    print("Creating new Supervisor Agent...")

    payload = {
        "name": sanitized_name,
        "description": description,
        "instructions": instructions,
        "agents": agents,
    }

    resp = _request("POST", "/api/2.0/multi-agent-supervisors", payload)
    mas = resp.get("multi_agent_supervisor", {})
    tile_id = mas.get("tile", {}).get("tile_id", "")
    print(f"Supervisor Agent created: {tile_id}")

# COMMAND ----------

# Wait for MAS endpoint to become ONLINE
def wait_for_online(tile_id: str, timeout_s: int = 600, poll_interval: int = 15) -> bool:
    """Wait for MAS endpoint to become ONLINE."""
    elapsed = 0
    while elapsed < timeout_s:
        try:
            resp = _request("GET", f"/api/2.0/multi-agent-supervisors/{tile_id}")
            mas = resp.get("multi_agent_supervisor", {})
            status = mas.get("status", {}).get("endpoint_status", "UNKNOWN")

            if status == "ONLINE":
                print(f"MAS is ONLINE")
                return True
            elif status in ("FAILED", "OFFLINE"):
                raise Exception(f"MAS endpoint is {status}")

            print(f"  Status: {status} (elapsed: {elapsed}s)")
            time.sleep(poll_interval)
            elapsed += poll_interval

        except Exception as e:
            if "not found" in str(e).lower():
                time.sleep(poll_interval)
                elapsed += poll_interval
            else:
                raise

    print(f"Warning: Timeout waiting for MAS after {timeout_s}s")
    return False

wait_for_online(tile_id, timeout_s=600)

# COMMAND ----------

# Add example questions for routing optimization (optional)
examples = [
    {"question": "What are the key metrics?", "guidelines": ["Route to Data_Explorer"]},
    {"question": "Show me the top 10 records", "guidelines": ["Route to Data_Explorer"]},
    {"question": "How do I get started?", "guidelines": ["Route to Knowledge_Assistant"]},
    {"question": "What does this error mean?", "guidelines": ["Route to Knowledge_Assistant"]},
]

added = 0
for ex in examples:
    try:
        _request("POST", f"/api/2.0/multi-agent-supervisors/{tile_id}/examples", {
            "tile_id": tile_id,
            "question": ex["question"],
            "guidelines": ex["guidelines"],
        })
        added += 1
    except Exception as e:
        print(f"Warning: Failed to add example: {e}")

print(f"Added {added}/{len(examples)} example questions")

# COMMAND ----------

# Output for downstream tasks
dbutils.jobs.taskValues.set(key="mas_tile_id", value=tile_id)

print(f"\nSupervisor Agent ready: {MAS_NAME}")
print(f"  Tile ID: {tile_id}")
print(f"  Agents: {len(agents)}")
print(f"  Task value set: mas_tile_id = {tile_id}")
