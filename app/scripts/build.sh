#!/bin/bash
# Build script — assembles everything needed for Databricks App deployment.
#
# Creates .build/ (gitignored, but bundled via sync.include in databricks.yml) with:
#   - app.yml          (Databricks App config — generated from databricks.<target>.yml's `env:` block)
#   - *.whl            (Python wheel including frontend assets, .claude/skills, initial_templates)
#   - pyproject.toml   (uv project file — pins `requires-python = ">=3.12,<3.13"` so the
#                       Apps runtime uses Python 3.12 instead of the pip default 3.11.
#                       References the wheel as a local-file dep.)
#   - uv.lock          (uv-resolved transitive deps for the above pyproject)
# Runtime data (.claude/skills/, initial_templates/) is inside the wheel —
# the App downloads ONE file instead of ~200 loose files (which used to crash
# the "downloading source code" step with a list-files timeout).
#
# Why uv (not pip + requirements.txt)? Apps' default install path uses pip on
# Python 3.11. Shipping pyproject.toml + uv.lock with NO requirements.txt
# switches Apps to uv, which honors `requires-python` and gives us 3.12.
# IMPORTANT: this only works if requirements.txt is absent from .build/ —
# Apps prefers requirements.txt when present and ignores pyproject.toml.
#
# Usage:
#   ./scripts/build.sh                   # full build, no env injection (manual run)
#   ./scripts/build.sh --skip-frontend   # skip frontend if already built
#   ./scripts/build.sh --target prod     # invoked by `databricks bundle deploy` —
#                                          generates app.yml from
#                                          databricks.prod.yml's `env:` dict.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# .build/ is intentionally NOT gitignored — the bundle CLI honors .gitignore
# when syncing, so an ignored .build/ would ship empty. Devs see it in
# `git status` after deploys; don't commit it.
BUILD_DIR="$APP_DIR/.build"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

cd "$APP_DIR"

# Parse args. --target is passed by the bundle artifact build (databricks.yml)
# so we can ask the bundle CLI for the resolved target.<target>.env dict and
# write it straight into .build/app.yml.
SKIP_FRONTEND=""
TARGET=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-frontend) SKIP_FRONTEND=1; shift ;;
        --target) TARGET="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# --- 1. Build frontend ---
if [[ -z "$SKIP_FRONTEND" ]]; then
    if [[ ! -d node_modules ]]; then
        echo -e "${BLUE}[1/4] Installing frontend dependencies (bun install)...${NC}"
        bun install
    fi
    echo -e "${BLUE}[1/4] Building frontend...${NC}"
    bun run --cwd "$APP_DIR" vite build --config vite.config.ts
else
    echo -e "${BLUE}[1/4] Skipping frontend build (--skip-frontend)${NC}"
fi

# Verify frontend output exists
if [[ ! -f "src/demo_prompt_generator/__dist__/index.html" ]]; then
    echo "ERROR: Frontend build output not found at src/demo_prompt_generator/__dist__/index.html"
    exit 1
fi

# --- 2. Stage runtime data INTO the package source tree (paths mirror dev) ---
# The wheel ships .claude/, initial_templates/, and ai_dev_kit/ INSIDE
# src/demo_prompt_generator/ so paths inside the installed package match the
# dev-tree layout exactly — backend resolvers can use one Path expression for
# both modes (editable install walks up to repo, wheel install reads from the
# package). Shipping these as loose workspace files crashed the App's source
# download with a list-files timeout; bundling into the wheel = one big file.
PKG_DIR="src/demo_prompt_generator"
echo -e "${BLUE}[2/4] Staging runtime data inside $PKG_DIR/...${NC}"
# Always clean up after build so dev iteration doesn't accumulate (and so
# `git status` stays clean even if the build fails partway through).
# `bin/` is excluded from cleanup so a cached CLI binary survives across
# back-to-back builds (the version-check below skips re-download when fresh).
trap 'rm -rf "$PKG_DIR/.claude" "$PKG_DIR/initial_templates" "$PKG_DIR/ai_dev_kit"' EXIT
rm -rf "$PKG_DIR/.claude" "$PKG_DIR/initial_templates" "$PKG_DIR/ai_dev_kit"

# NOTE: We do NOT ship the Databricks CLI inside the wheel — the App's
# bundle-source export path has a 10 MB per-file cap and the CLI binary
# alone is ~13 MB compressed. Instead, start.sh downloads + caches it
# at container boot. See app/start.sh.

# .claude/skills/databricks-demo-generator/ — the demo-generator skill itself.
if [[ -d "../.claude/skills/databricks-demo-generator" ]]; then
    mkdir -p "$PKG_DIR/.claude/skills"
    rsync -a \
        --exclude='node_modules' \
        --exclude='.venv' \
        --exclude='__pycache__' \
        --exclude='dist' \
        --exclude='.next' \
        --exclude='.pglite' \
        --exclude='.tanstack' \
        --exclude='__dist__' \
        "../.claude/skills/databricks-demo-generator/" \
        "$PKG_DIR/.claude/skills/databricks-demo-generator/"
fi

# initial_templates/ — pre-authored seed templates.
if [[ -d "../initial_templates" ]]; then
    cp -r "../initial_templates" "$PKG_DIR/initial_templates"
fi

# ai_dev_kit/ — clone the same branch dev.sh uses so the deployed app has
# the skill catalog without runtime cloning. Frozen with the wheel; redeploy
# to update.
AI_DEV_KIT_REPO="https://github.com/databricks-solutions/ai-dev-kit.git"
AI_DEV_KIT_BRANCH="${AI_DEV_KIT_BRANCH:-experimental}"
if [[ ! -d "$PKG_DIR/ai_dev_kit" ]]; then
    if [[ -d "ai_dev_kit/.git" ]]; then
        # Fast path: copy the locally cloned repo (already on the right branch
        # from dev.sh). Avoids a network fetch per build.
        echo "  Bundling ai_dev_kit from local clone (branch $(cd ai_dev_kit && git branch --show-current))"
        rsync -a --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
            "ai_dev_kit/" "$PKG_DIR/ai_dev_kit/"
    else
        echo "  Cloning ai_dev_kit ($AI_DEV_KIT_REPO branch $AI_DEV_KIT_BRANCH) into wheel..."
        git clone --depth 1 --branch "$AI_DEV_KIT_BRANCH" "$AI_DEV_KIT_REPO" "$PKG_DIR/ai_dev_kit"
        rm -rf "$PKG_DIR/ai_dev_kit/.git"
    fi
fi

# --- Build Python wheel ---
echo -e "${BLUE}[2/4] Building Python wheel...${NC}"
rm -f dist/*.whl
uv build --wheel --out-dir dist/

WHEEL=$(ls -t dist/*.whl 2>/dev/null | head -1)
if [[ -z "$WHEEL" ]]; then
    echo "ERROR: No wheel found in dist/"
    exit 1
fi

# Repack the wheel with a unique build-timestamped version so the app runtime
# always reinstalls (pip skips when the metadata version matches an existing install)
BUILD_TS=$(date +%Y%m%d%H%M%S)
WHL_TMPDIR=$(mktemp -d)
unzip -q "$WHEEL" -d "$WHL_TMPDIR"
# Find dist-info directory and patch version in METADATA
DIST_INFO=$(find "$WHL_TMPDIR" -maxdepth 1 -type d -name "*.dist-info")
sed -i '' "s/^Version: .*/Version: 0.1.0.dev${BUILD_TS}/" "$DIST_INFO/METADATA"
# Clear hash for modified METADATA in RECORD
METADATA_REL=$(basename "$DIST_INFO")/METADATA
sed -i '' "s|${METADATA_REL},sha256=[^,]*,[0-9]*|${METADATA_REL},,|" "$DIST_INFO/RECORD"
# Rename dist-info to match new version
NEW_DIST_INFO="$WHL_TMPDIR/demo_prompt_generator-0.1.0.dev${BUILD_TS}.dist-info"
mv "$DIST_INFO" "$NEW_DIST_INFO"
# Repack
NEW_WHL="dist/demo_prompt_generator-0.1.0.dev${BUILD_TS}-py3-none-any.whl"
(cd "$WHL_TMPDIR" && zip -qr - .) > "$NEW_WHL"
rm -rf "$WHL_TMPDIR" "$WHEEL"
WHEEL="$NEW_WHL"
echo "  Wheel: $(basename "$WHEEL")"

# --- 3. Generate pyproject.toml + uv.lock for the deployed app ---
echo -e "${BLUE}[3/4] Generating pyproject.toml + uv.lock for deploy...${NC}"
WHEEL_BASENAME=$(basename "$WHEEL")
# We ship a MINIMAL pyproject in .build/ that declares only the local wheel
# as a dep — uv resolves the wheel's full dependency tree automatically when
# it locks. This keeps the deployed-image pyproject decoupled from the dev
# pyproject's [tool.*] sections (uv-workspace, hatch build hooks, etc.) which
# don't apply at runtime.
mkdir -p dist/uv-stage
cat > dist/uv-stage/pyproject.toml <<EOF
[project]
name = "demo-prompt-generator-deploy"
version = "0.0.0"
# Pin the runtime to Python 3.12. Without this Apps' uv install picks 3.11
# (its hardcoded default for older lockfiles); 3.11 is fine but a few of our
# transitive deps ship 3.12-only optimisations and we want to track main.
requires-python = ">=3.12,<3.13"
dependencies = [
    "demo-prompt-generator",
]

# Tell uv to satisfy demo-prompt-generator from the local wheel that ships
# alongside this pyproject.toml. uv requires `file:` URLs for path deps in
# [tool.uv.sources]; the leading "./" makes it relative to this file.
[tool.uv.sources]
demo-prompt-generator = { path = "./${WHEEL_BASENAME}" }
EOF
# Lock against this minimal pyproject. The wheel must be present in the same
# dir for uv's file:// reference to resolve.
cp "$WHEEL" "dist/uv-stage/"
(cd dist/uv-stage && uv lock --quiet)

# Rewrite the internal PyPI proxy out of the lock when deploying to a workspace
# whose Apps containers can't reach pypi-proxy.dev.databricks.com (e.g. field-eng).
# The proxy mirrors public PyPI with identical /simple/ and /packages/<hash>/ paths,
# so a pure URL swap to pypi.org / files.pythonhosted.org keeps hashes valid — no
# re-resolution needed (which matters: the build host often can't reach public PyPI).
# Gated on REWRITE_LOCK_TO_PUBLIC_PYPI=1 so internal-only deploys are unaffected.
if [[ "${REWRITE_LOCK_TO_PUBLIC_PYPI:-}" == "1" ]]; then
    echo "  Rewriting uv.lock internal proxy URLs -> public PyPI"
    perl -i -pe 's{https://pypi-proxy\.dev\.databricks\.com/simple/}{https://pypi.org/simple/}g; s{https://pypi-proxy\.dev\.databricks\.com/packages/}{https://files.pythonhosted.org/packages/}g' dist/uv-stage/uv.lock
    if grep -q "pypi-proxy.dev.databricks.com" dist/uv-stage/uv.lock; then
        echo "ERROR: uv.lock still references pypi-proxy after rewrite" >&2
        grep -n "pypi-proxy.dev.databricks.com" dist/uv-stage/uv.lock | head >&2
        exit 1
    fi
fi

# --- 4. Assemble $BUILD_DIR ---
echo -e "${BLUE}[4/4] Assembling $BUILD_DIR ...${NC}"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp "$WHEEL" "$BUILD_DIR/"
cp dist/uv-stage/pyproject.toml "$BUILD_DIR/"
cp dist/uv-stage/uv.lock "$BUILD_DIR/"
# Belt-and-braces: ensure no stale requirements.txt sneaks into the upload.
# Apps prefers requirements.txt when present and would silently fall back to
# pip + Python 3.11, defeating this whole step.
rm -f "$BUILD_DIR/requirements.txt"
# Startup wrapper — downloads the Databricks CLI at container boot, puts
# it on PATH, then exec's uvicorn. See app/start.sh.
#
# Resolve the latest CLI release at build time and substitute it into the
# DBCLI_VERSION line before copying. Each deploy thus pins to whatever was
# latest at build time (predictable per-deploy, not per-cold-start). Falls
# back to whatever value start.sh has hardcoded if the GitHub API is
# unreachable.
LATEST_CLI=$(curl -fsSL https://api.github.com/repos/databricks/cli/releases/latest 2>/dev/null \
    | jq -r '.tag_name' 2>/dev/null \
    | sed 's/^v//' || true)
if [[ -n "$LATEST_CLI" && "$LATEST_CLI" != "null" ]]; then
    echo "  Latest Databricks CLI: v$LATEST_CLI (pinning into start.sh)"
    sed "s/^DBCLI_VERSION=.*/DBCLI_VERSION=\"$LATEST_CLI\"/" start.sh > "$BUILD_DIR/start.sh"
else
    FALLBACK_CLI=$(grep '^DBCLI_VERSION=' start.sh | sed 's/.*"\(.*\)".*/\1/')
    echo "  WARNING: could not resolve latest CLI from GitHub — falling back to v${FALLBACK_CLI:-unknown} hardcoded in app/start.sh" >&2
    cp start.sh "$BUILD_DIR/"
fi
chmod +x "$BUILD_DIR/start.sh"

# Generate $BUILD_DIR/app.yml from databricks.<target>.yml's `env:` dict.
# `command:` runs start.sh (NOT uvicorn directly) so we can prepend the
# bundled CLI's bin dir to PATH. When --target is passed (bundle artifact
# build), we ask the CLI for the resolved target.env and dump it 1:1 into
# app.yml. When invoked by hand, we write a minimal app.yml without env
# vars — the real `databricks bundle deploy` invocation reruns this with
# --target.
{
    echo "# --workers must stay at 1: ActiveStreamManager is a per-process singleton."
    echo "# start.sh prepends the bundled databricks CLI to PATH, then exec's uvicorn."
    echo "# Apps' uv install path puts source under /app/deployments/<id>/ (changes"
    echo "# per deployment) and sets cwd there, so a relative path is portable."
    echo 'command: ["bash", "start.sh"]'
} > "$BUILD_DIR/app.yml"

if [[ -n "$TARGET" ]]; then
    echo "  Generating $BUILD_DIR/app.yml env from databricks.${TARGET}.yml..."
    if ! command -v jq >/dev/null 2>&1; then
        echo "ERROR: jq is required to generate app.yml from the bundle target." >&2
        echo "  Install via: brew install jq  (or apt/yum equivalent)" >&2
        exit 1
    fi
    # `databricks bundle summary --output json` returns the resolved bundle
    # (vars substituted, includes merged). We pull the `app_env` complex var
    # — that's where databricks.<target>.yml puts the runtime env dict — and
    # emit it as YAML list-of-{name,value} entries for app.yml's `env:` block.
    # Why a complex var (instead of `targets.<t>.env`)? `env` isn't a recognized
    # bundle target field; the CLI drops it from the resolved summary. A complex
    # var IS first-class, gets var substitution applied, and round-trips cleanly.
    ENV_YAML=$(databricks bundle summary -t "$TARGET" --output json 2>/dev/null \
        | jq -r '
            (.variables.app_env.value // {})
            | to_entries
            | map("  - name: \"\(.key)\"\n    value: \"\(.value)\"")
            | join("\n")
        ')
    if [[ -n "$ENV_YAML" ]]; then
        printf "env:\n%s\n" "$ENV_YAML" >> "$BUILD_DIR/app.yml"
        # Show what was injected (helps debug missing vars).
        echo "$ENV_YAML" | sed 's/^/    /'
    else
        echo "  WARNING: variables.app_env was empty — did you set it in databricks.${TARGET}.yml?" >&2
    fi
fi

# NOTE: .claude/skills/ and initial_templates/ are NOT shipped here as loose
# files — they're inside the wheel (staged into src/demo_prompt_generator/_runtime_data/
# in step [2]). The App downloads a single wheel; the backend reads runtime data
# via importlib.resources. Shipping them as ~200 loose workspace files used to
# crash the App's "downloading source code" step with a list-files timeout.

# Wipe stale files in the workspace deploy dir before the bundle re-uploads.
# Bundle sync is ADDITIVE — files removed locally still linger in the workspace
# from prior deploys. We purge here so what lands matches `.build/` exactly.
# Only runs when --target is set (i.e. invoked by `databricks bundle deploy`),
# since manual `./scripts/build.sh` runs don't touch the workspace.
if [[ -n "$TARGET" ]]; then
    REMOTE_FILES=$(databricks bundle summary -t "$TARGET" --output json 2>/dev/null \
        | jq -r '.workspace.file_path // empty')
    if [[ -n "$REMOTE_FILES" ]]; then
        echo "  Wiping stale remote files at $REMOTE_FILES/.build"
        # `|| true` because the dir may not exist on first deploy.
        databricks workspace delete --recursive "$REMOTE_FILES/.build" 2>/dev/null || true
    fi
fi

echo -e "${GREEN}Build complete!${NC}"
echo -e "  ${BLUE}$BUILD_DIR${NC}"
ls -lh "$BUILD_DIR/"
echo ""
echo -e "Next: ${BLUE}databricks bundle deploy${NC}"
