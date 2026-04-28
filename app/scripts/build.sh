#!/bin/bash
# Build script — assembles everything needed for Databricks App deployment.
#
# Creates .build/ with:
#   - app.yml          (Databricks App config)
#   - *.whl            (Python wheel including frontend assets)
#   - requirements.txt (pinned dependencies)
#
# Usage:
#   ./scripts/build.sh          # full build (frontend + wheel + .build/)
#   ./scripts/build.sh --skip-frontend  # skip frontend if already built

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

cd "$APP_DIR"

# Parse args. --lakebase-instance is passed by the bundle artifact build
# (databricks.yml) so .build/app.yml's DB_INSTANCE_NAME placeholder gets
# replaced by var.lakebase_instance. When invoked by hand for local testing,
# the placeholder is left in place — the wheel still builds and `databricks
# bundle deploy` will rerun this script with the var resolved.
SKIP_FRONTEND=""
LAKEBASE_INSTANCE=""
LAKEBASE_AUTOSCALE_ENDPOINT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-frontend) SKIP_FRONTEND=1; shift ;;
        --lakebase-instance) LAKEBASE_INSTANCE="$2"; shift 2 ;;
        --lakebase-autoscale-endpoint) LAKEBASE_AUTOSCALE_ENDPOINT="$2"; shift 2 ;;
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

# --- 2. Build Python wheel ---
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

# --- 3. Export requirements ---
echo -e "${BLUE}[3/4] Exporting requirements.txt...${NC}"
WHEEL_BASENAME=$(basename "$WHEEL")
# Export deps without hashes (hashes + local wheel breaks pip's --require-hashes mode),
# drop the "." self-reference and editable installs, add the wheel instead
uv export --no-dev --no-editable --frozen --no-hashes 2>/dev/null | \
    grep -v '^-e ' | grep -v '^\.$' > dist/requirements.txt
echo "./${WHEEL_BASENAME}" >> dist/requirements.txt

# --- 4. Assemble .build/ ---
echo -e "${BLUE}[4/4] Assembling .build/ directory...${NC}"
rm -rf .build
mkdir -p .build

cp "$WHEEL" .build/
cp dist/requirements.txt .build/
cp app.yml .build/

# Substitute __DB_INSTANCE_NAME__ in .build/app.yml from the bundle var. If the
# arg is missing (manual `./scripts/build.sh`), leave the placeholder in place;
# `databricks bundle deploy` will overwrite .build/app.yml on its own pass.
if [[ -n "$LAKEBASE_INSTANCE" ]]; then
    echo "  Substituting DB_INSTANCE_NAME=$LAKEBASE_INSTANCE in .build/app.yml"
    sed -i.bak "s|__DB_INSTANCE_NAME__|$LAKEBASE_INSTANCE|g" .build/app.yml
    rm -f .build/app.yml.bak
fi

if [[ -n "$LAKEBASE_AUTOSCALE_ENDPOINT" ]]; then
    echo "  Substituting LAKEBASE_AUTOSCALE_ENDPOINT=$LAKEBASE_AUTOSCALE_ENDPOINT in .build/app.yml"
    # sed escaping for forward slashes in the resource path
    sed -i.bak "s|__LAKEBASE_AUTOSCALE_ENDPOINT__|$LAKEBASE_AUTOSCALE_ENDPOINT|g" .build/app.yml
    rm -f .build/app.yml.bak
else
    # Leave empty rather than the placeholder string so DatabaseConfig parses None
    sed -i.bak "s|__LAKEBASE_AUTOSCALE_ENDPOINT__||g" .build/app.yml
    rm -f .build/app.yml.bak
fi

# Bundle capability/domain/pattern blocks. The backend walks up from its
# install location looking for .claude/skills/databricks-demo-generator/references/blocks.
# In the app runtime, .build/ lands at /app/python/source_code, so placing
# .claude there makes the folder discoverable.
if [[ -d "../.claude" ]]; then
    echo "  Bundling .claude/ (capability blocks)..."
    cp -r "../.claude" .build/.claude
fi

# Bundle initial_templates/ so seed_templates can find them at runtime.
# The backend walks up from its install location looking for initial_templates/manifest.json.
if [[ -d "../initial_templates" ]]; then
    echo "  Bundling initial_templates/ (default seed templates)..."
    cp -r "../initial_templates" .build/initial_templates
fi

echo -e "${GREEN}Build complete!${NC}"
echo -e "  ${BLUE}.build/${NC}"
ls -lh .build/
echo ""
echo -e "Next: ${BLUE}databricks bundle deploy -t dev --profile <name>${NC}"
