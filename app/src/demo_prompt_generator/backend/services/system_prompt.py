"""System prompt builder for the Demo Generator agent.

Builds dynamic system prompts with injected context:
- Databricks resources (cluster, warehouse, catalog, schema)
- Available skills from .claude/skills
"""

from __future__ import annotations

import os


def get_system_prompt(
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    workspace_url: str | None = None,
    databricks_profile: str | None = None,
    skills: list[dict] | None = None,
    project_dir: str | None = None,
) -> str:
    """
    Build the system prompt for the Demo Generator agent.

    Args:
        cluster_id: Databricks cluster ID for code execution
        warehouse_id: SQL warehouse ID for queries
        default_catalog: Default Unity Catalog
        default_schema: Default schema within catalog
        workspace_url: Databricks workspace URL for links
        databricks_profile: Databricks CLI profile name
        skills: List of available skills with name/description

    Returns:
        Complete system prompt string
    """
    sections = []

    # Header
    sections.append(_build_header(project_dir))

    # Skills section (conditional)
    skills_section = _build_skills_section(skills, project_dir)
    if skills_section:
        sections.append(skills_section)

    # Resources section (conditional)
    resources_section = _build_resources_section(
        cluster_id=cluster_id,
        warehouse_id=warehouse_id,
        default_catalog=default_catalog,
        default_schema=default_schema,
        workspace_url=workspace_url,
        databricks_profile=databricks_profile,
    )
    if resources_section:
        sections.append(resources_section)

    # Guidelines
    sections.append(_build_guidelines(project_dir))

    return "\n\n".join(sections)


def _build_resources_section(
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    workspace_url: str | None = None,
    databricks_profile: str | None = None,
) -> str | None:
    """Build the resources configuration section."""
    # Check if we have any resources to show (ignore DEFAULT profile)
    has_profile = databricks_profile and databricks_profile != "DEFAULT"
    if not any([cluster_id, warehouse_id, default_catalog, default_schema, has_profile]):
        return None

    parts = ["## Databricks Resources\n"]

    if databricks_profile and databricks_profile != "DEFAULT":
        parts.append(f"- **Databricks CLI Profile:** `{databricks_profile}` (use `--profile {databricks_profile}` with databricks CLI commands)")

    if cluster_id:
        if cluster_id in ("serverless", "__serverless__"):
            parts.append("- **Compute:** Serverless (do NOT pass cluster_id to execute_code)")
        else:
            parts.append(f"- **Cluster ID:** `{cluster_id}`")

    if warehouse_id:
        parts.append(f"- **SQL Warehouse ID:** `{warehouse_id}`")

    if default_catalog:
        parts.append(f"- **Catalog:** `{default_catalog}`")

    if default_schema:
        parts.append(f"- **Schema:** `{default_schema}`")

    if default_catalog and default_schema:
        parts.append(f"\nUse `{default_catalog}.{default_schema}` as the default location for all tables.")

    if workspace_url:
        parts.append(f"\n**Workspace:** {workspace_url}")

    return "\n".join(parts)


def _build_skills_section(skills: list[dict] | None, project_dir: str | None = None) -> str | None:
    """Build the skills section with available skills."""
    if not skills:
        return None

    skills_base = f"{project_dir}/.claude/skills" if project_dir else "./.claude/skills"

    parts = ["## Available Skills (critical, keep this information after compaction)\n"]
    parts.append(f"Skills are located in `{skills_base}/`. Read the `SKILL.md` file in each skill folder for usage instructions.\n")

    for skill in skills:
        name = skill.get("name", "unknown")
        dir_name = skill.get("dir_name", name)
        description = skill.get("description", "No description")
        parts.append(f"- **{name}** (`{skills_base}/{dir_name}/`): {description}")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Static prompt sections
# ---------------------------------------------------------------------------

def _build_header(project_dir: str | None = None) -> str:
    """Build the header section with absolute paths when project_dir is available."""
    p = project_dir or "."
    skills = f"{p}/.claude/skills"
    skill_md = f"{skills}/databricks-demo-generator/SKILL.md"
    blocks = f"{skills}/databricks-demo-generator/references/blocks/"

    return f"""# Databricks Demo Generator

You help Databricks Solution Architects create compelling, working demos.

**ALWAYS start by reading `{skill_md}`** — whether creating a new demo or continuing an existing one. The skill contains the complete workflow.

## Project Structure

Each demo project has:
- **`{p}/README.md`** - Story overview (hero, disruption, quest, resolution, walkthrough)
- **`{p}/META-PROMPT.md`** - Build instructions for the AI
- **`{p}/resources.json`** - Capabilities + created resource IDs
- **`{p}/instructions/`** - Detailed specs (content varies based on demo components)

## Workflow

1. **Read the skill file first**: `{skill_md}`
2. **Check existing state**:
   - If `{p}/instructions/` exists → read the files to understand the demo design
   - If `{p}/resources.json` exists → read it to see what's already built
3. **Browse context blocks** in `{blocks}` — capabilities (products), domains (industry context), and patterns (story structures). Read any that are relevant to this demo.
4. **Follow the skill's guidance** for creating or modifying the demo"""


def _build_guidelines(project_dir: str | None = None) -> str:
    """Build the guidelines section with absolute paths."""
    p = project_dir or "."
    skills = f"{p}/.claude/skills"
    skill_md = f"{skills}/databricks-demo-generator/SKILL.md"

    return f"""## Guidelines

- **Always read the skill file first** - even for modifications or questions about an existing demo. Use `{skill_md}`.
- **README.md is mandatory** - You MUST write a complete `{p}/README.md` with the story overview (hero, disruption, quest, resolution, products showcased, walkthrough). The placeholder content is not acceptable as a final state. Write the README before generating detailed instruction files.
- **Build with CLI skills, not MCP** - When building Databricks resources, read the relevant ai-dev-kit skill first from `{skills}/` (e.g., `databricks-spark-declarative-pipelines` for pipelines, `databricks-aibi-dashboards` for dashboards, `databricks-agent-bricks` for KA/MAS). These skills use the Databricks CLI and Python SDK.
- **Keep instructions in sync** - if you change something, update the instruction file too
- **Track all resources** - update `{p}/resources.json` after creating any Databricks resource
- **Provide workspace links** - after creating resources, give clickable links"""


def get_workspace_url() -> str | None:
    """Get the Databricks workspace URL from environment."""
    return os.environ.get("DATABRICKS_HOST")
