#!/usr/bin/env bash
# Rewrite `package-lock.json`'s `resolved` URLs from the Databricks
# internal npm proxy to the PUBLIC npm registry, in place. Idempotent.
# A no-op when the lockfile already uses the public registry.
#
# WHY: npm bakes the registry URL into each `resolved` field at install
# time. On the Databricks VPN your ~/.npmrc points at
# `https://npm-proxy.dev.databricks.com/` (the public registry is
# blocked from the VPN). Those proxy URLs ship in the lockfile to the
# Databricks Apps container, which CAN'T reach the proxy — every
# package fetch ETIMEDOUTs after 3 retries × ~2 min each, the install
# appears to hang for ~8 min, and npm dies with the unhelpful
# "Exit handler never called!" message.
#
# Off-VPN users install via the public registry directly; the lockfile
# is already correct and this script does nothing.
#
# Called by build-app.sh after `npm install`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOCKFILE="$APP_DIR/package-lock.json"

if [[ ! -f "$LOCKFILE" ]]; then
    echo "[strip-internal-registry] $LOCKFILE not found — run 'npm install' first" >&2
    exit 1
fi

PROXY_URL="https://npm-proxy.dev.databricks.com/"
PUBLIC_URL="https://registry.npmjs.org/"

count=$(grep -c "$PROXY_URL" "$LOCKFILE" || true)
if [[ "$count" -eq 0 ]]; then
    echo "[strip-internal-registry] lockfile already uses public registry — no rewrite needed"
    exit 0
fi

echo "[strip-internal-registry] rewriting $count proxy URLs → public registry"
# `sed -i.bak` works on both BSD (macOS) and GNU sed.
sed -i.bak "s|$PROXY_URL|$PUBLIC_URL|g" "$LOCKFILE"
rm -f "$LOCKFILE.bak"

echo "[strip-internal-registry] done"
