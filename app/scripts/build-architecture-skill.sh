#!/usr/bin/env bash
# build-architecture-skill — refresh the standalone `databricks-architecture`
# skill FROM the app code (the single source of truth):
#   1. regenerate the skill's component catalog + icon-bank sections (SKILL.md),
#   2. build the two self-contained standalone HTMLs (viewer + editor),
#   3. copy the HTMLs + render-arch.mjs into the skill's renderer/.
# The reference jsoncs are authored in the skill itself, so they're left as-is.
set -euo pipefail
cd "$(dirname "$0")/.."           # app/
export NODE_OPTIONS=""            # a stale --require shim breaks node tools

SKILL_DIR="../.claude/skills/databricks-architecture"
RENDERER="$SKILL_DIR/renderer"
mkdir -p "$RENDERER"

echo "→ generating catalog + icon bank into SKILL.md…"
bun run scripts/gen-architecture-skill.ts

echo "→ building standalone viewer + editor HTML…"
./scripts/build-arch-standalone.sh

echo "→ copying renderer artifacts into the skill…"
cp dist-standalone/architecture-viewer.html "$RENDERER/architecture-viewer.html"
cp dist-standalone/architecture-editor.html "$RENDERER/architecture-editor.html"
cp scripts/render-arch.mjs "$RENDERER/render-arch.mjs"

echo "✓ databricks-architecture skill refreshed:"
echo "   SKILL.md (catalog + icon bank regenerated)"
ls -lh "$RENDERER"/*.html "$RENDERER"/render-arch.mjs | awk '{print "   "$NF" ("$5")"}'
