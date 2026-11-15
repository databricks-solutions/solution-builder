#!/bin/bash
# Build script — assembles everything needed for Databricks App deployment.
#
# Creates .build/ (gitignored, but bundled via sync.include in databricks.yml) with:
#   - app.yml          (Databricks App config — generated from databricks.<target>.yml's `env:` block)
#   - *.whl            (Python wheel including frontend assets, .claude/skills, initial_templates)
#   - pyproject.toml   (uv project file — pins `requires-python = ">=3.12,<3.13"` so the
#                       Apps runtime uses Python 3.12 instead of the pip default 3.11.
#                       References the wheel as a local-file dep.)
#   - uv.lock          (uv-resolved transitive deps for the above pyproject)
# Runtime data (.claude/skills/, initial_templates/) is inside the wheel —
# the App downloads ONE file instead of ~200 loose files (which used to crash
# the "downloading source code" step with a list-files timeout).
#
# Why uv (not pip + requirements.txt)? Apps' default install path uses pip on
# Python 3.11. Shipping pyproject.toml + uv.lock with NO requirements.txt
# switches Apps to uv, which honors `requires-python` and gives us 3.12.
# IMPORTANT: this only works if requirements.txt is absent from .build/ —
# Apps prefers requirements.txt when present and ignores pyproject.toml.
#
# Usage:
#   ./scripts/build.sh                   # full build, no env injection (manual run)
#   ./scripts/build.sh --skip-frontend   # skip frontend if already built
#   ./scripts/build.sh --target prod     # invoked by `databricks bundle deploy` —
#                                          generates app.yml from
#                                          databricks.prod.yml's `env:` dict.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# .build/ is intentionally NOT gitignored — the bundle CLI honors .gitignore
# when syncing, so an ignored .build/ would ship empty. Devs see it in
# `git status` after deploys; don't commit it.
BUILD_DIR="$APP_DIR/.build"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Stage timing ─────────────────────────────────────────────────────────────
# `stage "label"` prints a timestamped ▸ marker AND closes the previous stage
# with its elapsed time, so a slow step (e.g. a big rsync or the uv resolve)
# is immediately visible in the deploy log. `stage_end` closes the
# last one. Uses epoch seconds (portable macOS + Linux).
_BUILD_T0=$(date +%s)
_STAGE_T=$_BUILD_T0
_STAGE_LABEL=""
_elapsed() { local s=$1 n; n=$(date +%s); printf '%dm%02ds' $(( (n-s)/60 )) $(( (n-s)%60 )); }
stage() {
    [[ -n "$_STAGE_LABEL" ]] && echo -e "  ${GREEN}✓ ${_STAGE_LABEL} ($(_elapsed "$_STAGE_T"))${NC}"
    _STAGE_LABEL="$1"; _STAGE_T=$(date +%s)
    echo -e "${BLUE}▸ ${_STAGE_LABEL}${NC}"
}
stage_end() {
    [[ -n "$_STAGE_LABEL" ]] && echo -e "  ${GREEN}✓ ${_STAGE_LABEL} ($(_elapsed "$_STAGE_T"))${NC}"
    _STAGE_LABEL=""
    echo -e "${GREEN}✓ build.sh total: $(_elapsed "$_BUILD_T0")${NC}"
}
# On failure, name the stage we died in (the real EXIT trap that also cleans the
# staged dirs is installed later — it calls this). Kept as a function so we don't
# register a second `trap ... EXIT` (that would REPLACE the cleanup trap below).
_report_stage_failure() {
    local rc=$1
    if [[ $rc -ne 0 && -n "$_STAGE_LABEL" ]]; then
        echo -e "  ✗ FAILED during: ${_STAGE_LABEL} (after $(_elapsed "$_STAGE_T"))" >&2
    fi
    # MUST return 0: this runs inside the EXIT trap on the SUCCESS path too. A
    # bare trailing `[[ … ]] && …` returns the test's status (1 when false), and
    # under `set -e` + the trap that turned a successful build into `exit 1`
    # (the DAB CLI then reported "build failed"). Never let this leak non-zero.
    return 0
}

cd "$APP_DIR"

# Parse args. --target is passed by the bundle artifact build (databricks.yml)
# so we can ask the bundle CLI for the resolved target.<target>.env dict and
# write it straight into .build/app.yml.
SKIP_FRONTEND=""
TARGET=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-frontend) SKIP_FRONTEND=1; shift ;;
        --target) TARGET="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# --- 1. Build frontend ---
stage "[1/4] frontend (bun install + vite build)"
if [[ -z "$SKIP_FRONTEND" ]]; then
    if [[ ! -d node_modules ]]; then
        echo -e "${BLUE}[1/4] Installing frontend dependencies (bun install)...${NC}"
        # In CI (GitHub Actions sets CI=true) install FROZEN so a preview/deploy build
        # can't silently drift from bun.lock; local dev stays flexible. ${CI:+...} adds
        # the flag only when CI is set.
        bun install ${CI:+--frozen-lockfile}
    fi
    echo -e "${BLUE}[1/4] Building frontend...${NC}"
    bun run --cwd "$APP_DIR" vite build --config vite.config.ts
else
    echo -e "${BLUE}[1/4] Skipping frontend build (--skip-frontend)${NC}"
fi

# Verify frontend output exists
if [[ ! -f "src/demo_prompt_generator/__dist__/index.html" ]]; then
    echo "ERROR: Frontend build output not found at src/demo_prompt_generator/__dist__/index.html"
    exit 1
fi

# Drop the heavy vendored microsite architecture SVGs (~5 MB each) from the
# wheel. They push the wheel over the Apps source-export 10 MB per-file cap
# (which makes `bundle run` fail), and the microsites render fine without the
# static SVG. Best-effort — the microsites' index.html/app.js remain.
for _svg in \
    "src/demo_prompt_generator/__dist__/architecture.svg" \
    "src/demo_prompt_generator/__dist__/shift-left/architecture.svg"; do
    [[ -f "$_svg" ]] && rm -f "$_svg" && echo "  Stripped $_svg from the wheel"
done

# --- 2. Stage runtime data INTO the package source tree (paths mirror dev) ---
# The wheel ships .claude/, initial_templates/, and databricks_agent_skill/ INSIDE
# src/demo_prompt_generator/ so paths inside the installed package match the
# dev-tree layout exactly — backend resolvers can use one Path expression for
# both modes (editable install walks up to repo, wheel install reads from the
# package). Shipping these as loose workspace files crashed the App's source
# download with a list-files timeout; bundling into the wheel = one big file.
PKG_DIR="src/demo_prompt_generator"
stage "[2/4] stage runtime data into the wheel (.claude/skills, agent skills)"
echo -e "${BLUE}[2/4] Staging runtime data inside $PKG_DIR/...${NC}"
# Always clean up after build so dev iteration doesn't accumulate (and so
# `git status` stays clean even if the build fails partway through).
# `bin/` is excluded from cleanup so a cached CLI binary survives across
# back-to-back builds (the version-check below skips re-download when fresh).
trap 'rc=$?; _report_stage_failure "$rc"; rm -rf "$PKG_DIR/.claude" "$PKG_DIR/initial_templates" "$PKG_DIR/databricks_agent_skill"; exit $rc' EXIT
rm -rf "$PKG_DIR/.claude" "$PKG_DIR/initial_templates" "$PKG_DIR/databricks_agent_skill"

# NOTE: We do NOT ship the Databricks CLI inside the wheel — the App's
# bundle-source export path has a 10 MB per-file cap and the CLI binary
# alone is ~13 MB compressed. Instead, start.sh downloads + caches it
# at container boot. See app/start.sh.

# .claude/skills/databricks-solution-builder/ — the solution-builder skill itself.
if [[ -d "../.claude/skills/databricks-solution-builder" ]]; then
    mkdir -p "$PKG_DIR/.claude/skills"
    rsync -a \
        --exclude='node_modules' \
        --exclude='.venv' \
        --exclude='__pycache__' \
        --exclude='dist' \
        --exclude='.next' \
        --exclude='.pglite' \
        --exclude='.tanstack' \
        --exclude='__dist__' \
        "../.claude/skills/databricks-solution-builder/" \
        "$PKG_DIR/.claude/skills/databricks-solution-builder/"

fi

# .claude/skills/databricks-architecture/ — the architecture-diagram skill the
# solution-builder SKILL.md points the agent at (flat nodes/edges schema +
# component catalog + reference diagrams). skills_manager copies it into every
# project (renderer/ excluded there), so the wheel must ship it. renderer/ IS
# included in the wheel: the backend serves architecture-editor.html for the
# app's "Download standalone HTML" export (~5MB wheel cost).
if [[ -d "../.claude/skills/databricks-architecture" ]]; then
    mkdir -p "$PKG_DIR/.claude/skills"
    rsync -a \
        --exclude='node_modules' \
        --exclude='__pycache__' \
        "../.claude/skills/databricks-architecture/" \
        "$PKG_DIR/.claude/skills/databricks-architecture/"
fi

# initial_templates/ — pre-authored seed templates.
# NOT shipped inside the wheel (they were ~5 MB, pushing the wheel over the Apps
# 10 MB per-file source-export cap). Instead, the assemble step below zips EACH
# template folder into .build/initial_templates_zips/<slug>.zip. Those small
# per-template zips ship alongside the wheel (synced via databricks.yml); the
# workspace AUTO-EXPANDS each .zip on upload, so the container gets already-
# unzipped folders the seeder walks (rglob manifest.json). Per-template zips (not
# one big file) stay under the cap and keep the upload to ~a dozen files.
#
# We zip DIRECTLY from ../initial_templates with `zip -x` excludes (see
# _zip_template below) — no pre-copy. A template `npm ci`/`npm install` leaves an
# ~855 MB node_modules (≈690K tiny files); with 8 workshop apps that's ~6.8 GB.
# The old approach `cp -r`'d the whole tree to a temp dir THEN deleted the junk,
# so it copied all 6.8 GB first and stalled the deploy for minutes on "Building
# default…". Zipping straight from source + skipping junk during the walk avoids
# the copy entirely. Exclude set mirrors seed_templates._should_include_in_template.
#
# _TEMPLATE_JUNK_DIRS is excluded at BOTH the template root (`<rel>/<junk>/*`) AND
# nested (`<rel>/*/<junk>/*`) — a single `<rel>/*/<junk>/*` pattern MISSES a junk
# dir sitting directly under the template root (e.g. `<tpl>/.databricks/`), which
# leaked .databricks/node_modules into the archives. _zip_template expands both
# depths per dir (see below). File globs are excluded as-is (match at any depth).
TEMPLATES_SRC=""
# Kept in lockstep with template_service.JUNK_DIRS (the seeder's exclude-list) so
# a build/CI host that ran the templates' vitest/playwright suites doesn't zip
# test-results/ + playwright-report/ (multi-MB traces/PNGs) or raw_data/ into the
# archives only for the seeder to discard them — which would re-bloat exactly what
# this shipping change shrinks. If JUNK_DIRS changes, change this too.
_TEMPLATE_JUNK_DIRS=(
    .claude node_modules .venv venv __pycache__ .databricks
    dist build .git .pytest_cache .mypy_cache .ruff_cache
    test-results playwright-report raw_data .turbo .next
)
# File globs excluded at any depth. Bare (un-prefixed) names would be dead —
# stored zip paths are always "<rel>/…", so only the "*/…" forms can ever match.
_TEMPLATE_JUNK_FILES=('*.pyc' '*/.env' '*/.env.*' '*/.preview.*' '*/.DS_Store')
if [[ -d "../initial_templates" ]]; then
    TEMPLATES_SRC="$(cd ../initial_templates && pwd)"
fi

# databricks_agent_skill/ — clone the Databricks Agent Skills repo (same branch dev.sh uses)
# so the deployed app has the skill catalog without runtime cloning. Dir name
# kept as databricks_agent_skill/ for path stability. Frozen with the wheel; redeploy to update.
DAS_REPO="https://github.com/databricks/databricks-agent-skills.git"
DAS_BRANCH="${DAS_BRANCH:-${DATABRICKS_AGENT_SKILL_BRANCH:-main}}"
if [[ ! -d "$PKG_DIR/databricks_agent_skill" ]]; then
    if [[ -d "databricks_agent_skill/.git" ]]; then
        # Fast path: copy the locally cloned repo (already on the right branch
        # from dev.sh). Avoids a network fetch per build.
        echo "  Bundling databricks_agent_skill from local clone (branch $(cd databricks_agent_skill && git branch --show-current))"
        rsync -a --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
            "databricks_agent_skill/" "$PKG_DIR/databricks_agent_skill/"
    else
        echo "  Cloning databricks-agent-skills ($DAS_REPO branch $DAS_BRANCH) into wheel..."
        git clone --depth 1 --branch "$DAS_BRANCH" "$DAS_REPO" "$PKG_DIR/databricks_agent_skill"
        rm -rf "$PKG_DIR/databricks_agent_skill/.git"
    fi

    # Prune DAS to ONLY what the app reads (skills_manager: `skills/*` +
    # `experimental/databricks-genie`). The repo also ships a `plugins/databricks/`
    # tree that duplicates every skill 4x (claude/cursor/copilot/codex, ~13 MB)
    # plus commands/hooks/assets/docs — none of which the app uses, and which
    # blew the wheel past the Apps 10 MB source-export cap. Keep skills/ +
    # experimental/, drop the rest.
    if [[ -d "$PKG_DIR/databricks_agent_skill" ]]; then
        find "$PKG_DIR/databricks_agent_skill" -mindepth 1 -maxdepth 1 \
            ! -name "skills" ! -name "experimental" \
            -exec rm -rf {} + 2>/dev/null || true
        echo "  Pruned databricks_agent_skill to skills/ + experimental/ (dropped plugins/, commands/, etc.)"
    fi

    # Prune ai_dev_kit down to ONLY what the deployed app reads at runtime:
    # `skills/*` + `experimental/databricks-genie` (see backend
    # skills_manager._iter_source_skill_dirs). The full DAS repo ships a heavy
    # `plugins/` tree (~11 MB) plus build scripts + other experimental skills
    # that the generator never loads — and they push the wheel past the Apps
    # source-export 10 MB per-file cap, which makes `bundle run` fail. Keep the
    # genie experimental skill, drop everything else under experimental/.
    if [[ -d "$PKG_DIR/ai_dev_kit" ]]; then
        find "$PKG_DIR/ai_dev_kit" -maxdepth 1 -mindepth 1 \
            ! -name 'skills' ! -name 'experimental' -exec rm -rf {} +
        if [[ -d "$PKG_DIR/ai_dev_kit/experimental" ]]; then
            find "$PKG_DIR/ai_dev_kit/experimental" -maxdepth 1 -mindepth 1 \
                ! -name 'databricks-genie' -exec rm -rf {} +
        fi
        echo "  Pruned ai_dev_kit to skills/ + experimental/databricks-genie ($(du -sh "$PKG_DIR/ai_dev_kit" 2>/dev/null | cut -f1))"
    fi
fi

# --- Build Python wheel ---
stage "[2/4] build Python wheel (uv build)"
echo -e "${BLUE}[2/4] Building Python wheel...${NC}"
rm -f dist/*.whl
uv build --wheel --out-dir dist/

WHEEL=$(ls -t dist/*.whl 2>/dev/null | head -1)
if [[ -z "$WHEEL" ]]; then
    echo "ERROR: No wheel found in dist/"
    exit 1
fi

# Repack the wheel with a unique build-timestamped version so the app runtime
# always reinstalls (pip skips when the metadata version matches an existing install)
BUILD_TS=$(date +%Y%m%d%H%M%S)
WHL_TMPDIR=$(mktemp -d)
unzip -q "$WHEEL" -d "$WHL_TMPDIR"
# Find dist-info directory and patch version in METADATA
DIST_INFO=$(find "$WHL_TMPDIR" -maxdepth 1 -type d -name "*.dist-info")
sed -i '' "s/^Version: .*/Version: 0.1.0.dev${BUILD_TS}/" "$DIST_INFO/METADATA"
# Clear hash for modified METADATA in RECORD
METADATA_REL=$(basename "$DIST_INFO")/METADATA
sed -i '' "s|${METADATA_REL},sha256=[^,]*,[0-9]*|${METADATA_REL},,|" "$DIST_INFO/RECORD"
# Rename dist-info to match new version
NEW_DIST_INFO="$WHL_TMPDIR/demo_prompt_generator-0.1.0.dev${BUILD_TS}.dist-info"
mv "$DIST_INFO" "$NEW_DIST_INFO"
# Repack
NEW_WHL="dist/demo_prompt_generator-0.1.0.dev${BUILD_TS}-py3-none-any.whl"
(cd "$WHL_TMPDIR" && zip -qr - .) > "$NEW_WHL"
rm -rf "$WHL_TMPDIR" "$WHEEL"
WHEEL="$NEW_WHL"
echo "  Wheel: $(basename "$WHEEL")"

# --- 3. Generate pyproject.toml + uv.lock for the deployed app ---
stage "[3/4] resolve deploy deps (uv lock — often the slow one)"
echo -e "${BLUE}[3/4] Generating pyproject.toml + uv.lock for deploy...${NC}"
WHEEL_BASENAME=$(basename "$WHEEL")
# We ship a MINIMAL pyproject in .build/ that declares only the local wheel
# as a dep — uv resolves the wheel's full dependency tree automatically when
# it locks. This keeps the deployed-image pyproject decoupled from the dev
# pyproject's [tool.*] sections (uv-workspace, hatch build hooks, etc.) which
# don't apply at runtime.
mkdir -p dist/uv-stage
cat > dist/uv-stage/pyproject.toml <<EOF
[project]
name = "demo-prompt-generator-deploy"
version = "0.0.0"
# Pin the runtime to Python 3.12. Without this Apps' uv install picks 3.11
# (its hardcoded default for older lockfiles); 3.11 is fine but a few of our
# transitive deps ship 3.12-only optimisations and we want to track main.
requires-python = ">=3.12,<3.13"
dependencies = [
    "demo-prompt-generator",
]

# Tell uv to satisfy demo-prompt-generator from the local wheel that ships
# alongside this pyproject.toml. uv requires \`file:\` URLs for path deps in
# [tool.uv.sources]; the leading "./" makes it relative to this file.
[tool.uv.sources]
demo-prompt-generator = { path = "./${WHEEL_BASENAME}" }
EOF
# Lock against this minimal pyproject. The wheel must be present in the same
# dir for uv's file:// reference to resolve.
#
# Resolve against public PyPI regardless of the developer's global uv config.
cp "$WHEEL" "dist/uv-stage/"
(cd dist/uv-stage && UV_INDEX_URL="https://pypi.org/simple/" \
    uv lock --quiet --no-config)


# --- 4. Assemble $BUILD_DIR ---
stage "[4/4] assemble .build (wheel + zip templates + app.yml + start.sh)"
echo -e "${BLUE}[4/4] Assembling $BUILD_DIR ...${NC}"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp "$WHEEL" "$BUILD_DIR/"
cp dist/uv-stage/pyproject.toml "$BUILD_DIR/"
cp dist/uv-stage/uv.lock "$BUILD_DIR/"

# Archive each seed template folder into .build/initial_templates_zips/<slug>.tmpl.
# These ship alongside the wheel (databricks.yml sync); start.sh UNZIPS them into
# the runtime templates dir on boot and the seeder walks that (rglob manifest.json).
# Keeps them out of the wheel (~5 MB, over the Apps 10 MB source-export cap).
#
# ⚠️ The `.tmpl` extension is deliberate (they ARE zip archives). The Databricks
# workspace file-import AUTO-EXPANDS anything named `*.zip` on upload → the
# deployed container would then hold each template as THOUSANDS of loose expanded
# files, and the Apps "Downloading source code" deploy phase copies those
# file-by-file (~9 min for 16 templates). A non-`.zip` extension uploads as ONE
# opaque file per template (~16 files total) → the source copy is near-instant;
# start.sh unzips them locally in the container (milliseconds). `.tmpl` also dodges
# template_service._should_include_in_template's JUNK_EXTS (which drops `.zip`).
# DO NOT rename these back to `.zip`.
#
# ONE ARCHIVE PER *LEAF* TEMPLATE, not per top-level folder. A top-level dir that
# is a CONTAINER of templates (sub-folders with their own manifest.json but none
# of its own — e.g. `training_template/<7 workshop demos>`) is archived per
# sub-folder, so each stays small. Seed discovery recurses, so N small archives ==
# the same N templates as one big one.
if [[ -n "${TEMPLATES_SRC:-}" && -d "$TEMPLATES_SRC" ]]; then
    ZIP_DIR="$BUILD_DIR/initial_templates_zips"
    mkdir -p "$ZIP_DIR"
    _zipped=0
    # Archive the folder $1 (relative to $TEMPLATES_SRC) DIRECTLY from source. We
    # `cd` INTO initial_templates and zip "$_rel" so the STORED paths are
    # "<rel>/…" (NOT "initial_templates/<rel>/…") — start.sh unzips each archive
    # under initial_templates_zips/, and the seeder expects
    # initial_templates_zips/<rel>/… (an extra initial_templates/ level would
    # mis-nest them). `zip -x <patterns>` skips node_modules/.venv/etc. during the
    # walk — so we never touch that bulk (no pre-copy). Patterns are relative to
    # the `cd` root, hence the "<rel>/…" prefix on each exclude.
    _zip_template() {
        local _rel="$1"
        local _name="${_rel//\//__}"   # nested rel path → flat, collision-free name
        # Build the -x list: each junk DIR at both the template root AND nested,
        # plus the file globs. (A lone `<rel>/*/<junk>/*` misses a junk dir sitting
        # directly under the template root — that's what leaked .databricks.)
        local _ex=() _j
        for _j in "${_TEMPLATE_JUNK_DIRS[@]}"; do
            _ex+=("$_rel/$_j/*" "$_rel/*/$_j/*")
        done
        _ex+=("${_TEMPLATE_JUNK_FILES[@]}")
        (cd "$TEMPLATES_SRC" && zip -q -r "$ZIP_DIR/$_name.tmpl" "$_rel" -x "${_ex[@]}")
        _zipped=$((_zipped + 1))
    }
    for _tpl in "$TEMPLATES_SRC"/*/; do
        [[ -d "$_tpl" ]] || continue
        _slug="$(basename "$_tpl")"
        if [[ -f "$_tpl/manifest.json" ]]; then
            # Leaf template (its own manifest) → one zip.
            _zip_template "$_slug"
        else
            # Container of templates → one zip per sub-folder that has a manifest.
            for _sub in "$_tpl"*/; do
                [[ -d "$_sub" && -f "$_sub/manifest.json" ]] || continue
                _zip_template "$_slug/$(basename "$_sub")"
            done
        fi
    done
    echo "  Packaged $_zipped template zip(s) into $ZIP_DIR/"
fi
# Belt-and-braces: ensure no stale requirements.txt sneaks into the upload.
# Apps prefers requirements.txt when present and would silently fall back to
# pip + Python 3.11, defeating this whole step.
rm -f "$BUILD_DIR/requirements.txt"
# Startup wrapper — downloads the Databricks CLI at container boot, puts
# it on PATH, then exec's uvicorn. See app/start.sh.
#
# Resolve the latest CLI release at build time and substitute it into the
# DBCLI_VERSION line before copying. Each deploy thus pins to whatever was
# latest at build time (predictable per-deploy, not per-cold-start). Falls
# back to whatever value start.sh has hardcoded if the GitHub API is
# unreachable.
LATEST_CLI=$(curl -fsSL https://api.github.com/repos/databricks/cli/releases/latest 2>/dev/null \
    | jq -r '.tag_name' 2>/dev/null \
    | sed 's/^v//' || true)
if [[ -n "$LATEST_CLI" && "$LATEST_CLI" != "null" ]]; then
    echo "  Latest Databricks CLI: v$LATEST_CLI (pinning into start.sh)"
    sed "s/^DBCLI_VERSION=.*/DBCLI_VERSION=\"$LATEST_CLI\"/" start.sh > "$BUILD_DIR/start.sh"
else
    FALLBACK_CLI=$(grep '^DBCLI_VERSION=' start.sh | sed 's/.*"\(.*\)".*/\1/')
    echo "  WARNING: could not resolve latest CLI from GitHub — falling back to v${FALLBACK_CLI:-unknown} hardcoded in app/start.sh" >&2
    cp start.sh "$BUILD_DIR/"
fi
chmod +x "$BUILD_DIR/start.sh"

# Generate $BUILD_DIR/app.yml from databricks.<target>.yml's `env:` dict.
# `command:` runs start.sh (NOT uvicorn directly) so we can prepend the
# bundled CLI's bin dir to PATH. When --target is passed (bundle artifact
# build), we ask the CLI for the resolved target.env and dump it 1:1 into
# app.yml. When invoked by hand, we write a minimal app.yml without env
# vars — the real `databricks bundle deploy` invocation reruns this with
# --target.
{
    echo "# --workers must stay at 1: ActiveStreamManager is a per-process singleton."
    echo "# start.sh prepends the bundled databricks CLI to PATH, then exec's uvicorn."
    echo "# Apps' uv install path puts source under /app/deployments/<id>/ (changes"
    echo "# per deployment) and sets cwd there, so a relative path is portable."
    echo 'command: ["bash", "start.sh"]'
} > "$BUILD_DIR/app.yml"

if [[ -n "$TARGET" ]]; then
    echo "  Generating $BUILD_DIR/app.yml env from databricks.${TARGET}.yml..."
    if ! command -v jq >/dev/null 2>&1; then
        echo "ERROR: jq is required to generate app.yml from the bundle target." >&2
        echo "  Install via: brew install jq  (or apt/yum equivalent)" >&2
        exit 1
    fi
    # `databricks bundle summary --output json` returns the resolved bundle
    # (vars substituted, includes merged). We pull the `app_env` complex var
    # — that's where databricks.<target>.yml puts the runtime env dict — and
    # emit it as YAML list-of-{name,value} entries for app.yml's `env:` block.
    # Why a complex var (instead of `targets.<t>.env`)? `env` isn't a recognized
    # bundle target field; the CLI drops it from the resolved summary. A complex
    # var IS first-class, gets var substitution applied, and round-trips cleanly.
    # Profile: when invoked by `databricks bundle deploy -p <profile>`, the CLI
    # exports DATABRICKS_CONFIG_PROFILE to this build subprocess. Pass it through
    # explicitly so `bundle summary` resolves against the SAME workspace the
    # deploy targets — NOT the developer's DEFAULT profile (which may point at a
    # different workspace and yield an empty/wrong app_env, silently shipping an
    # app.yml with no env block).
    PROFILE_ARG=()
    if [[ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]]; then
        PROFILE_ARG=(-p "$DATABRICKS_CONFIG_PROFILE")
    fi
    # Do NOT swallow errors here: a failed `bundle summary` must fail the build
    # loudly rather than produce an empty env block. Capture stderr for the log.
    # NOTE: expand PROFILE_ARG with the `${arr[@]+"${arr[@]}"}` guard — under
    # `set -u` (set at the top), a bare `"${PROFILE_ARG[@]}"` on an EMPTY array
    # raises "unbound variable" on bash 3.2 (macOS's stock /bin/bash), which
    # would abort a local build run without DATABRICKS_CONFIG_PROFILE set.
    SUMMARY_JSON=$(databricks bundle summary -t "$TARGET" ${PROFILE_ARG[@]+"${PROFILE_ARG[@]}"} --output json) || {
        echo "ERROR: 'databricks bundle summary -t $TARGET ${PROFILE_ARG[*]-}' failed — cannot generate app.yml env." >&2
        exit 1
    }
    ENV_YAML=$(printf '%s' "$SUMMARY_JSON" | jq -r '
            (.variables.app_env.value // {})
            | to_entries
            | map("  - name: \"\(.key)\"\n    value: \"\(.value)\"")
            | join("\n")
        ')
    if [[ -n "$ENV_YAML" ]]; then
        printf "env:\n%s\n" "$ENV_YAML" >> "$BUILD_DIR/app.yml"
        # Show WHICH vars were injected (keys only — NEVER the values). The
        # app_env block carries secrets (SP client secret, tokens); echoing
        # `value:` here leaked them to the deploy console/logs. Keys alone still
        # let you spot a missing var; the values live in .build/app.yml.
        printf '%s' "$SUMMARY_JSON" | jq -r '
            (.variables.app_env.value // {}) | keys[] | "    - \(.)"'
    else
        echo "ERROR: variables.app_env resolved EMPTY for target '$TARGET' — refusing to ship an app.yml with no env block." >&2
        exit 1
    fi
fi

# NOTE: .claude/skills/ and initial_templates/ are NOT shipped here as loose
# files — they're inside the wheel (staged into src/demo_prompt_generator/_runtime_data/
# in step [2]). The App downloads a single wheel; the backend reads runtime data
# via importlib.resources. Shipping them as ~200 loose workspace files used to
# crash the App's "downloading source code" step with a list-files timeout.

# Wipe stale files in the workspace deploy dir before the bundle re-uploads.
# Bundle sync is ADDITIVE — files removed locally still linger in the workspace
# from prior deploys. We purge here so what lands matches `.build/` exactly.
# Only runs when --target is set (i.e. invoked by `databricks bundle deploy`),
# since manual `./scripts/build.sh` runs don't touch the workspace.
if [[ -n "$TARGET" ]]; then
    REMOTE_FILES=$(databricks bundle summary -t "$TARGET" --output json 2>/dev/null \
        | jq -r '.workspace.file_path // empty')
    if [[ -n "$REMOTE_FILES" ]]; then
        echo "  Wiping stale remote files at $REMOTE_FILES/.build"
        # `|| true` because the dir may not exist on first deploy.
        databricks workspace delete --recursive "$REMOTE_FILES/.build" 2>/dev/null || true
    fi
fi

stage_end
echo -e "${GREEN}Build complete!${NC}"
echo -e "  ${BLUE}$BUILD_DIR${NC}"
ls -lh "$BUILD_DIR/"

# The "Next: deploy" hint is only meaningful for a MANUAL standalone build.
# When --target is set we were invoked INSIDE `bundle deploy` (it's already
# deploying), so printing "run deploy next" is confusing — skip it.
if [[ -z "$TARGET" ]]; then
    echo ""
    # NOTE: this only built .build/ locally — nothing was deployed.
    echo -e "Next (nothing deployed yet — this only built .build/):"
    echo -e "  ${BLUE}databricks bundle deploy -t <target>${NC}"
    echo -e "  ${BLUE}databricks bundle run demo-prompt-generator-app -t <target>${NC}"
fi
