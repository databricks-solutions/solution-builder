#!/usr/bin/env bash
# Deploy this Databricks App end-to-end. Reads .env for config; idempotent
# on every step.
#
# Flow:
#   0. Rebuild dist/ from source (build-app.sh) — never ship a stale dist.
#   1. Load .env  → APP_NAME, LAKEBASE_PROJECT_ID, PGDATABASE.
#   2. Upload source to /Workspace/Users/<me>/apps/<APP_NAME>.
#   3. `databricks apps create` (skipped if app exists).
#   4. `databricks apps deploy` — applies app.yaml scopes (incl. model-serving).
#   5. Wait for the App's Postgres SP role to appear, reassign any stale
#      prior-SP ownership, then GRANT public.
#   6. Start the App so the container is warm.
#   7. Print URL + status + log-tail command.
#
# Requires .env populated by scripts/lakebase_setup_db.sh + APP_NAME set.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

[[ -f .env ]] || {
    echo "[deploy] ERROR: .env not found in $APP_DIR" >&2
    echo "[deploy]   Copy .env.template to .env, run scripts/lakebase_setup_db.sh," >&2
    echo "[deploy]   paste its output, and set APP_NAME." >&2
    exit 1
}
set -a; . ./.env; set +a

for v in APP_NAME LAKEBASE_PROJECT_ID PGDATABASE; do
    [[ -n "${!v:-}" ]] || {
        echo "[deploy] ERROR: $v is empty in .env" >&2
        exit 1
    }
done

# Hard guard — `dbdemos-generator*` is the live demo-generator app itself.
# A deploy targeting that name would overwrite the production tool every
# Databricks SA is currently using. Override only if you genuinely intend
# to redeploy the platform app (almost never from inside a generated demo).
case "$APP_NAME" in
    dbdemos-generator|dbdemos-generator-*)
        echo "[deploy] ERROR: APP_NAME='$APP_NAME' is reserved." >&2
        echo "[deploy]   This is the live demo-generator app (or a sibling)." >&2
        echo "[deploy]   Pick a name like dbgen-<demo_short_name> in .env, update" >&2
        echo "[deploy]   resources.json's created_resources.app.name to match, and retry." >&2
        exit 1
        ;;
esac

PROFILE_FLAG=()
[[ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]] && \
    PROFILE_FLAG=(--profile "$DATABRICKS_CONFIG_PROFILE")

# Friendly error helper. Recognizes the most common ways `databricks apps`
# blows up and prints something the user can act on instead of a stack trace.
explain_apps_error() {
    local stage="$1"      # "create" | "deploy"
    local err="$2"
    case "$err" in
        *"workspace apps limit"*|*"app limit"*|*"quota"*)
            echo "[deploy] ERROR ($stage): the workspace is at its Databricks Apps quota." >&2
            echo "[deploy]   Skip the deploy step for now — the demo can run via the" >&2
            echo "[deploy]   Preview button in the UI's App tab without being deployed." >&2
            echo "[deploy]   To enable a real deploy later, free a slot in: databricks apps list" >&2
            echo "[deploy]   then ask the assistant to re-run the deploy step." >&2
            ;;
        *"already exists"*)
            echo "[deploy] ERROR ($stage): name '$APP_NAME' already taken by another user/app." >&2
            echo "[deploy]   Pick a different APP_NAME in .env or delete the existing one." >&2
            ;;
        *"PERMISSION_DENIED"*|*"403"*|*"not authorized"*)
            echo "[deploy] ERROR ($stage): permission denied on the workspace." >&2
            echo "[deploy]   Check your DATABRICKS_CONFIG_PROFILE / token has the Apps role." >&2
            ;;
        *)
            echo "[deploy] ERROR ($stage): $err" >&2
            ;;
    esac
}

USER_NAME="$(databricks current-user me ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])")"
WS_PATH="/Workspace/Users/$USER_NAME/apps/$APP_NAME"

echo "[deploy] app=$APP_NAME  ws_path=$WS_PATH  user=$USER_NAME"

# 0) Rebuild from source before uploading. A stale dist/ is a real footgun:
#    the container installs FRESH deps (npm ci), so a dist/ built against an
#    older @databricks/appkit crashes at boot (e.g. "server({autoStart}) has
#    been removed"). build-app.sh runs `npm run build:source` AND rewrites the
#    lockfile's proxy URLs → public registry (the container can't reach the
#    internal proxy). Always rebuild here so what we upload matches the deps
#    the container will install.
echo "[deploy] rebuilding dist/ from source (avoids stale-dist boot crash)…"
if ! ./scripts/build-app.sh; then
    echo "[deploy] ERROR: build-app.sh failed — fix the build before deploying." >&2
    exit 1
fi

# 1) Upload source. Delete the upload dir (not the app) and re-import —
#    `--overwrite` alone doesn't prune removed/renamed files.
echo "[deploy] uploading source to $WS_PATH"
databricks workspace delete "$WS_PATH" --recursive ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} 2>/dev/null || true
databricks workspace mkdirs "$WS_PATH" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"}
if ! err="$(databricks workspace import-dir . "$WS_PATH" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} 2>&1 1>/dev/null)"; then
    echo "[deploy] ERROR (upload): $err" >&2
    exit 1
fi

# 2) Create the App resource if missing. Scopes are NOT set here — the app's
#    OBO scopes come from `app.yaml`'s `user_authorization.scopes` (incl.
#    `model-serving`), which `databricks apps deploy` (step 3) applies from the
#    uploaded source. Do NOT set `user_api_scopes` via `apps create/update` on
#    this interactive path — it overrides/clobbers the app.yaml scopes (using a
#    different scope vocabulary, e.g. serving.serving-endpoints ≠ model-serving)
#    and the agent then 403s "required scopes: model-serving".
if ! databricks apps get "$APP_NAME" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} >/dev/null 2>&1; then
    echo "[deploy] creating app $APP_NAME"
    if ! err="$(databricks apps create "$APP_NAME" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} 2>&1 1>/dev/null)"; then
        explain_apps_error create "$err"
        exit 1
    fi
fi

# 3) Deploy the uploaded source.
echo "[deploy] deploying source…"
if ! err="$(databricks apps deploy "$APP_NAME" --source-code-path "$WS_PATH" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} 2>&1 1>/dev/null)"; then
    explain_apps_error deploy "$err"
    echo "[deploy]   Get container logs with:" >&2
    echo "    databricks apps logs $APP_NAME ${PROFILE_FLAG[*]:-}" >&2
    exit 1
fi

# 4) Wait for the App's Postgres SP role to appear, then GRANT.
#    The role is created the first time the App's SP authenticates to
#    Lakebase — typically a few seconds after the container starts.
APP_SP_UUID="$(
    databricks apps get "$APP_NAME" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('service_principal_client_id',''))"
)"
[[ -n "$APP_SP_UUID" ]] || {
    echo "[deploy] ERROR: app $APP_NAME has no service_principal_client_id." >&2
    exit 1
}

BRANCH_PATH="projects/$LAKEBASE_PROJECT_ID/branches/${LAKEBASE_BRANCH_ID:-production}"
echo "[deploy] waiting for SP role $APP_SP_UUID in $BRANCH_PATH (up to 90s)"
ROLE_FOUND=false
for i in $(seq 1 30); do
    if databricks postgres list-roles "$BRANCH_PATH" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json 2>/dev/null \
        | python3 -c "
import sys, json
sp = '$APP_SP_UUID'
for r in json.load(sys.stdin):
    s = r.get('status', {})
    if s.get('identity_type') == 'SERVICE_PRINCIPAL' and s.get('postgres_role') == sp:
        sys.exit(0)
sys.exit(1)
"; then
        echo "[deploy]   role found after $((i * 3))s"
        ROLE_FOUND=true
        break
    fi
    sleep 3
done

if $ROLE_FOUND; then
    echo "[deploy] granting App SP CREATE+USAGE on schema public"
    "$SCRIPT_DIR/lakebase_grant_app_credential.sh" \
        --app-name "$APP_NAME" \
        --project-id "$LAKEBASE_PROJECT_ID" \
        --db-name "$PGDATABASE" \
        ${LAKEBASE_BRANCH_ID:+--branch-id "$LAKEBASE_BRANCH_ID"} \
        || echo "[deploy] WARNING: grant step failed — re-run lakebase_grant_app_credential.sh manually." >&2
else
    echo "[deploy] WARNING: SP role didn't appear within 90s." >&2
    echo "[deploy]   The app may still be starting. After it's up, run:" >&2
    echo "    ./scripts/lakebase_grant_app_credential.sh --app-name $APP_NAME \\" >&2
    echo "        --project-id $LAKEBASE_PROJECT_ID --db-name $PGDATABASE" >&2
fi

# 5) Start the App so the container is warm (no-op if already running).
echo "[deploy] starting app"
databricks apps start "$APP_NAME" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} >/dev/null 2>&1 || true

# 6) Status + URL + log-tail.
echo
databricks apps get "$APP_NAME" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json | python3 -c "
import sys, json
d = json.load(sys.stdin)
ad = d.get('active_deployment', {}).get('status', {})
print(f\"  URL:    {d.get('url','?')}\")
print(f\"  App:    {d.get('app_status', {}).get('state', '?')}\")
print(f\"  Deploy: {ad.get('state','?')} — {ad.get('message','')}\")
"
echo
echo "  Tail logs:  databricks apps logs $APP_NAME ${PROFILE_FLAG[*]:-}"
