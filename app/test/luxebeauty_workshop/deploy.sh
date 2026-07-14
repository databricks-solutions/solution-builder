#!/usr/bin/env bash
# ============================================================================
# LuxeBeauty Workshop — deploy script (dogfood/test).
# ============================================================================
# Mirrors the app_template_test workflow, but for the WORKSHOP variant: instead
# of building the whole demo, it just (1) generates the raw parquet into a UC
# Volume and (2) uploads the 3 workshop notebooks to a workspace folder. The SA
# then builds silver/gold + dashboard + Genie LIVE by pasting the notebooks'
# Genie Code prompts — that's the point of the workshop.
#
# Usage:
#   ./deploy.sh                 # defaults below (WEST, luxebeauty_workshop schema)
#   PROFILE=WEST CATALOG=… SCHEMA=… ./deploy.sh
# ============================================================================
set -euo pipefail

PROFILE="${PROFILE:-WEST}"
CATALOG="${CATALOG:-retail_consumer_goods}"
SCHEMA="${SCHEMA:-luxebeauty_workshop}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src"

# Workspace folder the notebooks land in (per-user).
USER_EMAIL="$(databricks current-user me -p "$PROFILE" --output json | python3 -c 'import sys,json;print(json.load(sys.stdin)["userName"])')"
WS_DIR="/Workspace/Users/${USER_EMAIL}/luxebeauty_workshop"

echo "▶ profile=$PROFILE  target=$CATALOG.$SCHEMA  ws=$WS_DIR"

# ── 1. Schema + Volume ──────────────────────────────────────────────────────
echo "▶ [1/3] ensuring schema + raw_data volume …"
databricks sql query -p "$PROFILE" --query \
  "CREATE SCHEMA IF NOT EXISTS ${CATALOG}.${SCHEMA}; CREATE VOLUME IF NOT EXISTS ${CATALOG}.${SCHEMA}.raw_data;" \
  2>/dev/null || {
    # Fallback if `databricks sql query` isn't available on this CLI build:
    echo "  (sql query CLI unavailable — the data-gen script creates schema+volume itself)"
  }

# ── 2. Generate raw data → Volume ───────────────────────────────────────────
echo "▶ [2/3] generating raw parquet → /Volumes/${CATALOG}/${SCHEMA}/raw_data/ …"
DATABRICKS_CONFIG_PROFILE="$PROFILE" DEMO_CATALOG="$CATALOG" DEMO_SCHEMA="$SCHEMA" \
  python3 "$SRC/data_generation/generate_data.py"

# ── 3. Upload the workshop notebooks (intro hub + 5 steps) ──────────────────
echo "▶ [3/3] uploading notebooks → $WS_DIR …"
databricks workspace mkdirs "$WS_DIR" -p "$PROFILE" 2>/dev/null || true
# Upload every notebook in notebooks/ so the intro's $./ cross-links resolve.
for f in "$SRC"/notebooks/*.py; do
  nb="$(basename "$f" .py)"
  databricks workspace import "$WS_DIR/$nb" \
    --file "$f" --format SOURCE --language PYTHON --overwrite -p "$PROFILE"
  echo "  ✓ $nb"
done
# Ship CONTEXT.md alongside so the Assistant can read it from the workspace.
databricks workspace import "$WS_DIR/CONTEXT.md" --file "$SRC/CONTEXT.md" \
  --format RAW --overwrite -p "$PROFILE" 2>/dev/null || true

HOST="$(python3 -c "import configparser,os; c=configparser.ConfigParser(); c.read(os.path.expanduser('~/.databrickscfg')); print(c['$PROFILE'].get('host','').rstrip('/'))" 2>/dev/null || true)"
echo ""
echo "✅ done. Open the introduction to start the workshop:"
# Databricks opens a notebook by path via /#workspace<full-path>.
echo "   ${HOST}/#workspace${WS_DIR}/00_introduction"
echo "   raw data: /Volumes/${CATALOG}/${SCHEMA}/raw_data/"
