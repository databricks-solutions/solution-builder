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
    """Build the system prompt for the Demo Generator agent."""
    p = project_dir or "."

    sections = [
        # Define paths once, then reference by short name everywhere
        f"## Path References\n\n"
        f"- **PROJECT**: `{p}`\n"
        f"- **SKILLS**: `{p}/.claude/skills`\n"
        f"- **DEMO_SKILL**: `{p}/.claude/skills/databricks-demo-generator/SKILL.md`\n"
        f"- **BLOCKS**: `{p}/.claude/skills/databricks-demo-generator/references/blocks/`\n"
        f"\nAll paths below use these references.",
        _PROMPT_TEMPLATE,
    ]

    if skills:
        lines = ["## Available Skills (critical, keep this information after compaction)\n"]
        for s in skills:
            name = s.get("name", "unknown")
            dir_name = s.get("dir_name", name)
            desc = s.get("description", "No description")
            lines.append(f"- **{name}** (`SKILLS/{dir_name}/SKILL.md`): {desc}")
        sections.append("\n".join(lines))

    resources = _build_resources_section(
        cluster_id=cluster_id,
        warehouse_id=warehouse_id,
        default_catalog=default_catalog,
        default_schema=default_schema,
        workspace_url=workspace_url,
        databricks_profile=databricks_profile,
    )
    if resources:
        sections.append(resources)

    return "\n\n".join(sections)


_PROMPT_TEMPLATE = """# Databricks Demo Generator

You help Databricks Solution Architects create compelling, working demos.

**ALWAYS start by reading `DEMO_SKILL`** — whether creating a new demo or continuing an existing one. The skill contains the complete workflow.

## Project Structure

- `PROJECT/README.md` — Story overview, walkthrough
- `PROJECT/META-PROMPT.md` — Build prompt for the AI
- `PROJECT/resources.json` — Capabilities + created resource IDs
- `PROJECT/specifications/` — Detailed specs per component

## Workflow

1. **Read the skill first**: `DEMO_SKILL`
2. **Check existing state**: read `PROJECT/specifications/` and `PROJECT/resources.json` if they exist
3. **Browse context blocks** in `BLOCKS` — capabilities, domains, patterns
4. **Follow the skill's guidance** for creating or modifying the demo

## Guidelines

- **Always read the skill file first** — `DEMO_SKILL`
- **README.md is mandatory** — write `PROJECT/README.md` with the full story before generating specification files
- **Build with CLI skills, not MCP** — read the relevant skill from `SKILLS/` first (e.g., `databricks-spark-declarative-pipelines`, `databricks-aibi-dashboards`, `databricks-agent-bricks`)
- **Keep spec files in sync** — if you change something, update the spec file too
- **Track all resources** — update `PROJECT/resources.json` after creating any Databricks resource
- **Provide workspace links** — after creating resources, give clickable links"""


def _build_resources_section(
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    workspace_url: str | None = None,
    databricks_profile: str | None = None,
) -> str | None:
    """Build the resources configuration section."""
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


def get_workspace_url() -> str | None:
    """Get the Databricks workspace URL from environment."""
    return os.environ.get("DATABRICKS_HOST")
