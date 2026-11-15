#!/usr/bin/env bash
# Build the Databricks App for deployment. Wired into databricks.yml's
# `artifacts.default.build` so a single `databricks bundle deploy` does:
#
#   1. npm install (with dev deps for the build) — uses the caller's
#      ~/.npmrc registry (a private registry mirror, if configured).
#   2. npm run build:source → produces dist/ (server) and client/dist/
#      (vite client).
#   3. Rewrite package-lock.json `resolved` URLs to the PUBLIC registry.
#      If your ~/.npmrc points at a private registry mirror, npm bakes its URLs into
#      the lockfile; the Apps container can't reach it and the install hangs, then
#      dies with the misleading "Exit handler never called!". No-op when already public.
#
# Env var injection: NOT done here. The app's env lives in databricks.yml
# (apps.warranty_app.config.env); the Genie agent id the setup job creates is
# read at boot from <catalog>.<schema>.demo_resources (server/services/resources.ts).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOCKFILE="$APP_DIR/package-lock.json"

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

# Point the lockfile's `resolved` URLs at the public npm registry. A lockfile generated
# behind a private registry mirror bakes that mirror's host into every URL, and the App
# container can't reach it. Any non-public host is rewritten; a public lockfile is a no-op.
PUBLIC_URL="https://registry.npmjs.org/"
count=$(grep -E '"resolved": "https://' "$LOCKFILE" | grep -vc 'registry\.npmjs\.org/' || true)
if [[ "$count" -gt 0 ]]; then
    echo "[build-app] rewriting $count non-public resolved URLs → public registry"
    sed -i.bak -E "s|\"resolved\": \"https://[^/]+/|\"resolved\": \"${PUBLIC_URL}|g" "$LOCKFILE"
    rm -f "$LOCKFILE.bak"
else
    echo "[build-app] lockfile already on public registry — no rewrite needed"
fi

# Sanity-check the build outputs the deploy expects to ship.
[[ -f "$APP_DIR/dist/server.js" ]] || {
    echo "[build-app] ERROR: dist/server.js missing — server build failed?" >&2
    exit 1
}
[[ -f "$APP_DIR/client/dist/index.html" ]] || {
    echo "[build-app] ERROR: client/dist/index.html missing — client build failed?" >&2
    exit 1
}


echo "[build-app] done — dist/ + client/dist/ ready, lockfile points at public registry"
