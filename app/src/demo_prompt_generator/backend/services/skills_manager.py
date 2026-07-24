"""
Skills manager for managing skills in projects.

Workflow:
1. On app startup: Databricks Agent Skills (DAS) is cloned/updated by dev.sh or build-electron.sh
2. On project creation: Copy solution-builder + default skills to .claude/skills/
3. Skills folder is IGNORED from watchdog sync (managed here only)
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Configuration
# The Databricks Agent Skills (DAS) repo is cloned by:
#   - dev.sh (clones into ./ai_dev_kit/ for editable dev)
#   - scripts/build.sh (clones into the wheel under demo_prompt_generator/ai_dev_kit/)
# (The clone dir is still named `ai_dev_kit/` for path stability; its CONTENTS are
# now github.com/databricks/databricks-agent-skills.) Resolution order (first hit
# wins): explicit AI_DEV_KIT_PATH env var, wheel-bundled path inside the installed
# package, then ./ai_dev_kit/ relative to cwd (dev.sh setup).
def _resolve_ai_dev_kit_local() -> str:
    explicit = os.getenv("AI_DEV_KIT_PATH")
    if explicit:
        return explicit
    bundled = Path(__file__).parent.parent.parent / "ai_dev_kit"
    if bundled.exists():
        return str(bundled)
    return "./ai_dev_kit"

AI_DEV_KIT_LOCAL = _resolve_ai_dev_kit_local()
PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Skill dirs from the DAS repo that we never copy into a project.
#
# - TEMPLATE: scaffolding/stub entry, not a real skill.
# - databricks-apps-python: generic AppKit/Streamlit/Dash/Gradio/Flask
#   Python-app skill. Our app flow is Node/React/FastAPI via
#   `app_template` + `app.md` — if this skill is in the project, build
#   subagents tend to default to Streamlit/Python frameworks, which
#   conflicts with the template. Excluded.
# - databricks-apps: the generic Databricks Apps skill — same concern as
#   databricks-apps-python (steers app-build subagents away from our
#   app_template + app.md Node/React/FastAPI flow). Excluded.
# - databricks-lakebase-provisioned: legacy name; we use branch-based
#   Lakebase via app.md's own provisioning flow (databricks-lakebase).
#   Kept here as a no-op guard in case the name reappears.
EXCLUDE_SKILLS: set[str] = {
    "TEMPLATE",
    "databricks-apps-python",
    "databricks-apps",
    "databricks-lakebase-provisioned",
}


def _iter_source_skill_dirs() -> list[Path]:
    """Every skill directory the DAS repo exposes to the generator, from BOTH
    roots the new repo (github.com/databricks/databricks-agent-skills) uses:
      - `skills/*` — the GA per-resource skills.
      - `experimental/databricks-genie` — the one experimental skill we ship.
    Returns the source dirs (excluded names + non-dirs filtered out here);
    callers still check for a SKILL.md. Missing roots are skipped silently."""
    root = Path(AI_DEV_KIT_LOCAL)
    dirs: list[Path] = []
    skills_dir = root / "skills"
    if skills_dir.exists():
        dirs.extend(sorted(p for p in skills_dir.iterdir() if p.is_dir()))
    genie = root / "experimental" / "databricks-genie"
    if genie.is_dir():
        dirs.append(genie)
    return [d for d in dirs if d.name not in EXCLUDE_SKILLS]


def get_available_skills() -> list[dict]:
    """
    Get list of available skills from the Databricks Agent Skills (DAS) repo.

    Returns:
        List of {name, description, path, dir_name} dicts
    """
    source_dirs = _iter_source_skill_dirs()
    if not source_dirs:
        logger.warning("Skills directory not found")
        return []

    skills = []
    for skill_path in source_dirs:
        skill_md = skill_path / "SKILL.md"
        if not skill_md.exists():
            continue

        # Parse frontmatter for name/description
        try:
            content = skill_md.read_text()
            name, description = _parse_skill_frontmatter(content)
            if name:
                skills.append({
                    "name": name,
                    "description": description or "",
                    "path": str(skill_path),
                    "dir_name": skill_path.name,
                })
        except Exception as e:
            logger.warning(f"Failed to parse skill {skill_path.name}: {e}")

    return skills


def _parse_skill_frontmatter(content: str) -> tuple[Optional[str], Optional[str]]:
    """Parse name and description from SKILL.md frontmatter."""
    if not content.startswith("---"):
        return None, None

    end_idx = content.find("---", 3)
    if end_idx < 0:
        return None, None

    frontmatter = content[3:end_idx]
    name = None
    description = None

    for line in frontmatter.split("\n"):
        if line.startswith("name:"):
            name = line.split(":", 1)[1].strip().strip("\"'")
        elif line.startswith("description:"):
            description = line.split(":", 1)[1].strip().strip("\"'")

    return name, description


def _find_repo_root() -> Optional[Path]:
    """Find the repository root by looking for CLAUDE.md."""
    current_file = Path(__file__)
    # Direct path from this file: services/ -> backend/ -> demo_prompt_generator/ -> src/ -> app/ -> repo root
    project_root = current_file.parent.parent.parent.parent.parent.parent
    if (project_root / "CLAUDE.md").exists():
        return project_root

    # Fallback: walk up looking for CLAUDE.md
    for parent in current_file.parents:
        if (parent / "CLAUDE.md").exists():
            return parent

    return None


def _get_repo_skill_path(skill_name: str) -> Optional[Path]:
    """Resolve a skill that lives in THIS repo's ``.claude/skills/<name>``.

    Wheel install: ``demo_prompt_generator/.claude/skills/<name>/`` is shipped
    inside the package by scripts/build.sh.
    Editable dev install: walk up to the repo's ``.claude/skills/...``.
    """
    bundled = Path(__file__).parent.parent.parent / ".claude" / "skills" / skill_name
    if bundled.exists():
        return bundled

    repo_root = _find_repo_root()
    if repo_root:
        skill = repo_root / ".claude" / "skills" / skill_name
        if skill.exists():
            return skill

    current_file = Path(__file__)
    for parent in current_file.parents:
        candidate = parent / ".claude" / "skills" / skill_name
        if candidate.exists():
            return candidate

    return None


def get_demo_generator_skill_path() -> Optional[Path]:
    """Get the path to the solution-builder skill."""
    return _get_repo_skill_path("databricks-solution-builder")


def get_architecture_skill_path() -> Optional[Path]:
    """Get the path to the databricks-architecture skill (SKILL.md, reference/,
    and — in dev / a wheel that ships it — renderer/ with the standalone
    viewer/editor HTMLs)."""
    return _get_repo_skill_path("databricks-architecture")


# Ignore rules for skill copies. We EXCLUDE node_modules: the skill copy only
# needs the skill's markdown + the app_template source, and copying the
# template's ~880MB node_modules into every project was the single biggest
# create-path cost (a synchronous copytree blocking the HTTP response) for no
# benefit — the agent never runs those deps from the skill dir, and when the
# app is built into <project>/app/ its start.sh runs `npm ci` on first boot
# anyway (a cross-filesystem copy flattens the .bin symlinks, forcing a fresh
# install regardless). The wheel build (scripts/build.sh) also excludes it.
_SKILL_COPY_IGNORE = shutil.ignore_patterns(
    "node_modules",
    ".venv",
    "dist",
    ".env",
    ".env.local",
    ".DS_Store",
    "*.tsbuildinfo",
    "playwright-report",
    "test-results",
    "__pycache__",
    "*.pyc",
)


# The in-app replacement for the skill's local-render workflow. Inside Solution
# Builder the Architecture tab renders architecture.md live in its own canvas, so
# there is no HTML-copy / headless-Chrome render loop — the agent just writes the
# `architecture.md` file and the app draws it.
_ARCH_SKILL_IN_APP_WORKFLOW = """## Workflow — how to make a diagram

You are running inside Solution Builder. The Architecture tab renders the
project's `architecture.md` **live in the app's own canvas** — there is no HTML
file to copy and no image to render. Just:

1. **Write `architecture.md`** at the project root, containing a single ```json
   fenced block with the `{ name, story, columns?, nodes[], edges[] }` schema
   (or an ARRAY of those objects for multiple tabs). Plain JSON — no `//` comments.
2. The app re-renders the diagram automatically as soon as the file is saved.
3. **To see your result, read `architecture.png`** at the project root. The app
   automatically renders a PNG of the live canvas into that file as part of the
   feedback loop — it refreshes whenever the user has the Architecture tab open
   and turns to the chat. Read it to check the diagram is right (components
   present, wired correctly, laid out cleanly) and edit `architecture.md` to fix
   anything. Repeat until it looks right. (If `architecture.png` is missing or
   stale, the Architecture tab may not be open — proceed from the JSON; the user
   sees the live canvas regardless.)

Start from the example in **The format** below (copy its `nodes`/`edges` and
adapt), or from `reference/architecture-complete.jsonc` — the flagship
end-to-end shape. **Strip the `//` comments** when you write the file.
"""


def _localize_arch_skill_for_app(skill_md: Path) -> None:
    """Rewrite a project's copied architecture SKILL.md for the in-app context:
    strip the local-only render-loop workflow (copy an HTML, run headless Chrome
    → PNG — none of which exists inside Solution Builder, where the canvas renders
    architecture.md natively) and inject a short in-app workflow in its place.
    A no-op if the markers aren't present (older skill versions)."""
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError:
        return
    # Drop every local-render-only block between its markers (inclusive):
    # the HTML-copy + headless-Chrome workflow and the renderer/ file list.
    for marker in ("local-render-workflow", "local-render-files"):
        text = re.sub(
            rf"<!-- BEGIN: {marker}.*?<!-- END: {marker} -->\n?",
            "",
            text,
            flags=re.DOTALL,
        )
    # Fill the in-app workflow placeholder with the app-native instructions.
    text = re.sub(
        r"<!-- BEGIN: in-app-workflow.*?<!-- END: in-app-workflow -->\n?",
        _ARCH_SKILL_IN_APP_WORKFLOW,
        text,
        flags=re.DOTALL,
    )
    try:
        skill_md.write_text(text, encoding="utf-8")
    except OSError:
        pass


def copy_skills_to_project(project_id: str) -> bool:
    """Copy the solution-builder skill + every non-excluded Databricks Agent Skills (DAS) skill
    into the project's `.claude/skills/` directory.

    Every project gets the full set. Capability-based filtering was tried
    and removed — pruning by exact slug match silently dropped blocks the
    agent needed when capability ids drifted, and the blocks/skills are
    cheap to ship.
    """
    project_dir = Path(PROJECTS_BASE_DIR) / project_id
    skills_dest = project_dir / ".claude" / "skills"
    skills_dest.mkdir(parents=True, exist_ok=True)

    copied = 0

    # Copy the solution-builder skill (lives in this repo, not Databricks Agent Skills (DAS)).
    demo_skill_path = get_demo_generator_skill_path()
    if demo_skill_path and demo_skill_path.exists():
        dest = skills_dest / "databricks-solution-builder"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(demo_skill_path, dest, ignore=_SKILL_COPY_IGNORE)
        copied += 1

    # Copy the databricks-architecture skill (also this repo). The
    # solution-builder SKILL.md points the agent at
    # `.claude/skills/databricks-architecture/SKILL.md` for the flat
    # nodes/edges schema + component catalog + reference diagrams — without
    # this copy that path doesn't exist inside a project session.
    # `renderer/` (the ~5MB standalone viewer/editor HTMLs + headless render
    # loop) is excluded: inside the app the Architecture tab renders
    # architecture.md natively, so the agent only needs SKILL.md + reference/.
    arch_skill_path = _get_repo_skill_path("databricks-architecture")
    if arch_skill_path and arch_skill_path.exists():
        dest = skills_dest / "databricks-architecture"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(
            arch_skill_path,
            dest,
            ignore=shutil.ignore_patterns(
                "renderer", ".venv", ".DS_Store", "__pycache__", "*.pyc",
            ),
        )
        _localize_arch_skill_for_app(dest / "SKILL.md")
        copied += 1

    # Copy every non-excluded skill from the DAS repo (skills/* + the one
    # experimental/databricks-genie), via the shared source enumerator.
    for src in _iter_source_skill_dirs():
        if not (src / "SKILL.md").exists():
            continue  # not a real skill (e.g. TEMPLATE-like stub)
        dest = skills_dest / src.name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=_SKILL_COPY_IGNORE)
        copied += 1

    logger.info(f"Copied {copied} skills to project {project_id}")
    return True


def ensure_project_skills(project_id: str) -> bool:
    """Ensure skills exist in project, copying if missing.

    Also heals projects created before the databricks-architecture skill was
    added to the copy set — they have a populated skills dir but lack it.
    """
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if (
        not skills_dir.exists()
        or not any(skills_dir.iterdir())
        or not (skills_dir / "databricks-architecture" / "SKILL.md").exists()
    ):
        return copy_skills_to_project(project_id)
    return True


def refresh_project_skills(project_id: str) -> bool:
    """Re-copy all skills from Databricks Agent Skills (DAS) to project."""
    # Remove old skills (except solution-builder)
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if skills_dir.exists():
        for item in skills_dir.iterdir():
            if item.name != "databricks-solution-builder":
                shutil.rmtree(item)

    return copy_skills_to_project(project_id)


def get_project_skills_list(project_id: str) -> list[dict]:
    """
    Scan .claude/skills folder and return list of skills with metadata.

    Returns list of dicts with: name, description, dir_name
    """
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if not skills_dir.exists():
        return []

    skills = []
    for skill_path in skills_dir.iterdir():
        if not skill_path.is_dir():
            continue

        skill_md = skill_path / "SKILL.md"
        if skill_md.exists():
            try:
                content = skill_md.read_text()
                name, description = _parse_skill_frontmatter(content)
                skills.append({
                    "name": name or skill_path.name,
                    "description": description or "",
                    "dir_name": skill_path.name,
                })
            except Exception as e:
                logger.warning(f"Failed to parse skill {skill_path.name}: {e}")
                skills.append({
                    "name": skill_path.name,
                    "description": "",
                    "dir_name": skill_path.name,
                })
        else:
            # Skill without SKILL.md - still include it
            skills.append({
                "name": skill_path.name,
                "description": "",
                "dir_name": skill_path.name,
            })

    return sorted(skills, key=lambda s: s["name"])


def get_skill_files_tree(project_id: str, skill_name: str) -> list[dict]:
    """
    Get file tree for a skill directory as a nested structure.

    Returns list of dicts with: path, name, is_dir, children (for directories)
    """
    skill_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills" / skill_name
    if not skill_dir.exists():
        return []

    def build_tree(directory: Path, base_path: Path) -> list[dict]:
        """Recursively build tree structure."""
        items = []

        # Sort: directories first, then files, alphabetically
        children = sorted(directory.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))

        for item in children:
            rel_path = str(item.relative_to(base_path))

            if item.is_dir():
                items.append({
                    "path": rel_path,
                    "name": item.name,
                    "is_dir": True,
                    "children": build_tree(item, base_path),
                })
            else:
                items.append({
                    "path": rel_path,
                    "name": item.name,
                    "is_dir": False,
                })

        return items

    return build_tree(skill_dir, skill_dir)


def get_skill_file_content(project_id: str, skill_name: str, file_path: str) -> Optional[str]:
    """
    Get content of a specific skill file.

    Returns file content as string, or None if not found.
    """
    skill_file = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills" / skill_name / file_path
    if not skill_file.exists() or not skill_file.is_file():
        return None

    try:
        return skill_file.read_text()
    except Exception as e:
        logger.error(f"Failed to read skill file {skill_name}/{file_path}: {e}")
        return None


def get_project_directory(project_id: str) -> Path:
    """Get the absolute path to a project's directory."""
    return Path(PROJECTS_BASE_DIR).resolve() / project_id


def create_project_directory(
    project_id: str,
    initial_readme: str | None = None,
    capabilities: Optional[list[str]] = None,
) -> Path:
    """
    Create a new project directory with initial structure.

    Args:
        project_id: Project UUID
        initial_readme: Optional initial content for README.md (None = no README created)
        capabilities: Selected capability IDs. Used only to decide whether to
            pre-create `specifications/app/` (when `databricks-apps` is in the
            list); does NOT filter which skills get copied — every project
            gets the full skill set.

    Returns:
        Path to the created project directory
    """
    project_dir = Path(PROJECTS_BASE_DIR) / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    # Create initial README.md only if content is provided
    if initial_readme is not None:
        readme_path = project_dir / "README.md"
        readme_path.write_text(initial_readme)

    # Provision .claude/settings.json. Two paths depending on mode:
    #   - Deployed (DATABRICKS_CLIENT_ID set): the FMAPI auth helper writes
    #     settings.json with apiKeyHelper + ANTHROPIC_BASE_URL + MODEL +
    #     enableAllProjectMcpServers=False, plus the helper script and the
    #     initial token file. Background task (lifespan) keeps the token fresh.
    #   - Local: minimal settings.json (just MCP-disable). Claude Code uses
    #     whatever ANTHROPIC_API_KEY / `claude login` the dev has set up.
    from ..core import fmapi_auth
    from ..core._config import AppConfig
    minted = fmapi_auth.mint_fmapi_token()
    if minted is not None:
        host, token = minted
        cfg = AppConfig()
        fmapi_auth.provision_project_files(
            project_dir,
            anthropic_base_url=f"{host}/{cfg.anthropic_base_path.strip('/')}",
            anthropic_model=cfg.anthropic_llm_endpoint,
            token=token,
        )
    else:
        import json
        claude_dir = project_dir / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)
        settings_path = claude_dir / "settings.json"
        settings_path.write_text(json.dumps({
            "enableAllProjectMcpServers": False,
            "mcpServers": {},
        }, indent=2))

    # Every project gets the full skill set — no capability-based filtering.
    copy_skills_to_project(project_id)

    # Scaffold the spec stage's expected layout up front. The build agent
    # walks `specifications/*.md` numerically (see stages/03.1-build.md); having
    # the folder pre-created — plus `specifications/app/` when an app is part
    # of the demo — removes guesswork for the spec agent in Stage 2.
    specs_dir = project_dir / "specifications"
    specs_dir.mkdir(parents=True, exist_ok=True)
    if capabilities and "databricks-apps" in capabilities:
        (specs_dir / "app").mkdir(parents=True, exist_ok=True)

    logger.info(f"Created project directory: {project_dir}")
    return project_dir


def build_initial_resources_json(capability_ids: list[str]) -> dict:
    """Build the initial resources.json content from selected capability IDs.

    Classifies each ID as buildable or talking_track using the ``buildable``
    flag in the capability markdown frontmatter.
    """
    from ..core.constants import get_capabilities_by_id

    caps_by_id = get_capabilities_by_id()

    buildable: list[str] = []
    talking_track: list[str] = []

    for cap_id in capability_ids:
        meta = caps_by_id.get(cap_id)
        if meta and meta.get("buildable"):
            buildable.append(cap_id)
        else:
            talking_track.append(cap_id)

    return {
        "capabilities": {
            "buildable": sorted(buildable),
            "talking_track": sorted(talking_track),
        },
        "created_resources": {},
    }
