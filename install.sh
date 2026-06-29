#!/usr/bin/env bash
# Databricks Solution Builder — CLI installer
#
# One-liner:
#   bash <(curl -sL https://raw.githubusercontent.com/databricks-solutions/solution-builder/main/install.sh)
#
# Installs the `databricks-demo-generator` skill into ~/.claude/skills/ (or
# ./.claude/skills/ with --project) and chains into the AI Dev Kit installer
# unless --skill-only is passed.

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
# Public location overridable for forks / private mirrors via env vars.
REPO_OWNER="${DSB_REPO_OWNER:-databricks-solutions}"
REPO_NAME="${DSB_REPO_NAME:-solution-builder}"
SKILL_NAME="databricks-demo-generator"
SKILL_SUBPATH=".claude/skills/${SKILL_NAME}"
AI_DEV_KIT_INSTALLER="https://raw.githubusercontent.com/databricks-solutions/ai-dev-kit/main/install.sh"

BRANCH="${DSB_BRANCH:-main}"
DEST_MODE="${DSB_DEST:-user}"   # "user" or "project"
INSTALL_AI_DEV_KIT=1

# ─── Colors ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    RED=$'\033[0;31m'
    GREEN=$'\033[0;32m'
    YELLOW=$'\033[1;33m'
    BLUE=$'\033[0;34m'
    CYAN=$'\033[0;36m'
    BOLD=$'\033[1m'
    NC=$'\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; NC=''
fi

info()    { printf '%s%s%s\n' "${CYAN}" "$*" "${NC}"; }
success() { printf '%s✓ %s%s\n' "${GREEN}" "$*" "${NC}"; }
warn()    { printf '%s⚠ %s%s\n' "${YELLOW}" "$*" "${NC}"; }
err()     { printf '%s✗ %s%s\n' "${RED}" "$*" "${NC}" >&2; }

# ─── Args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --project)         DEST_MODE="project"; shift ;;
        --user)            DEST_MODE="user"; shift ;;
        --skill-only|--no-ai-dev-kit)
                           INSTALL_AI_DEV_KIT=0; shift ;;
        --branch)          BRANCH="${2:-main}"; shift 2 ;;
        -h|--help)
            cat <<EOF
Databricks Solution Builder — CLI installer

Usage:
  bash <(curl -sL .../install.sh) [flags]

Flags:
  --project          Install skill into ./.claude/skills (default: ~/.claude/skills)
  --skill-only       Skip the AI Dev Kit installer
  --branch <name>    Pull skill from this branch of ${REPO_NAME} (default: main)
  -h, --help         Show this help

Env equivalents: DSB_DEST=user|project, DSB_BRANCH=<name>
EOF
            exit 0
            ;;
        *) warn "Ignoring unknown argument: $1"; shift ;;
    esac
done

# ─── Banner ───────────────────────────────────────────────────────────────────
cat <<EOF
${BLUE}╔═══════════════════════════════════════════════════════╗${NC}
${BLUE}║${NC}                                                       ${BLUE}║${NC}
${BLUE}║${NC}   ${BOLD}Databricks Solution Builder — CLI installer${NC}        ${BLUE}║${NC}
${BLUE}║${NC}                                                       ${BLUE}║${NC}
${BLUE}║${NC}   Skill:   ${GREEN}${SKILL_NAME}${NC}                  ${BLUE}║${NC}
${BLUE}║${NC}   Branch:  ${CYAN}${BRANCH}${NC}$(printf '%*s' $((40 - ${#BRANCH})) '')${BLUE}║${NC}
${BLUE}║${NC}                                                       ${BLUE}║${NC}
${BLUE}╚═══════════════════════════════════════════════════════╝${NC}

EOF

# ─── Preflight ────────────────────────────────────────────────────────────────
need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        err "Required command not found: $1"
        return 1
    fi
}

need_cmd curl || exit 1
need_cmd tar  || exit 1

if ! command -v claude >/dev/null 2>&1; then
    warn "The 'claude' CLI was not detected on PATH. Install it from https://docs.claude.com/en/docs/claude-code to use the skill after install."
fi

# ─── Destination ──────────────────────────────────────────────────────────────
case "$DEST_MODE" in
    user)
        DEST_PARENT="$HOME/.claude/skills"
        ;;
    project)
        DEST_PARENT="$(pwd)/.claude/skills"
        ;;
    *)
        err "Unknown DSB_DEST: $DEST_MODE (expected 'user' or 'project')"
        exit 1
        ;;
esac

DEST="$DEST_PARENT/$SKILL_NAME"

info "Installing skill to: $DEST"
mkdir -p "$DEST_PARENT"

# ─── Fetch skill from GitHub tarball ──────────────────────────────────────────
TMPDIR_INSTALL="$(mktemp -d -t dsb-install-XXXXXX)"
cleanup() { rm -rf "$TMPDIR_INSTALL"; }
trap cleanup EXIT

TARBALL_URL="${DSB_TARBALL_URL:-https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${BRANCH}}"
TARBALL="$TMPDIR_INSTALL/repo.tar.gz"

info "Downloading ${REPO_NAME}@${BRANCH} …"
if ! curl -fsSL "$TARBALL_URL" -o "$TARBALL"; then
    err "Failed to download tarball from $TARBALL_URL"
    err "Check that the branch '$BRANCH' exists on ${REPO_OWNER}/${REPO_NAME}."
    exit 1
fi

info "Extracting skill …"
# tar emits ${REPO_NAME}-${BRANCH}/ as its top-level dir
EXTRACT_DIR="$TMPDIR_INSTALL/extract"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL" -C "$EXTRACT_DIR" \
    "${REPO_NAME}-${BRANCH}/${SKILL_SUBPATH}" 2>/dev/null || {
        err "Skill subpath not found in tarball: ${SKILL_SUBPATH}"
        err "Repo layout may have changed on branch '${BRANCH}'."
        exit 1
    }

SRC="$EXTRACT_DIR/${REPO_NAME}-${BRANCH}/${SKILL_SUBPATH}"
if [ ! -d "$SRC" ]; then
    err "Extracted skill directory missing: $SRC"
    exit 1
fi

# Idempotent install: remove existing, then copy.
if [ -d "$DEST" ]; then
    warn "Removing existing skill at $DEST"
    rm -rf "$DEST"
fi
cp -R "$SRC" "$DEST"
success "Skill installed at $DEST"

# ─── AI Dev Kit ───────────────────────────────────────────────────────────────
if [ "$INSTALL_AI_DEV_KIT" -eq 1 ]; then
    echo
    info "Chaining into the AI Dev Kit installer …"
    echo
    if ! bash <(curl -sL "$AI_DEV_KIT_INSTALLER"); then
        warn "AI Dev Kit installer exited non-zero. The Demo Generator skill is still installed."
        warn "You can retry it later with:"
        warn "  bash <(curl -sL $AI_DEV_KIT_INSTALLER)"
    else
        success "AI Dev Kit installed"
    fi
else
    info "Skipping AI Dev Kit installer (--skill-only)."
    info "Install it later with:"
    info "  bash <(curl -sL $AI_DEV_KIT_INSTALLER)"
fi

# ─── Post-install message ─────────────────────────────────────────────────────
echo
cat <<EOF
${GREEN}${BOLD}Done.${NC}

  Skill:        ${DEST}
  Scope:        $([ "$DEST_MODE" = "user" ] && echo 'user-global (~/.claude)' || echo 'current directory (./.claude)')

${BOLD}Next steps${NC}
  1. cd into any project directory you want to work in
  2. Run: ${CYAN}claude${NC}
  3. Ask the agent to build a Databricks solution — the skill loads automatically

${BOLD}Update / reinstall${NC}
  bash <(curl -sL https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/install.sh)

EOF
