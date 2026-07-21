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

# Generate the Drizzle SQL migrations from schema.ts. This does NOT happen via
# `build:source` (npm only auto-runs `prebuild` before a script named exactly
# `build`, not `build:source`), and `drizzle/` is gitignored — so on the DAB
# path it would otherwise never be produced NOR shipped, and the deployed
# container's runMigrations() 503s with "No Drizzle migrations folder found".
# Generate it here so it lands next to dist/ and the DAB sync.include ships it.
echo "[build-app] generating Drizzle migrations (db:generate)…"
npm run db:generate

echo "[build-app] building server + client…"
npm run build:source

# Rewrite ANY Databricks npm-proxy URL → public registry, in place. The App
# container can't reach the internal proxy, and different dev environments pin
# different proxy hosts in the lockfile (npm-proxy.dev.databricks.com on VPN,
# npm-proxy.cloud.databricks.com elsewhere) — so match them all, not just one.
# Missing even one host leaves proxy URLs that 404 on the container (e.g.
# whatwg-url-5.0.0.tgz not mirrored on the cloud proxy). `sed -i.bak` works on
# both BSD (macOS) and GNU sed.
PROXY_RE="https://npm-proxy[.-][a-z0-9.-]*databricks\.com/"
PUBLIC_URL="https://registry.npmjs.org/"
count=$(grep -cE "$PROXY_RE" "$LOCKFILE" || true)
if [[ "$count" -gt 0 ]]; then
    echo "[build-app] rewriting $count proxy URLs → public registry"
    sed -i.bak -E "s|$PROXY_RE|$PUBLIC_URL|g" "$LOCKFILE"
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
