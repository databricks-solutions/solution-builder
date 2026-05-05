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

exec uvicorn demo_prompt_generator.backend.app:app --workers 1
