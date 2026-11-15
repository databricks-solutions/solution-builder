#!/usr/bin/env bash
# Local dev only: let the bundled agent run in a local project, through a workspace's
# Foundation Model API (FMAPI) Anthropic bridge.
#
# Usage: scripts/local_agent_auth.sh <project id> <databricks profile> [model endpoint]
#
# Deployed mode writes these files itself (core/fmapi_auth.py). Locally it does not, and the
# agent's CLAUDE_CONFIG_DIR is the project's own .claude/, so it never sees your own Claude
# login. This writes the same two files deployed mode writes: get_anthropic_token.sh (here it
# mints a fresh token from the profile) and .claude/settings.json (apiKeyHelper plus the
# bridge address). Start dev.sh from a shell without ANTHROPIC_* or CLAUDE_CODE_* variables,
# or they override these settings.
#
# No python3 here: the helper runs with the project under app/projects/<id> as its working
# folder, where python3 is the uv shim that can rewrite app/uv.lock (see AGENTS.md).
# PROJECTS_BASE_DIR overrides the projects folder (default app/projects).
set -euo pipefail
ID="${1:?usage: local_agent_auth.sh <project id> <profile> [model endpoint]}"
PROFILE="${2:?usage: local_agent_auth.sh <project id> <profile> [model endpoint]}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="${3:-$(sed -n 's/^ANTHROPIC_LLM_ENDPOINT=//p' "$APP_DIR/.env" 2>/dev/null | head -1)}"
MODEL="${MODEL:-databricks-claude-sonnet-4-6}"
DIR="${PROJECTS_BASE_DIR:-$APP_DIR/projects}/$ID"
[ -d "$DIR" ] || { echo "no project folder $DIR (open the project once so its files restore)" >&2; exit 1; }

# The profile's host, from its [section] in ~/.databrickscfg, without a trailing slash.
HOST="$(awk -v want="[$PROFILE]" '
  /^[[:space:]]*\[/ { inside = ($0 == want) ; next }
  inside && /^[[:space:]]*host[[:space:]]*=/ {
    sub(/^[^=]*=[[:space:]]*/, ""); sub(/[[:space:]]+$/, ""); sub(/\/+$/, ""); print; exit
  }' "$HOME/.databrickscfg")"
[ -n "$HOST" ] || { echo "no host for profile '$PROFILE' in ~/.databrickscfg" >&2; exit 1; }

# Single-quote a value for the generated POSIX sh helper.
sh_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
# Escape a value for a JSON string.
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

HELPER="$DIR/get_anthropic_token.sh"
cat > "$HELPER" <<SH
#!/bin/sh
# Local dev only: print a fresh workspace OAuth token for the FMAPI Anthropic bridge.
databricks auth token --profile $(sh_quote "$PROFILE") | sed -n 's/.*"access_token": *"\([^"]*\)".*/\1/p'
SH
chmod 700 "$HELPER"
mkdir -p "$DIR/.claude"
cat > "$DIR/.claude/settings.json" <<JSON
{
  "apiKeyHelper": "$(json_escape "$HELPER")",
  "env": {
    "ANTHROPIC_BASE_URL": "$(json_escape "$HOST")/serving-endpoints/anthropic",
    "ANTHROPIC_MODEL": "$(json_escape "$MODEL")",
    "ANTHROPIC_CUSTOM_HEADERS": "x-databricks-use-coding-agent-mode: true",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  },
  "enableAllProjectMcpServers": false,
  "mcpServers": {}
}
JSON
chmod 600 "$DIR/.claude/settings.json"
TOKEN="$("$HELPER")"
[ -n "$TOKEN" ] || { echo "the helper printed no token; check 'databricks auth token --profile $PROFILE'" >&2; exit 1; }
echo "agent auth ready for $ID: $HOST, model $MODEL"
