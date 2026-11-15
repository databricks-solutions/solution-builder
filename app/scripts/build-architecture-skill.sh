#!/usr/bin/env bash
# build-architecture-skill — refresh the standalone `databricks-architecture`
# skill FROM the app code (the single source of truth):
#   1. regenerate the skill's component catalog + icon-bank sections
#      (reference/component-catalog.md, plus reference/icons.tsv),
#   2. build the two self-contained standalone HTMLs (viewer + editor),
#   3. copy the HTMLs + renderer helpers into the skill's renderer/.
# The reference jsoncs and the other reference/*.md files are authored in the skill
# itself, so they're left as-is.
# (Component WIRING — what feeds what — is generated INTO the catalog table
#  from CATALOG.wiring, so this skill no longer needs a separate
#  platform_architecture.md; that file stays in the solution-builder skill for
#  its capability-selection workflow.)
set -euo pipefail
cd "$(dirname "$0")/.."           # app/
export NODE_OPTIONS=""            # a stale --require shim breaks node tools

SKILL_DIR="../.claude/skills/databricks-architecture"
RENDERER="$SKILL_DIR/renderer"
REFERENCE="$SKILL_DIR/reference"
mkdir -p "$RENDERER" "$REFERENCE"

echo "→ generating catalog + icon bank into reference/component-catalog.md…"
bun run scripts/gen-architecture-skill.ts
node scripts/gen-showcase-references.mjs   # the showcase page's "Skill references" view

echo "→ building standalone viewer + editor HTML…"
./scripts/build-arch-standalone.sh

echo "→ copying renderer artifacts into the skill…"
cp dist-standalone/architecture-viewer.html "$RENDERER/architecture-viewer.html"
cp dist-standalone/architecture-editor.html "$RENDERER/architecture-editor.html"
cp scripts/render-arch.mjs "$RENDERER/render-arch.mjs"
cp scripts/browser-lifecycle.mjs "$RENDERER/browser-lifecycle.mjs"
cp scripts/inspect-arch.mjs "$RENDERER/inspect-arch.mjs"
# The one copy of the layout check: the Node scripts above AND the app render tool
# (backend/services/arch_render.py) evaluate this file. It must sit next to them.
cp scripts/arch-browser.js "$RENDERER/arch-browser.js"
cp scripts/render-arch-tabs.mjs "$RENDERER/render-arch-tabs.mjs"
cp scripts/embed-arch.mjs "$RENDERER/embed-arch.mjs"

# Wiring now lives in the generated catalog table (CATALOG.wiring), so we no
# longer copy platform_architecture.md here. Remove a stale copy if present.
rm -f "$REFERENCE/platform_architecture.md"

echo "✓ databricks-architecture skill refreshed:"
echo "   reference/component-catalog.md (catalog + icon bank + wiring regenerated)"
ls -lh "$RENDERER"/*.html "$RENDERER"/*.mjs | awk '{print "   "$NF" ("$5")"}'
