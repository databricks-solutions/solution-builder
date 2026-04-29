"""System prompt builder for the Demo Generator agent.

Builds dynamic system prompts with injected context:
- Databricks resources (cluster, warehouse, catalog, schema)
- Available skills from .claude/skills
"""

from __future__ import annotations

import os
from pathlib import Path


# Path to the shared databricks-connect venv provisioned by dev.sh.
# Resolves to <repo>/app/.venv-dbconnect — same place dev.sh writes it.
_DBCONNECT_VENV = Path(__file__).resolve().parents[4] / ".venv-dbconnect"


def get_system_prompt(
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    workspace_url: str | None = None,
    databricks_profile: str | None = None,
    skills: list[dict] | None = None,
    project_dir: str | None = None,
    template_lineage: dict | None = None,
) -> str:
    """Build the system prompt for the Demo Generator agent.

    template_lineage (optional): when the project was forked from a template,
    a dict with keys ``name``, ``industry``, and ``capabilities`` (list[str]).
    Adds a short context block telling the agent the user is adapting an
    existing demo rather than authoring from scratch.
    """
    p = project_dir or "."

    sections = [
        # Define paths once, then reference by short name everywhere
        f"## Path References\n\n"
        f"- **PROJECT**: `{p}`\n"
        f"- **SKILLS**: `{p}/.claude/skills`\n"
        f"- **DEMO_SKILL**: `{p}/.claude/skills/databricks-demo-generator/SKILL.md`\n"
        f"\nAll paths below use these references.",
        _PROMPT_TEMPLATE,
    ]

    lineage = _build_template_lineage_section(template_lineage)
    if lineage:
        sections.append(lineage)

    if skills:
        lines = [
            "## Available Skills (index — read the skill's SKILL.md for full usage)\n",
            "Each entry: `dir-name — short purpose`. Use `Read SKILLS/<dir>/SKILL.md` for triggers, examples, scripts.\n",
        ]
        for s in skills:
            dir_name = s.get("dir_name", s.get("name", "unknown"))
            desc = s.get("description", "") or ""
            short = _short_skill_hint(desc)
            lines.append(f"- `{dir_name}` — {short}" if short else f"- `{dir_name}`")
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

    dbconnect = _build_dbconnect_section()
    if dbconnect:
        sections.append(dbconnect)

    return "\n\n".join(sections)


def _build_template_lineage_section(lineage: dict | None) -> str | None:
    """Tell the agent the project was forked from a template, so its replies
    treat the work as adapt-in-place rather than generate-from-scratch."""
    if not lineage:
        return None
    name = lineage.get("name")
    if not name:
        return None
    industry = lineage.get("industry") or "unspecified industry"
    caps = lineage.get("capabilities") or []
    caps_str = ", ".join(caps) if caps else "see resources.json"

    return (
        "## Template lineage\n\n"
        f"This project was **forked from the `{name}` template** "
        f"(industry: {industry}; capabilities: {caps_str}). "
        "The user is adapting an existing demo for their own scenario, not authoring one from scratch. "
        "When they describe changes, **edit the inherited files in place** rather than creating parallel "
        "structures. If the user is unclear about what to change, ask which dimension matters most: "
        "industry/customer, data model, narrative, or capability mix — and offer the inherited values "
        "as the current state."
    )


def _build_dbconnect_section() -> str | None:
    """Inject pre-provisioned databricks-connect venv guidance when present.

    Local dev runs `dev.sh` which provisions a single Python 3.12 venv with
    databricks-connect installed. Without this section the agent falls into
    a Python 3.14 → install loop on every new project. In production
    deployments the venv won't exist, so the section is silently skipped.
    """
    venv_python = _DBCONNECT_VENV / "bin" / "python"
    if not venv_python.exists():
        return None

    return (
        "## Pre-provisioned databricks-connect venv\n\n"
        f"A Python 3.12 venv with databricks-connect, faker, numpy, pandas, "
        f"holidays, and pyarrow is already installed at:\n\n"
        f"`{venv_python}`\n\n"
        f"Use it directly for any data-gen / databricks-connect script:\n\n"
        f"```bash\n"
        f"{venv_python} path/to/script.py\n"
        f"```\n\n"
        f"**Do NOT** create a new venv, run `uv pip install databricks-connect`, "
        f"or invoke the system Python. The system Python is 3.14, which "
        f"databricks-connect does not support — every detour through it wastes "
        f"~1-2 minutes per project. If a script needs an additional package, "
        f"install it into this venv with "
        f"`uv pip install --python {venv_python} <pkg>`."
    )


_PROMPT_TEMPLATE = """# Databricks Demo Generator

You help Databricks Solution Architects create compelling, working demos.

**ALWAYS start by reading `DEMO_SKILL`** — whether creating a new demo or continuing an existing one. The skill contains the complete workflow.

## Project Structure

- `PROJECT/README.md` — Story overview, walkthrough
- `PROJECT/META-PROMPT.md` — Build prompt for the AI (generic, do not write it copy it from template)
- `PROJECT/resources.json` — Capabilities + created resource IDs
- `PROJECT/specifications/` — Detailed specs per component

## Workflow

1. **Read the skill first**: `DEMO_SKILL`
2. **Check existing state**: read `PROJECT/specifications/` and `PROJECT/resources.json` if they exist
3. **Browse context blocks** in `BLOCKS` — capabilities, domains, patterns
4. **Follow the skill's guidance** for creating or modifying the demo

## Guidelines

- **Always read the demo generation skill file first** — `DEMO_SKILL`
- **README.md is mandatory** — write `PROJECT/README.md` with the full story before generating specification files
- **Build with CLI skills, not MCP** — read the relevant skill from `SKILLS/` first (e.g., `databricks-spark-declarative-pipelines`, `databricks-aibi-dashboards`, `databricks-agent-bricks`)
- **Keep spec files in sync** — if you change something, update the spec file too
- **Track all resources** — update `PROJECT/resources.json` after creating any Databricks resource
- **Provide workspace links** — after creating resources, give clickable links
- **Enforce build-order gates** — consumption resources depend on upstream data. BEFORE creating any dashboard, Genie space, Knowledge Assistant, or agent, VERIFY its inputs exist, for example:
  - **Dashboard**: the pipeline must have completed successfully AND every table referenced in any dataset must return `COUNT(*) > 0` via `execute_sql` against the fully qualified `{CATALOG}.{SCHEMA}.{table}` name. No exceptions. A dashboard built against missing or empty tables fails silently on every widget (`TABLE_OR_VIEW_NOT_FOUND`) and requires delete-and-recreate.
  - **Genie space**: every listed table must exist with rows.
  - **Knowledge Assistant**: source documents must be uploaded and the vector index must have finished syncing.
  - **Multi-Agent Supervisor**: every downstream tool must already have an ID in `resources.json.created_resources`.
  If any precondition fails, STOP and fix the upstream resource — never proceed to create the downstream resource.

## Communication Style

**Do NOT narrate your process.** When thinking, never output lines like "Story is clear", "Let me read the file…", "Now I'll write the README…", "Writing the architecture documentation... " etc. Just do it instead calling the tools. Only write final short text that is useful to the *user*: summaries of what you built, questions asking for clarification, or explanations of design choices. 
Keep all internal planning in your thinking blocks, not in your response text.

## Tool-Use Efficiency (do not skip)
    
Tool calls emitted in the same assistant response run **concurrently**. Latency is dominated by LLM round-trips, not tool execution time.

- Batch all independent reads into one response. When you need multiple reference files (domain block, pattern block, capability blocks, `platform_architecture.md`, `architecture.md` schema ref), issue all `Read` calls in a single turn — not one per turn.
- Batch independent writes. `resources.json`, `README.md`, and `architecture.md` do NOT depend on each other's file contents — write them in parallel in the same response. Same for independent files in `instructions/`.
- Sequential is only correct when a later call genuinely needs the *result* of an earlier one."""


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


def _short_skill_hint(description: str, max_chars: int = 100) -> str:
    """Collapse a skill description to a one-line hint.

    Takes the first sentence (up to first period followed by space/newline), strips YAML
    folded-scalar markers, and truncates. Keeps discoverability after context compaction
    while avoiding dumping 400-char trigger lists into every turn.
    """
    if not description:
        return ""
    text = description.strip().lstrip(">-|").strip()
    for marker in (". ", ".\n", "\n\n"):
        idx = text.find(marker)
        if 0 < idx <= max_chars:
            text = text[:idx]
            break
    text = text.replace("\n", " ").strip()
    if len(text) > max_chars:
        text = text[: max_chars - 1].rstrip() + "…"
    return text
