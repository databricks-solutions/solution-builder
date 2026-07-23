#!/usr/bin/env bash
# Grant the App's Postgres SP role what it needs on the Lakebase database.
# Reference script — lives in the demo's app/scripts/ directory.
# Idempotent — Postgres no-ops repeated GRANTs.
#
# Usage:
#   ./scripts/lakebase_grant_app_credential.sh \
#     --app-name <name> --project-id <id> --db-name <name> [--branch-id <id>]
#
# Example:
#   ./scripts/lakebase_grant_app_credential.sh \
#     --app-name dbgen-<demo> --project-id <lakebase-project> --db-name dbgen_<demo>
#
# Defaults: branch=production. `--app-name`, `--project-id`, `--db-name`
# are required: the script resolves the App's SP UUID via `apps get
# <app-name>` and matches it to the right Postgres role (multiple apps
# can share one project/branch, so we can't blindly pick the first SP role).
#
# Pass the same `--project-id` / `--db-name` you used when creating the DB.
#
# Without this script, the App's SP can connect to the database (CONNECT
# from the bundle binding or the Apps UI binding) but can't write to its
# schemas — Drizzle migrations on first boot fail with `pg=42501`.
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
            sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
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
[[ -z "$SP_ROLE" ]] && {
    echo "[grant] ERROR: no Postgres role for SP $APP_SP_UUID in $BRANCH_PATH." >&2
    echo "[grant]   The role is created when the App connects to Lakebase the first time" >&2
    echo "[grant]   (DAB postgres binding apply, or first connection from the App)." >&2
    echo "[grant]   Verify with: databricks postgres list-roles $BRANCH_PATH" >&2
    exit 1
}
echo "[grant] SP role: $SP_ROLE"

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
-- \`drizzle\` (Drizzle's migration-tracking table). The SP must be able to
-- create + own tables in each. Two failure modes this guards against:
--   1. Schema doesn't exist → SP can't create it (only DB-level CREATE helps,
--      but Drizzle/AppKit reference the schema by name expecting it present).
--   2. Schema EXISTS but is owned by another role (e.g. a human who ran an
--      earlier deploy) → SP gets "permission denied for schema <x>".
-- We DROP + recreate each app schema so it's freshly owned/granted, then grant
-- the SP ALL on it. DROP CASCADE is safe: \`app\` tables are rebuilt from Delta
-- by db/sync.ts on every boot; \`appkit\`/\`drizzle\` are regenerable bookkeeping.
-- NOTE: we GRANT ALL to the SP rather than reassigning OWNER — the running
-- session is the human owner, and a plain SET ROLE to the SP would fail (the
-- human isn't a member of the SP role), so ownership stays with the human and
-- the SP gets full privileges instead.
DO \$\$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['app','appkit','drizzle'] LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
    EXECUTE format('CREATE SCHEMA %I', s);
    EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', s, '$SP_ROLE');
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO %I', s, '$SP_ROLE');
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON SEQUENCES TO %I', s, '$SP_ROLE');
  END LOOP;
END \$\$;
EOF

echo "[grant] done."
