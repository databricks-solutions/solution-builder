#!/bin/bash
#
# Release script for Demo Prompt Generator Electron app
#
# This script:
# 1. Bumps the version in package.json
# 2. Builds the Electron app (backend + frontend + packaging)
# 3. Creates a git tag
# 4. Publishes the release to GitHub Releases
#
# Usage:
#   ./scripts/release.sh [patch|minor|major]
#   ./scripts/release.sh 1.2.3
#
# Prerequisites:
#   - GitHub CLI (gh) authenticated with repo access
#   - GH_TOKEN environment variable set (for electron-builder publishing)
#
# Examples:
#   ./scripts/release.sh patch    # 0.1.0 -> 0.1.1
#   ./scripts/release.sh minor    # 0.1.0 -> 0.2.0
#   ./scripts/release.sh major    # 0.1.0 -> 1.0.0
#   ./scripts/release.sh 1.0.0    # Set explicit version

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$APP_DIR"

echo -e "${BLUE}=== Demo Prompt Generator Release ===${NC}"
echo ""

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check gh CLI
    if ! command -v gh &> /dev/null; then
        echo -e "${RED}Error: GitHub CLI (gh) not found. Install with: brew install gh${NC}"
        exit 1
    fi

    # Check gh auth
    if ! gh auth status &> /dev/null; then
        echo -e "${RED}Error: Not authenticated with GitHub CLI. Run: gh auth login${NC}"
        exit 1
    fi

    # Check GH_TOKEN for electron-builder
    if [ -z "$GH_TOKEN" ]; then
        echo -e "${YELLOW}Warning: GH_TOKEN not set. Setting from gh CLI...${NC}"
        export GH_TOKEN=$(gh auth token)
        if [ -z "$GH_TOKEN" ]; then
            echo -e "${RED}Error: Could not get GH_TOKEN. Please set it manually.${NC}"
            exit 1
        fi
    fi

    # Check for clean git state
    if [ -n "$(git status --porcelain)" ]; then
        echo -e "${YELLOW}Warning: You have uncommitted changes.${NC}"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    echo -e "${GREEN}Prerequisites OK${NC}"
    echo ""
}

# Get current version
get_current_version() {
    node -p "require('./package.json').version"
}

# Bump version
bump_version() {
    local bump_type="$1"
    local current_version=$(get_current_version)
    local new_version=""

    if [[ "$bump_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        # Explicit version provided
        new_version="$bump_type"
    else
        # Parse current version
        IFS='.' read -r major minor patch <<< "$current_version"

        case "$bump_type" in
            major)
                new_version="$((major + 1)).0.0"
                ;;
            minor)
                new_version="$major.$((minor + 1)).0"
                ;;
            patch|"")
                new_version="$major.$minor.$((patch + 1))"
                ;;
            *)
                echo -e "${RED}Error: Invalid bump type: $bump_type${NC}"
                echo "Usage: $0 [patch|minor|major|x.y.z]"
                exit 1
                ;;
        esac
    fi

    echo "$new_version"
}

# Update version in package.json
update_version() {
    local new_version="$1"

    echo -e "${YELLOW}Updating version to $new_version...${NC}"

    # Update package.json
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
        pkg.version = '$new_version';
        fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 4) + '\n');
    "

    echo -e "${GREEN}Version updated to $new_version${NC}"
}

# Build the app
build_app() {
    echo ""
    echo -e "${BLUE}Building the application...${NC}"
    echo ""

    # Use the existing build script
    ./scripts/build-electron.sh

    echo ""
    echo -e "${GREEN}Build complete${NC}"
}

# Create git tag and commit
create_tag() {
    local version="$1"
    local tag_name="v$version"

    echo ""
    echo -e "${YELLOW}Creating git tag $tag_name...${NC}"

    # Commit version bump
    git add package.json
    git commit -m "chore: bump version to $version" || true

    # Create tag
    git tag -a "$tag_name" -m "Release $tag_name"

    echo -e "${GREEN}Tag $tag_name created${NC}"
}

# Publish to GitHub Releases
publish_release() {
    local version="$1"
    local tag_name="v$version"

    echo ""
    echo -e "${BLUE}Publishing to GitHub Releases...${NC}"
    echo ""

    # Push tag
    git push origin "$tag_name"

    # Use electron-builder to publish
    # This uploads the artifacts to GitHub Releases
    npx electron-builder --mac --publish always

    echo ""
    echo -e "${GREEN}Release $tag_name published!${NC}"
}

# Main
main() {
    local bump_type="${1:-patch}"

    check_prerequisites

    local current_version=$(get_current_version)
    local new_version=$(bump_version "$bump_type")

    echo -e "${BLUE}Version: ${current_version} -> ${new_version}${NC}"
    echo ""

    read -p "Continue with release? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Release cancelled."
        exit 0
    fi

    update_version "$new_version"
    build_app
    create_tag "$new_version"
    publish_release "$new_version"

    echo ""
    echo -e "${GREEN}=== Release Complete ===${NC}"
    echo ""
    echo "Release v$new_version has been published to GitHub Releases."
    echo "Users will automatically receive the update notification."
    echo ""
    echo "View the release at:"
    echo "  https://github.com/databricks-solutions/solution-builder/releases/tag/v$new_version"
}

main "$@"
