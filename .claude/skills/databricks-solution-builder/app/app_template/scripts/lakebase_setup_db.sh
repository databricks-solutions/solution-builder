#!/usr/bin/env bash
# Ensure a Lakebase project + branch + endpoint + database exist.
# Idempotent — safe to re-run; reuses anything that already exists.
#
# Usage:
#   ./scripts/lakebase_setup_db.sh --db-name <name> [--project-id <id>] [--branch-id <id>]
#
# Examples:
#   ./scripts/lakebase_setup_db.sh --db-name dbgen_luxebeauty
#       → uses shared `dbdemos-asset-generator` project; if it's full, falls
#         back to `-2`, `-3`, ... up to `-9`. Branch defaults to `production`.
#
#   ./scripts/lakebase_setup_db.sh --db-name dbgen_luxebeauty --project-id my-private-project
#       → dedicated project; fails loudly if full (no auto-fallback).
#
#   ./scripts/lakebase_setup_db.sh --db-name dbgen_luxebeauty --project-id my-private-project --branch-id staging
#       → dedicated project + branch.
#
# Same flags work whether you run this during local app development or as
# a pre-step when packaging the demo as a DAB. In the DAB case the
# database resource path printed at the end is what the App's `postgres`
# binding `database:` field must reference.
set -euo pipefail

# ── Arg parsing ────────────────────────────────────────────────────────────
DB_NAME=""
PROJECT_ID=""
BRANCH_ID="production"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --db-name)    DB_NAME="$2"; shift 2 ;;
        --project-id) PROJECT_ID="$2"; shift 2 ;;
        --branch-id)  BRANCH_ID="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown arg: $1" >&2
            echo "Usage: $0 --db-name <name> [--project-id <id>] [--branch-id <id>]" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$DB_NAME" ]]; then
    echo "Error: --db-name is required" >&2
    echo "Usage: $0 --db-name <name> [--project-id <id>] [--branch-id <id>]" >&2
    exit 1
fi

# When --project-id is omitted, use the shared default with auto-bump
# fallback on capacity errors. When passed explicitly, fail loudly.
SHARED_PROJECT_DEFAULT="dbdemos-asset-generator"
USE_SHARED_DEFAULT=false
if [[ -z "$PROJECT_ID" ]]; then
    PROJECT_ID="$SHARED_PROJECT_DEFAULT"
    USE_SHARED_DEFAULT=true
fi

PROFILE_FLAG=()
[[ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]] && \
    PROFILE_FLAG=(--profile "$DATABRICKS_CONFIG_PROFILE")

# DB resource ID (slug used in the resource path). Lowercase + digits +
# hyphens only — replace underscores from the friendly DB name.
DB_ID="db-${DB_NAME//_/-}"

# ── Helpers ────────────────────────────────────────────────────────────────
ensure_project() {
    local p="$1"
    if databricks postgres get-project "projects/$p" "${PROFILE_FLAG[@]}" > /dev/null 2>&1; then
        return 0
    fi
    if databricks postgres create-project "$p" "${PROFILE_FLAG[@]}" \
        --json "{\"spec\":{\"display_name\":\"$p\",\"pg_version\":17}}" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

ensure_branch_and_endpoint() {
    local proj="$1"
    local branch_path="projects/$proj/branches/$BRANCH_ID"
    if ! databricks postgres get-branch "$branch_path" "${PROFILE_FLAG[@]}" > /dev/null 2>&1; then
        databricks postgres create-branch "projects/$proj" "$BRANCH_ID" "${PROFILE_FLAG[@]}" \
            --json '{"spec":{"no_expiry":true}}' > /dev/null
    fi
    if ! databricks postgres get-endpoint "$branch_path/endpoints/primary" "${PROFILE_FLAG[@]}" > /dev/null 2>&1; then
        databricks postgres create-endpoint "$branch_path" primary "${PROFILE_FLAG[@]}" \
            --json '{"spec":{"endpoint_type":"ENDPOINT_TYPE_READ_WRITE","autoscaling_limit_min_cu":0.5,"autoscaling_limit_max_cu":2}}' > /dev/null
    fi
}

# Returns "exists" / "created" on stdout, empty on failure.
try_create_database() {
    local proj="$1"
    local branch_path="projects/$proj/branches/$BRANCH_ID"
    if databricks postgres get-database "$branch_path/databases/$DB_ID" "${PROFILE_FLAG[@]}" > /dev/null 2>&1; then
        echo "exists"
        return 0
    fi
    local owner_role
    owner_role="$(
        databricks postgres list-roles "$branch_path" "${PROFILE_FLAG[@]}" -o json 2>/dev/null \
        | python3 -c "import sys,json; rs=json.load(sys.stdin); print(rs[0]['name']) if rs else ''"
    )"
    [[ -z "$owner_role" ]] && return 1
    if databricks postgres create-database "$branch_path" "${PROFILE_FLAG[@]}" \
        --database-id "$DB_ID" \
        --json "{\"spec\":{\"postgres_database\":\"$DB_NAME\",\"role\":\"$owner_role\"}}" > /dev/null 2>&1; then
        echo "created"
        return 0
    fi
    return 1
}

# ── Project + branch + endpoint ────────────────────────────────────────────
ensure_project "$PROJECT_ID" || {
    echo "[setup-db] ERROR: cannot create or access project '$PROJECT_ID'" >&2
    exit 1
}
echo "[setup-db] project: $PROJECT_ID"
ensure_branch_and_endpoint "$PROJECT_ID"
BRANCH_PATH="projects/$PROJECT_ID/branches/$BRANCH_ID"

# ── Database (with shared-default fallback) ────────────────────────────────
result="$(try_create_database "$PROJECT_ID" || true)"
if [[ -z "$result" ]]; then
    if ! $USE_SHARED_DEFAULT; then
        echo "[setup-db] ERROR: could not create database '$DB_NAME' in project '$PROJECT_ID'." >&2
        echo "[setup-db]   Inspect with: databricks postgres list-databases $BRANCH_PATH" >&2
        exit 1
    fi
    echo "[setup-db] '$PROJECT_ID' rejected the database (likely full). Trying fallbacks…"
    for i in 2 3 4 5 6 7 8 9; do
        FALLBACK="${SHARED_PROJECT_DEFAULT}-${i}"
        echo "[setup-db]   trying $FALLBACK"
        ensure_project "$FALLBACK" || continue
        ensure_branch_and_endpoint "$FALLBACK"
        result="$(try_create_database "$FALLBACK" || true)"
        if [[ -n "$result" ]]; then
            PROJECT_ID="$FALLBACK"
            BRANCH_PATH="projects/$FALLBACK/branches/$BRANCH_ID"
            break
        fi
    done
    [[ -z "$result" ]] && {
        echo "[setup-db] ERROR: exhausted fallbacks (-2..-9). Free up a project or pass --project-id." >&2
        exit 1
    }
fi
echo "[setup-db] database '$DB_NAME' (id=$DB_ID): $result"

# ── Print connection details for .env / app config ─────────────────────────
PG_HOST="$(
    databricks postgres get-endpoint "$BRANCH_PATH/endpoints/primary" "${PROFILE_FLAG[@]}" -o json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status']['hosts']['host'])"
)"

cat <<EOF

[setup-db] done. Use these values for your .env / app config:

  LAKEBASE_PROJECT_ID=$PROJECT_ID
  LAKEBASE_ENDPOINT=$BRANCH_PATH/endpoints/primary
  PGHOST=$PG_HOST
  PGDATABASE=$DB_NAME

  # Database resource path (for the App's bundle \`postgres\` binding):
  $BRANCH_PATH/databases/$DB_ID

EOF
