#!/bin/bash
# Build script - builds the frontend for production

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building frontend for production...${NC}"

cd "$APP_DIR"

# Build frontend with vite
bun run --cwd "$APP_DIR" vite build --config vite.config.ts

echo -e "${GREEN}Build complete!${NC}"
echo -e "Output: ${BLUE}src/demo_prompt_generator/ui/__dist__${NC}"
