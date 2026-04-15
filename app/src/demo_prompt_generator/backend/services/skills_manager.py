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
# Note: ai-dev-kit cloning/pulling is handled by dev.sh and build-electron.sh
# These scripts manage branch checkout with proper git clean to avoid stale files
AI_DEV_KIT_LOCAL = os.getenv("AI_DEV_KIT_PATH", "./ai_dev_kit")
PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Skills to copy by default - None means copy ALL available skills
# Set to a list of skill names to limit which skills are copied
DEFAULT_SKILLS = None  # Copy all skills from ai-dev-kit


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
    """Find the repository root by looking for blocks/ directory."""
    current_file = Path(__file__)
    # Direct path from this file: services/ -> backend/ -> demo_prompt_generator/ -> src/ -> app/ -> repo root
    project_root = current_file.parent.parent.parent.parent.parent.parent
    if (project_root / "blocks").exists():
        return project_root

    # Fallback: walk up looking for blocks/
    for parent in current_file.parents:
        if (parent / "blocks").exists():
            return parent

    return None


def get_demo_generator_skill_path() -> Optional[Path]:
    """Get the path to the demo-generator skill from this project."""
    repo_root = _find_repo_root()
    if repo_root:
        demo_skill = repo_root / ".claude" / "skills" / "databricks-demo-generator"
        if demo_skill.exists():
            return demo_skill

    # Fallback: look in parent directories
    current_file = Path(__file__)
    for parent in current_file.parents:
        candidate = parent / ".claude" / "skills" / "databricks-demo-generator"
        if candidate.exists():
            return candidate

    return None


def copy_skills_to_project(
    project_id: str,
    enabled_skills: Optional[list[str]] = None,
) -> bool:
    """
    Copy skills to a project's .claude/skills/ directory.

    Args:
        project_id: Project UUID
        enabled_skills: List of skill names to copy. If None, use defaults.

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

    # Copy demo-generator from this project
    demo_skill_path = get_demo_generator_skill_path()
    if demo_skill_path and demo_skill_path.exists():
        dest = skills_dest / "databricks-demo-generator"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(demo_skill_path, dest)
        copied += 1

        # Copy domain and pattern blocks from blocks/ into the skill's references
        # so the agent can browse them alongside capability blocks.
        # blocks/ is the single source of truth — this keeps them fresh on each copy.
        repo_root = _find_repo_root()
        if repo_root:
            blocks_src = repo_root / "blocks"
            refs_blocks = dest / "references" / "blocks"
            for block_type in ("domains", "patterns"):
                src_dir = blocks_src / block_type
                if src_dir.exists():
                    dest_dir = refs_blocks / block_type
                    if dest_dir.exists():
                        shutil.rmtree(dest_dir)
                    shutil.copytree(src_dir, dest_dir)
                    logger.debug(f"Copied {block_type} blocks to project {project_id}")

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
            shutil.copytree(src, dest)
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


def create_project_directory(project_id: str, initial_readme: str = "") -> Path:
    """
    Create a new project directory with initial structure.

    Args:
        project_id: Project UUID
        initial_readme: Initial content for README.md

    Returns:
        Path to the created project directory
    """
    project_dir = Path(PROJECTS_BASE_DIR) / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    # Create initial README.md
    readme_content = initial_readme or f"# Project {project_id}\n\nThis is a new Databricks Asset Generator project.\n"
    readme_path = project_dir / "README.md"
    readme_path.write_text(readme_content)

    # Create .claude/settings.json that disables MCP inheritance
    # Building uses ai-dev-kit CLI skills, not MCP tools
    import json
    claude_dir = project_dir / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)
    settings_path = claude_dir / "settings.json"
    settings_path.write_text(json.dumps({
        "enableAllProjectMcpServers": False,
        "mcpServers": {},
    }, indent=2))

    # Copy skills
    copy_skills_to_project(project_id)

    logger.info(f"Created project directory: {project_dir}")
    return project_dir
