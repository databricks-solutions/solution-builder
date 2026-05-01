#!/bin/bash
# Grant the deployed app's OAuth integration the `all-apis` scope.
#
# Why: Databricks Apps creates a custom OAuth integration per app, but only
# pre-grants `iam.current-user:read`. That's enough for the app to identify
# the signed-in user, but every other workspace API call (UC, SQL, jobs,
# Genie, dashboards, …) returns 403 — which is fatal for the demo-generator
# since the agent provisions resources on the user's behalf.
#
# Run ONCE per deployment (and again if scopes ever drift).
#
# Usage:
#   ./scripts/set-app-oauth-scopes.sh                       # uses target=prod
#   ./scripts/set-app-oauth-scopes.sh --target prod         # explicit
#   ./scripts/set-app-oauth-scopes.sh --account ACCOUNT-XXX # custom account profile
#
# Resolves the app name from databricks.<target>.yml via
# `databricks bundle summary` so it stays in sync with whatever you actually
# deployed. The account-level CLI profile (host = accounts.cloud.databricks.com)
# is auto-detected from ~/.databrickscfg, or pass --account explicitly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

TARGET="prod"
ACCOUNT_PROFILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target) TARGET="$2"; shift 2 ;;
        --account) ACCOUNT_PROFILE="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | head -n -1
            exit 0 ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

cd "$APP_DIR"

# --- 1. Resolve app name from the bundle target ----------------------------
if ! command -v jq >/dev/null 2>&1; then
    echo -e "${RED}ERROR: jq is required (brew install jq).${NC}" >&2
    exit 1
fi

# bundle summary needs .build/ to exist — trivially.
mkdir -p .build && touch .build/app.yml

APP_NAME=$(databricks bundle summary -t "$TARGET" --output json 2>/dev/null \
    | jq -r '.variables.app_name.value // empty')

if [[ -z "$APP_NAME" ]]; then
    echo -e "${RED}ERROR: could not resolve app_name from databricks.${TARGET}.yml${NC}" >&2
    echo "Did you create databricks.${TARGET}.yml from databricks.${TARGET}.yml.example?" >&2
    exit 1
fi
echo -e "${BLUE}Target:    ${NC}$TARGET"
echo -e "${BLUE}App name:  ${NC}$APP_NAME"

# --- 2. Find an account-level CLI profile ----------------------------------
# Prefer an explicit --account; otherwise look in ~/.databrickscfg for a
# section whose host starts with `https://accounts.`.
if [[ -z "$ACCOUNT_PROFILE" ]]; then
    ACCOUNT_PROFILE=$(awk '
        /^\[/ { in_section = 1; sect = $0; sub(/^\[/, "", sect); sub(/\]$/, "", sect); host=""; next }
        /^[[:space:]]*host[[:space:]]*=/ {
            sub(/^[^=]*=[[:space:]]*/, "")
            host = $0
            if (host ~ /^https:\/\/accounts\./) { print sect; exit }
        }
    ' "$HOME/.databrickscfg" 2>/dev/null || true)
fi

if [[ -z "$ACCOUNT_PROFILE" ]]; then
    echo -e "${RED}ERROR: no account-level CLI profile found in ~/.databrickscfg.${NC}" >&2
    echo "Add one or pass --account <profile-name>. To create:" >&2
    echo "    databricks auth login --host https://accounts.cloud.databricks.com --profile ACCOUNT-..." >&2
    exit 1
fi
echo -e "${BLUE}Account:   ${NC}$ACCOUNT_PROFILE"

# --- 3. Find the integration ID by name ------------------------------------
INTEGRATION_ID=$(DATABRICKS_CONFIG_PROFILE="$ACCOUNT_PROFILE" \
    databricks account custom-app-integration list --output json 2>/dev/null \
    | jq -r --arg name "$APP_NAME" '
        .[] | select(.name == $name) | .integration_id' \
    | head -1)

if [[ -z "$INTEGRATION_ID" ]]; then
    echo -e "${RED}ERROR: no custom-app-integration named '$APP_NAME' in account.${NC}" >&2
    echo "Has the app been deployed yet? Run \`databricks bundle deploy -t $TARGET\` first." >&2
    exit 1
fi
echo -e "${BLUE}Integration ID: ${NC}$INTEGRATION_ID"

# --- 4. Inspect current scopes (idempotency check) -------------------------
CURRENT_SCOPES=$(DATABRICKS_CONFIG_PROFILE="$ACCOUNT_PROFILE" \
    databricks account custom-app-integration get "$INTEGRATION_ID" --output json 2>/dev/null \
    | jq -r '.scopes | join(",")')
echo -e "${BLUE}Current scopes: ${NC}$CURRENT_SCOPES"

if echo "$CURRENT_SCOPES" | grep -q '\ball-apis\b'; then
    echo -e "${GREEN}✓ all-apis already granted — nothing to do.${NC}"
    exit 0
fi

# --- 5. Update --------------------------------------------------------------
echo -e "${YELLOW}Granting all-apis...${NC}"
DATABRICKS_CONFIG_PROFILE="$ACCOUNT_PROFILE" \
    databricks account custom-app-integration update "$INTEGRATION_ID" --json '{
        "scopes": ["openid", "profile", "email", "all-apis", "offline_access", "iam.current-user"]
    }' >/dev/null

NEW_SCOPES=$(DATABRICKS_CONFIG_PROFILE="$ACCOUNT_PROFILE" \
    databricks account custom-app-integration get "$INTEGRATION_ID" --output json 2>/dev/null \
    | jq -r '.scopes | join(",")')
echo -e "${GREEN}✓ Done.${NC} New scopes: $NEW_SCOPES"
echo
echo "Existing user sessions still hold tokens with the old narrower scope —"
echo "they need to sign out + back in (or wait for refresh) to pick up all-apis."
