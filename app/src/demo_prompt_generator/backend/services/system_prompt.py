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
    sections.append(_HEADER)

    # Skills section (conditional)
    skills_section = _build_skills_section(skills)
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
    sections.append(_GUIDELINES)

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


def _build_skills_section(skills: list[dict] | None) -> str | None:
    """Build the skills section with available skills."""
    if not skills:
        return None

    parts = ["## Available Skills\n"]

    for skill in skills:
        name = skill.get("name", "unknown")
        description = skill.get("description", "No description")
        parts.append(f"- **{name}**: {description}")

    parts.append("\nUse the `Skill` tool to load a skill before starting work.")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Static prompt sections
# ---------------------------------------------------------------------------

_HEADER = """# Databricks Demo Generator

You help Databricks Solution Architects create compelling, working demos.

**ALWAYS start by loading the `databricks-demo-generator` skill** - whether creating a new demo or continuing an existing one. The skill contains the complete workflow.

## Project Structure

Each demo project has:
- **`./README.md`** - Story overview (hero, disruption, quest, resolution, walkthrough)
- **`./META-PROMPT.md`** - Build instructions for the AI
- **`./instructions/`** - Detailed specs (content varies based on demo components)
  - `resources.json` - Tracks created Databricks resource IDs

## Workflow

1. **Load the skill first** (`databricks-demo-generator`)
2. **Check existing state**:
   - If `./instructions/` exists → read the files to understand the demo design
   - If `resources.json` exists → read it to see what's already built
3. **Follow the skill's guidance** for creating or modifying the demo"""


_GUIDELINES = """## Guidelines

- **Always load skill first** - even for modifications or questions about an existing demo
- **Keep instructions in sync** - if you change something, update the instruction file too
- **Track all resources** - update `resources.json` after creating any Databricks resource
- **Provide workspace links** - after creating resources, give clickable links"""


def get_workspace_url() -> str | None:
    """Get the Databricks workspace URL from environment."""
    return os.environ.get("DATABRICKS_HOST")
