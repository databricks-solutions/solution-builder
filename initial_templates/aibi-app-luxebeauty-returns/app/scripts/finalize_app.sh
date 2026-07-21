#!/usr/bin/env bash
# Finalize the Databricks App: harvest the demo's resolved resource IDs from
# the setup job's exit JSON, write them into app.yaml's env block, and deploy.
#
# Run order for a full deploy:
#   1. databricks bundle deploy   --var ...     # app shell + setup job
#   2. databricks bundle run luxebeauty_setup   # creates data/genie/ka/mas,
#                                                  ends with export_resources
#                                                  exiting a resources JSON
#   3. ./app/scripts/finalize_app.sh            # THIS — wires env + deploys app
#
# Why a separate step (not in-bundle): the Genie/KA/MAS IDs only exist after
# the setup job's SDK tasks run; the bundle can't know them at deploy time.
# The job's `export_resources` task exits a JSON with everything; we read it
# back here via `get-run-output` (the exit value IS retrievable post-run,
# unlike task-values) and bake it into app.yaml.
#
# Usage:
#   ./app/scripts/finalize_app.sh [--profile <p>] [--job-id <id>] [--run-id <id>]
# Defaults: profile from DATABRICKS_CONFIG_PROFILE; latest run of the
# luxebeauty_setup job in the current bundle target.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$(dirname "$APP_DIR")"
APP_YAML="$APP_DIR/app.yaml"
APP_YAML_TEMPLATE="$APP_DIR/app.yaml.template"

PROFILE="${DATABRICKS_CONFIG_PROFILE:-}"
JOB_ID=""
RUN_ID=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile) PROFILE="$2"; shift 2 ;;
        --job-id)  JOB_ID="$2"; shift 2 ;;
        --run-id)  RUN_ID="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done
PROFILE_FLAG=()
[[ -n "$PROFILE" ]] && PROFILE_FLAG=(--profile "$PROFILE")

cd "$BUNDLE_DIR"

# ── 1. Resolve the setup job + its latest run ──────────────────────────────
# Find the job by display name so we don't need the bundle's --var values
# here. The name matches databricks.yml's job name with the dev-mode prefix.
# ⚠️ When forking this template for a new demo, change "LuxeBeauty Setup" to
#    match the renamed job name in databricks.yml (resources.jobs.<key>.name).
SETUP_JOB_NAME_MATCH="LuxeBeauty Setup"
if [[ -z "$JOB_ID" ]]; then
    JOB_ID=$(databricks jobs list "${PROFILE_FLAG[@]}" -o json 2>/dev/null \
        | python3 -c "
import sys, json
d = json.load(sys.stdin)
jobs = d if isinstance(d, list) else d.get('jobs', [])
hit = [j for j in jobs if '$SETUP_JOB_NAME_MATCH' in (j.get('settings',{}).get('name','') or '')]
print(hit[0]['job_id'] if hit else '')
")
fi
[[ -n "$JOB_ID" ]] || { echo "[finalize] ERROR: couldn't find the LuxeBeauty Setup job by name." >&2; exit 1; }
echo "[finalize] setup job id: $JOB_ID"

if [[ -z "$RUN_ID" ]]; then
    RUN_ID=$(databricks jobs list-runs --job-id "$JOB_ID" --limit 1 "${PROFILE_FLAG[@]}" -o json 2>/dev/null \
        | python3 -c "
import sys, json
d = json.load(sys.stdin)
runs = d if isinstance(d, list) else d.get('runs', [])
print(runs[0]['run_id'] if runs else '')
")
fi
[[ -n "$RUN_ID" ]] || { echo "[finalize] ERROR: no run found for job $JOB_ID — run \`bundle run luxebeauty_setup\` first." >&2; exit 1; }
echo "[finalize] setup run id:  $RUN_ID"

# ── 2. Find the export_resources task + read its exit JSON ─────────────────
TASK_RUN_ID=$(databricks jobs get-run "$RUN_ID" "${PROFILE_FLAG[@]}" -o json 2>/dev/null \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
for t in d.get('tasks',[]):
    if t.get('task_key')=='export_resources':
        print(t.get('run_id')); break
")
[[ -n "$TASK_RUN_ID" ]] || { echo "[finalize] ERROR: export_resources task not found in run $RUN_ID." >&2; exit 1; }

RESOURCES_JSON=$(databricks jobs get-run-output "$TASK_RUN_ID" "${PROFILE_FLAG[@]}" -o json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('notebook_output',{}).get('result','') or '')")
[[ -n "$RESOURCES_JSON" ]] || { echo "[finalize] ERROR: export_resources produced no exit JSON — did the task succeed?" >&2; exit 1; }

echo "[finalize] harvested resources:"
echo "$RESOURCES_JSON" | python3 -m json.tool | sed 's/^/    /'

# ── 3. Render app.yaml from the template + resolved values ─────────────────
# Snapshot the original app.yaml as the template on first run.
if [[ ! -f "$APP_YAML_TEMPLATE" ]]; then
    cp "$APP_YAML" "$APP_YAML_TEMPLATE"
    echo "[finalize] snapshotted app.yaml → app.yaml.template (first run)"
fi

python3 - "$RESOURCES_JSON" "$APP_YAML_TEMPLATE" "$APP_YAML" <<'PYEOF'
import sys, json
resources = json.loads(sys.argv[1])
template_path, out_path = sys.argv[2], sys.argv[3]

# Env vars the app reads (config/app.json placeholders). value_from entries
# are platform bindings (warehouse + postgres); plain values come from the
# harvested resources JSON.
env_lines = [
    ("NODE_ENV", "production"),
    # binding-derived (the platform injects these from databricks.yml's
    # apps.<key>.resources bindings — keep as value_from)
    ("__VALUEFROM__DATABRICKS_WAREHOUSE_ID", "sql-warehouse"),
    ("__VALUEFROM__WAREHOUSE_ID", "sql-warehouse"),
    ("__VALUEFROM__LAKEBASE_ENDPOINT", "postgres"),
    # plain values from the setup job's exit JSON
    ("DEMO_CATALOG", resources["catalog"]),
    ("DEMO_SCHEMA", resources["schema"]),
    ("DASHBOARD_ID", resources.get("dashboard_id", "")),
    ("PIPELINE_ID", resources.get("pipeline_id", "")),
    ("AGENT_MLFLOW_EXPERIMENT_PATH", resources.get("agent_mlflow_experiment_path", "")),
    ("GENIE_SPACE_ID", resources.get("genie_space_id", "")),
    ("KA_ENDPOINT_NAME", resources.get("ka_endpoint_name", "")),
    ("MAS_ENDPOINT_NAME", resources.get("mas_endpoint_name", "")),
]

# The agent-traces experiment path. If the harvest didn't produce it, the app
# still self-derives /Shared/solution_builder/<DATABRICKS_APP_NAME>-agent-traces
# at boot (server.ts) — so this is a NOTE, not a failure. We still emit it when
# present so the env value matches resources.json (and the DAB derivation).
if not resources.get("agent_mlflow_experiment_path"):
    print(
        "[finalize] NOTE: agent_mlflow_experiment_path missing from harvested "
        "resources — the app will self-derive it from DATABRICKS_APP_NAME at boot "
        "(/Shared/solution_builder/<app_name>-agent-traces). Set it in "
        "resources.json to pin an explicit path.",
        file=sys.stderr,
    )

# Read the template, strip its existing `env:` block, append the new one.
with open(template_path) as f:
    text = f.read()

# Keep everything BEFORE the `env:` line (command + user_authorization).
head = text.split("\nenv:", 1)[0].rstrip() + "\n"

lines = ["", "env:"]
for name, val in env_lines:
    if name.startswith("__VALUEFROM__"):
        lines.append(f"  - name: {name.replace('__VALUEFROM__','')}")
        lines.append(f"    valueFrom: {val}")
    else:
        lines.append(f"  - name: {name}")
        lines.append(f"    value: \"{val}\"")

with open(out_path, "w") as f:
    f.write(head + "\n".join(lines) + "\n")

print(f"[finalize] wrote {out_path} with {len(env_lines)} env entries")
PYEOF

# ── 4. Deploy the app ──────────────────────────────────────────────────────
# We just rewrote the local app.yaml, but the app's source already lives in
# the workspace from `bundle deploy`. Re-sync just app.yaml, then deploy from
# the bundle's synced source path (reuse the active deployment's path).
APP_NAME=$(echo "$RESOURCES_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['app_name'])")

SRC_PATH=$(databricks apps get "$APP_NAME" "${PROFILE_FLAG[@]}" -o json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
ad=d.get('active_deployment') or {}
print(ad.get('source_code_path') or d.get('default_source_code_path',''))
")
[[ -n "$SRC_PATH" ]] || { echo "[finalize] ERROR: could not resolve app source_code_path." >&2; exit 1; }
echo "[finalize] app source path: $SRC_PATH"

# Push the freshly-rendered app.yaml into the synced source dir so the new
# deployment picks it up.
echo "[finalize] uploading rendered app.yaml → $SRC_PATH/app.yaml"
databricks workspace import "$SRC_PATH/app.yaml" \
    --file "$APP_YAML" --format AUTO --overwrite "${PROFILE_FLAG[@]}" 2>&1 | tail -2 || true

echo "[finalize] deploying app: $APP_NAME"
databricks apps deploy "$APP_NAME" --source-code-path "$SRC_PATH" "${PROFILE_FLAG[@]}" 2>&1 | tail -5

echo "[finalize] done — app should boot with full env."
