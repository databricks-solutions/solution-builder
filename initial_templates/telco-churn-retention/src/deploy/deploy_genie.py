"""
Create or update the Veridian churn & retention Genie space from genie/genie_space.json
(serialized-v2). DAB spark_python_task; also runnable locally:
    DATABRICKS_CONFIG_PROFILE=<profile> python src/deploy/deploy_genie.py --catalog <catalog> \
        --schema <schema> --warehouse_id <id> --parent_path "/Workspace/..."
Idempotent: looks the space up by exact title (+ tables in this catalog.schema) and updates it. Exits the space id as the
task value `genie_space_id`.
"""
import argparse
import json
import os

from databricks.sdk import WorkspaceClient

SPACE_TITLE = "Veridian Mobile - Churn and Retention"
SPACE_DESCRIPTION = (
    "Ask why postpaid churn rose from ~1.0% to ~1.7%/month since July 2026: a 5G core migration on 5 "
    "Southwest sites, the Switch & Save promo roll-off, and the Crest Wireless $25/line promo. Covers the "
    "30-day churn-risk model scores + SHAP drivers, retention offer save rates, AI-analyzed care calls and "
    "the retention desk's live decisions."
)

ap = argparse.ArgumentParser()
for k in ("catalog", "schema", "warehouse_id", "parent_path", "space_json"):
    ap.add_argument(f"--{k}", default="")
args, _ = ap.parse_known_args()
# --space_json: the bundle passes ${workspace.file_path}/genie/genie_space.json (serverless spark_python_task has no
# __file__); locally it defaults to genie/genie_space.json relative to the demo root (the cwd).
space_json = args.space_json or os.path.join(os.getcwd(), "genie", "genie_space.json")

assert args.catalog and args.schema and args.warehouse_id, "catalog + schema + warehouse_id are required"
raw = open(space_json).read()
payload = json.loads(raw.replace("{{CATALOG}}", args.catalog).replace("{{SCHEMA}}", args.schema))
payload["data_sources"]["tables"] = sorted(payload["data_sources"]["tables"], key=lambda t: t["identifier"])
serialized = json.dumps(payload)

w = WorkspaceClient()
# Reuse only OUR space: same title AND its tables live in this catalog.schema (a fork of the template into another
# schema of the same workspace must get its own space, never overwrite this one).
prefix = f"{args.catalog}.{args.schema}.".lower()


def is_ours(space_id):
    sp = w.genie.get_space(space_id=space_id, include_serialized_space=True)
    tables = json.loads(sp.serialized_space or "{}").get("data_sources", {}).get("tables", [])
    return any(t.get("identifier", "").replace("`", "").lower().startswith(prefix) for t in tables)


existing_id, token = None, None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=token)
    for sp in resp.spaces or []:
        if sp.title == SPACE_TITLE and is_ours(sp.space_id):
            existing_id = sp.space_id
    token = getattr(resp, "next_page_token", None)
    if existing_id or not token:
        break

if existing_id:
    w.genie.update_space(space_id=existing_id, warehouse_id=args.warehouse_id, serialized_space=serialized,
                         description=SPACE_DESCRIPTION)
    space_id = existing_id
    print(f"updated Genie space {space_id}")
else:
    kw = {"parent_path": args.parent_path} if args.parent_path else {}
    space_id = w.genie.create_space(warehouse_id=args.warehouse_id, serialized_space=serialized,
                                    title=SPACE_TITLE, description=SPACE_DESCRIPTION, **kw).space_id
    print(f"created Genie space {space_id}")

# Expose the id to downstream job tasks. A plain .py spark_python_task has no global `dbutils`: import it (outside a
# job — local runs — taskValues.set is a no-op).
from databricks.sdk.runtime import dbutils  # noqa: E402

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
