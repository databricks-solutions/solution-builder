#!/usr/bin/env bash
# Build the Databricks App for deployment. Wired into databricks.yml's
# `artifacts.default.build` so a single `databricks bundle deploy` does:
#
#   1. npm install (with dev deps for the build) — uses the caller's
#      ~/.npmrc registry. package-lock.json must keep its public
#      registry.npmjs.org `resolved` URLs: the Apps container can only reach
#      the public registry (a private mirror baked into the lockfile makes
#      its install hang and fail with "Exit handler never called!").
#   2. npm run build:source → produces dist/ (server) and client/dist/
#      (vite client).
#
# Env var injection: NOT done here. The setup job's final task
# (patch_app_env.py) POSTs a new app deployment with the full env list
# (bundle-resolved IDs + task-value Genie space ID). Doing it post-job
# keeps everything in one place AND lets us include task-value-derived
# data the bundle can't know at deploy time.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$APP_DIR"

echo "[build-app] installing npm dependencies (incl. dev)…"
npm install --include=dev

# Generate the Drizzle SQL migrations from schema.ts. This does NOT happen via
# `build:source` (npm only auto-runs `prebuild` before a script named exactly
# `build`, not `build:source`), and `drizzle/` is gitignored — so on the DAB
# path it would otherwise never be produced NOR shipped, and the deployed
# container's runMigrations() 503s with "No Drizzle migrations folder found".
# Generate it here so it lands next to dist/ and the DAB sync.include ships it.
# db:generate (scripts/db-generate.js) is incremental when drizzle/ exists and
# gives a from-scratch baseline a deterministic tag + `when`, so a rebuild never
# renames the migration an existing Lakebase DB already applied (which would
# re-run its CREATE TABLEs → "relation already exists" → redeploy 503).
echo "[build-app] generating Drizzle migrations (db:generate)…"
npm run db:generate

echo "[build-app] building server + client…"
npm run build:source

# Sanity-check the build outputs the deploy expects to ship.
[[ -f "$APP_DIR/dist/server.js" ]] || {
    echo "[build-app] ERROR: dist/server.js missing — server build failed?" >&2
    exit 1
}
[[ -f "$APP_DIR/client/dist/index.html" ]] || {
    echo "[build-app] ERROR: client/dist/index.html missing — client build failed?" >&2
    exit 1
}


echo "[build-app] done — dist/ + client/dist/ ready"
