# Databricks notebook source
"""
Deploy Knowledge Assistant - Reference script for DAB workflow task.
REQUIRES: databricks-sdk>=0.102.0 (use sdk_latest environment)

Creates or updates a Knowledge Assistant using the Databricks SDK.
Idempotent: safe to re-run.

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema: Schema name

Outputs (via dbutils.jobs.taskValues.set):
- ka_tile_id: The created/updated Knowledge Assistant tile ID
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")

KA_NAME = "Demo Knowledge Assistant"  # Customize for your demo
VOLUME_PATH = f"/Volumes/{catalog}/{schema}/docs"
print(f"Deploying Knowledge Assistant: '{KA_NAME}'")
print(f"  Document source: {VOLUME_PATH}")

# COMMAND ----------

import time
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.knowledgeassistants import (
    KnowledgeAssistant,
    KnowledgeSource,
    FilesSpec,  # CORRECT: FilesSpec, NOT FilesKnowledgeSource
)

w = WorkspaceClient()

description = f"Ask questions about {catalog}.{schema} documentation"
instructions = "Be helpful and cite sources when answering questions. Provide specific page references when available."

# COMMAND ----------

# Check whether the KA already exists
existing_id = None
page_token = None

print("Searching for existing Knowledge Assistants...")
while True:
    resp = w.knowledge_assistants.list_knowledge_assistants(page_size=100, page_token=page_token)
    for ka in resp.knowledge_assistants or []:
        if ka.display_name == KA_NAME:
            existing_id = ka.name.split("/")[-1] if ka.name else None
            resource_name = ka.name
            print(f"  Found: {ka.display_name} ({existing_id})")
            break
    if existing_id or not resp.next_page_token:
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating existing Knowledge Assistant: {existing_id}")

    # Update the KA metadata
    updated_ka = KnowledgeAssistant(
        name=resource_name,
        display_name=KA_NAME,
        description=description,
        instructions=instructions,
    )

    w.knowledge_assistants.update_knowledge_assistant(
        name=resource_name,
        knowledge_assistant=updated_ka,
        update_mask="display_name,description,instructions",
    )

    # Trigger re-indexing of knowledge sources
    try:
        w.knowledge_assistants.sync_knowledge_sources(name=resource_name)
        print("Knowledge sources synced")
    except Exception as e:
        print(f"Warning: Could not sync sources: {e}")

    tile_id = existing_id
    print(f"Knowledge Assistant updated: {tile_id}")
else:
    print("Creating new Knowledge Assistant...")

    # Create the KA
    new_ka = KnowledgeAssistant(
        display_name=KA_NAME,
        description=description,
        instructions=instructions,
    )

    result = w.knowledge_assistants.create_knowledge_assistant(knowledge_assistant=new_ka)
    resource_name = result.name
    tile_id = resource_name.split("/")[-1]
    print(f"Knowledge Assistant created: {tile_id}")

    # Add knowledge source pointing to the UC volume
    # CORRECT: Use FilesSpec with source_type="FILES"
    knowledge_source = KnowledgeSource(
        display_name="documents",
        source_type="FILES",  # REQUIRED parameter
        files_spec=FilesSpec(  # CORRECT: files_spec (not files_knowledge_source)
            path=VOLUME_PATH,
        ),
    )

    w.knowledge_assistants.create_knowledge_source(
        parent=resource_name,
        knowledge_source=knowledge_source,
    )
    print(f"Knowledge source added: {VOLUME_PATH}")

# COMMAND ----------

# Wait for KA to be ready (indexing can take a few minutes)
def wait_for_ready(name: str, timeout_s: int = 600, poll_interval: int = 15):
    """Wait for Knowledge Assistant indexing to complete."""
    elapsed = 0
    while elapsed < timeout_s:
        try:
            ka = w.knowledge_assistants.get_knowledge_assistant(name=name)
            status = getattr(ka, 'status', None)

            if status and hasattr(status, 'state'):
                state = status.state
                if state in ('ACTIVE', 'READY', 'ONLINE'):
                    print(f"Knowledge Assistant is ready: {state}")
                    return True
                elif state in ('FAILED', 'ERROR'):
                    raise Exception(f"Knowledge Assistant failed: {state}")
                print(f"  Status: {state} (elapsed: {elapsed}s)")
            else:
                print(f"  Waiting for indexing... (elapsed: {elapsed}s)")

            time.sleep(poll_interval)
            elapsed += poll_interval

        except Exception as e:
            if "not found" in str(e).lower():
                time.sleep(poll_interval)
                elapsed += poll_interval
            else:
                raise

    print(f"Warning: Timeout waiting for KA after {timeout_s}s")
    return False

wait_for_ready(resource_name, timeout_s=600)

# COMMAND ----------

# Output for downstream tasks (e.g., deploy_mas)
dbutils.jobs.taskValues.set(key="ka_tile_id", value=tile_id)

print(f"\nKnowledge Assistant ready: {KA_NAME}")
print(f"  Tile ID: {tile_id}")
print(f"  Volume: {VOLUME_PATH}")
print(f"  Task value set: ka_tile_id = {tile_id}")
