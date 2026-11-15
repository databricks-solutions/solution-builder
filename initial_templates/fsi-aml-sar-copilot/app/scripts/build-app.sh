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
# Env var injection: NOT done here. Static env lives in the bundle's
# apps.<key>.config; the Genie agent id (created by the setup job) is read
# by the app at boot from <catalog>.<schema>.demo_resources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOCKFILE="$APP_DIR/package-lock.json"

cd "$APP_DIR"

echo "[build-app] installing npm dependencies (incl. dev)…"
npm install --include=dev

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
