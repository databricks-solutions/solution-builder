#!/usr/bin/env bash
# Build the two self-contained architecture HTMLs (viewer + editor) from the
# app code, into app/dist-standalone/. One engine, two modes.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="dist-standalone"
mkdir -p "$OUT"

for MODE in viewer editor; do
  echo "→ building standalone ($MODE)…"
  ARCH_MODE="$MODE" npx vite build --config vite.standalone.config.ts >/dev/null
  cp ".arch-standalone-build/$MODE/standalone.html" "$OUT/architecture-$MODE.html"
done

rm -rf .arch-standalone-build
echo "✓ standalone HTML written:"
ls -lh "$OUT"/architecture-*.html | awk '{print "   "$NF" ("$5")"}'
