#!/usr/bin/env bash
# Kill only the previous instance of *this* project's dev server (tracked via
# a PID file scoped to this app dir), then `npm run dev`.
set -uo pipefail

cd "$(dirname "$0")"

APP_PORT="${DATABRICKS_APP_PORT:-8765}"
# Re-export so AppKit's server plugin (which reads DATABRICKS_APP_PORT) picks
# up the fallback. Without this, a standalone `./start.sh` with no parent
# injection leaves DATABRICKS_APP_PORT unset → AppKit defaults to 8000,
# which collides with the Demo Prompt Generator UI typically running there.
export DATABRICKS_APP_PORT="$APP_PORT"
# Derive HMR port from APP_PORT so multiple projects can run concurrently
# without their Vite WebSockets colliding. The +1000 offset is far enough
# from APP_PORT to avoid accidental overlap if someone increments APP_PORT,
# and the value is exported so vite.config.ts can read it.
HMR_PORT=$((APP_PORT + 1000))
export VITE_HMR_PORT="$HMR_PORT"
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
# Protect launcher-injected runtime vars from .env override.
#
# `source .env` below would overwrite the parent-injected DATABRICKS_APP_PORT
# (the dynamic port the Demo Prompt Generator launcher assigned us). Because
# bash propagates that re-assignment to the exported env, the Node child
# then binds to whatever .env says (typically a stale 8100) instead of the
# port the launcher is probing for readiness — preview gets stuck on
# "Booting" forever.
#
# Fix: when the launcher injected DATABRICKS_APP_PORT, strip the line from
# .env BEFORE we source it. EXIT trap (set further down) restores .env.
# Standalone runs (no parent injection) leave .env untouched.
if [ -n "${DATABRICKS_APP_PORT:-}" ] && [ -f .env ] && grep -qE '^[[:space:]]*DATABRICKS_APP_PORT=' .env; then
  cp .env .env.launcher-bak
  grep -vE '^[[:space:]]*DATABRICKS_APP_PORT=' .env.launcher-bak > .env
  echo "[start.sh] launcher injected DATABRICKS_APP_PORT=$DATABRICKS_APP_PORT — stripped from .env for this run"
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
#
# `cp -r` (used when the parent forks app_template/ into a new project) turns
# symlinks into regular files, so we always reinstall on a fresh copy. The
# probe checks both that the install exists AND that .bin/ symlinks are intact.
#
# Install strategy — fall back gracefully so a fresh fork never hangs:
#   1. `npm ci` (fast, deterministic — requires a synced lockfile).
#   2. If (1) fails because lockfile URLs are unreachable (e.g. corpnet proxy
#      baked into package-lock.json), retry with `--registry` forced to the
#      public registry. The lockfile's `integrity` hashes are URL-independent,
#      so this is safe.
#   3. If (2) still fails (lockfile out of sync with package.json — a forking
#      LLM added a dep without running `npm install` first), fall back to
#      `npm install` which is more permissive and re-resolves the tree.
PUBLIC_NPM=https://registry.npmjs.org/
install_deps() {
  # `.npmrc` sets `omit=dev` so the Databricks Apps runtime container only
  # ships runtime deps (build artifacts are pre-built by scripts/build-app.sh).
  # Local preview needs the full toolchain (vite, tsx, @databricks/appkit-ui,
  # etc.) — every install path here forces `--include=dev` to override .npmrc.
  echo "[start.sh] node_modules missing or broken — reinstalling…"
  rm -rf node_modules
  if npm ci --include=dev 2>&1; then
    return 0
  fi
  echo "[start.sh] npm ci failed — retrying against public registry ($PUBLIC_NPM)…"
  if npm ci --include=dev --registry="$PUBLIC_NPM" 2>&1; then
    return 0
  fi
  echo "[start.sh] npm ci failed (lockfile likely out of sync) — falling back to npm install…"
  npm install --include=dev --registry="$PUBLIC_NPM"
}

# Decide whether deps need (re)installing. We trigger install in 3 cases:
#   1. node_modules/ missing entirely (first run after a fresh fork).
#   2. `.bin/tsx` is not a symlink (cp -r turned symlinks into regular files
#      during the parent's app_template/ → projects/<id>/app/ copy).
#   3. package.json or package-lock.json is newer than node_modules's own
#      `.package-lock.json` snapshot — meaning someone (typically the LLM
#      customizing the template) edited deps without rerunning install.
#      npm itself writes node_modules/.package-lock.json at the END of a
#      successful install, so its mtime is "last time the tree matched
#      the manifest". Anything edited after that is drift → reinstall.
needs_install() {
  # Probe a runtime dep (appkit) AND a dev-only dep (appkit-ui). If only
  # the runtime dep exists, someone ran `npm install` without --include=dev
  # (or with omit=dev from .npmrc winning) — the client build will fail
  # at vite import-resolution. Both modes (standalone + preview) must
  # always reinstall the full dev tree here.
  [ ! -d "node_modules/@databricks/appkit/dist" ] && return 0
  [ ! -d "node_modules/@databricks/appkit-ui" ] && return 0
  [ ! -L "node_modules/.bin/tsx" ] && return 0
  if [ -f "node_modules/.package-lock.json" ]; then
    if [ "package.json" -nt "node_modules/.package-lock.json" ] || \
       { [ -f "package-lock.json" ] && [ "package-lock.json" -nt "node_modules/.package-lock.json" ]; }; then
      echo "[start.sh] package.json/package-lock.json edited since last install — reinstalling…"
      return 0
    fi
  fi
  return 1
}

if needs_install; then
  if ! install_deps; then
    echo "[start.sh] ERROR: dependency install failed. See errors above." >&2
    exit 1
  fi
fi

# Generate the Drizzle migrations explicitly. The `predev` lifecycle hook
# (npm run sync && typegen && db:generate) would normally do this before
# `npm run dev` — BUT .npmrc sets `ignore-scripts=true` (to skip the
# postinstall typegen on the runtime container), which ALSO suppresses
# pre/post scripts like `predev`. Without this line `drizzle/` is never
# created and the server's runMigrations() 503s with "No Drizzle migrations
# folder found" on first preview boot. Run it directly so it's independent of
# the npm lifecycle. Idempotent + cheap (regenerates from schema.ts).
if [ ! -d drizzle ] || [ -z "$(ls -A drizzle 2>/dev/null)" ]; then
  echo "[start.sh] generating Drizzle migrations (db:generate)…"
  npm run db:generate || {
    echo "[start.sh] ERROR: db:generate failed — server will 503 on migrate." >&2
    exit 1
  }
fi

echo "[start.sh] ports clear — starting dev server"
echo "[start.sh] open: http://localhost:$APP_PORT  (use localhost, NOT 0.0.0.0 — embedded AI/BI dashboards need a secure context, and browsers treat 0.0.0.0 as non-secure → crypto.randomUUID is undefined and the dashboard iframe errors out)"

# Auth diagnostic — prints which Databricks auth source the app will use.
# The parent (Demo Prompt Generator) injects DATABRICKS_CONFIG_FILE in
# deployed mode and DATABRICKS_CONFIG_PROFILE in local mode. See AUTH.md
# in the generator's backend. Knowing this up-front makes "why is my
# agent unauthenticated" debugging instant.
#
# Standalone fallback: if neither var is set (running ./start.sh directly
# for debugging, outside the Demo Prompt Generator launcher), pick the
# ~/.databrickscfg profile whose host matches .env's DATABRICKS_HOST — so
# the app authenticates against the SAME workspace the demo is wired to.
# Blindly defaulting to DEFAULT was a footgun: DEFAULT often points at a
# different workspace, and a valid token sent to the wrong host comes back
# as "Bad Request: Invalid Token". Fall back to DEFAULT only if no profile
# matches (also avoids the SDK's host-collision error).
#
# .env is loaded at runtime by tsx (--env-file-if-exists), not in this
# shell yet, so we parse DATABRICKS_HOST out of .env directly here.
#
# Two profiles can share a host (e.g. a valid one + a stale one), so host
# alone is ambiguous — among the matches we prefer one that actually
# authenticates (`databricks auth token`), and warn (rather than guess)
# if several valid ones tie. The whole helper is best-effort: any miss
# falls through to DEFAULT.
_match_profile_by_host() {
  local want_host cfg host_norm line cur_profile matches=() p valid=()
  want_host=$(grep -E '^[[:space:]]*DATABRICKS_HOST=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \t\r')
  [ -z "$want_host" ] && return 1
  want_host=${want_host%/}                          # strip trailing slash
  cfg="${HOME}/.databrickscfg"
  [ -r "$cfg" ] || return 1
  # Walk the ini: collect EVERY profile whose host= matches.
  while IFS= read -r line; do
    case "$line" in
      \[*\])  cur_profile=${line#[}; cur_profile=${cur_profile%]} ;;
      *host*=*)
        host_norm=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*host[[:space:]]*=[[:space:]]*//; s#/$##')
        [ "$host_norm" = "$want_host" ] && matches+=("$cur_profile")
        ;;
    esac
  done < "$cfg"
  [ ${#matches[@]} -eq 0 ] && return 1
  if [ ${#matches[@]} -eq 1 ]; then printf '%s' "${matches[0]}"; return 0; fi
  # Ambiguous host → keep only profiles that currently authenticate.
  if command -v databricks >/dev/null 2>&1; then
    for p in "${matches[@]}"; do
      databricks auth token -p "$p" >/dev/null 2>&1 && valid+=("$p")
    done
  fi
  if [ ${#valid[@]} -eq 1 ]; then printf '%s' "${valid[0]}"; return 0; fi
  # 0 valid or a tie among several valid → too ambiguous to pick safely.
  echo "[start.sh] auth: .env's DATABRICKS_HOST ($want_host) matches multiple ~/.databrickscfg profiles (${matches[*]}) and can't be disambiguated — set DATABRICKS_CONFIG_PROFILE explicitly." >&2
  return 1
}

if [ -z "${DATABRICKS_CONFIG_FILE:-}" ] && [ -z "${DATABRICKS_CONFIG_PROFILE:-}" ]; then
  if _matched=$(_match_profile_by_host); then
    export DATABRICKS_CONFIG_PROFILE="$_matched"
    echo "[start.sh] auth: no profile injected — matched DATABRICKS_CONFIG_PROFILE=$_matched to .env's DATABRICKS_HOST (set one in your env to override)."
  else
    export DATABRICKS_CONFIG_PROFILE=DEFAULT
    echo "[start.sh] auth: no profile injected, no unambiguous ~/.databrickscfg match for .env's DATABRICKS_HOST — defaulting to DATABRICKS_CONFIG_PROFILE=DEFAULT. If the app 401s/Invalid-Tokens, run: DATABRICKS_CONFIG_PROFILE=<your-profile> ./start.sh"
  fi
elif [ -n "${DATABRICKS_CONFIG_FILE:-}" ]; then
  echo "[start.sh] auth: DATABRICKS_CONFIG_FILE=$DATABRICKS_CONFIG_FILE profile=${DATABRICKS_CONFIG_PROFILE:-DEFAULT}"
  if [ ! -r "$DATABRICKS_CONFIG_FILE" ]; then
    echo "[start.sh] WARNING: DATABRICKS_CONFIG_FILE is set but not readable — subprocess calls may 401."
  fi
else
  echo "[start.sh] auth: DATABRICKS_CONFIG_PROFILE=$DATABRICKS_CONFIG_PROFILE (from inherited ~/.databrickscfg)"
fi

# Dev-only: forward browser errors (ErrorBoundary, window.onerror,
# unhandledrejection) to the server terminal. Never set in prod.
export DEV_CLIENT_ERROR_LOG=1

# Launch `npm run dev` in a fresh session so its PGID equals its PID. Record
# that PGID so the next ./start.sh run kills only this project's tree.
# setsid on Linux; Python's os.setsid() on macOS (setsid is Linux-only).
trap 'rm -f "$PGID_FILE"; [ -f .env.launcher-bak ] && mv .env.launcher-bak .env' EXIT

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
