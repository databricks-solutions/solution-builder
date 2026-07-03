#!/bin/bash
# refresh-arch-skill — recompile the FULL databricks-architecture skill from the
# app code (catalog + standalone viewer/editor HTML + render-arch.mjs into the
# skill's renderer/). Thin wrapper over build-architecture-skill.sh. Called by
# dev.sh on every start so dev always runs with a fresh skill.
#
# Best-effort: prints a warning on failure but does not abort (dev.sh must not be
# blocked by a skill-compile hiccup).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"
export NODE_OPTIONS=""

./scripts/build-architecture-skill.sh
