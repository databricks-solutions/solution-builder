"""
Run a .sql file (relative to the demo root) on a SQL WAREHOUSE — DAB spark_python_task
(--catalog --schema --warehouse_id --sql_file).
Substitutes {{CATALOG}} / {{SCHEMA}}, splits on ';', executes each statement and POLLS until
it finishes (AI Functions over ~10K chat lines take several minutes). Fails the task on error.
Used for src/ai/chat_toxicity.sql (AI Functions run on a warehouse).
"""
import os
import time

from databricks.sdk import WorkspaceClient

import argparse

ap = argparse.ArgumentParser()
for k in ("catalog", "schema", "warehouse_id", "sql_file"):
    ap.add_argument(f"--{k}", required=True)
a, _ = ap.parse_known_args()
catalog, schema, warehouse_id, sql_file = a.catalog, a.schema, a.warehouse_id, a.sql_file
# --sql_file is an absolute path (the DAB passes ${workspace.file_path}/src/…) or relative to the demo root.
# Serverless spark_python_task does not define __file__, hence the absolute path from the bundle.
if os.path.isabs(sql_file):
    path = sql_file
else:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = f"{root}/{sql_file}"
raw = open(path).read().replace("{{CATALOG}}", catalog).replace("{{SCHEMA}}", schema)
stmts = [s.strip() for s in "\n".join(l for l in raw.splitlines() if not l.strip().startswith("--")).split(";") if s.strip()]

w = WorkspaceClient()
for i, stmt in enumerate(stmts, 1):
    r = w.statement_execution.execute_statement(warehouse_id=warehouse_id, statement=stmt, wait_timeout="0s")
    sid = r.statement_id
    while True:
        st = w.statement_execution.get_statement(sid).status
        if st.state.value in ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED"):
            break
        time.sleep(10)
    print(f"[{i}/{len(stmts)}] {st.state.value}: {' '.join(stmt.split())[:90]}")
    if st.state.value in ("FAILED", "CANCELED"):
        raise RuntimeError(st.error.message if st.error else st.state.value)
