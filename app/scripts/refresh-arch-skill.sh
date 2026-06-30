#!/bin/bash
# refresh-arch-skill — recompile the architecture skill from the app code (the
# single source of truth): (1) regenerate the skill's component catalog + icon
# bank from CATALOG, (2) rebuild the self-contained standalone viewer + editor
# HTML. Called by dev.sh on every start so dev always runs with a fresh skill.
#
# Best-effort: each step prints a warning on failure but does not abort (dev.sh
# must not be blocked by a skill-compile hiccup).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

# Run node tools with a clean NODE_OPTIONS (a stale --require shim breaks them).
export NODE_OPTIONS=""

ok=0
bun run scripts/gen-architecture-skill.ts && \
  ./scripts/build-arch-standalone.sh || ok=1

# TODO (skill packaging phases): copy the built HTMLs + render-arch.mjs +
# references into .claude/skills/databricks-architecture/renderer/ once that
# skill folder is scaffolded.

exit $ok
