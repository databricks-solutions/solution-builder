#!/usr/bin/env bash
# Ensure a Lakebase project + branch + endpoint + database exist.
# Idempotent — safe to re-run; reuses anything that already exists.
#
# Usage:
#   ./scripts/lakebase_setup_db.sh --db-name <name> [--project-id <id>] [--branch-id <id>]
#
# Shared-project distribution (when --project-id is OMITTED):
#   Demo databases are spread across a POOL of shared projects
#   (`dbdemos-asset-generator`, then `-2`, `-3`, … `-9` — 10 projects max)
#   instead of piling into one. Before creating a database the script
#   proactively picks the first pool project holding fewer than
#   SHARED_PROJECT_MAX_DBS databases (default 50), creating the next pool
#   project as needed. Every `CREATE DATABASE` auto-provisions ~2 Postgres
#   roles for zeroETL, so hundreds of databases on one project's branch blow
#   Lakebase's roles-per-branch limit (this paged Lakebase oncalls when 380+
#   demos landed in a single project). Capping databases-per-project keeps
#   every branch well under that limit and keeps endpoint starts fast. Because
#   the pool is bounded (10 projects for up to ~500 demos), it also stays far
#   under the 1000-projects-per-workspace quota. Override the cap with
#   SHARED_PROJECT_MAX_DBS=<n>.
#
# Examples:
#   ./scripts/lakebase_setup_db.sh --db-name dbgen_luxebeauty
#       → shared pool, proactive distribution (+ reactive fallback on a race).
#         Branch defaults to `production`.
#   ./scripts/lakebase_setup_db.sh --db-name dbgen_x --project-id my-private-project
#       → dedicated project; fails loudly if full (no pool fallback).
#   ./scripts/lakebase_setup_db.sh --db-name dbgen_x --project-id my-project --branch-id staging
#       → dedicated project + branch.
#
# Same flags work whether you run this during local app development or as a
# pre-step when packaging the demo as a DAB. In the DAB case the database
# resource path printed at the end is what the App's `postgres` binding
# `database:` field must reference.
set -euo pipefail

# ── Config / sourceable globals ──────────────────────────────────────────────
# The base shared-pool project. New demos (no --project-id) are distributed
# across this project and its numbered siblings.
SHARED_PROJECT_DEFAULT="dbdemos-asset-generator"
# Max databases per shared-pool project before rolling to the next one. Each
# database auto-adds ~2 zeroETL roles, so this caps roles-per-branch well under
# Lakebase's limit. Conservative default; override via the environment.
SHARED_PROJECT_MAX_DBS="${SHARED_PROJECT_MAX_DBS:-50}"
# Safe defaults so the helpers below are sourceable (unit tests) under `set -u`;
# main() sets the real values from args/env.
BRANCH_ID="${BRANCH_ID:-production}"
PROFILE_FLAG=()

# NOTE: every `databricks` call expands PROFILE_FLAG as
# `${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"}` — the `[@]+` guard makes an EMPTY
# array expand to nothing under `set -u` on bash 3.2 (the macOS default), where
# a bare `"${PROFILE_FLAG[@]}"` otherwise raises "unbound variable".

# ── Helpers ──────────────────────────────────────────────────────────────────
# The ordered shared-project pool: base, then -2 .. -9.
shared_candidates() {
    echo "$SHARED_PROJECT_DEFAULT"
    local i
    for i in 2 3 4 5 6 7 8 9; do echo "${SHARED_PROJECT_DEFAULT}-${i}"; done
}

project_exists() {
    databricks postgres get-project "projects/$1" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} > /dev/null 2>&1
}

# Count databases on a project's branch. Emits exactly ONE integer on stdout and
# always exits 0. "Unavailable" (transient CLI error, or a project whose branch
# isn't listable yet) reads as 0 — a fresh/empty project, so it gets chosen.
# The CLI call is captured separately (not piped) so a nonzero exit can't ride a
# pipe under `set -o pipefail` and turn the count into a second stray line.
count_databases() {
    local proj="$1" json
    json="$(databricks postgres list-databases "projects/$proj/branches/$BRANCH_ID" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json 2>/dev/null)" || json=""
    printf '%s' "$json" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read() or '[]')
    xs = d if isinstance(d, list) else d.get('databases', [])
    print(len(xs))
except Exception:
    print(0)
" 2>/dev/null || echo 0
}

# Proactively pick the first shared-pool project with headroom (fewer than
# SHARED_PROJECT_MAX_DBS databases). A not-yet-created project counts as empty
# and is chosen (main creates it). Echoes the slug; returns 1 if the whole pool
# is at capacity.
pick_shared_project() {
    local cand n
    for cand in $(shared_candidates); do
        if ! project_exists "$cand"; then
            echo "$cand"; return 0
        fi
        n="$(count_databases "$cand")"
        if [[ "$n" -lt "$SHARED_PROJECT_MAX_DBS" ]]; then
            echo "$cand"; return 0
        fi
    done
    return 1
}

ensure_project() {
    local p="$1"
    if databricks postgres get-project "projects/$p" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} > /dev/null 2>&1; then
        return 0
    fi
    if databricks postgres create-project "$p" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} \
        --json "{\"spec\":{\"display_name\":\"$p\",\"pg_version\":17}}" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

ensure_branch_and_endpoint() {
    local proj="$1"
    local branch_path="projects/$proj/branches/$BRANCH_ID"
    if ! databricks postgres get-branch "$branch_path" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} > /dev/null 2>&1; then
        databricks postgres create-branch "projects/$proj" "$BRANCH_ID" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} \
            --json '{"spec":{"no_expiry":true}}' > /dev/null
    fi
    if ! databricks postgres get-endpoint "$branch_path/endpoints/primary" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} > /dev/null 2>&1; then
        databricks postgres create-endpoint "$branch_path" primary ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} \
            --json '{"spec":{"endpoint_type":"ENDPOINT_TYPE_READ_WRITE","autoscaling_limit_min_cu":0.5,"autoscaling_limit_max_cu":2}}' > /dev/null
    fi
}

# Returns "exists" / "created" on stdout, empty on failure.
try_create_database() {
    local proj="$1"
    local branch_path="projects/$proj/branches/$BRANCH_ID"
    if databricks postgres get-database "$branch_path/databases/$DB_ID" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} > /dev/null 2>&1; then
        echo "exists"
        return 0
    fi
    local owner_role
    owner_role="$(
        databricks postgres list-roles "$branch_path" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json 2>/dev/null \
        | python3 -c "import sys,json; rs=json.load(sys.stdin); print(rs[0]['name']) if rs else ''"
    )"
    [[ -z "$owner_role" ]] && return 1
    if databricks postgres create-database "$branch_path" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} \
        --database-id "$DB_ID" \
        --json "{\"spec\":{\"postgres_database\":\"$DB_NAME\",\"role\":\"$owner_role\"}}" > /dev/null 2>&1; then
        echo "created"
        return 0
    fi
    return 1
}

# ── main ─────────────────────────────────────────────────────────────────────
main() {
    DB_NAME=""
    PROJECT_ID=""
    BRANCH_ID="production"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --db-name)    DB_NAME="$2"; shift 2 ;;
            --project-id) PROJECT_ID="$2"; shift 2 ;;
            --branch-id)  BRANCH_ID="$2"; shift 2 ;;
            -h|--help)
                # Print the whole header comment block (robust to its length).
                awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"
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

    # When --project-id is omitted, use the shared pool with proactive
    # distribution + reactive fallback. When passed explicitly, fail loudly.
    USE_SHARED_DEFAULT=false
    if [[ -z "$PROJECT_ID" ]]; then
        USE_SHARED_DEFAULT=true
    fi

    if [[ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]]; then
        PROFILE_FLAG=(--profile "$DATABRICKS_CONFIG_PROFILE")
    else
        PROFILE_FLAG=()
    fi

    # DB resource ID (slug used in the resource path). Lowercase + digits +
    # hyphens only — replace underscores from the friendly DB name.
    DB_ID="db-${DB_NAME//_/-}"

    # ── Pick the target project ──────────────────────────────────────────────
    # Shared pool: proactively choose a project with headroom BEFORE creating
    # (the fix for the roles-per-branch limit — don't pile every demo into the
    # base project). Explicit --project-id: use it as-is.
    if $USE_SHARED_DEFAULT; then
        PROJECT_ID="$(pick_shared_project)" || {
            echo "[setup-db] ERROR: shared pool (${SHARED_PROJECT_DEFAULT}, -2..-9) is at capacity" >&2
            echo "[setup-db]   (>= ${SHARED_PROJECT_MAX_DBS} databases each). Options: pass --project-id" >&2
            echo "[setup-db]   <dedicated-project>, raise SHARED_PROJECT_MAX_DBS, or reap dead demo DBs." >&2
            exit 1
        }
    fi

    # ── Project + branch + endpoint ──────────────────────────────────────────
    ensure_project "$PROJECT_ID" || {
        echo "[setup-db] ERROR: cannot create or access project '$PROJECT_ID'" >&2
        exit 1
    }
    echo "[setup-db] project: $PROJECT_ID"
    ensure_branch_and_endpoint "$PROJECT_ID"
    BRANCH_PATH="projects/$PROJECT_ID/branches/$BRANCH_ID"

    # ── Database (with shared-pool reactive fallback) ────────────────────────
    result="$(try_create_database "$PROJECT_ID" || true)"
    if [[ -z "$result" ]]; then
        if ! $USE_SHARED_DEFAULT; then
            echo "[setup-db] ERROR: could not create database '$DB_NAME' in project '$PROJECT_ID'." >&2
            echo "[setup-db]   Inspect with: databricks postgres list-databases $BRANCH_PATH" >&2
            exit 1
        fi
        # Proactive pick should have found headroom; this covers a race where
        # the chosen project filled between pick and create. Try the rest of
        # the pool (skip the one we already tried).
        echo "[setup-db] '$PROJECT_ID' rejected the database (race/full). Trying pool fallbacks…"
        for cand in $(shared_candidates); do
            [[ "$cand" == "$PROJECT_ID" ]] && continue
            echo "[setup-db]   trying $cand"
            ensure_project "$cand" || continue
            ensure_branch_and_endpoint "$cand"
            result="$(try_create_database "$cand" || true)"
            if [[ -n "$result" ]]; then
                PROJECT_ID="$cand"
                BRANCH_PATH="projects/$cand/branches/$BRANCH_ID"
                break
            fi
        done
        [[ -z "$result" ]] && {
            echo "[setup-db] ERROR: exhausted shared pool (${SHARED_PROJECT_DEFAULT}, -2..-9)." >&2
            echo "[setup-db]   Free up a project, raise SHARED_PROJECT_MAX_DBS, or pass --project-id." >&2
            exit 1
        }
    fi
    echo "[setup-db] database '$DB_NAME' (id=$DB_ID): $result"

    # ── Print connection details for .env / app config ───────────────────────
    PG_HOST="$(
        databricks postgres get-endpoint "$BRANCH_PATH/endpoints/primary" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['status']['hosts']['host'])"
    )"

    # Resolve the project UUID (`uid`) — the `resources.json` `lakebase_project_id`
    # field and the workspace UI link (`/lakebase/projects/<uid>`) route by the UUID,
    # NOT the slug/name. `$PROJECT_ID` above is the SLUG. Emit both, explicitly
    # labeled, so the exact right value lands in resources.json (the #1 mistake here
    # is recording the slug where the UUID belongs → a 404 on "Open Lakebase").
    PROJECT_UID="$(
        databricks postgres get-project "projects/$PROJECT_ID" ${PROFILE_FLAG[@]+"${PROFILE_FLAG[@]}"} -o json 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('uid',''))" 2>/dev/null
    )"

    cat <<EOF

[setup-db] done. Use these values for your .env / app config:

  LAKEBASE_PROJECT_ID=$PROJECT_ID   # (this is the SLUG — used by CLI + resource paths)
  LAKEBASE_ENDPOINT=$BRANCH_PATH/endpoints/primary
  PGHOST=$PG_HOST
  PGDATABASE=$DB_NAME

  # Database resource path (for the App's bundle \`postgres\` binding):
  $BRANCH_PATH/databases/$DB_ID

[setup-db] Record these in resources.json created_resources (see app.md):
  lakebase_project_id   = $PROJECT_UID   # ← the UUID (uid) — powers the /lakebase/projects/<uid> UI link
  lakebase_project_slug = $PROJECT_ID   # ← the slug/name — for CLI + DAB paths
  # If the uid above is blank, resolve it with:
  #   databricks postgres get-project "projects/$PROJECT_ID" -o json | jq -r '.uid'

EOF
}

# Run main only when executed directly, so the file can be sourced by unit
# tests to exercise the helpers (see lakebase_setup_db_test.sh).
if [[ "${BASH_SOURCE[0]:-}" == "${0:-}" ]]; then
    main "$@"
fi
