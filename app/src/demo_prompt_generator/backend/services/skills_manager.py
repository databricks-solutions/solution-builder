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

# Skills to copy by default - None means copy ALL available skills
# Set to a list of skill names to limit which skills are copied
DEFAULT_SKILLS = None  # Copy all skills from ai-dev-kit

# Skills that should ALWAYS be copied into every project (baseline tooling
# that applies regardless of which demo capabilities the user picked).
CORE_SKILLS: set[str] = {
    "databricks-config",
    "databricks-docs",
    "databricks-python-sdk",
    "databricks-unity-catalog",
    "databricks-synthetic-data-gen",
    "databricks-bundles",
    "databricks-execution-compute",
    "databricks-dbsql",
    "databricks-jobs",
}

# Never copy these skill dirs (stub/template entries in ai-dev-kit,
# plus skills that conflict with the demo-generator's own app flow).
# - databricks-app-python: generic Streamlit/Gradio Python app skill.
#   Our app is Node/React/FastAPI via app_template + app.md; this skill
#   makes build subagents default to Streamlit. Kept out.
# - databricks-lakebase-provisioned: we use Lakebase Autoscaling
#   (branch-based) via app.md's own provisioning flow.
#   databricks-lakebase-autoscale is the one that applies.
EXCLUDE_SKILLS: set[str] = {
    "TEMPLATE",
    "databricks-app-python",
    "databricks-lakebase-provisioned",
}

# Map each capability id (see references/blocks/capabilities/*.md) to the
# ai-dev-kit skill dirs it needs. Capabilities not listed contribute no extra
# skills beyond CORE_SKILLS.
CAPABILITY_TO_SKILLS: dict[str, list[str]] = {
    "ai-functions": ["databricks-ai-functions"],
    "aibi-dashboards": ["databricks-aibi-dashboards"],
    # databricks-app-python intentionally NOT listed: it's the generic
    # Streamlit/Python-app skill; our app is Node/React/FastAPI via
    # app_template + app.md. databricks-lakebase-provisioned also out —
    # we use the autoscale (branch-based) flow documented in app.md.
    "databricks-apps": ["databricks-lakebase-autoscale"],
    "genie": ["databricks-genie"],
    "information-extraction": ["databricks-ai-functions"],
    "knowledge-assistant": ["databricks-agent-bricks", "databricks-unstructured-pdf-generation"],
    "lakebase": ["databricks-lakebase-autoscale"],
    "lakeflow-jobs": ["databricks-jobs"],
    "metric-views": ["databricks-metric-views"],
    "model-serving": ["databricks-model-serving"],
    "model-training-mlflow": ["databricks-mlflow-evaluation", "databricks-model-serving"],
    "sdp": ["databricks-spark-declarative-pipelines"],
    "supervisor-agent": ["databricks-agent-bricks"],
    "vector-search": ["databricks-vector-search"],
    "zerobus-ingest": ["databricks-zerobus-ingest"],
}


def skills_for_capabilities(capability_ids: Optional[list[str]]) -> Optional[list[str]]:
    """Resolve selected capability IDs to the set of skill dir_names to copy.

    Currently disabled — always returns None so `copy_skills_to_project`
    copies every ai-dev-kit skill regardless of which capabilities were
    selected. The per-capability mapping (`CAPABILITY_TO_SKILLS`) and the
    `CORE_SKILLS` baseline are kept below for reference / future re-enable.
    """
    return None


def _prune_capability_blocks(
    demo_skill_dest: Path,
    capability_ids: list[str],
) -> None:
    """Remove capability block files the user didn't select.

    Keeps domains/, patterns/, and all non-capabilities references intact.
    Only removes files from references/blocks/capabilities/ whose stem
    (filename minus .md) is not in the selected capability_ids set.
    """
    caps_dir = demo_skill_dest / "references" / "blocks" / "capabilities"
    if not caps_dir.is_dir():
        return

    selected = set(capability_ids)
    removed = 0
    for f in list(caps_dir.iterdir()):
        if f.is_file() and f.suffix == ".md" and f.stem not in selected:
            f.unlink()
            removed += 1

    if removed:
        logger.info(
            f"Pruned {removed} unselected capability blocks; "
            f"kept {len(selected)} selected"
        )


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


def copy_skills_to_project(
    project_id: str,
    enabled_skills: Optional[list[str]] = None,
    capability_ids: Optional[list[str]] = None,
) -> bool:
    """
    Copy skills to a project's .claude/skills/ directory.

    Args:
        project_id: Project UUID
        enabled_skills: List of skill names to copy. If None, use defaults.
        capability_ids: Selected capability IDs. When provided, only capability
            blocks matching these IDs are kept in the demo-generator skill.
            Unselected capability blocks are pruned so the agent never sees them.

    Returns:
        True if successful
    """
    project_dir = Path(PROJECTS_BASE_DIR) / project_id
    skills_dest = project_dir / ".claude" / "skills"
    skills_dest.mkdir(parents=True, exist_ok=True)

    # Get available skills from ai-dev-kit
    available = get_available_skills()
    name_to_dir = {s["name"]: s["dir_name"] for s in available}

    # Determine which skills to copy
    # If enabled_skills is None and DEFAULT_SKILLS is None, copy ALL available skills
    if enabled_skills is None:
        if DEFAULT_SKILLS is None:
            # Copy all available skills
            enabled_skills = [s["dir_name"] for s in available]
        else:
            enabled_skills = DEFAULT_SKILLS

    copied = 0

    # Ignore rules for skill copies. The demo-generator skill bundles an
    # app_template/ that may carry a local node_modules/ (hundreds of MB),
    # a dev .env with secrets, or build artifacts. Skip them so creation
    # is fast and we never leak credentials.
    _ignored = shutil.ignore_patterns(
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

    # Copy demo-generator from this project
    demo_skill_path = get_demo_generator_skill_path()
    if demo_skill_path and demo_skill_path.exists():
        dest = skills_dest / "databricks-demo-generator"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(demo_skill_path, dest, ignore=_ignored)
        copied += 1

        # Prune capability blocks the user didn't select so the agent
        # never sees them and can't accidentally incorporate them.
        if capability_ids:
            _prune_capability_blocks(dest, capability_ids)

    # Copy skills from ai-dev-kit
    skills_src = Path(AI_DEV_KIT_LOCAL) / "databricks-skills"
    if skills_src.exists():
        for skill_name in enabled_skills:
            # Handle both skill names and directory names
            dir_name = name_to_dir.get(skill_name, skill_name)
            src = skills_src / dir_name

            if not src.exists():
                logger.warning(f"Skill not found: {skill_name}")
                continue

            # Skip non-skill directories (TEMPLATE, etc.)
            if not (src / "SKILL.md").exists():
                logger.debug(f"Skipping {skill_name} - no SKILL.md")
                continue

            dest = skills_dest / dir_name
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest, ignore=_ignored)
            copied += 1

    logger.info(f"Copied {copied} skills to project {project_id}")
    return True


def ensure_project_skills(project_id: str) -> bool:
    """Ensure skills exist in project, copying if missing."""
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if not skills_dir.exists() or not any(skills_dir.iterdir()):
        return copy_skills_to_project(project_id, None)
    return True


def refresh_project_skills(project_id: str) -> bool:
    """Re-copy all skills from ai-dev-kit to project."""
    # Remove old skills (except demo-generator)
    skills_dir = Path(PROJECTS_BASE_DIR) / project_id / ".claude" / "skills"
    if skills_dir.exists():
        for item in skills_dir.iterdir():
            if item.name != "databricks-demo-generator":
                shutil.rmtree(item)

    # Copy default skills
    return copy_skills_to_project(project_id, None)


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
        capabilities: Selected capability IDs. When provided, only skills needed for
            these capabilities (plus CORE_SKILLS) are copied into the project. When
            None/empty, all skills are copied (legacy behavior).

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
            anthropic_base_url=f"{host}/serving-endpoints/anthropic",
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

    # Copy skills — filter to capability-relevant set when capabilities provided.
    # Also pass raw capability IDs so the demo-generator's capability blocks
    # are pruned to only what the user selected.
    copy_skills_to_project(
        project_id,
        skills_for_capabilities(capabilities),
        capability_ids=capabilities,
    )

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
