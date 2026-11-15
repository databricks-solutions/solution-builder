"""
Run a .sql file (relative to the demo root) on a SQL WAREHOUSE — DAB spark_python_task
(--catalog --schema --warehouse_id --sql_file). Substitutes ${catalog} / ${schema}, splits on ';',
executes each statement and POLLS until it finishes (AI Functions take a few minutes). Fails on error.
Used for src/ai/note_insights.sql (AI Functions over the CRM notes).
"""
import argparse
import os
import time

from databricks.sdk import WorkspaceClient

ap = argparse.ArgumentParser()
for k in ("catalog", "schema", "warehouse_id", "sql_file"):
    ap.add_argument(f"--{k}", required=True)
a, _ = ap.parse_known_args()
# --sql_file: absolute (the bundle passes ${workspace.file_path}/…; serverless spark_python_task has no __file__)
# or relative to the demo root when run locally.
path = a.sql_file if os.path.isabs(a.sql_file) else os.path.join(os.getcwd(), a.sql_file)
raw = open(path).read().replace("${catalog}", a.catalog).replace("${schema}", a.schema)
stmts = [s.strip() for s in "\n".join(l for l in raw.splitlines() if not l.strip().startswith("--")).split(";") if s.strip()]
w = WorkspaceClient()
for i, stmt in enumerate(stmts, 1):
    sid = w.statement_execution.execute_statement(warehouse_id=a.warehouse_id, statement=stmt, wait_timeout="0s").statement_id
    while True:
        st = w.statement_execution.get_statement(sid).status
        if st.state.value in ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED"):
            break
        time.sleep(10)
    print(f"[{i}/{len(stmts)}] {st.state.value}: {' '.join(stmt.split())[:90]}")
    if st.state.value in ("FAILED", "CANCELED"):
        raise RuntimeError(st.error.message if st.error else st.state.value)
