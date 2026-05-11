# Databricks notebook source
"""
Deploy Genie Space - Reference script for DAB workflow task.
REQUIRES: databricks-sdk>=0.102.0 (use sdk_latest environment)

Creates or updates a Genie Space using the Databricks SDK.
Idempotent: safe to re-run.

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema: Schema name
- warehouse_id: SQL warehouse ID

Outputs (via dbutils.jobs.taskValues.set):
- genie_space_id: The created/updated Genie Space ID
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")

SPACE_NAME = "Demo Data Explorer"  # Customize for your demo
print(f"Deploying Genie Space: '{SPACE_NAME}'")
print(f"  catalog.schema: {catalog}.{schema}")

# COMMAND ----------

import json
import uuid
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Resolve warehouse if not provided
if not warehouse_id:
    for wh in w.warehouses.list():
        name_l = (wh.name or "").lower()
        if "serverless" in name_l or "shared" in name_l or "starter" in name_l:
            warehouse_id = wh.id
            break
    if not warehouse_id:
        wh_list = list(w.warehouses.list())
        if wh_list:
            warehouse_id = wh_list[0].id
    print(f"  Resolved warehouse: {warehouse_id}")

# COMMAND ----------

# Discover tables in the schema (customize as needed)
tables = spark.sql(f"SHOW TABLES IN {catalog}.{schema}").collect()
table_identifiers = sorted([
    f"{catalog}.{schema}.{row.tableName}"
    for row in tables
    if not row.tableName.startswith("_")
])

print(f"Found {len(table_identifiers)} tables")

# Sample questions (customize for your demo)
sample_questions = [
    ["What are the key metrics?"],
    ["Show me the top 10 records"],
    ["What trends do you see?"],
]


def _uuid_hex():
    """Generate a lowercase 32-hex UUID (required by Genie API)."""
    return uuid.uuid4().hex


# Build serialized_space JSON
serialized_space = json.dumps({
    "version": 2,
    "config": {
        "sample_questions": [{"id": _uuid_hex(), "question": q} for q in sample_questions]
    },
    "data_sources": {
        "tables": [{"identifier": t} for t in table_identifiers]
    },
})

description = f"Ask questions about {catalog}.{schema} data"

# COMMAND ----------

# Check whether the space already exists (SDK requires pagination)
existing_id = None
page_token = None

print("Searching for existing Genie Spaces...")
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for space in resp.spaces or []:
        if space.title == SPACE_NAME:
            existing_id = space.space_id
            print(f"  Found: {space.title} ({existing_id})")
            break
    if existing_id or not resp.next_page_token:
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating existing Genie Space: {existing_id}")
    w.genie.update_space(
        space_id=existing_id,
        warehouse_id=warehouse_id,
        serialized_space=serialized_space,
    )
    space_id = existing_id
    print(f"Genie Space updated: {space_id}")
else:
    print("Creating new Genie Space...")
    space = w.genie.create_space(
        warehouse_id=warehouse_id,
        title=SPACE_NAME,
        description=description,
        serialized_space=serialized_space,
    )
    space_id = space.space_id
    print(f"Genie Space created: {space_id}")

# COMMAND ----------

# Output for downstream tasks (e.g., deploy_mas)
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)

print(f"\nGenie Space ready: {SPACE_NAME}")
print(f"  Space ID: {space_id}")
print(f"  Tables: {len(table_identifiers)}")
print(f"  Task value set: genie_space_id = {space_id}")
