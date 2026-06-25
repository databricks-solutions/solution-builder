#!/usr/bin/env bash
# Build the Databricks App for deployment. Wired into databricks.yml's
# `artifacts.default.build` so a single `databricks bundle deploy` does:
#
#   1. npm install (with dev deps for the build) — uses the caller's
#      ~/.npmrc registry (Databricks internal proxy on VPN, public off-VPN).
#   2. npm run build:source → produces dist/ (server) and client/dist/
#      (vite client).
#   3. Rewrite package-lock.json `resolved` URLs to the PUBLIC registry.
#      On VPN your ~/.npmrc points at npm-proxy.dev.databricks.com and npm
#      bakes those URLs into the lockfile; the Apps container can't reach
#      the proxy, so its install hangs ~8 min and dies with the misleading
#      "Exit handler never called!". No-op when already public (off-VPN).
#
# Env var injection: NOT done here. The setup job's final task
# (patch_app_env.py) POSTs a new app deployment with the full env list
# (bundle-resolved IDs + task-value Genie/KA/MAS IDs). Doing it post-job
# keeps everything in one place AND lets us include task-value-derived
# data the bundle can't know at deploy time.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOCKFILE="$APP_DIR/package-lock.json"

cd "$APP_DIR"

echo "[build-app] installing npm dependencies (incl. dev)…"
npm install --include=dev

echo "[build-app] building server + client…"
npm run build:source

# Rewrite proxy URLs → public registry, in place. `sed -i.bak` works on
# both BSD (macOS) and GNU sed.
PROXY_URL="https://npm-proxy.dev.databricks.com/"
PUBLIC_URL="https://registry.npmjs.org/"
count=$(grep -c "$PROXY_URL" "$LOCKFILE" || true)
if [[ "$count" -gt 0 ]]; then
    echo "[build-app] rewriting $count proxy URLs → public registry"
    sed -i.bak "s|$PROXY_URL|$PUBLIC_URL|g" "$LOCKFILE"
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
