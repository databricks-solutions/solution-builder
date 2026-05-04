#!/bin/bash
# Publish (or update) the databricks-demo-generator skill in the vibe marketplace.
#
# What it does:
#   1. Resyncs `.claude/skills/databricks-demo-generator/` into the vibe checkout
#      at `plugins/fe-databricks-demo-generator/skills/databricks-demo-generator/`,
#      excluding heavy dev artifacts (node_modules, .venv, build output).
#   2. Bumps the plugin version in BOTH plugin.json and marketplace.json.
#   3. Shows the resulting diff and prompts to commit/push/PR.
#
# Usage:
#   ./scripts/publish-skill-to-vibe.sh                       # patch bump
#   ./scripts/publish-skill-to-vibe.sh --bump minor          # minor bump
#   ./scripts/publish-skill-to-vibe.sh --bump major          # major bump
#   ./scripts/publish-skill-to-vibe.sh --vibe /path/to/vibe  # custom vibe path
#   ./scripts/publish-skill-to-vibe.sh --no-push             # stop after commit
#
# Defaults:
#   vibe checkout: ../vibe (sibling of this repo)
#   bump:          patch
#
# Prereqs:
#   - vibe repo cloned at the chosen path with write access (Opal: vibe-write role)
#   - jq, git, rsync, gh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIBE_DIR="$(cd "$REPO_ROOT/.." && pwd)/vibe"
BUMP="patch"
DO_PUSH=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vibe) VIBE_DIR="$2"; shift 2 ;;
        --bump) BUMP="$2"; shift 2 ;;
        --no-push) DO_PUSH=0; shift ;;
        -h|--help) awk '/^set -euo/{exit} /^#!/{next} /^#/{sub(/^# ?/,""); print; next} /^$/{print}' "$0"; exit 0 ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# --- Sanity ---
if [[ ! -d "$VIBE_DIR/.git" ]]; then
    echo -e "${RED}ERROR: $VIBE_DIR is not a git checkout.${NC}" >&2
    echo "Clone it first: git clone https://github.com/databricks-field-eng/vibe.git $VIBE_DIR" >&2
    exit 1
fi
SKILL_SRC="$REPO_ROOT/.claude/skills/databricks-demo-generator"
PLUGIN_DIR="$VIBE_DIR/plugins/fe-databricks-demo-generator"
SKILL_DST="$PLUGIN_DIR/skills/databricks-demo-generator"
PLUGIN_JSON="$PLUGIN_DIR/.claude-plugin/plugin.json"
MARKET_JSON="$VIBE_DIR/.claude-plugin/marketplace.json"

if [[ ! -d "$SKILL_SRC" ]]; then
    echo -e "${RED}ERROR: source skill missing at $SKILL_SRC${NC}" >&2
    exit 1
fi
if [[ ! -f "$PLUGIN_JSON" ]] || [[ ! -f "$MARKET_JSON" ]]; then
    echo -e "${RED}ERROR: vibe plugin not yet scaffolded at $PLUGIN_DIR${NC}" >&2
    echo "First-time publish needs the plugin dir + plugin.json + marketplace entry created." >&2
    echo "After PR #1305 merges this script handles updates only." >&2
    exit 1
fi
for tool in jq git rsync; do
    command -v $tool >/dev/null || { echo -e "${RED}ERROR: $tool required${NC}" >&2; exit 1; }
done

# --- Make sure the vibe checkout is on a feature branch, not main ---
cd "$VIBE_DIR"
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" == "main" ]]; then
    BRANCH="update/databricks-demo-generator-$(date +%Y%m%d-%H%M%S)"
    echo -e "${YELLOW}On main; creating branch $BRANCH${NC}"
    git fetch origin main --quiet
    git checkout -b "$BRANCH" origin/main
else
    echo -e "${BLUE}Updating existing branch: $CURRENT_BRANCH${NC}"
    BRANCH="$CURRENT_BRANCH"
fi

# --- Sync skill files ---
echo -e "${BLUE}Syncing skill into $SKILL_DST${NC}"
rsync -a --delete \
    --exclude='node_modules' \
    --exclude='.venv' \
    --exclude='__pycache__' \
    --exclude='dist' \
    --exclude='.next' \
    --exclude='.pglite' \
    --exclude='.tanstack' \
    --exclude='__dist__' \
    --exclude='.DS_Store' \
    --exclude='*.pyc' \
    "$SKILL_SRC/" "$SKILL_DST/"

NEW_FILES=$(find "$SKILL_DST" -type f | wc -l | tr -d ' ')
NEW_SIZE=$(du -sh "$SKILL_DST" | awk '{print $1}')
echo "  $NEW_FILES files, $NEW_SIZE"

# --- Bump version (rolls over at 10 per CONTRIBUTING.md) ---
bump_version() {
    local current="$1" kind="$2"
    IFS=. read -r M m p <<< "$current"
    case "$kind" in
        patch)
            p=$((p + 1))
            if [[ "$p" -ge 10 ]]; then p=0; m=$((m + 1)); fi
            if [[ "$m" -ge 10 ]]; then m=0; M=$((M + 1)); fi
            ;;
        minor)
            m=$((m + 1)); p=0
            if [[ "$m" -ge 10 ]]; then m=0; M=$((M + 1)); fi
            ;;
        major)
            M=$((M + 1)); m=0; p=0
            ;;
        *) echo "invalid bump: $kind" >&2; exit 1 ;;
    esac
    echo "$M.$m.$p"
}

OLD_VERSION=$(jq -r '.version' "$PLUGIN_JSON")
NEW_VERSION=$(bump_version "$OLD_VERSION" "$BUMP")
echo -e "${BLUE}Version: $OLD_VERSION → $NEW_VERSION (bump=$BUMP)${NC}"

# Update plugin.json
tmp=$(mktemp); jq --arg v "$NEW_VERSION" '.version = $v' "$PLUGIN_JSON" > "$tmp" && mv "$tmp" "$PLUGIN_JSON"

# Update marketplace.json — find our plugin entry and bump
tmp=$(mktemp)
jq --arg v "$NEW_VERSION" \
   '(.plugins[] | select(.name == "fe-databricks-demo-generator") | .version) = $v' \
   "$MARKET_JSON" > "$tmp" && mv "$tmp" "$MARKET_JSON"

# --- Show diff ---
cd "$VIBE_DIR"
echo
echo -e "${BLUE}Changes:${NC}"
git status -s | head -20
echo
echo -e "${BLUE}First 30 lines of diff (--stat):${NC}"
git diff --stat | head -30

# --- Commit ---
read -p "Commit + push to '$BRANCH'? [y/N] " -n 1 -r REPLY
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Stopped before commit. Files are staged on disk; review and finish manually.${NC}"
    exit 0
fi

git add plugins/fe-databricks-demo-generator/ \
        .claude-plugin/marketplace.json
git commit -m "$(cat <<EOF
fe-databricks-demo-generator: skill update v$NEW_VERSION

Resync from databricks-field-eng/industry-demo-prompts main.

EOF
)"

if [[ "$DO_PUSH" == "1" ]]; then
    git push -u origin "$BRANCH" 2>&1 | tail -3
    echo
    echo -e "${GREEN}Pushed.${NC} Open a PR if needed:"
    echo "    cd $VIBE_DIR && gh pr create --fill"
else
    echo -e "${YELLOW}--no-push: branch ready locally, push manually when ready.${NC}"
fi
