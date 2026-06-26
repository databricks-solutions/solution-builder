# Databricks notebook source
"""
Deploy the demo's Knowledge Assistant — reference script for a DAB setup-job task.

Reads a committed KA config JSON (KA metadata + knowledge-source definitions),
substitutes the catalog/schema into the volume path, then creates or updates
via the Databricks SDK. Idempotent: searches by display name.

═══════════════════════════════════════════════════════════════════════════
GOTCHAS — proven the hard way; do NOT "simplify" these away:
  • KnowledgeSource(files=FilesSpec(...)) — the field is `files`, NOT
    `files_spec`. The wrong name fails with a confusing pydantic error.
  • update_knowledge_assistant needs update_mask=FieldMask(paths=[...])
    (from google.protobuf.field_mask_pb2), NOT a comma-separated string.
  • WAIT-FOR-INDEXING ONLY ON FIRST CREATE. On updates, return immediately —
    the platform re-indexes asynchronously and blocking the job ~10 min on a
    no-op redeploy is pure waste. Downstream tasks tolerate a briefly-503 KA.
  • LOAD-FROM-JSON: keep the (long) KA instructions + source list in a config
    file, not inlined here.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest).

Parameters:
- catalog, schema

Outputs (taskValues):
- ka_endpoint_name: the served endpoint name (consumed by the MAS task)
- ka_id:            the KA resource ID
"""

# COMMAND ----------

# ⚠️ EDIT PER DEMO: the source volume path baked into the committed KA JSON
# (the catalog/schema/volume the config was authored against). We literal-
# replace the catalog/schema prefix with the deployed catalog/schema; the
# volume name (`<demo_documents_volume>`) is the demo's — rename to match.
SRC_VOLUME_PATH = "/Volumes/<source_catalog>/<source_schema>/<demo_documents_volume>/"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")

catalog = dbutils.widgets.get("catalog")
schema  = dbutils.widgets.get("schema")
assert catalog and schema

# COMMAND ----------

import json
import os
import time
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.knowledgeassistants import (
    KnowledgeAssistant,
    KnowledgeSource,
    FilesSpec,
)
from google.protobuf.field_mask_pb2 import FieldMask

# Locate knowledge_assistant.json — this path is the DEMO's (assumes
# src/knowledge_assistant/knowledge_assistant.json relative to bundle root).
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path   = f"/Workspace{bundle_root}/src/knowledge_assistant/knowledge_assistant.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    raw = f.read()

# Rewrite the authored volume path to the deployed catalog/schema. We swap the
# first two path segments (catalog/schema) and keep the volume name from config.
src_parts = SRC_VOLUME_PATH.strip("/").split("/")  # ['Volumes', cat, schema, volume]
dst_volume_path = f"/Volumes/{catalog}/{schema}/{src_parts[3]}/"
raw = raw.replace(SRC_VOLUME_PATH, dst_volume_path)
print(f"Volume path: {SRC_VOLUME_PATH} → {dst_volume_path}")

cfg = json.loads(raw)
ka_meta  = cfg["knowledge_assistant"]
sources  = cfg["knowledge_sources"]
KA_NAME  = ka_meta["display_name"]
print(f"KA display name: {KA_NAME}")
print(f"Sources: {len(sources)} (path → {sources[0]['files']['path']})")

# COMMAND ----------

w = WorkspaceClient()

# Search by display name.
existing_resource_name = None
for ka in w.knowledge_assistants.list_knowledge_assistants(page_size=100):
    if ka.display_name == KA_NAME:
        existing_resource_name = ka.name
        print(f"Found: {ka.name}")
        break

# COMMAND ----------

was_created = False
if existing_resource_name:
    # Idempotent update — metadata only. Skip re-syncing knowledge sources:
    # the platform re-indexes in the background when the volume changes, so
    # triggering it here just blocks the job ~10 min on no-op redeploys.
    updated = KnowledgeAssistant(
        name=existing_resource_name,
        display_name=KA_NAME,
        description=ka_meta.get("description", ""),
        instructions=ka_meta.get("instructions", ""),
    )
    w.knowledge_assistants.update_knowledge_assistant(
        name=existing_resource_name,
        knowledge_assistant=updated,
        # update_mask MUST be a FieldMask of paths — NOT a comma string.
        update_mask=FieldMask(paths=["display_name", "description", "instructions"]),
    )
    resource_name = existing_resource_name
    print("KA metadata updated (sources sync skipped — platform handles re-indexing async)")
else:
    new_ka = KnowledgeAssistant(
        display_name=KA_NAME,
        description=ka_meta.get("description", ""),
        instructions=ka_meta.get("instructions", ""),
    )
    created = w.knowledge_assistants.create_knowledge_assistant(knowledge_assistant=new_ka)
    resource_name = created.name
    was_created = True
    print(f"Created KA: {resource_name}")

    for src in sources:
        ks = KnowledgeSource(
            display_name=src["display_name"],
            source_type="FILES",
            # The field is `files`, NOT `files_spec`.
            files=FilesSpec(path=src["files"]["path"]),
        )
        w.knowledge_assistants.create_knowledge_source(
            parent=resource_name,
            knowledge_source=ks,
        )
        print(f"Added source: {src['display_name']} → {src['files']['path']}")

ka_id = resource_name.split("/")[-1]
ka_endpoint_name = f"ka-{ka_id.split('-')[0]}-endpoint"
print(f"KA ID:           {ka_id}")
print(f"KA endpoint:     {ka_endpoint_name}")

# COMMAND ----------

# Only wait for indexing on first creation. On updates we exit immediately —
# the platform re-indexes async and downstream tasks (deploy_mas, the app)
# tolerate a not-yet-ready endpoint (queries 503 briefly, then start working).
def wait_ready(name, timeout_s=600, interval=15):
    elapsed = 0
    while elapsed < timeout_s:
        try:
            ka = w.knowledge_assistants.get_knowledge_assistant(name=name)
            state = getattr(getattr(ka, 'status', None), 'state', None)
            if state in ('ACTIVE', 'READY', 'ONLINE'):
                print(f"KA is {state}")
                return True
            if state in ('FAILED', 'ERROR'):
                raise Exception(f"KA failed: {state}")
            print(f"  state={state} elapsed={elapsed}s")
        except Exception as e:
            if "not found" not in str(e).lower(): raise
        time.sleep(interval); elapsed += interval
    print(f"WARN: timeout after {timeout_s}s — continuing anyway")
    return False

if was_created:
    print("KA newly created — waiting for first-time indexing…")
    wait_ready(resource_name)
else:
    print("KA already existed — skipping wait (re-indexing runs async).")

# COMMAND ----------

dbutils.jobs.taskValues.set(key="ka_id", value=ka_id)
dbutils.jobs.taskValues.set(key="ka_endpoint_name", value=ka_endpoint_name)
print(f"task values: ka_id={ka_id} ka_endpoint_name={ka_endpoint_name}")
