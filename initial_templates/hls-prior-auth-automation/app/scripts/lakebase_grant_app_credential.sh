#!/usr/bin/env bash
# Grant the App's Postgres SP role CREATE+USAGE on schema `public`.
# Idempotent — Postgres no-ops repeated GRANTs.
#
# Usage:
#   ./scripts/lakebase_grant_app_credential.sh \
#     --app-name <name> --project-id <id> --db-name <name> [--branch-id <id>]
#
# Example:
#   ./scripts/lakebase_grant_app_credential.sh \
#     --app-name dbgen-luxebeauty --project-id dbdemos-asset-generator --db-name dbgen_luxebeauty
#
# Defaults: branch=production. `--app-name`, `--project-id`, `--db-name`
# are required: the script resolves the App's SP UUID via `apps get
# <app-name>` and matches it to the right Postgres role (multiple apps
# can share one project/branch, so we can't blindly pick the first SP role).
#
# Pass the same `--project-id` / `--db-name` you passed to lakebase_setup_db.sh.
#
# Without this script, the App's SP can connect to the database (CONNECT
# from the bundle binding or the Apps UI binding) but can't write to
# `public` — Drizzle migrations on first boot fail with `pg=42501`.
#
# Run AFTER the App is created / bundle-deployed. Idempotent.
set -euo pipefail

APP_NAME=""
DB_NAME=""
PROJECT_ID=""
BRANCH_ID="production"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --app-name)   APP_NAME="$2"; shift 2 ;;
        --db-name)    DB_NAME="$2"; shift 2 ;;
        --project-id) PROJECT_ID="$2"; shift 2 ;;
        --branch-id)  BRANCH_ID="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown arg: $1" >&2
            echo "Usage: $0 --app-name <name> --project-id <id> --db-name <name> [--branch-id <id>]" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$APP_NAME" || -z "$DB_NAME" || -z "$PROJECT_ID" ]]; then
    echo "Error: --app-name, --project-id, and --db-name are all required" >&2
    echo "Usage: $0 --app-name <name> --project-id <id> --db-name <name> [--branch-id <id>]" >&2
    exit 1
fi

PROFILE_FLAG=()
[[ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]] && \
    PROFILE_FLAG=(--profile "$DATABRICKS_CONFIG_PROFILE")

BRANCH_PATH="projects/$PROJECT_ID/branches/$BRANCH_ID"

# Resolve the App's SP UUID — that's what the Postgres role's `postgres_role`
# field contains. Match by app name so we don't grant to the wrong app
# when several apps share the same project/branch.
APP_SP_UUID="$(
    databricks apps get "$APP_NAME" "${PROFILE_FLAG[@]}" -o json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('service_principal_client_id',''))"
)"
[[ -z "$APP_SP_UUID" ]] && {
    echo "[grant] ERROR: app '$APP_NAME' not found or has no service principal." >&2
    echo "[grant]   Verify with: databricks apps get $APP_NAME" >&2
    exit 1
}
echo "[grant] target: $BRANCH_PATH database=$DB_NAME app=$APP_NAME (sp=$APP_SP_UUID)"

# Find the Postgres role whose postgres_role matches this app's SP UUID.
SP_ROLE="$(
    databricks postgres list-roles "$BRANCH_PATH" "${PROFILE_FLAG[@]}" -o json \
    | python3 -c "
import sys, json
sp = '$APP_SP_UUID'
for r in json.load(sys.stdin):
    s = r.get('status', {})
    if s.get('identity_type') == 'SERVICE_PRINCIPAL' and s.get('postgres_role') == sp:
        print(s['postgres_role'])
        break
"
)"
# No role for this SP yet? Create it. Normally the role appears when the App
# first connects to Lakebase (DAB binding apply / first connection), but on the
# interactive redeploy path there's no binding to auto-provision it — and the
# reassign step below NEEDS the new role to exist before it can transfer the
# prior (deleted) app's schema ownership onto it. So create it here.
# Note: role-id must match ^[a-z]([a-z0-9-]*)$, and the SP UUID starts with a
# digit, so we prefix `sp-`. The `postgres_role` field stays the bare SP UUID
# (that's what identifies the SP); `SP_ROLE` (used in the GRANTs) is the UUID too.
if [[ -z "$SP_ROLE" ]]; then
    echo "[grant] no Postgres role for SP $APP_SP_UUID yet — creating one"
    if databricks postgres create-role "$BRANCH_PATH" \
        --role-id "sp-$APP_SP_UUID" \
        --json "{\"spec\": {\"identity_type\": \"SERVICE_PRINCIPAL\", \"postgres_role\": \"$APP_SP_UUID\", \"auth_method\": \"LAKEBASE_OAUTH_V1\"}}" \
        ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} >/dev/null 2>&1; then
        SP_ROLE="$APP_SP_UUID"
        echo "[grant]   created role sp-$APP_SP_UUID (postgres_role=$APP_SP_UUID)"
    else
        echo "[grant] ERROR: could not create a Postgres role for SP $APP_SP_UUID in $BRANCH_PATH." >&2
        echo "[grant]   Create it manually, then re-run:" >&2
        echo "[grant]     databricks postgres create-role $BRANCH_PATH --role-id sp-$APP_SP_UUID \\" >&2
        echo "[grant]       --json '{\"spec\":{\"identity_type\":\"SERVICE_PRINCIPAL\",\"postgres_role\":\"$APP_SP_UUID\",\"auth_method\":\"LAKEBASE_OAUTH_V1\"}}'" >&2
        echo "[grant]   Verify with: databricks postgres list-roles $BRANCH_PATH" >&2
        exit 1
    fi
fi
echo "[grant] SP role: $SP_ROLE"

# ── Reassign stale ownership from a PRIOR app's SP ──────────────────────────
# On a redeploy-after-delete the app gets a NEW service principal, but the app
# schemas (app/appkit/drizzle) are still owned by the OLD, now-deleted app's SP
# role. The connecting user (us) is NOT that owner, so a plain DROP/ALTER can't
# fix it ("must be owner of schema appkit"). The managed-API fix is one command:
# `delete-role --reassign-owned-to` transfers everything the old SP owns to the
# current SP and drops the dead role (the CLI equivalent of the UI's "reassign
# owned objects"). Do this for every OTHER service-principal role on the branch
# so the current SP ends up owning its schemas. No-op when there's no stale SP.
STALE_ROLE_NAMES="$(
    databricks postgres list-roles "$BRANCH_PATH" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json \
    | python3 -c "
import sys, json
cur = '$APP_SP_UUID'
for r in json.load(sys.stdin):
    s = r.get('status', {})
    # a SERVICE_PRINCIPAL role that isn't the current app's SP = a leftover
    if s.get('identity_type') == 'SERVICE_PRINCIPAL' and s.get('postgres_role') != cur:
        print(r['name'])   # full resource path (roles/<name>, not the UUID)
"
)"
if [[ -n "$STALE_ROLE_NAMES" ]]; then
    NEW_ROLE_PATH="$BRANCH_PATH/roles/$SP_ROLE"
    while IFS= read -r old_path; do
        [[ -z "$old_path" ]] && continue
        echo "[grant] reassigning objects owned by stale SP role $old_path → current SP + dropping it"
        if databricks postgres delete-role "$old_path" --reassign-owned-to "$NEW_ROLE_PATH" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} >/dev/null 2>&1; then
            echo "[grant]   reassigned + dropped $old_path"
        else
            echo "[grant]   WARNING: reassign of $old_path failed (continuing)"
        fi
    done <<< "$STALE_ROLE_NAMES"
fi

# Auth as the current Databricks user (the DB owner from setup) to run the
# GRANTs. Token is short-lived; no plumbing needed beyond this call.
PG_HOST="$(
    databricks postgres get-endpoint "$BRANCH_PATH/endpoints/primary" "${PROFILE_FLAG[@]}" -o json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status']['hosts']['host'])"
)"
PG_TOKEN="$(
    databricks postgres generate-database-credential "$BRANCH_PATH/endpoints/primary" "${PROFILE_FLAG[@]}" -o json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
)"
PG_USER="$(databricks current-user me "${PROFILE_FLAG[@]}" -o json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])")"

PGPASSWORD="$PG_TOKEN" psql -h "$PG_HOST" -p 5432 -U "$PG_USER" \
    -d "$DB_NAME" --set=sslmode=require -v ON_ERROR_STOP=1 <<EOF
-- CREATE on the database so the app can make new schemas itself.
GRANT CREATE ON DATABASE "$DB_NAME" TO "$SP_ROLE";

-- public schema (default landing for anything unqualified)
GRANT USAGE, CREATE ON SCHEMA public TO "$SP_ROLE";
GRANT ALL ON ALL TABLES IN SCHEMA public TO "$SP_ROLE";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "$SP_ROLE";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "$SP_ROLE";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "$SP_ROLE";

-- The app uses three of its own schemas: \`app\` (Drizzle tables — the
-- Delta→Lakebase mirror), \`appkit\` (AppKit's PersistentStorage cache), and
-- \`drizzle\` (Drizzle's migration-tracking table). The SP creates + OWNS these
-- itself on first boot (it has GRANT CREATE ON DATABASE above). We must NOT try
-- to create/alter/drop them AS the connecting user — that fails with "must be
-- owner" / "must be able to SET ROLE" because we're neither the owner nor a
-- member of the SP role. Stale ownership from a prior app's SP is already
-- transferred by the delete-role --reassign-owned-to step above. So here we
-- only GRANT the SP on any of these schemas that ALREADY exist (best-effort;
-- skip silently if a schema isn't present yet — the SP makes it on boot).
DO \$\$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['app','appkit','drizzle'] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      BEGIN
        EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', s, '$SP_ROLE');
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', s, '$SP_ROLE');
        EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO %I', s, '$SP_ROLE');
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'not owner of schema % — SP owns it (via reassign) or will on boot; skipping grants', s;
      END;
    END IF;
  END LOOP;
END \$\$;
EOF

echo "[grant] done."
