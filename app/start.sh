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
    if curl -fsSL --connect-timeout 20 --max-time 120 "$DBCLI_URL" -o /tmp/databricks_cli.zip; then
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

# ── Seed templates ──────────────────────────────────────────────────────────
# initial_templates/ is NOT in the wheel (~5 MB — over the 10 MB export cap).
# build.sh archives each template into .build/initial_templates_zips/<slug>.tmpl
# (zip archives, `.tmpl` extension) and databricks.yml syncs that dir.
#
# WHY `.tmpl` + unzip here (NOT `.zip` + rely on auto-expand): the workspace
# file-import auto-expands `*.zip` on upload, which used to land each template as
# THOUSANDS of loose files — and the Apps "Downloading source code" deploy phase
# then copied them file-by-file (~9 min for 16 templates). Shipping ONE opaque
# `.tmpl` per template (workspace leaves it as a single file) makes that copy
# near-instant; we unzip them here in the container (milliseconds). `unzip`
# preserves mtimes, so the seeder's stat-based content_checksum stays stable
# across restarts (its skip-fast-path keeps working — no re-seed churn).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_DIR="$SCRIPT_DIR/initial_templates_zips"
TEMPLATES_DIR="$SCRIPT_DIR/.initial_templates_unpacked"
if compgen -G "$ARCHIVE_DIR/*.tmpl" > /dev/null 2>&1; then
    # Opaque archives shipped → unzip each into the runtime templates dir.
    rm -rf "$TEMPLATES_DIR"; mkdir -p "$TEMPLATES_DIR"
    _n=0; _fail=0
    for _arch in "$ARCHIVE_DIR"/*.tmpl; do
        # -o overwrite, -q quiet. Keep unzip's stderr (don't 2>/dev/null it) so a
        # corrupt/bad archive says WHY, not just which. Stored paths are "<rel>/…".
        if unzip -qo "$_arch" -d "$TEMPLATES_DIR"; then
            _n=$((_n + 1))
        else
            _fail=$((_fail + 1))
            echo "[start.sh] WARNING: failed to unzip $(basename "$_arch")" >&2
        fi
    done
    if [[ "$_n" -eq 0 ]]; then
        # ALL archives failed to unzip — do NOT export an empty templates dir with a
        # success-shaped log. The seeder would find nothing and the gallery would be
        # silently empty. Fail loud so the boot log makes the cause obvious.
        echo "[start.sh] ERROR: $_fail template archive(s) present but NONE unzipped — gallery will seed EMPTY." >&2
    else
        export INITIAL_TEMPLATES_DIR="$TEMPLATES_DIR"
        echo "[start.sh] Seed templates: unpacked $_n archive(s)$([[ $_fail -gt 0 ]] && echo " ($_fail failed)") → $TEMPLATES_DIR (INITIAL_TEMPLATES_DIR)"
    fi
elif [[ -d "$ARCHIVE_DIR" ]] && compgen -G "$ARCHIVE_DIR/*/" > /dev/null 2>&1; then
    # Transition / rollback: a prior deploy left already-expanded folders (old
    # `.zip` auto-expand path). `compgen -G` (not `find … | read`, which is fragile
    # under set -o pipefail) matches the .tmpl branch's own idiom. Point the seeder
    # straight at them.
    export INITIAL_TEMPLATES_DIR="$ARCHIVE_DIR"
    _n=$(find "$ARCHIVE_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    echo "[start.sh] Seed templates: $_n pre-expanded folder(s) at $ARCHIVE_DIR (INITIAL_TEMPLATES_DIR)"
else
    echo "[start.sh] No template archives found — seeding will fall back to any bundled dir." >&2
fi

# ── jq ────────────────────────────────────────────────────────────────────
# Apps containers don't ship jq either, but the solution-builder skills tell the
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
    if curl -fsSL --connect-timeout 20 --max-time 60 "$JQ_URL" -o "$JQ_BIN"; then
        chmod +x "$JQ_BIN"
        echo "[start.sh] Installed: jq $("$JQ_BIN" --version)"
    else
        echo "[start.sh] WARNING: failed to download jq from $JQ_URL — agent jq calls may fail" >&2
    fi
else
    echo "[start.sh] jq cached: $("$JQ_BIN" --version)"
fi

export PATH="$JQ_DIR:$PATH"

# ── Old deployment snapshots ────────────────────────────────────────────────
# Every app deployment copies the source into /Workspace/Users/<app SP>/src/
# <deployment-id>, the app runs from that copy, and nothing ever deletes the old
# ones (prod had 110, ~57 MB each). Keep the SNAPSHOT_KEEP newest (default 10;
# 0 = off). Deployment ids are time-ordered hex, so newest = last by name, and
# the deployment booting now is always among the newest. Runs as the app SP (its
# own home), in the background and time-bounded: it never delays or fails a boot.
prune_deployment_snapshots() {
    local keep="${SNAPSHOT_KEEP:-10}" me dir
    [[ "$keep" =~ ^[0-9]+$ && "$keep" -gt 0 ]] || return 0
    me="$(timeout 30 databricks current-user me -o json | jq -r '.userName // empty')"
    [[ -n "$me" ]] || return 0
    dir="/Workspace/Users/$me/src"
    timeout 60 databricks workspace list "$dir" -o json \
        | jq -r '.[] | select(.object_type == "DIRECTORY") | .path' \
        | grep -E '/[0-9a-f]{32}$' | sort -r | tail -n +"$((keep + 1))" \
        | while read -r p; do
            timeout 60 databricks workspace delete --recursive "$p" && echo "pruned $p"
          done
}
if [[ -n "${DATABRICKS_APP_NAME:-}" ]] && command -v databricks >/dev/null && command -v jq >/dev/null; then
    ( set +e +o pipefail; prune_deployment_snapshots; echo "done" ) >/tmp/snapshot-prune.log 2>&1 &
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

# ── Playwright Chromium ─────────────────────────────────────────────────────
# The brand service screenshots company sites with headless Chromium. The
# browser binary (~170 MB) is far too big to bundle in the wheel, so — same
# pattern as the CLI/jq above — download it at container boot into a cached
# /tmp dir and point Playwright at it via PLAYWRIGHT_BROWSERS_PATH. The
# `playwright` PYTHON package is in the wheel (pyproject); only the browser is
# fetched here, plus the shared libs it needs (below). Cold start: one-time;
# warm restarts skip both. Non-fatal: if it fails, the brand service just skips
# screenshots (best-effort).
# Must run AFTER the venv is on PATH: /usr/bin/python3 has no playwright package.
export PLAYWRIGHT_BROWSERS_PATH="/tmp/ms-playwright"
# Download the headless shell straight from Google's Chrome-for-Testing bucket.
# `playwright install` goes through cdn.playwright.dev, which only redirects
# there and times out from the Apps container (every request).
# Unpack where Playwright looks. Python's zipfile drops the exec bits, hence the chmod.
# The build the installed playwright package expects. /tmp survives a redeploy on
# the same compute, and the build re-resolves deps (a newer playwright can need a
# different build), so "some headless shell is on disk" isn't enough.
# Never fatal (set -e): no plan just means no screenshots.
PW_PLAN="$(timeout 30 python3 -m playwright install --dry-run chromium-headless-shell 2>/dev/null || true)"
PW_SHELL_DIR="$(awk '/Install location:/ {print $3; exit}' <<<"$PW_PLAN")"
install_headless_shell_from_gcs() {
    local dir="$PW_SHELL_DIR" url zip
    url="$(awk '/Download url:/ {print $3; exit}' <<<"$PW_PLAN")"
    url="${url/https:\/\/cdn.playwright.dev\/builds\/cft\//https://storage.googleapis.com/chrome-for-testing-public/}"
    [[ -n "$dir" && "$url" == https://storage.googleapis.com/* ]] || return 1
    echo "Fallback download: $url -> $dir"
    zip="$(mktemp /tmp/headless-shell-XXXXXX.zip)"
    curl -fsSL --connect-timeout 20 --max-time 300 "$url" -o "$zip" \
        && mkdir -p "$dir" && python3 -m zipfile -e "$zip" "$dir" \
        && find "$dir" -type f -exec chmod +x {} + \
        && touch "$dir/INSTALLATION_COMPLETE"
    local rc=$?
    rm -f "$zip"
    [[ $rc -eq 0 ]] || rm -rf "$dir"
    return $rc
}
# The Apps image lacks the shared libs Chromium links against (glib, nss, atk,
# dbus, gbm, X11 bits…) and the app has no root, so `playwright install
# --with-deps` can't apt-install them. Instead run apt as this user with its
# lists/cache under /tmp, download the browser's packages plus their not-yet-
# installed dependencies, and unpack them into $BROWSER_LIBS. Only packages missing
# from the image are unpacked, so nothing shadows a system lib. The path is exported
# as BROWSER_LD_LIBRARY_PATH, not LD_LIBRARY_PATH: only brand_service's screenshot
# subprocess loads these libs; uvicorn, previews and the agent never see them.
BROWSER_LIBS="/tmp/chrome-libs"
install_browser_libs() {
    local exe apt_opts pkgs
    exe="$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | head -1)"
    [[ -n "$exe" ]] || return 0
    LD_LIBRARY_PATH="$(browser_lib_path)" ldd "$exe" | grep -q "not found" || return 0
    # Boot waits on this, so a slow or blocked mirror must fail fast, not stall startup.
    apt_opts=(-o Dir::State::Lists=/tmp/apt/lists -o Dir::Cache=/tmp/apt/cache
              -o Debug::NoLocking=1 -o APT::Sandbox::User="$(id -un)"
              -o Acquire::http::Timeout=20 -o Acquire::Retries=1)
    mkdir -p /tmp/apt/lists/partial /tmp/apt/cache/archives/partial /tmp/apt/debs "$BROWSER_LIBS"
    timeout 120 apt-get "${apt_opts[@]}" -qq update || return 1
    # Playwright's chromium dependency list for Ubuntu 22.04, plus the closure
    # apt resolves for it, minus what dpkg says is already installed.
    pkgs="$(apt-cache "${apt_opts[@]}" depends --recurse --no-recommends --no-suggests \
              --no-conflicts --no-breaks --no-replaces --no-enhances \
              libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
              libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
              libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
              libxkbcommon0 libxrandr2 \
            | grep -E '^[a-z0-9]' | sort -u \
            | while read -r p; do dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'ok installed' || echo "$p"; done)"
    echo "Downloading browser libs: $(echo $pkgs)"
    (cd /tmp/apt/debs && timeout 180 apt-get "${apt_opts[@]}" -qq download $pkgs) || return 1
    for deb in /tmp/apt/debs/*.deb; do dpkg -x "$deb" "$BROWSER_LIBS" || return 1; done
    rm -rf /tmp/apt
    echo "Still missing after unpack:"
    LD_LIBRARY_PATH="$(browser_lib_path)" ldd "$exe" | grep "not found" || echo "  (none)"
}
browser_lib_path() {
    echo "$BROWSER_LIBS/usr/lib/x86_64-linux-gnu:$BROWSER_LIBS/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
}

if [[ -z "$PW_SHELL_DIR" || ! -f "$PW_SHELL_DIR/INSTALLATION_COMPLETE" ]]; then
    echo "[start.sh] Installing Playwright chromium-headless-shell ${PW_SHELL_DIR##*/} ..."
    # Drop builds an earlier deploy left behind (~250MB each in /tmp).
    if [[ -n "$PW_SHELL_DIR" ]]; then
        for d in "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*; do
            [[ -e "$d" && "$d" != "$PW_SHELL_DIR" ]] && rm -rf "$d"
        done
    fi
    # headless-shell is the lightweight build (~25% less RAM than full chromium).
    if install_headless_shell_from_gcs >/tmp/pw-install.log 2>&1 \
       || timeout 180 python3 -m playwright install chromium-headless-shell >>/tmp/pw-install.log 2>&1; then
        echo "[start.sh] Playwright chromium-headless-shell installed."
    else
        echo "[start.sh] WARNING: playwright install failed — site screenshots disabled (see /tmp/pw-install.log)" >&2
        tail -n 40 /tmp/pw-install.log >&2 || true
    fi
else
    echo "[start.sh] Playwright chromium-headless-shell ${PW_SHELL_DIR##*/} cached."
fi
if install_browser_libs >>/tmp/pw-install.log 2>&1; then
    export BROWSER_LD_LIBRARY_PATH="$(browser_lib_path)"
else
    echo "[start.sh] WARNING: browser shared libs install failed — site screenshots may fail (see /tmp/pw-install.log)" >&2
    tail -n 20 /tmp/pw-install.log >&2 || true
fi
# The POV deck's layout check and screenshots (references/pov-deck-tools) run the
# same headless shell from node and look for it at CHROME_PATH first. Point that at
# a wrapper that puts the libs above on the loader path for Chrome alone, plus a
# font when the image has none (no fonts leaves every glyph blank in a screenshot).
PW_SHELL="$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | head -1 || true)"
if [[ -n "$PW_SHELL" ]]; then
    mkdir -p "$BROWSER_LIBS"
    PW_ENV=""
    [[ -n "${BROWSER_LD_LIBRARY_PATH:-}" ]] && PW_ENV="LD_LIBRARY_PATH=\"$BROWSER_LD_LIBRARY_PATH\""
    if [[ -z "$(ls -A /usr/share/fonts 2>/dev/null)" ]]; then
        PW_FONTS="$BROWSER_LIBS/usr/share/fonts"
        if [[ ! -d "$PW_FONTS" ]]; then
            PW_DEB=/tmp/fonts-dejavu-core.deb   # pinned and checksummed (Ubuntu 22.04)
            curl -fsSL -m 60 -o "$PW_DEB" "http://archive.ubuntu.com/ubuntu/pool/main/f/fonts-dejavu/fonts-dejavu-core_2.37-2build1_all.deb" \
                && echo "c33fe8bf33b50d99d6448804a090123b1bbba37d7a8703c630695676d110a47d  $PW_DEB" | sha256sum -c --quiet - \
                && dpkg-deb -x "$PW_DEB" "$BROWSER_LIBS" \
                || echo "[start.sh] WARNING: could not fetch a font for the headless shell" >&2
            rm -f "$PW_DEB"
        fi
        if [[ -d "$PW_FONTS" ]]; then
            printf '<?xml version="1.0"?>\n<fontconfig><dir>%s</dir><cachedir>%s/fc-cache</cachedir></fontconfig>\n' \
                "$PW_FONTS" "$BROWSER_LIBS" > "$BROWSER_LIBS/fonts.conf"
            PW_ENV="$PW_ENV FONTCONFIG_FILE=\"$BROWSER_LIBS/fonts.conf\""
        fi
    fi
    printf '#!/bin/sh\n%s exec "%s" "$@"\n' "$PW_ENV" "$PW_SHELL" > "$BROWSER_LIBS/chrome-headless-shell"
    chmod +x "$BROWSER_LIBS/chrome-headless-shell"
    export CHROME_PATH="$BROWSER_LIBS/chrome-headless-shell"
    # Launch it once, so a browser that installs but cannot start says why in `apps logs`
    # (the deck's drivers only see "Chrome never started").
    if timeout 20 "$CHROME_PATH" --no-sandbox --dump-dom about:blank >/dev/null 2>/tmp/pw-launch.log; then
        echo "[start.sh] Playwright headless shell launches ($CHROME_PATH)."
    else
        echo "[start.sh] WARNING: Playwright headless shell does not launch:" >&2
        { LD_LIBRARY_PATH="${BROWSER_LD_LIBRARY_PATH:-}" ldd "$PW_SHELL" 2>/dev/null | grep 'not found'; tail -n 15 /tmp/pw-launch.log; } \
            | sed 's/^/[start.sh] pw-launch: /' >&2 || true
    fi
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
# to drain. The app eagerly stops ALL long-lived streams the instant SIGTERM
# arrives — agent + preview proxy/SSE + collab/HMR WebSockets are task-cancelled
# (eager-cancel handler in core/lakebase.py), and the two SYNC-generator SSEs
# (capabilities-suggest, grounding-scan) poll a shutdown flag and return — so the
# drain normally finishes in ~100ms regardless of this value. Kept at 10s (NOT
# lowered): the eager-cancel is the mechanism; a lower value would only truncate a
# legitimate non-stream request (e.g. a multi-second LLM call) earlier on redeploy
# for no benefit. 10s leaves headroom under the platform's ~15s SIGKILL for the
# bounded lifespan teardown.
#
# --workers 1 is REQUIRED: ActiveStreamManager / LiveConnectionRegistry (and the
# client pool / reapers) are per-process singletons — a second worker would fork
# a second, disconnected set.
UVICORN_ARGS=(demo_prompt_generator.backend.app:app --workers 1 --timeout-graceful-shutdown 10)

# ── Databricks Apps observability (OpenTelemetry) ───────────────────────────
# When the Apps telemetry option is enabled, Databricks injects the OTLP collector
# env (OTEL_EXPORTER_OTLP_ENDPOINT + protocol/headers/resource attrs). We detect
# that and launch uvicorn under `opentelemetry-instrument`, which auto-instruments
# FastAPI (request spans) and wires logs; CPU/memory/process metrics are started
# explicitly in core/observability.py at app startup. When telemetry is OFF (local
# dev, or a deploy without it) OTEL_EXPORTER_OTLP_ENDPOINT is unset → we exec plain
# uvicorn, byte-identical to before. `opentelemetry-instrument` resolves from the
# venv already fronted on PATH above.
if [[ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]]; then
    export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-solution-builder-generator}"
    echo "[start.sh] telemetry on (OTEL_EXPORTER_OTLP_ENDPOINT set) — launching under opentelemetry-instrument as '$OTEL_SERVICE_NAME'"
    exec opentelemetry-instrument uvicorn "${UVICORN_ARGS[@]}"
else
    exec uvicorn "${UVICORN_ARGS[@]}"
fi
