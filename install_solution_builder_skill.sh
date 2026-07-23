#!/bin/bash
# Install the databricks-solution-builder skill into your local project
#
# For most users the curl-piped installer is simpler — it doesn't require a
# clone and can also install the AI Dev Kit alongside the skill:
#
#   bash <(curl -sL https://raw.githubusercontent.com/databricks-solutions/solution-builder/main/install.sh) --project
#
# This script remains for running install from a local clone.
#
# Usage (requires gh CLI authenticated):
#   gh repo clone databricks-solutions/solution-builder /tmp/dsb && /tmp/dsb/install_demo_generator_skill.sh && rm -rf /tmp/dsb
#
# Or if you have the repo cloned:
#   ./install_demo_generator_skill.sh

set -e

SKILL_NAME="databricks-solution-builder"
SKILL_PATH=".claude/skills/$SKILL_NAME"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_SKILL="$SCRIPT_DIR/.claude/skills/$SKILL_NAME"

echo "Installing $SKILL_NAME skill..."

# Check if source skill exists (running from cloned repo)
if [ ! -d "$SOURCE_SKILL" ]; then
    echo "Error: Skill not found at $SOURCE_SKILL"
    echo "Make sure you're running this from the cloned repo root."
    exit 1
fi

# Create .claude/skills directory if it doesn't exist
mkdir -p .claude/skills

# Remove existing skill if present
if [ -d "$SKILL_PATH" ]; then
    echo "Removing existing $SKILL_NAME skill..."
    rm -rf "$SKILL_PATH"
fi

# Copy the skill
echo "Copying skill..."
cp -r "$SOURCE_SKILL" "$SKILL_PATH"

echo "✓ Installed $SKILL_NAME to $SKILL_PATH"
echo ""
echo "To use: run 'claude' and the skill will be available automatically."
