# Databricks notebook source
"""
Run a .sql file on a SQL WAREHOUSE — DAB setup-job task (environment_key: sdk_latest).

Generic helper: reads a committed .sql file (relative to the demo root), substitutes
{{CATALOG}} / {{SCHEMA}}, splits on ';', and executes each statement on the target SQL
warehouse via the Statement Execution API. Used for:
  • build_ai_review.sql   — ai_query() criteria review of the open PA queue.
  • build_metric_view.sql — the pa_ops_metrics UC metric view.

Statements that fail are reported but do NOT abort the run (idempotent re-runs;
see dab_instructions.md).

REQUIRES: databricks-sdk>=0.114.0.

Parameters (base_parameters):
- catalog, schema, warehouse_id, sql_file (path relative to the demo root, e.g.
  'src/deploy/build_forecast.sql')
"""

# COMMAND ----------

import os
import re
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")
dbutils.widgets.text("sql_file", "", "SQL file (relative to demo root)")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
sql_file = dbutils.widgets.get("sql_file")
assert catalog and schema and warehouse_id and sql_file, \
    "catalog + schema + warehouse_id + sql_file are required"

# COMMAND ----------

# The .sql file lives under the demo root. This notebook is at src/deploy/, so the demo
# root is two dirs up from the notebook path.
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
demo_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
path = f"/Workspace{demo_root}/{sql_file}"
print(f"Loading SQL: {path}")

with open(path) as f:
    raw = f.read()
raw = raw.replace("{{CATALOG}}", catalog).replace("{{SCHEMA}}", schema)

# Split into statements: drop full-line comments, split on ';' at end of line.
lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
statements = [s.strip() for s in re.split(r";\s*\n", "\n".join(lines) + "\n") if s.strip()]
print(f"{len(statements)} statement(s) to run on warehouse {warehouse_id}")

# COMMAND ----------

w = WorkspaceClient()
for i, stmt in enumerate(statements, 1):
    preview = " ".join(stmt.split())[:90]
    try:
        resp = w.statement_execution.execute_statement(
            warehouse_id=warehouse_id, statement=stmt, wait_timeout="50s")
        # Long statements (ai_query over the open queue) outlive the 50s wait — poll.
        while resp.status and resp.status.state in (StatementState.PENDING, StatementState.RUNNING):
            time.sleep(5)
            resp = w.statement_execution.get_statement(resp.statement_id)
        state = resp.status.state if resp.status else None
        if state == StatementState.FAILED:
            msg = resp.status.error.message if resp.status.error else "unknown"
            print(f"  [{i}] FAILED (continuing): {preview}\n       -> {msg[:160]}")
        else:
            print(f"  [{i}] {state}: {preview}")
    except Exception as e:  # noqa: BLE001 — report + continue (idempotent re-runs)
        print(f"  [{i}] ERROR (continuing): {preview}\n       -> {str(e).splitlines()[0][:160]}")

print("done.")
