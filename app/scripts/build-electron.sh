#!/bin/bash
# ==============================================================================
# Build script for Databricks Solution Builder Electron App
#
# This script:
# 1. Downloads standalone Python 3.12 (if not present)
# 2. Creates a Python virtual environment with dependencies
# 3. Bundles the Python backend with PyInstaller
# 4. Builds the React frontend
# 5. Packages everything with electron-builder
#
# The script automatically skips steps that are already complete.
#
# Usage:
#   ./scripts/build-electron.sh [options]
#
# Options:
#   --arch arm64|x64|universal  Target architecture (default: from package.json)
#   --skip-python               Skip Python setup entirely
#   --skip-frontend             Skip frontend build entirely
#   --rebuild-frontend          Force rebuild the frontend
#   --rebuild-backend           Force rebuild the PyInstaller backend
#   --clean                     Remove all build artifacts and start fresh
#   --ai-dev-kit-branch BRANCH  Clone/checkout specific ai-dev-kit branch (default: simplify-skills-remove-mcp)
#   --lakebase-url URL          Embed Lakebase PostgreSQL connection URL
#
# Environment variables:
#   AI_DEV_KIT_BRANCH           Same as --ai-dev-kit-branch
#   LAKEBASE_PG_URL             Same as --lakebase-url
#
# Requirements:
#   - macOS
#   - Node.js / bun
#   - curl, tar
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
PYTHON_VERSION="3.12.7"
# python-build-standalone releases
PYTHON_STANDALONE_BASE="https://github.com/indygreg/python-build-standalone/releases/download/20241016"

# Parse arguments
ARCH=""
SKIP_PYTHON=false
SKIP_FRONTEND=false
REBUILD_FRONTEND=false
REBUILD_BACKEND=false
CLEAN=false
# IMPORTANT: Using 'simplify-skills-remove-mcp' branch which is pure skills (no Python packages)
# TODO: Change back to 'main' once this branch is merged
AI_DEV_KIT_BRANCH="${AI_DEV_KIT_BRANCH:-simplify-skills-remove-mcp}"
LAKEBASE_URL="${LAKEBASE_PG_URL:-}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --skip-python)
            SKIP_PYTHON=true
            shift
            ;;
        --skip-frontend)
            SKIP_FRONTEND=true
            shift
            ;;
        --rebuild-frontend)
            REBUILD_FRONTEND=true
            shift
            ;;
        --rebuild-backend)
            REBUILD_BACKEND=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --ai-dev-kit-branch)
            AI_DEV_KIT_BRANCH="$2"
            shift 2
            ;;
        --lakebase-url)
            LAKEBASE_URL="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--arch arm64|x64] [--skip-python] [--skip-frontend] [--rebuild-frontend] [--rebuild-backend] [--clean] [--ai-dev-kit-branch BRANCH] [--lakebase-url URL]"
            exit 1
            ;;
    esac
done

# Handle --clean
if [ "$CLEAN" = true ]; then
    echo -e "${YELLOW}Cleaning build artifacts...${NC}"
    rm -rf "$APP_DIR/dist-python" "$APP_DIR/dist-venv" "$APP_DIR/dist-backend" "$APP_DIR/dist-electron" "$APP_DIR/build-pyinstaller"
    rm -rf "$APP_DIR/src/demo_prompt_generator/ui/__dist__"
    rm -f "$APP_DIR/run_server.py" "$APP_DIR/run_aidevkit.py"
    echo -e "${GREEN}Clean complete${NC}"
fi

# Handle --rebuild flags
if [ "$REBUILD_FRONTEND" = true ]; then
    rm -rf "$APP_DIR/src/demo_prompt_generator/ui/__dist__"
fi
if [ "$REBUILD_BACKEND" = true ]; then
    rm -rf "$APP_DIR/dist-backend" "$APP_DIR/build-pyinstaller"
fi

# ==============================================================================
# Clone ai_dev_kit if not present
# ==============================================================================
AI_DEV_KIT_REPO="https://github.com/databricks-solutions/ai-dev-kit.git"

if [ ! -d "$APP_DIR/ai_dev_kit" ]; then
    echo -e "${CYAN}Cloning ai-dev-kit repository (branch: $AI_DEV_KIT_BRANCH)...${NC}"
    git clone --branch "$AI_DEV_KIT_BRANCH" "$AI_DEV_KIT_REPO" "$APP_DIR/ai_dev_kit"
    echo -e "${GREEN}ai-dev-kit cloned successfully${NC}"
elif [ ! -d "$APP_DIR/ai_dev_kit/databricks-skills" ]; then
    # Incomplete or wrong structure - remove and re-clone
    echo -e "${YELLOW}ai_dev_kit folder has wrong structure, re-cloning...${NC}"
    rm -rf "$APP_DIR/ai_dev_kit"
    git clone --branch "$AI_DEV_KIT_BRANCH" "$AI_DEV_KIT_REPO" "$APP_DIR/ai_dev_kit"
    echo -e "${GREEN}ai-dev-kit cloned successfully${NC}"
else
    # Check if we need to switch branches or update
    CURRENT_BRANCH=$(cd "$APP_DIR/ai_dev_kit" && git branch --show-current)
    if [ "$CURRENT_BRANCH" != "$AI_DEV_KIT_BRANCH" ]; then
        # Different branch - do a complete reset to avoid stale files
        echo -e "${YELLOW}Switching ai-dev-kit to branch: $AI_DEV_KIT_BRANCH (full reset)${NC}"
        (cd "$APP_DIR/ai_dev_kit" && \
            git fetch origin && \
            git checkout "$AI_DEV_KIT_BRANCH" && \
            git reset --hard "origin/$AI_DEV_KIT_BRANCH" && \
            git clean -fdx)
        echo -e "${GREEN}ai-dev-kit switched and reset${NC}"
    else
        # Same branch - hard reset to origin to ensure clean state
        echo -e "${CYAN}Updating ai-dev-kit (branch: $AI_DEV_KIT_BRANCH)...${NC}"
        (cd "$APP_DIR/ai_dev_kit" && \
            git fetch origin && \
            git reset --hard "origin/$AI_DEV_KIT_BRANCH" && \
            git clean -fdx) && \
        echo -e "${GREEN}ai-dev-kit updated${NC}" || echo -e "${YELLOW}ai-dev-kit update failed${NC}"
    fi
fi

# Show build info
ARCH_DISPLAY="${ARCH:-from package.json}"
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Building Databricks Solution Builder for macOS${NC}            ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${CYAN}Architecture: $ARCH_DISPLAY${NC}                               ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$APP_DIR"

# ==============================================================================
# Step 1: Download Standalone Python
# ==============================================================================
download_python() {
    echo -e "${CYAN}Step 1: Setting up standalone Python $PYTHON_VERSION${NC}"

    PYTHON_DIR="$APP_DIR/dist-python"

    if [ -d "$PYTHON_DIR/bin" ] && [ -f "$PYTHON_DIR/bin/python3" ]; then
        echo -e "  ${GREEN}Python already downloaded, skipping${NC}"
        return 0
    fi

    # Determine download URL based on machine architecture
    MACHINE_ARCH="$(uname -m)"
    case "$MACHINE_ARCH" in
        arm64|aarch64)
            PYTHON_ARCHIVE="cpython-${PYTHON_VERSION}+20241016-aarch64-apple-darwin-install_only_stripped.tar.gz"
            ;;
        x86_64)
            PYTHON_ARCHIVE="cpython-${PYTHON_VERSION}+20241016-x86_64-apple-darwin-install_only_stripped.tar.gz"
            ;;
        *)
            echo -e "${RED}Unsupported architecture: $MACHINE_ARCH${NC}"
            exit 1
            ;;
    esac

    PYTHON_URL="${PYTHON_STANDALONE_BASE}/${PYTHON_ARCHIVE}"

    echo -e "  ${CYAN}Downloading Python from:${NC}"
    echo -e "  $PYTHON_URL"

    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    # Download
    curl -L -o "$TEMP_DIR/python.tar.gz" "$PYTHON_URL"

    # Extract
    echo -e "  ${CYAN}Extracting Python...${NC}"
    mkdir -p "$PYTHON_DIR"
    tar -xzf "$TEMP_DIR/python.tar.gz" -C "$PYTHON_DIR" --strip-components=1

    # Verify
    if [ -f "$PYTHON_DIR/bin/python3" ]; then
        echo -e "  ${GREEN}Python installed: $($PYTHON_DIR/bin/python3 --version)${NC}"
    else
        echo -e "  ${RED}Python installation failed${NC}"
        exit 1
    fi
}

# ==============================================================================
# Step 2: Create Virtual Environment and Install Dependencies
# ==============================================================================
setup_python_env() {
    echo ""
    echo -e "${CYAN}Step 2: Setting up Python environment with uv${NC}"

    PYTHON_DIR="$APP_DIR/dist-python"
    VENV_DIR="$APP_DIR/dist-venv"
    DEPS_MARKER="$VENV_DIR/.deps-installed"

    # Check if venv exists and dependencies are up to date
    if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/pyinstaller" ] && [ -f "$DEPS_MARKER" ]; then
        # Check if pyproject.toml is newer than our marker
        if [ "$APP_DIR/pyproject.toml" -ot "$DEPS_MARKER" ]; then
            echo -e "  ${GREEN}Python environment up to date, skipping${NC}"
            return 0
        else
            echo -e "  ${YELLOW}pyproject.toml changed, reinstalling dependencies...${NC}"
        fi
    fi

    # Use uv to create venv with our standalone Python
    if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python" ]; then
        echo -e "  ${GREEN}Virtual environment exists${NC}"
    else
        echo -e "  ${CYAN}Creating virtual environment with uv...${NC}"
        uv venv "$VENV_DIR" --python "$PYTHON_DIR/bin/python3"
    fi

    # Install dependencies with uv
    echo -e "  ${CYAN}Installing dependencies with uv...${NC}"
    uv pip install -e "$APP_DIR" pyinstaller --python "$VENV_DIR/bin/python"


    # Create marker file to track when deps were installed
    touch "$DEPS_MARKER"

    echo -e "  ${GREEN}Python environment ready${NC}"
}

# ==============================================================================
# Step 3: Bundle Backend with PyInstaller
# ==============================================================================
bundle_backend() {
    echo ""
    echo -e "${CYAN}Step 3: Bundling Python backend with PyInstaller${NC}"

    VENV_DIR="$APP_DIR/dist-venv"
    BACKEND_DIST="$APP_DIR/dist-backend"

    # Check if backend already bundled and source hasn't changed
    if [ -f "$BACKEND_DIST/backend/backend" ]; then
        # Check if any Python source is newer than the bundle
        NEWEST_SRC=$(find "$APP_DIR/src" -name "*.py" -newer "$BACKEND_DIST/backend/backend" 2>/dev/null | head -1)
        if [ -z "$NEWEST_SRC" ]; then
            echo -e "  ${GREEN}Backend already bundled and up to date, skipping${NC}"
            echo -e "  ${YELLOW}(Use --rebuild-backend to force rebuild)${NC}"
            return 0
        else
            echo -e "  ${YELLOW}Source files changed, rebuilding backend...${NC}"
        fi
    fi

    # Create a wrapper script for PyInstaller
    cat > "$APP_DIR/run_server.py" << 'EOF'
#!/usr/bin/env python3
"""
Entry point for the bundled backend server.
Used by PyInstaller to create a standalone executable.
"""
import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', type=str, default='127.0.0.1')
    args = parser.parse_args()

    # Set environment variables
    os.environ['ELECTRON_RUN'] = '1'

    # Import and run uvicorn
    import uvicorn
    from demo_prompt_generator.backend.app import app

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level='info',
    )

if __name__ == '__main__':
    main()
EOF

    # Run PyInstaller
    echo -e "  ${CYAN}Running PyInstaller...${NC}"
    cd "$APP_DIR"

    # PyInstaller with auto-discovery + minimal hints for dynamic imports
    "$VENV_DIR/bin/pyinstaller" \
        --name backend \
        --onedir \
        --noconfirm \
        --clean \
        --distpath "$BACKEND_DIST" \
        --workpath "$APP_DIR/build-pyinstaller" \
        --specpath "$APP_DIR/build-pyinstaller" \
        --collect-all=demo_prompt_generator \
        --collect-submodules=uvicorn \
        --collect-submodules=fastapi \
        --collect-submodules=starlette \
        run_server.py

    # Verify
    if [ -f "$BACKEND_DIST/backend/backend" ]; then
        echo -e "  ${GREEN}Backend bundled successfully${NC}"
        echo -e "  ${GREEN}Size: $(du -sh "$BACKEND_DIST/backend" | cut -f1)${NC}"
    else
        echo -e "  ${RED}Backend bundling failed${NC}"
        exit 1
    fi
}

# ==============================================================================
# ==============================================================================
# Step 4: Build Frontend
# ==============================================================================
build_frontend() {
    echo ""
    echo -e "${CYAN}Step 4: Building React frontend${NC}"

    cd "$APP_DIR"

    # Check if frontend already built and source hasn't changed
    if [ -f "src/demo_prompt_generator/ui/__dist__/index.html" ]; then
        # Check if any frontend source is newer than the build
        NEWEST_SRC=$(find "$APP_DIR/src/demo_prompt_generator/ui" \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" \) -newer "src/demo_prompt_generator/ui/__dist__/index.html" 2>/dev/null | head -1)
        if [ -z "$NEWEST_SRC" ]; then
            echo -e "  ${GREEN}Frontend already built and up to date, skipping${NC}"
            echo -e "  ${YELLOW}(Use --rebuild-frontend to force rebuild)${NC}"
            return 0
        else
            echo -e "  ${YELLOW}Source files changed, rebuilding frontend...${NC}"
        fi
    fi

    # Install npm dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "  ${CYAN}Installing npm dependencies...${NC}"
        bun install
    fi

    # Build frontend with Electron flag
    echo -e "  ${CYAN}Building with Vite (Electron mode)...${NC}"
    ELECTRON_BUILD=1 bun run build

    # Check output
    if [ -d "src/demo_prompt_generator/ui/__dist__" ]; then
        echo -e "  ${GREEN}Frontend built successfully${NC}"
        echo -e "  ${GREEN}Size: $(du -sh "src/demo_prompt_generator/ui/__dist__" | cut -f1)${NC}"
    else
        echo -e "  ${RED}Frontend build failed${NC}"
        exit 1
    fi
}

# ==============================================================================
# Step 5: Package with Electron Builder
# ==============================================================================
package_electron() {
    echo ""
    echo -e "${CYAN}Step 5: Packaging with Electron Builder${NC}"

    cd "$APP_DIR"

    # Ensure electron and electron-builder are installed
    if [ ! -d "node_modules/electron" ]; then
        echo -e "  ${CYAN}Installing Electron...${NC}"
        bun install
    fi

    # Generate config file with embedded settings
    CONFIG_FILE="$APP_DIR/electron/config.json"
    echo -e "  ${CYAN}Generating config file...${NC}"
    if [ -n "$LAKEBASE_URL" ]; then
        echo -e "  ${GREEN}Embedding Lakebase URL${NC}"
        cat > "$CONFIG_FILE" << EOF
{
  "lakebaseUrl": "$LAKEBASE_URL"
}
EOF
    else
        echo -e "  ${YELLOW}No Lakebase URL provided (will use PGLite locally)${NC}"
        cat > "$CONFIG_FILE" << EOF
{
  "lakebaseUrl": null
}
EOF
    fi

    # Build for specified architecture (or use package.json config if not specified)
    if [ -n "$ARCH" ]; then
        echo -e "  ${CYAN}Building for macOS $ARCH...${NC}"
        case "$ARCH" in
            arm64)
                bun run electron-builder --mac --arm64
                ;;
            x64)
                bun run electron-builder --mac --x64
                ;;
            universal)
                bun run electron-builder --mac --universal
                ;;
        esac
    else
        echo -e "  ${CYAN}Building for macOS (using package.json config)...${NC}"
        bun run electron-builder --mac
    fi

    # Show output
    echo ""
    echo -e "${GREEN}Build complete!${NC}"
    echo -e "${CYAN}Output files:${NC}"
    ls -la "$APP_DIR/dist-electron/"
}

# ==============================================================================
# Main
# ==============================================================================

if [ "$SKIP_PYTHON" = false ]; then
    download_python
    setup_python_env
    bundle_backend
fi

if [ "$SKIP_FRONTEND" = false ]; then
    build_frontend
fi

package_electron

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}Build completed successfully!${NC}                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  The app is available at:                                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    ${YELLOW}dist-electron/Databricks Solution Builder-*.dmg${NC}          ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
