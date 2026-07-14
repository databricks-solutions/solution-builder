#!/usr/bin/env bash
# init.sh — clean-room playground for the standalone databricks-architecture
# skill.
#
# Wipes this folder (INCLUDING .claude/), recompiles the skill from the current
# app code, and installs it fresh — so a `claude` session started here tests
# exactly what's in the repo right now, with zero stale state and zero
# solution-builder involvement.
#
#   cd app/test/architecture && ./init.sh
#   claude "Create an architecture diagram for a retail demo: Salesforce +
#           Kafka feeding the lakehouse, a dashboard + Genie, and an app"
#
# The agent should read the skill, copy a renderer template, write the JSON,
# render a PNG to check its work, and iterate. Everything it produces lands
# here (gitignored); re-run init.sh for a fresh slate.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../.." && pwd)"
SKILL_SRC="$REPO_ROOT/.claude/skills/databricks-architecture"

# 1. Recompile the skill from the CURRENT app code (catalog + standalone
#    viewer/editor HTML + render-arch.mjs). Fatal here — a playground built
#    from a stale skill is exactly the wrong thing to test against.
echo "- Recompiling the skill from app code ..."
NODE_OPTIONS="" bash "$REPO_ROOT/app/scripts/build-architecture-skill.sh"

# 2. Wipe the playground — everything except this script + the tracked docs.
echo "- Cleaning ${DIR} ..."
find "$DIR" -mindepth 1 -maxdepth 1 \
  ! -name init.sh ! -name README.md ! -name .gitignore \
  -exec rm -rf {} +

# 3. Fresh skill install where a `claude` session started here will find it.
echo "- Installing the skill ..."
mkdir -p "$DIR/.claude/skills"
cp -R "$SKILL_SRC" "$DIR/.claude/skills/databricks-architecture"

echo
echo "✓ Clean playground ready."
echo "  cd $DIR"
echo "  claude \"Create an architecture diagram for <your demo idea>\""
