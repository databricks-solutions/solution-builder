"""
Skills manager for cloning ai-dev-kit and managing skills in projects.

Workflow:
1. On app startup: Clone/pull ai-dev-kit repo
2. On project creation: Copy demo-generator + default skills to .claude/skills/
3. Skills folder is IGNORED from watchdog sync (managed here only)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Configuration
AI_DEV_KIT_REPO = "https://github.com/databricks-solutions/ai-dev-kit.git"
AI_DEV_KIT_LOCAL = os.getenv("AI_DEV_KIT_PATH", "./ai_dev_kit")
PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Skills to copy by default
DEFAULT_SKILLS = [
    "databricks-spark-declarative-pipelines",
    "databricks-aibi-dashboards",
    "databricks-genie",
    "databricks-agent-bricks",
    "databricks-unity-catalog",
    "databricks-model-serving",
]


def clone_or_pull_ai_dev_kit() -> bool:
    """
    Clone ai-dev-kit repo if not present, or pull latest.

    Called during app startup.
    """
    repo_path = Path(AI_DEV_KIT_LOCAL)

    try:
        if repo_path.exists() and (repo_path / ".git").exists():
            # Pull latest
            logger.info(f"Pulling latest ai-dev-kit from {repo_path}")
            result = subprocess.run(
                ["git", "pull", "--ff-only"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                logger.warning(f"Git pull failed: {result.stderr}")
                return False
        else:
            # Clone fresh
            logger.info(f"Cloning ai-dev-kit to {repo_path}")
            repo_path.parent.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(
                ["git", "clone", "--depth", "1", AI_DEV_KIT_REPO, str(repo_path)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                logger.error(f"Git clone failed: {result.stderr}")
                return False

        logger.info("ai-dev-kit repository ready")
        return True

    except subprocess.TimeoutExpired:
        logger.error("Git operation timed out")
        return False
    except Exception as e:
        logger.error(f"Failed to manage ai-dev-kit repo: {e}")
        return False


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


def get_demo_generator_skill_path() -> Optional[Path]:
    """Get the path to the demo-generator skill from this project."""
    # Look in the project's .claude/skills directory
    current_file = Path(__file__)
    project_root = current_file.parent.parent.parent.parent.parent.parent
    demo_skill = project_root / ".claude" / "skills" / "databricks-demo-generator"

    if demo_skill.exists():
        return demo_skill

    # Fallback: look in parent directories
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

    # Determine which skills to copy
    if enabled_skills is None:
        enabled_skills = DEFAULT_SKILLS

    # Map skill names to directory names
    available = get_available_skills()
    name_to_dir = {s["name"]: s["dir_name"] for s in available}

    copied = 0

    # Copy demo-generator from this project
    demo_skill_path = get_demo_generator_skill_path()
    if demo_skill_path and demo_skill_path.exists():
        dest = skills_dest / "databricks-demo-generator"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(demo_skill_path, dest)
        copied += 1

    # Copy skills from ai-dev-kit
    skills_src = Path(AI_DEV_KIT_LOCAL) / "databricks-skills"
    if skills_src.exists():
        for skill_name in enabled_skills:
            dir_name = name_to_dir.get(skill_name, skill_name)
            src = skills_src / dir_name

            if not src.exists():
                logger.warning(f"Skill not found: {skill_name}")
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

    # Copy skills
    copy_skills_to_project(project_id)

    logger.info(f"Created project directory: {project_dir}")
    return project_dir
