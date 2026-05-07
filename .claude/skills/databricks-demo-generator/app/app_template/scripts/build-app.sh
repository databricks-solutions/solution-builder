#!/usr/bin/env bash
# Build the Databricks App for deployment. Wired into databricks.yml's
# `artifacts.default.build` so a single `databricks bundle deploy`
# triggers the full pipeline:
#
#   1. npm install (with dev deps so we can run the build) — uses the
#      caller's normal npm registry (Databricks internal proxy on VPN,
#      public registry off-VPN). Both work locally.
#   2. npm run build:source → produces dist/ (server bundle) and
#      client/dist/ (vite client bundle).
#   3. Rewrite package-lock.json's `resolved` URLs to point at the
#      PUBLIC npm registry. Reason: when you install on the Databricks
#      VPN, your global ~/.npmrc points at https://npm-proxy.dev.databricks.com
#      and npm bakes those proxy URLs into the lockfile. The Databricks
#      Apps container can't reach that proxy — its install would hang
#      ~8 minutes (3 retries × per-package network timeout, in parallel)
#      and then die with the misleading "Exit handler never called!"
#      error from npm. The rewrite is a no-op when the lockfile already
#      uses the public registry (off-VPN users).
#
# Run from the project's app/ dir. Invoked by DAB from the bundle root,
# so we cd ourselves.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOCKFILE="$APP_DIR/package-lock.json"

cd "$APP_DIR"

echo "[build-app] installing npm dependencies (incl. dev)…"
npm install --include=dev

echo "[build-app] building server + client…"
npm run build:source

echo "[build-app] rewriting lockfile registry URLs (proxy → public)…"
"$SCRIPT_DIR/strip-internal-registry.sh"

# Sanity-check the build outputs the deploy expects to ship.
if [[ ! -f "$APP_DIR/dist/server.js" ]]; then
    echo "[build-app] ERROR: dist/server.js missing — server build failed?" >&2
    exit 1
fi
if [[ ! -f "$APP_DIR/client/dist/index.html" ]]; then
    echo "[build-app] ERROR: client/dist/index.html missing — client build failed?" >&2
    exit 1
fi

echo "[build-app] done — dist/ + client/dist/ ready, lockfile points at public registry"
