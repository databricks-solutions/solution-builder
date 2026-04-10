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
# Parse arguments
# ============================================================================
# IMPORTANT: Using 'add-aidevkit-cli' branch which removes MCP in favor of CLI tools
# TODO: Change back to 'main' once this branch is merged
AI_DEV_KIT_BRANCH="${AI_DEV_KIT_BRANCH:-add-aidevkit-cli}"

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
# Clone ai_dev_kit if not present
# ============================================================================
AI_DEV_KIT_REPO="https://github.com/databricks-solutions/ai-dev-kit.git"
NEED_CLI_INSTALL=false

if [ ! -d "ai_dev_kit" ]; then
    echo -e "${CYAN}Cloning ai-dev-kit repository (branch: $AI_DEV_KIT_BRANCH)...${NC}"
    git clone --branch "$AI_DEV_KIT_BRANCH" "$AI_DEV_KIT_REPO" ai_dev_kit
    echo -e "${GREEN}ai-dev-kit cloned successfully${NC}"
    NEED_CLI_INSTALL=true
elif [ ! -d "ai_dev_kit/databricks-tools-core" ]; then
    echo -e "${RED}ERROR: ai_dev_kit folder exists but seems incomplete${NC}"
    echo -e "Try: ${CYAN}rm -rf ai_dev_kit && ./scripts/dev.sh${NC}"
    exit 1
else
    # Check if we need to switch branches
    CURRENT_BRANCH=$(cd ai_dev_kit && git branch --show-current)
    if [ "$CURRENT_BRANCH" != "$AI_DEV_KIT_BRANCH" ] && [ "$AI_DEV_KIT_BRANCH" != "main" ]; then
        echo -e "${YELLOW}Switching ai-dev-kit to branch: $AI_DEV_KIT_BRANCH${NC}"
        (cd ai_dev_kit && git fetch && git checkout "$AI_DEV_KIT_BRANCH" && git pull)
        NEED_CLI_INSTALL=true
    fi
fi

# ============================================================================
# Install aidevkit CLI (required for Claude Code sessions)
# ============================================================================
# Check if aidevkit is installed and working
if ! command -v aidevkit &> /dev/null || [ "$NEED_CLI_INSTALL" = true ]; then
    echo -e "${CYAN}Installing aidevkit CLI tools...${NC}"

    # Install databricks-tools-core first (dependency)
    uv pip install -e "$APP_DIR/ai_dev_kit/databricks-tools-core" --quiet 2>/dev/null || \
        pip install -e "$APP_DIR/ai_dev_kit/databricks-tools-core" --quiet

    # Install the CLI
    uv pip install -e "$APP_DIR/ai_dev_kit/databricks-aidevkit-cli" --quiet 2>/dev/null || \
        pip install -e "$APP_DIR/ai_dev_kit/databricks-aidevkit-cli" --quiet

    # Verify installation
    if command -v aidevkit &> /dev/null; then
        echo -e "${GREEN}aidevkit CLI installed successfully${NC}"
        aidevkit --version 2>/dev/null || true
    else
        echo -e "${YELLOW}Warning: aidevkit CLI not in PATH after install${NC}"
        echo -e "  You may need to add your Python bin directory to PATH"
    fi
else
    echo -e "${GREEN}aidevkit CLI:${NC} $(aidevkit --version 2>/dev/null || echo 'installed')"
fi

# ============================================================================
# Check for .env file
# ============================================================================
if [ ! -f .env ]; then
    echo -e "${RED}ERROR: .env file not found!${NC}"
    echo ""
    echo -e "Create one from the example:"
    echo -e "  ${CYAN}cp .env.example .env${NC}"
    echo ""
    echo -e "Then edit ${CYAN}.env${NC} and set the required values."
    echo ""
    exit 1
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

# Database configuration
echo -e "${CYAN}Database:${NC}"
if [ -z "$LAKEBASE_PG_URL" ]; then
    echo -e "  ${YELLOW}Using PGLite (local PostgreSQL cluster)${NC}"
    echo -e "  Data stored in: ${GREEN}~/.pglite/${NC}"
    echo -e "  To reset: ${CYAN}RESET_DB=1 ./scripts/dev.sh${NC}"

    # Check if PostgreSQL is installed (required for PGLite)
    if ! command -v pg_ctl &> /dev/null; then
        echo ""
        echo -e "  ${RED}PostgreSQL is not installed!${NC}"
        echo -e "  PGLite requires PostgreSQL to be installed locally."
        echo ""

        # Detect OS and offer to install
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
                echo -e "  Or set ${CYAN}LAKEBASE_PG_URL${NC} in .env to use a remote database."
                exit 1
            fi
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            echo -e "  To install PostgreSQL on Ubuntu/Debian:"
            echo -e "    ${CYAN}sudo apt install postgresql${NC}"
            echo ""
            echo -e "  Or set ${CYAN}LAKEBASE_PG_URL${NC} in .env to use a remote database."
            exit 1
        else
            echo -e "  Please install PostgreSQL manually or set ${CYAN}LAKEBASE_PG_URL${NC} in .env"
            exit 1
        fi
    else
        echo -e "  ${GREEN}PostgreSQL detected:${NC} $(which pg_ctl)"
    fi
else
    # Show masked DB URL (hide password)
    DB_DISPLAY=$(echo "$LAKEBASE_PG_URL" | sed 's|://[^:]*:[^@]*@|://****:****@|')
    echo -e "  ${GREEN}$DB_DISPLAY${NC}"
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
echo -e "${CYAN}Cleaning up existing processes...${NC}"
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
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

# Start backend (uvicorn with reload) - prefix output with [BACKEND]
echo -e "${GREEN}Starting backend on http://127.0.0.1:8000${NC}"
(uv run uvicorn demo_prompt_generator.backend.app:app --host 127.0.0.1 --port 8000 --reload --reload-exclude 'projects/*' --reload-exclude '.pglite/*' 2>&1 | sed "s/^/[${BLUE}BACKEND${NC}] /") &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend (vite dev server) - prefix output with [FRONTEND]
echo -e "${GREEN}Starting frontend on http://localhost:5173${NC}"
(bun run --cwd "$APP_DIR" vite --config vite.config.ts 2>&1 | sed "s/^/[${CYAN}FRONTEND${NC}] /") &
FRONTEND_PID=$!

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Development servers running:${NC}"
echo -e "  Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e "  Backend:  ${BLUE}http://127.0.0.1:8000${NC}"
echo -e "  API Docs: ${BLUE}http://127.0.0.1:8000/docs${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
