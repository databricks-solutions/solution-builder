"""
Skills manager for managing skills in projects.

Workflow:
1. On app startup: ai-dev-kit is cloned/updated by dev.sh or build-electron.sh
2. On project creation: Copy demo-generator + default skills to .claude/skills/
3. Skills folder is IGNORED from watchdog sync (managed here only)
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Configuration
# ai-dev-kit cloning is handled by:
#   - dev.sh (clones into ./ai_dev_kit/ for editable dev)
#   - scripts/build.sh (clones into the wheel under demo_prompt_generator/ai_dev_kit/)
# Resolution order (first hit wins): explicit AI_DEV_KIT_PATH env var, wheel-bundled
# path inside the installed package, then ./ai_dev_kit/ relative to cwd (dev.sh setup).
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

# Skill dirs from ai-dev-kit that we never copy into a project.
#
# - TEMPLATE: scaffolding/stub entry inside ai-dev-kit, not a real skill.
# - databricks-apps-python: generic AppKit/Streamlit/Dash/Gradio/Flask
#   Python-app skill. Our app flow is Node/React/FastAPI via
#   `app_template` + `app.md` — if this skill is in the project, build
#   subagents tend to default to Streamlit/Python frameworks, which
#   conflicts with the template. Excluded.
# - databricks-lakebase-provisioned: we use Lakebase Autoscaling
#   (branch-based) via app.md's own provisioning flow.
#   databricks-lakebase-autoscale is the one that applies.
EXCLUDE_SKILLS: set[str] = {
    "TEMPLATE",
    "databricks-apps-python",
    "databricks-lakebase-provisioned",
}


def get_available_skills() -> list[dict]:
    """
    Get list of available skills from ai-dev-kit.

    Returns:
        List of {name, description, path, dir_name} dicts
    """
    skills_dir = Path(AI_DEV_KIT_LOCAL) / "databricks-skills"
    if not skills_dir.exists():
        logger.warning("Skills directory not found")
        return []

    skills = []
    for skill_path in skills_dir.iterdir():
        if not skill_path.is_dir():
            continue
        if skill_path.name in EXCLUDE_SKILLS:
            continue

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


def get_demo_generator_skill_path() -> Optional[Path]:
    """Get the path to the demo-generator skill.

    Wheel install: ``demo_prompt_generator/.claude/skills/databricks-demo-generator/``
    is shipped inside the package by scripts/build.sh.
    Editable dev install: walk up to the repo's ``.claude/skills/...``.
    """
    bundled = Path(__file__).parent.parent.parent / ".claude" / "skills" / "databricks-demo-generator"
    if bundled.exists():
        return bundled

    repo_root = _find_repo_root()
    if repo_root:
        demo_skill = repo_root / ".claude" / "skills" / "databricks-demo-generator"
        if demo_skill.exists():
            return demo_skill

    current_file = Path(__file__)
    for parent in current_file.parents:
        candidate = parent / ".claude" / "skills" / "databricks-demo-generator"
        if candidate.exists():
            return candidate

    return None


# Ignore rules for skill copies. We intentionally KEEP node_modules — the
# canonical app_template/ ships with a pre-installed node_modules so the
# agent doesn't have to run `npm install` (2-4 min) during a session. The
# wheel build (scripts/build.sh) excludes node_modules separately, since
# native binaries (sharp, esbuild, @ast-grep) aren't OS-portable.
_SKILL_COPY_IGNORE = shutil.ignore_patterns(
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


def copy_skills_to_project(project_id: str) -> bool:
    """Copy the demo-generator skill + every non-excluded ai-dev-kit skill
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

    # Copy the demo-generator skill (lives in this repo, not ai-dev-kit).
    demo_skill_path = get_demo_generator_skill_path()
    if demo_skill_path and demo_skill_path.exists():
        dest = skills_dest / "databricks-demo-generator"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(demo_skill_path, dest, ignore=_SKILL_COPY_IGNORE)
        copied += 1

    # Copy every non-excluded skill from ai-dev-kit.
    skills_src = Path(AI_DEV_KIT_LOCAL) / "databricks-skills"
    if skills_src.exists():
        for src in skills_src.iterdir():
            if not src.is_dir():
                continue
            if src.name in EXCLUDE_SKILLS:
                continue
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
    """Ensure skills exist in project, copying if missing."""
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if not skills_dir.exists() or not any(skills_dir.iterdir()):
        return copy_skills_to_project(project_id)
    return True


def refresh_project_skills(project_id: str) -> bool:
    """Re-copy all skills from ai-dev-kit to project."""
    # Remove old skills (except demo-generator)
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if skills_dir.exists():
        for item in skills_dir.iterdir():
            if item.name != "databricks-demo-generator":
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
    # walks `specifications/*.md` numerically (see stages/03-build.md); having
    # the folder pre-created — plus `specifications/app/` when an app is part
    # of the demo — removes guesswork for the spec agent in Stage 2.
    specs_dir = project_dir / "specifications"
    specs_dir.mkdir(parents=True, exist_ok=True)
    if capabilities and "databricks-apps" in capabilities:
        (specs_dir / "app").mkdir(parents=True, exist_ok=True)

    # Drop META-PROMPT.md at the project root from the skill template if it
    # isn't there yet. SKILL.md says it's generic and copied from the
    # template; pre-seeding it removes that step from Stage 2.
    meta_prompt_dst = project_dir / "META-PROMPT.md"
    if not meta_prompt_dst.exists():
        meta_prompt_src = (
            project_dir / ".claude" / "skills" / "databricks-demo-generator"
            / "references" / "META-PROMPT-TEMPLATE.md"
        )
        if meta_prompt_src.exists():
            meta_prompt_dst.write_text(meta_prompt_src.read_text())

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
