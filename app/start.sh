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

DBCLI_VERSION="1.6.0"
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

# ── jq ────────────────────────────────────────────────────────────────────
# Apps containers don't ship jq either, but the demo-generator skills tell the
# agent to pipe `databricks ... -o json | jq -r .field`. Without jq those
# commands fail only in the deployed container (dev laptops have jq), so the
# agent silently can't read resource IDs. Fetch the official static binary
# (single file, no unzip) and cache it, same pattern as the CLI above.
JQ_VERSION="1.7.1"
JQ_DIR="/tmp/jq-v${JQ_VERSION}"
JQ_BIN="$JQ_DIR/jq"

if [[ ! -x "$JQ_BIN" ]]; then
    echo "[start.sh] Downloading jq v$JQ_VERSION ..."
    mkdir -p "$JQ_DIR"
    JQ_URL="https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/jq-linux-amd64"
    if curl -fsSL "$JQ_URL" -o "$JQ_BIN"; then
        chmod +x "$JQ_BIN"
        echo "[start.sh] Installed: jq $("$JQ_BIN" --version)"
    else
        echo "[start.sh] WARNING: failed to download jq from $JQ_URL — agent jq calls may fail" >&2
    fi
else
    echo "[start.sh] jq cached: $("$JQ_BIN" --version)"
fi

export PATH="$JQ_DIR:$PATH"

# ── Playwright Chromium ─────────────────────────────────────────────────────
# The brand service screenshots company sites with headless Chromium. The
# browser binary (~170 MB) is far too big to bundle in the wheel, so — same
# pattern as the CLI/jq above — download it at container boot into a cached
# /tmp dir and point Playwright at it via PLAYWRIGHT_BROWSERS_PATH. The
# `playwright` PYTHON package is in the wheel (pyproject); only the browser is
# fetched here. Cold start: one-time ~10-20 s; warm restarts skip it.
# System libs Chromium needs (--with-deps) may already be present; if apt isn't
# available we still try the browser-only install. Non-fatal: if it fails, the
# brand service just skips screenshots (best-effort).
export PLAYWRIGHT_BROWSERS_PATH="/tmp/ms-playwright"
if [[ -z "$(ls -A "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-* 2>/dev/null)" ]]; then
    echo "[start.sh] Installing Playwright chromium-headless-shell ..."
    # headless-shell is the lightweight build (~25% less RAM than full chromium);
    # --with-deps pulls the shared libs Chromium needs on the Apps base image.
    if python3 -m playwright install --with-deps chromium-headless-shell >/tmp/pw-install.log 2>&1 \
       || python3 -m playwright install chromium-headless-shell >>/tmp/pw-install.log 2>&1; then
        echo "[start.sh] Playwright chromium-headless-shell installed."
    else
        echo "[start.sh] WARNING: playwright install failed — site screenshots disabled (see /tmp/pw-install.log)" >&2
    fi
else
    echo "[start.sh] Playwright chromium-headless-shell cached."
fi

# ── Camoufox (anti-detection Firefox) ───────────────────────────────────────
# Second screenshot backend for sites that bot-wall headless Chromium
# (network-layer WAFs: LVMH, DataDome, etc.). The `camoufox` PYTHON package is in
# the wheel; its Firefox binary (~140 MB) is fetched at boot, same pattern.
# Cached under ~/.cache/camoufox. Non-fatal: if it fails, we fall back to the
# Chromium backend. NODE_OPTIONS is unset for the fetch/launch — a stray
# --require crashes Camoufox's Node launcher (the app also strips it in code).
if [[ ! -d "$HOME/.cache/camoufox/Camoufox.app" && ! -d "$HOME/.cache/camoufox/camoufox" ]]; then
    echo "[start.sh] Fetching Camoufox browser ..."
    if NODE_OPTIONS= python3 -m camoufox fetch >>/tmp/pw-install.log 2>&1; then
        echo "[start.sh] Camoufox fetched."
    else
        echo "[start.sh] WARNING: camoufox fetch failed — falls back to Chromium screenshots (see /tmp/pw-install.log)" >&2
    fi
else
    echo "[start.sh] Camoufox cached."
fi

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

# --timeout-graceful-shutdown: on SIGTERM (redeploy/stop), uvicorn force-closes
# any still-open connections after this many seconds instead of waiting for them
# to drain. Without it, long-lived SSE streams (agent progress, preview events)
# keep connections open and uvicorn hangs indefinitely → the app gets stuck in
# "Stopping". 10s leaves headroom under the platform's ~15s SIGKILL window while
# our lifespan teardown (bounded, in core/lakebase.py) runs.
exec uvicorn demo_prompt_generator.backend.app:app --workers 1 --timeout-graceful-shutdown 10
