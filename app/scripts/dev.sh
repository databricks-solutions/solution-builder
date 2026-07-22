#!/bin/bash
# Development script - runs both backend (uvicorn) and frontend (vite) with interleaved output

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Databricks Asset Generator - Development Server${NC}            ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$APP_DIR"

# ============================================================================
# CLI preflight — fail fast with a clear message if uv / bun are missing,
# instead of an obscure error halfway through `uv sync` / `bun install`.
# ============================================================================
if ! command -v uv &> /dev/null; then
    echo -e "${RED}ERROR: uv is not installed${NC}"
    echo -e "  Install via: ${CYAN}curl -LsSf https://astral.sh/uv/install.sh | sh${NC}"
    exit 1
fi
if ! command -v bun &> /dev/null; then
    echo -e "${RED}ERROR: bun is not installed${NC}"
    echo -e "  Install via: ${CYAN}curl -fsSL https://bun.sh/install | bash${NC}"
    exit 1
fi

# ============================================================================
# Parse arguments
# ============================================================================
# IMPORTANT: Using 'simplify-skills-remove-mcp' branch which removes MCP in favor of CLI tools
# TODO: Change back to 'main' once this branch is merged
AI_DEV_KIT_BRANCH="${AI_DEV_KIT_BRANCH:-experimental}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --ai-dev-kit-branch)
            AI_DEV_KIT_BRANCH="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# ============================================================================
# Port offset — run a SECOND instance in parallel without clobbering the first.
# PORT_OFFSET shifts BOTH ports together (they must move in lockstep so the
# frontend's /api proxy still finds the backend). Default 0 → unchanged.
#   PORT_OFFSET=1 ./scripts/dev.sh   → backend :8001, frontend :5174
# The kill-lines below only touch THESE ports, so a parallel instance never
# kills your already-running one.
# ============================================================================
PORT_OFFSET="${PORT_OFFSET:-0}"
BACKEND_PORT=$((8000 + PORT_OFFSET))
FRONTEND_PORT=$((5173 + PORT_OFFSET))
# Wire the frontend → backend proxy + Vite's listen port to the shifted values
# (vite.config.ts reads both). Exported so the `bun run vite` child inherits them.
export VITE_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
export VITE_PORT="${FRONTEND_PORT}"

# ============================================================================
# Clone ai_dev_kit if not present (pure skills - no Python packages)
# ============================================================================
AI_DEV_KIT_REPO="https://github.com/databricks-solutions/ai-dev-kit.git"

if [ ! -d "ai_dev_kit" ]; then
    echo -e "${CYAN}Cloning ai-dev-kit repository (branch: $AI_DEV_KIT_BRANCH)...${NC}"
    git clone --branch "$AI_DEV_KIT_BRANCH" "$AI_DEV_KIT_REPO" ai_dev_kit
    echo -e "${GREEN}ai-dev-kit cloned successfully${NC}"
elif [ ! -d "ai_dev_kit/databricks-skills" ]; then
    # Incomplete or wrong structure - remove and re-clone
    echo -e "${YELLOW}ai_dev_kit folder has wrong structure, re-cloning...${NC}"
    rm -rf ai_dev_kit
    git clone --branch "$AI_DEV_KIT_BRANCH" "$AI_DEV_KIT_REPO" ai_dev_kit
    echo -e "${GREEN}ai-dev-kit cloned successfully${NC}"
else
    # Check if we need to switch branches or update
    CURRENT_BRANCH=$(cd ai_dev_kit && git branch --show-current)
    if [ "$CURRENT_BRANCH" != "$AI_DEV_KIT_BRANCH" ]; then
        # Different branch - do a complete reset to avoid stale files
        echo -e "${YELLOW}Switching ai-dev-kit to branch: $AI_DEV_KIT_BRANCH (full reset)${NC}"
        (cd ai_dev_kit && \
            git fetch origin && \
            git checkout "$AI_DEV_KIT_BRANCH" && \
            git reset --hard "origin/$AI_DEV_KIT_BRANCH" && \
            git clean -fdx)
        echo -e "${GREEN}ai-dev-kit switched and reset${NC}"
    else
        # Same branch - hard reset to origin to ensure clean state
        echo -e "${CYAN}Updating ai-dev-kit (branch: $AI_DEV_KIT_BRANCH)...${NC}"
        (cd ai_dev_kit && \
            git fetch origin && \
            git reset --hard "origin/$AI_DEV_KIT_BRANCH" && \
            git clean -fdx) && \
        echo -e "${GREEN}ai-dev-kit updated${NC}" || echo -e "${YELLOW}ai-dev-kit update failed${NC}"
    fi
fi

# Sync Python environment (removes stale packages if ai_dev_kit changed)
echo -e "${CYAN}Syncing Python environment...${NC}"
uv sync --quiet

# ============================================================================
# Provision a shared Python 3.12 venv for databricks-connect data-gen scripts.
# The agent reuses this single venv across all projects instead of recreating
# one per project (which fails on Python 3.14 and wastes ~1-2 min each time).
# Path is hardcoded so system_prompt.py can find it; rm -rf to refresh.
# ============================================================================
if [ ! -x .venv-dbconnect/bin/python ]; then
    echo -e "${CYAN}Provisioning shared databricks-connect venv (Python 3.12)...${NC}"
    uv python install 3.12 --quiet
    uv venv --python 3.12 .venv-dbconnect --quiet
    uv pip install --python .venv-dbconnect/bin/python --quiet \
        "databricks-connect>=16.4,<17.4" \
        faker numpy pandas holidays pyarrow
    echo -e "${GREEN}databricks-connect venv ready at .venv-dbconnect${NC}"
fi

# Generate _metadata.py if missing — gitignored like _version.py, but unlike
# _version.py there's no dynamic source, so a fresh clone has neither the
# file nor a hatch hook run to produce one. Without this, uvicorn crashes
# with `ModuleNotFoundError: demo_prompt_generator._metadata` on first start.
if [ ! -f src/demo_prompt_generator/_metadata.py ]; then
    echo -e "${CYAN}Generating _metadata.py...${NC}"
    .venv/bin/python scripts/generate_metadata.py
fi

# Install / sync frontend dependencies. Run on every start (not just on
# fresh clone) — otherwise pulling a branch that adds a dep silently
# leaves node_modules stale and vite crashes mid-page-load with an
# unhelpful "Failed to resolve import" error. Bun's lockfile-aware
# install is near-instant when nothing changed, so the cost is fine.
echo -e "${CYAN}Syncing frontend dependencies (bun install)...${NC}"
bun install --silent

# ============================================================================
# Recompile the architecture skill (catalog from code + standalone viewer/editor
# HTML) so dev always starts with a FRESH skill. Backgrounded + non-fatal — a
# failure here must never block the dev servers.
# ============================================================================
echo -e "${CYAN}Refreshing architecture skill (catalog + standalone)...${NC}"
(
    if ./scripts/refresh-arch-skill.sh >/dev/null 2>&1; then
        echo -e "[${GREEN}ARCH-SKILL${NC}] compiled (catalog + standalone HTML)"
    else
        echo -e "[${YELLOW}ARCH-SKILL${NC}] compile failed (non-fatal)"
    fi
) &

# ============================================================================
# Check for .env file — auto-bootstrap from .env.example so a fresh clone
# can just run ./scripts/dev.sh. The example sets DATABRICKS_CONFIG_PROFILE=DEFAULT
# which works against ~/.databrickscfg.
# ============================================================================
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}.env not found — copying from .env.example${NC}"
        cp .env.example .env
        echo -e "  Edit ${CYAN}.env${NC} if you need a non-default profile or direct token auth."
    else
        echo -e "${RED}ERROR: .env file not found and .env.example missing${NC}"
        exit 1
    fi
fi

# Load .env file
echo -e "${CYAN}Loading .env file...${NC}"
set -a
source .env
set +a

# ============================================================================
# Validate required environment variables
# ============================================================================
ERRORS=0

# Check Databricks auth (required)
if [ -z "$DATABRICKS_CONFIG_PROFILE" ] && [ -z "$DATABRICKS_HOST" ]; then
    echo -e "${RED}ERROR: Databricks authentication not configured${NC}"
    echo ""
    echo -e "  Options:"
    echo -e "  1. Use a profile (recommended):"
    echo -e "     ${CYAN}databricks auth login --host https://your-workspace.cloud.databricks.com --profile my-profile${NC}"
    echo -e "     Then add to .env: ${CYAN}DATABRICKS_CONFIG_PROFILE=my-profile${NC}"
    echo ""
    echo -e "  2. Use direct token auth:"
    echo -e "     Add to .env:"
    echo -e "     ${CYAN}DATABRICKS_HOST=https://your-workspace.cloud.databricks.com${NC}"
    echo -e "     ${CYAN}DATABRICKS_TOKEN=dapi...${NC}"
    echo ""
    ERRORS=1
fi

# Exit if any errors
if [ $ERRORS -ne 0 ]; then
    echo -e "${RED}Please fix the errors above and try again.${NC}"
    exit 1
fi

# ============================================================================
# Show configuration
# ============================================================================
echo -e "${GREEN}Configuration OK${NC}"
echo ""

# Database configuration. Two modes (mirror core/lakebase.py):
#   - LAKEBASE_DATABASE_PATH set (and USE_PGLITE != 1) → real Lakebase via SDK
#     OAuth. No password anywhere; SDK reads DATABRICKS_CONFIG_PROFILE.
#   - Otherwise → PGLite (auto-provisioned local cluster in ~/.pglite/).
echo -e "${CYAN}Database:${NC}"
if [ -n "$LAKEBASE_DATABASE_PATH" ] && [ "$USE_PGLITE" != "1" ]; then
    echo -e "  ${GREEN}Lakebase (OAuth via Databricks SDK)${NC}"
    echo -e "  Path: ${CYAN}$LAKEBASE_DATABASE_PATH${NC}"
    echo -e "  Profile: ${CYAN}${DATABRICKS_CONFIG_PROFILE:-DEFAULT}${NC}"
else
    echo -e "  ${YELLOW}Using PGLite (local PostgreSQL cluster)${NC}"
    echo -e "  Data stored in: ${GREEN}~/.pglite/${NC}"
    echo -e "  To reset: ${CYAN}RESET_DB=1 ./scripts/dev.sh${NC}"

    # PGLite needs a system PostgreSQL install for pg_ctl.
    if ! command -v pg_ctl &> /dev/null; then
        echo ""
        echo -e "  ${RED}PostgreSQL is not installed!${NC}"
        echo -e "  PGLite requires PostgreSQL to be installed locally."
        echo ""

        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo -e "  Would you like to install PostgreSQL via Homebrew? (y/n)"
            read -r INSTALL_PG
            if [[ "$INSTALL_PG" == "y" || "$INSTALL_PG" == "Y" ]]; then
                echo -e "  ${CYAN}Installing PostgreSQL...${NC}"
                brew install postgresql@16
                brew link postgresql@16 --force
                echo -e "  ${GREEN}PostgreSQL installed successfully!${NC}"
            else
                echo ""
                echo -e "  To install manually, run:"
                echo -e "    ${CYAN}brew install postgresql@16${NC}"
                echo ""
                echo -e "  Or set ${CYAN}LAKEBASE_DATABASE_PATH${NC} in .env to use Lakebase."
                exit 1
            fi
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            echo -e "  To install PostgreSQL on Ubuntu/Debian:"
            echo -e "    ${CYAN}sudo apt install postgresql${NC}"
            echo ""
            echo -e "  Or set ${CYAN}LAKEBASE_DATABASE_PATH${NC} in .env to use Lakebase."
            exit 1
        else
            echo -e "  Please install PostgreSQL manually or set ${CYAN}LAKEBASE_DATABASE_PATH${NC} in .env"
            exit 1
        fi
    else
        echo -e "  ${GREEN}PostgreSQL detected:${NC} $(which pg_ctl)"
    fi
fi
echo ""

# Databricks auth
echo -e "${CYAN}Databricks Authentication:${NC}"
if [ -n "$DATABRICKS_CONFIG_PROFILE" ]; then
    echo -e "  Profile: ${GREEN}$DATABRICKS_CONFIG_PROFILE${NC}"
elif [ -n "$DATABRICKS_HOST" ]; then
    echo -e "  Host: ${GREEN}$DATABRICKS_HOST${NC} (direct auth)"
fi
echo ""

# ============================================================================
# Kill any existing processes on our ports
# ============================================================================
echo -e "${CYAN}Cleaning up existing processes on :${BACKEND_PORT} / :${FRONTEND_PORT}...${NC}"
lsof -ti:${BACKEND_PORT} | xargs kill -9 2>/dev/null || true
lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null || true
sleep 1

# ============================================================================
# Cleanup function
# ============================================================================
cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo -e "${GREEN}Servers stopped.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ============================================================================
# Start servers
# ============================================================================

# Start frontend first (it's faster)
echo -e "${GREEN}Starting frontend on http://localhost:${FRONTEND_PORT}${NC}"
(bun run --cwd "$APP_DIR" vite --config vite.config.ts 2>&1 | while IFS= read -r line; do echo -e "[$(date +%H:%M:%S)] [${CYAN}FRONTEND${NC}] $line"; done) &
FRONTEND_PID=$!

# Start backend (uvicorn with reload) - prefix output with [BACKEND]
# Use --reload-dir to only watch src/ (much faster than excluding everything else)
echo -e "${GREEN}Starting backend on http://127.0.0.1:${BACKEND_PORT}${NC}"
(.venv/bin/python -u -m uvicorn demo_prompt_generator.backend.app:app --host 127.0.0.1 --port ${BACKEND_PORT} --reload --reload-dir src --timeout-graceful-shutdown 5 2>&1 | while IFS= read -r line; do echo -e "[$(date +%H:%M:%S)] [${BLUE}BACKEND${NC}] $line"; done) &
BACKEND_PID=$!

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Development servers running:${NC}"
echo -e "  Frontend: ${BLUE}http://localhost:${FRONTEND_PORT}${NC}"
echo -e "  Backend:  ${BLUE}http://127.0.0.1:${BACKEND_PORT}${NC}"
echo -e "  API Docs: ${BLUE}http://127.0.0.1:${BACKEND_PORT}/docs${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
