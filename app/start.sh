#!/bin/bash
# Startup wrapper for the deployed Databricks App.
#
# Apps containers don't pre-install the Databricks CLI, and the bundle's
# source-export path caps individual files at 10 MB so we can't ship the
# 13 MB CLI binary inside the wheel either. Workaround: download the CLI
# at container boot, cache it on the container's filesystem, and put it
# on PATH before exec'ing uvicorn.
#
# Cold start cost: one-time ~3-5 s download per fresh container; warm
# restarts (same container) skip the download.
#
# Local dev does NOT use this script. ./scripts/dev.sh runs uvicorn
# itself and relies on whatever `databricks` is on the dev's $PATH.

set -euo pipefail

# ── Refuse to run outside the deployed Apps container. ────────────────────
# The script's downloads, PATH munging, and venv assumptions are all
# tailored to the Apps runtime (Linux amd64, pre-baked .venv on PATH,
# no pre-installed Databricks CLI). Running it on a dev laptop produces
# the wrong CLI binary (Linux exec'd on macOS) AND picks up whatever
# Python happens to be active (conda base, system Python), giving
# `ModuleNotFoundError: demo_prompt_generator` because that interpreter
# doesn't have the project installed.
#
# For local development use `./scripts/dev.sh` instead — that script
# starts uvicorn from the project's .venv and Vite alongside it, with
# hot reload on both.
if [[ "$(uname -s)" != "Linux" ]]; then
    echo "[start.sh] This script is the deployed-container entrypoint and only runs on Linux." >&2
    echo "[start.sh] For local development, run ./scripts/dev.sh instead." >&2
    exit 1
fi

DBCLI_VERSION="0.299.0"
DBCLI_DIR="/tmp/databricks-cli-v${DBCLI_VERSION}"
DBCLI_BIN="$DBCLI_DIR/databricks"

if [[ ! -x "$DBCLI_BIN" ]]; then
    echo "[start.sh] Downloading Databricks CLI v$DBCLI_VERSION ..."
    mkdir -p "$DBCLI_DIR"
    DBCLI_URL="https://github.com/databricks/cli/releases/download/v${DBCLI_VERSION}/databricks_cli_${DBCLI_VERSION}_linux_amd64.zip"
    if curl -fsSL "$DBCLI_URL" -o /tmp/databricks_cli.zip; then
        unzip -qo /tmp/databricks_cli.zip -d "$DBCLI_DIR"
        chmod +x "$DBCLI_BIN"
        rm -f /tmp/databricks_cli.zip
        echo "[start.sh] Installed: $("$DBCLI_BIN" --version)"
    else
        echo "[start.sh] WARNING: failed to download CLI from $DBCLI_URL — agent CLI calls may fail" >&2
    fi
else
    echo "[start.sh] Databricks CLI cached: $("$DBCLI_BIN" --version)"
fi

export PATH="$DBCLI_DIR:$PATH"

# Front the venv on PATH so subprocesses (the agent's Bash tool, any `python`
# / `python3` invocation in start scripts, etc.) inherit our 3.12 venv
# interpreter instead of the OS-level /usr/bin/python3 (3.10 on Ubuntu 22.04).
#
# IMPORTANT: must be ABSOLUTE paths. The Apps container starts uvicorn with
# `cwd = source_code_path` and `command -v uvicorn` resolves to the relative
# `.venv/bin/uvicorn` — exporting that as PATH means subprocesses spawned
# from a different cwd (e.g. the agent's bash running in projects/<uuid>/)
# can't find the venv. Resolve to an absolute path before exporting.
UVICORN_BIN="$(command -v uvicorn || true)"
if [[ -n "$UVICORN_BIN" ]]; then
    VENV_BIN="$(cd "$(dirname "$UVICORN_BIN")" && pwd)"
    export PATH="$VENV_BIN:$PATH"
    export VIRTUAL_ENV="$(dirname "$VENV_BIN")"
fi

# Confirm which Python the Apps install path picked. Useful when verifying
# that the pyproject.toml + uv.lock pair (no requirements.txt) actually
# steered uv onto our pinned 3.12 — the Apps default is pip + 3.11.
# Apps containers don't ship a `python` symlink, only `python3`.
echo "[start.sh] system python3: /usr/bin/python3 → $(/usr/bin/python3 --version 2>&1)"
echo "[start.sh] PATH python3:   $(command -v python3) → $(python3 --version 2>&1)"
echo "[start.sh] VIRTUAL_ENV:    ${VIRTUAL_ENV:-<unset>}"

exec uvicorn demo_prompt_generator.backend.app:app --workers 1
