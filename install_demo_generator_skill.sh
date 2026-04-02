#!/bin/bash
# Install the databricks-demo-generator skill into your local project
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/databricks-field-eng/industry-demo-prompts/main/install_demo_generator_skill.sh | bash
#
# Or clone and run locally:
#   ./install_demo_generator_skill.sh

set -e

REPO="databricks-field-eng/industry-demo-prompts"
BRANCH="main"
SKILL_NAME="databricks-demo-generator"
SKILL_PATH=".claude/skills/$SKILL_NAME"

echo "Installing $SKILL_NAME skill..."

# Create .claude/skills directory if it doesn't exist
mkdir -p .claude/skills

# Remove existing skill if present
if [ -d "$SKILL_PATH" ]; then
    echo "Removing existing $SKILL_NAME skill..."
    rm -rf "$SKILL_PATH"
fi

# Download and extract the skill folder
echo "Downloading skill from GitHub..."
curl -sL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | \
    tar -xz --strip-components=3 -C .claude/skills \
    "industry-demo-prompts-$BRANCH/.claude/skills/$SKILL_NAME"

echo "✓ Installed $SKILL_NAME to $SKILL_PATH"
echo ""
echo "To use: run 'claude' and invoke the skill with /databricks-demo-generator"
