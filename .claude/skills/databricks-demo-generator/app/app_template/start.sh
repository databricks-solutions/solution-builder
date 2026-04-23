#!/usr/bin/env bash
# Kill only the previous instance of *this* project's dev server (tracked via
# a PID file scoped to this app dir), then `npm run dev`.
set -uo pipefail

cd "$(dirname "$0")"

APP_PORT="${DATABRICKS_APP_PORT:-8765}"
HMR_PORT=24678
PGID_FILE=".preview.pgid"

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "${pids:-}" ]; then
    echo "[start.sh] killing pids on :$port → $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

# Kill the previous run of this project only (if any), by process group.
if [ -f "$PGID_FILE" ]; then
  old_pgid=$(cat "$PGID_FILE" 2>/dev/null || true)
  if [ -n "${old_pgid:-}" ] && kill -0 "-$old_pgid" 2>/dev/null; then
    echo "[start.sh] killing previous preview process group $old_pgid"
    kill -TERM "-$old_pgid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "-$old_pgid" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "-$old_pgid" 2>/dev/null || true
  fi
  rm -f "$PGID_FILE"
fi

# Free our own ports in case something unrelated lingers on them.
for _ in 1 2 3; do
  kill_port "$APP_PORT"
  kill_port "$HMR_PORT"
  sleep 0.4
  if ! lsof -ti:"$APP_PORT" >/dev/null 2>&1 && ! lsof -ti:"$HMR_PORT" >/dev/null 2>&1; then
    break
  fi
done

if lsof -ti:"$APP_PORT" >/dev/null 2>&1; then
  echo "[start.sh] ERROR: something still listening on :$APP_PORT:"
  lsof -i:"$APP_PORT" || true
  exit 1
fi

# Create .env from template if it doesn't exist
if [ ! -f ".env" ]; then
  if [ -f ".env.template" ]; then
    cp .env.template .env
    echo "[start.sh] created .env from .env.template — fill in the values and re-run."
  else
    echo "[start.sh] ERROR: no .env file. Copy .env.template to .env and fill in your values."
  fi
  exit 1
fi

# ----------------------------------------------------------------------------
# .env validation — catches the common mistakes LLMs make with a clear error
# pointing at the fix. Keeps errors greppable + actionable.
# ----------------------------------------------------------------------------
source .env

errors=()

# --- Presence ---
[ -z "${DATABRICKS_HOST:-}" ]         && errors+=("DATABRICKS_HOST is missing.")
[ -z "${LAKEBASE_ENDPOINT:-}" ]       && errors+=("LAKEBASE_ENDPOINT is missing.")
[ -z "${PGHOST:-}" ]                  && errors+=("PGHOST is missing.")
[ -z "${DATABRICKS_WAREHOUSE_ID:-}" ] && errors+=("DATABRICKS_WAREHOUSE_ID is missing.")

# --- Unreplaced placeholders (<...>, TODO, FILL_ME) ---
for var in DATABRICKS_HOST LAKEBASE_ENDPOINT PGHOST DATABRICKS_WAREHOUSE_ID DATABRICKS_WORKSPACE_ID PGDATABASE; do
  val="${!var:-}"
  if [[ "$val" == *"<"*">"* ]] || [[ "$val" == *"TODO"* ]] || [[ "$val" == *"FILL_ME"* ]]; then
    errors+=("$var still contains a placeholder ('$val'). Replace it with the real value.")
  fi
done

# --- DATABRICKS_HOST format ---
if [ -n "${DATABRICKS_HOST:-}" ]; then
  if [[ "$DATABRICKS_HOST" != https://* ]]; then
    errors+=("DATABRICKS_HOST must start with 'https://' (got: '$DATABRICKS_HOST').")
  fi
  if [[ "$DATABRICKS_HOST" == */ ]]; then
    errors+=("DATABRICKS_HOST must NOT end with a trailing slash (got: '$DATABRICKS_HOST'). AppKit appends paths itself.")
  fi
fi

# --- LAKEBASE_ENDPOINT vs PGHOST — the classic confusion ---
# LAKEBASE_ENDPOINT must be a resource path: projects/<id>/branches/<id>/endpoints/<id>
# PGHOST must be a DNS hostname ending in .cloud.databricks.com (or similar)
if [ -n "${LAKEBASE_ENDPOINT:-}" ]; then
  if [[ "$LAKEBASE_ENDPOINT" != projects/*/branches/*/endpoints/* ]]; then
    errors+=("LAKEBASE_ENDPOINT must be a resource path, not a hostname.
             Expected format: projects/<PROJECT_ID>/branches/<BRANCH>/endpoints/<ENDPOINT>
             Got:             '$LAKEBASE_ENDPOINT'
             Fix: run  databricks postgres get-endpoint projects/<PROJECT_ID>/branches/production/endpoints/primary
                  take the '.name' field (a path starting with 'projects/')     → LAKEBASE_ENDPOINT
                  take the '.status.hosts.host' field (ends .cloud.databricks.com) → PGHOST")
  fi
  if [[ "$LAKEBASE_ENDPOINT" == *".cloud.databricks.com"* ]] || [[ "$LAKEBASE_ENDPOINT" == *".database."* ]]; then
    errors+=("LAKEBASE_ENDPOINT looks like a hostname. It must be a resource path starting with 'projects/'. That hostname belongs in PGHOST.")
  fi
fi

if [ -n "${PGHOST:-}" ]; then
  if [[ "$PGHOST" == projects/* ]]; then
    errors+=("PGHOST looks like a resource path. It must be a DNS hostname (e.g. ep-xxx.database.<region>.cloud.databricks.com). That path belongs in LAKEBASE_ENDPOINT.")
  fi
  if [[ "$PGHOST" == https://* ]]; then
    errors+=("PGHOST must be a bare hostname — no 'https://' prefix. Got: '$PGHOST'")
  fi
  if [[ "$PGHOST" == *:* ]]; then
    errors+=("PGHOST must NOT contain a port. Use PGPORT for that. Got: '$PGHOST'")
  fi
fi

# --- Lakebase uses OAuth, not password auth ---
if [ -n "${PGPASSWORD:-}" ]; then
  errors+=("PGPASSWORD is set. Lakebase uses OAuth — remove PGPASSWORD from .env.")
fi

# --- Auth-file vars don't belong in .env ---
# The Demo Prompt Generator injects DATABRICKS_CONFIG_FILE / _PROFILE at
# spawn; the process env wins over .env, but putting them in .env is
# confusing and brittle. Reject.
if grep -qE '^[[:space:]]*(DATABRICKS_CONFIG_FILE|DATABRICKS_CONFIG_PROFILE|DATABRICKS_TOKEN)=' .env 2>/dev/null; then
  errors+=("Do not set DATABRICKS_CONFIG_FILE / DATABRICKS_CONFIG_PROFILE / DATABRICKS_TOKEN in .env — the launcher injects them (see AUTH.md in the generator).")
fi

# --- Report and exit ---
if [ ${#errors[@]} -gt 0 ]; then
  echo "" >&2
  echo "╔══════════════════════════════════════════════════════════════════╗" >&2
  echo "║ [start.sh] .env validation failed — ${#errors[@]} issue(s) found.             ║" >&2
  echo "╚══════════════════════════════════════════════════════════════════╝" >&2
  for i in "${!errors[@]}"; do
    printf '\n%d. %s\n' "$((i+1))" "${errors[$i]}" >&2
  done
  echo "" >&2
  echo "See .env.template for the full guide on each variable." >&2
  echo "After fixing .env, re-run ./start.sh (or click Restart in the UI)." >&2
  exit 1
fi

# Ensure dependencies are installed and .bin symlinks are valid.
# cp -r can turn symlinks into regular files — detect and fix by reinstalling.
if [ ! -d "node_modules/@databricks/appkit/dist" ] || [ ! -L "node_modules/.bin/tsx" ]; then
  echo "[start.sh] node_modules missing or broken — reinstalling…"
  rm -rf node_modules
  npm install
fi

echo "[start.sh] ports clear — starting dev server"

# Auth diagnostic — prints which Databricks auth source the app will use.
# The parent (Demo Prompt Generator) injects DATABRICKS_CONFIG_FILE in
# deployed mode and DATABRICKS_CONFIG_PROFILE in local mode. See AUTH.md
# in the generator's backend. Knowing this up-front makes "why is my
# agent unauthenticated" debugging instant.
if [ -n "${DATABRICKS_CONFIG_FILE:-}" ]; then
  echo "[start.sh] auth: DATABRICKS_CONFIG_FILE=$DATABRICKS_CONFIG_FILE profile=${DATABRICKS_CONFIG_PROFILE:-DEFAULT}"
  if [ ! -r "$DATABRICKS_CONFIG_FILE" ]; then
    echo "[start.sh] WARNING: DATABRICKS_CONFIG_FILE is set but not readable — subprocess calls may 401."
  fi
elif [ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]; then
  echo "[start.sh] auth: DATABRICKS_CONFIG_PROFILE=$DATABRICKS_CONFIG_PROFILE (from inherited ~/.databrickscfg)"
else
  echo "[start.sh] auth: no profile/file injected — relying on ambient Databricks auth env."
fi

# Dev-only: forward browser errors (ErrorBoundary, window.onerror,
# unhandledrejection) to the server terminal. Never set in prod.
export DEV_CLIENT_ERROR_LOG=1

# Launch `npm run dev` in a fresh session so its PGID equals its PID. Record
# that PGID so the next ./start.sh run kills only this project's tree.
# setsid on Linux; Python's os.setsid() on macOS (setsid is Linux-only).
trap 'rm -f "$PGID_FILE"' EXIT

(
  if command -v setsid >/dev/null 2>&1; then
    exec setsid npm run dev
  elif command -v python3 >/dev/null 2>&1; then
    exec python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' npm run dev
  else
    exec npm run dev
  fi
) &
child_pid=$!
echo "$child_pid" > "$PGID_FILE"
wait "$child_pid"
