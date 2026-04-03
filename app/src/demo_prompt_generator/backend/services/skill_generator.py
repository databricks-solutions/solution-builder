"""Generates a SKILL.md file from demo request form data using a Databricks FM endpoint."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from ..models import DemoRequestIn

logger = logging.getLogger(__name__)

# Architecture component IDs — the valid node types for Mermaid architecture diagrams.
# Mirrors SKILL_CATALOG in architecture-builder.tsx. Single source of truth for prompts.
ARCHITECTURE_COMPONENTS: dict[str, list[tuple[str, str]]] = {
    "Data Asset": [
        ("delta-table", "Managed or external Delta Lake table"),
        ("streaming-table", "Delta table with built-in streaming ingestion"),
        ("materialized-view", "Pre-computed view that auto-refreshes"),
        ("uc-volume", "Unity Catalog Volume for files and artifacts"),
        ("feature-table", "Feature engineering table for ML models"),
        ("vector-index", "Vector Search index for similarity queries"),
        ("external-file", "CSV, JSON, Parquet, or PDF files"),
    ],
    "Compute": [
        ("declarative-pipeline", "Lakeflow Declarative Pipeline (SDP)"),
        ("auto-loader", "Incremental file ingestion from cloud storage"),
        ("structured-streaming", "Spark Structured Streaming"),
        ("databricks-job", "Orchestrated multi-task job with scheduling"),
        ("model-serving", "Deploy and query Model Serving endpoints"),
        ("sql-warehouse", "Serverless SQL compute for analytics queries"),
        ("vector-search-endpoint", "Serve similarity search queries"),
        ("ai-agent", "Mosaic AI Agent (tool-use, RAG, multi-turn)"),
        ("ai-gateway", "LLM routing, rate limiting, and governance"),
        ("lakeflow-connect", "Managed connectors for SaaS and database ingestion"),
        ("zerobus-ingest", "Real-time Delta table ingestion via gRPC"),
        ("lakebase-sync", "Real-time sync from Delta to Lakebase"),
        ("synthetic-data-gen", "Generate realistic synthetic data"),
    ],
    "Application": [
        ("aibi-dashboard", "AI/BI Lakeview dashboard with visualizations"),
        ("genie-space", "Natural language SQL exploration"),
        ("databricks-app", "Full-stack app (FastAPI/React or Streamlit)"),
        ("agent-app", "LangGraph agent deployed as a Databricks App"),
        ("custom-mcp-app", "Custom MCP server as a Databricks App"),
        ("notebook", "Interactive notebook for analysis or orchestration"),
        ("alert", "Scheduled SQL alert with notifications"),
    ],
    "External": [
        ("lakebase-db", "Managed PostgreSQL for OLTP"),
        ("delta-sharing", "Cross-org data sharing endpoint"),
        ("external-mcp", "Third-party MCP server outside Databricks"),
    ],
}


def _arch_components_catalog() -> str:
    """Format architecture components for prompt inclusion."""
    lines: list[str] = []
    for category, components in ARCHITECTURE_COMPONENTS.items():
        ids = ", ".join(f"`{cid}`" for cid, _ in components)
        lines.append(f"{category}: {ids}")
    return "\n".join(lines)


def _features_summary(req: DemoRequestIn) -> str:
    mapping = {
        "delta_lake": "Delta Lake",
        "delta_live_tables": "Delta Live Tables",
        "unity_catalog": "Unity Catalog",
        "databricks_sql": "Databricks SQL / Dashboards",
        "mlflow": "MLflow / Experiments",
        "model_registry": "Model Registry",
        "model_serving": "Model Serving",
        "feature_store": "Feature Store",
        "automl": "AutoML",
        "mosaic_ai": "Mosaic AI / LLM Agents",
        "vector_search": "Vector Search",
        "structured_streaming": "Structured Streaming",
        "serverless_compute": "Serverless Compute",
        "workflows_jobs": "Workflows / Jobs",
        "genie": "Genie (AI/BI)",
        "databricks_apps": "Databricks Apps",
        "lakehouse_monitoring": "Lakehouse Monitoring",
    }
    lines = [label for field, label in mapping.items() if getattr(req.features, field, False)]
    return ", ".join(lines) if lines else "(none selected)"


def _build_system_prompt() -> str:
    return """\
You are a Databricks demo architect. You produce a single SKILL.md file that a \
Subject Matter Expert (SME) or an LLM agent can read and execute to build a \
complete demo end-to-end on the Databricks platform.

Follow these authoring rules strictly.

## Authoring rules

1. **Concise is key.** The reader is already expert at Databricks. Only include \
context they do NOT already know: domain-specific schemas, business logic, dataset \
relationships, acceptance criteria. Never explain what Delta Lake is or how Unity \
Catalog works — just reference them.

2. **YAML frontmatter.** Exactly two fields:
   - `name`: lowercase-hyphen, max 64 chars, describes the demo
   - `description`: third-person, says what the skill does AND when to use it. Max 1024 chars.

3. **Body under 500 lines.** If you need more, tell the reader to create reference files, \
but the SKILL.md itself must stay concise.

4. **Degrees of freedom.** Use HIGH freedom for creative decisions (dashboard layout, \
chart colors). Use LOW freedom for fragile operations (exact catalog/schema names, \
SQL DDL, table relationships). Provide exact table schemas with column names and types.

5. **Workflow pattern with checklist.** The Build Steps section must be a numbered list \
with a copyable checklist at the top. Each step names the **Databricks service or \
platform capability** being used (e.g. Spark Declarative Pipelines, Vector Search, \
Model Serving, AI/BI Dashboards).

6. **Consistent terminology.** Pick one term for each concept and stick with it.

7. **No YAML/JSON config dumps.** Describe datasets as markdown subsections with tables \
for schemas. Describe transformations in prose. This is a skill, not a config file.

8. **Template pattern for outputs.** For dashboards, Genie spaces, or apps, describe \
what they should contain with enough specificity to build but enough freedom to adapt.

9. **Reference Databricks services by official name.** For example: \
"Use Spark Declarative Pipelines to build the medallion architecture" or \
"Deploy a Model Serving endpoint for real-time scoring." Where domain-specific best \
practices apply, note what kind of SME guidance would be valuable \
(e.g. "An SME template for customer segmentation would define the recommended feature \
engineering approach and clustering strategy").

10. **Modern Databricks conventions.** Always use Spark Declarative Pipelines (SDP), NOT \
Delta Live Tables (DLT). Use Databricks Asset Bundles for project structure. Use serverless \
compute by default. Use CLUSTER BY (Liquid Clustering) not PARTITION BY.

## Proposal structure (keep it scannable — aim for ~40 lines max)

```
---
name: <demo-name>
description: "<One sentence: what this demo builds and who it's for.>"
---

# <Demo Title>

## Overview
2-3 sentences: audience, business problem, what makes it compelling, wow moment.

## Data
Bullet list of tables (name, one-line purpose, source type, ~row count). No schemas.

## What Gets Built
Bullet list of deliverables: pipelines, dashboards, Genie spaces, apps, models. \
One line each — just name + what it does.

## Build Steps
Numbered list. Each step names the Databricks service being used. Keep to 4-7 steps.

## Acceptance Criteria
3-5 bullet checklist of what "done" looks like.
```

This is a PROPOSAL — a scannable pitch, not a spec. All detail (schemas, SQL, architecture diagrams, \
directory layout) comes later during buildout in data-schema.md, architecture.md, storyline.md, \
project-structure.md, and walkthrough.md."""


def _build_user_prompt(req: DemoRequestIn) -> str:
    talking_pts = "; ".join(req.talking_points) if req.talking_points else "(none)"
    kpis = "; ".join(req.kpis) if req.kpis else "(none)"
    delivery = ", ".join(d.value for d in req.delivery_formats) if req.delivery_formats else "live walkthrough"

    return f"""\
Generate a SKILL.md for this demo request.

Demo name: {req.demo_name}
Account: {req.account_name or "Internal"}
Audience: {req.primary_audience}
Industry: {req.industry}

Business problem: {req.business_problem}
Wow moment: {req.wow_moment}
Scenario: {req.solution_summary}

Talking points: {talking_pts}
KPIs: {kpis}
Features: {_features_summary(req)}
Data source: {req.data_source_type.value}
Row count: {req.row_count or "sensible defaults"}

Length: {req.demo_length.value} min | Tone: {req.tone.value} | Delivery: {delivery}
Competitor: {req.competitor or "(none)"} | Avoid: {req.topics_to_avoid or "(none)"}
Cloud: {req.cloud.value if req.cloud else "aws"}
Workspace: {req.workspace_url or "(not specified)"}
Branding: {req.branding or "(none)"}
Extend existing: {req.existing_demo or "new"}
Context: {req.additional_context or "(none)"}

Output ONLY the SKILL.md content starting with the --- frontmatter. No commentary."""


async def generate_skill(
    req: DemoRequestIn,
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> str:
    """Call a Databricks FM endpoint to generate the SKILL.md content."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": _build_user_prompt(req)},
        ],
        "max_tokens": 8192,
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    content: str = data["choices"][0]["message"]["content"]
    if content.startswith("```"):
        content = content[content.index("\n") + 1 :]
    if content.rstrip().endswith("```"):
        content = content[: content.rfind("```")]
    return content.strip()


async def stream_inspiration(
    topic: str,
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[str]:
    """Stream a business use-case description for a given topic."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a Databricks solutions architect. Given a topic, "
                    "generate a compelling 3-4 paragraph business use-case that "
                    "could become a Databricks demo. Include: company persona, "
                    "pain point, data they have, and which Databricks capabilities "
                    "solve it. Be specific — use concrete numbers and metrics. "
                    "Plain prose, no markdown headers or bullets."
                ),
            },
            {"role": "user", "content": f"Generate a business use-case for: {topic}"},
        ],
        "max_tokens": 1024,
        "temperature": 0.8,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


# ---------------------------------------------------------------------------
# Workspace: generate SKILL.md from a plain topic (streaming)
# ---------------------------------------------------------------------------


async def stream_skill_from_topic(
    topic: str,
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[str]:
    """Stream a full SKILL.md generated from a freeform topic description."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {"role": "system", "content": _build_system_prompt()},
            {
                "role": "user",
                "content": (
                    f"Generate a SKILL.md for this use-case topic:\n\n"
                    f"{topic}\n\n"
                    f"Infer the best industry, audience, Databricks features, datasets, "
                    f"and demo structure from the topic. Use synthetic data. "
                    f"Target a 15-20 minute live walkthrough with a technical tone.\n\n"
                    f"Output ONLY the SKILL.md content starting with the --- frontmatter. "
                    f"No commentary."
                ),
            },
        ],
        "max_tokens": 8192,
        "temperature": 0.7,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


async def stream_skill_refinement(
    current_skill_md: str,
    user_message: str,
    history: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
    focused_sections: list[str] | None = None,
) -> AsyncIterator[str]:
    """Stream a refined SKILL.md based on user feedback."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }

    focus_note = ""
    if focused_sections:
        section_list = ", ".join(f'"{s}"' for s in focused_sections)
        focus_note = (
            f"\n\nSECTION FOCUS: The user wants changes specifically in: {section_list}. "
            f"Concentrate modifications on those sections. Keep all other sections identical."
        )

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                f"{_build_system_prompt()}\n\n"
                "You are now REFINING an existing SKILL.md based on the user's feedback. "
                "Output the COMPLETE updated SKILL.md (not a diff). Start with the --- "
                "frontmatter. Preserve all sections that the user did not ask to change. "
                f"No commentary before or after the SKILL.md.{focus_note}"
            ),
        },
        {
            "role": "user",
            "content": f"Here is the current SKILL.md:\n\n{current_skill_md}",
        },
        {
            "role": "assistant",
            "content": "I've reviewed the SKILL.md. What changes would you like?",
        },
    ]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    payload = {
        "messages": messages,
        "max_tokens": 8192,
        "temperature": 0.5,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


async def stream_section_refinement(
    section_title: str,
    section_content: str,
    user_message: str,
    full_skill_context: str,
    history: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[str]:
    """Stream a refined version of a single SKILL.md section."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "You are editing a SINGLE section of a SKILL.md file. "
                "You will receive the full SKILL.md for context, then the specific section to edit.\n\n"
                "Rules:\n"
                f"- Output ONLY the updated content for the '## {section_title}' section\n"
                f"- Do NOT include the '## {section_title}' header line itself\n"
                "- Do NOT output any other sections, frontmatter, or the full SKILL.md\n"
                "- Do NOT add commentary before or after the content\n"
                "- Preserve the style, formatting, and conventions of the existing skill\n"
                "- The section must remain consistent with the rest of the SKILL.md\n"
                "- If the section contains ### sub-headers, tables, or checklists, preserve that structure"
            ),
        },
        {
            "role": "user",
            "content": f"Here is the full SKILL.md for context:\n\n{full_skill_context}",
        },
        {
            "role": "assistant",
            "content": f"I've reviewed the full SKILL.md. I'm ready to edit the '## {section_title}' section.",
        },
    ]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({
        "role": "user",
        "content": (
            f"Current content of '## {section_title}':\n\n"
            f"{section_content}\n\n"
            f"Requested change: {user_message}\n\n"
            f"Output ONLY the updated section content. No header line, no other sections."
        ),
    })

    payload = {
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0.5,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


# ---------------------------------------------------------------------------
# Stage 1: Proposal generation
# ---------------------------------------------------------------------------


def _build_proposal_system_prompt() -> str:
    return f"""\
You are a Databricks demo architect. Generate a **short demo proposal** — \
a scannable pitch with storyline and architecture.

## Output format

Start with `# Demo Proposal: <Name>`. Use these EXACT section headers (the UI parses them):

## Background
3-5 sentences. The industry context, fictional company name, sector, size, what's broken \
today, the cost of the problem, and the key metrics. Combine industry context and business \
problem into one tight narrative. Be specific with numbers — "Apex Manufacturing, a mid-market \
auto parts producer with 12 plants, loses ~$4.2M/year from unplanned equipment downtime..."

## Proposed Solution
3-4 sentences. What does the Databricks demo build? Focus on the data flow and 2-3 key \
Databricks capabilities. NO external tools (no Kafka, Airflow, dbt, Snowflake, etc.) — \
everything is Databricks-native.

## Company & Persona
2 sentences. The fictional company's hero persona — name, role, and what they care about. \
Example: "Maria Chen, VP of Operations at Apex, is tired of reactive maintenance schedules..."

## Wow Moment
1-2 sentences. The single most impressive thing the audience sees. A live prediction, \
a Genie question answered, a real-time dashboard update — something specific and visual.

## Datasets
A markdown table with columns: Table | Description | ~Rows. One row per table. \
Keep to 3-5 tables max. Example:
| Table | Description | ~Rows |
|-------|-------------|-------|
| raw_sensor_readings | IoT telemetry from 200 machines | ~2M |

## Transformations
Brief bullet list of pipeline stages. One line each — just stage name + what it does. \
Example:
- **Bronze ingestion** — raw sensor data and maintenance logs
- **Silver cleaning** — dedupe, standardize timestamps, enrich with asset metadata
- **Gold features** — rolling averages, failure rate aggregations, ML feature tables

## Outputs
Brief bullet list of deliverables. One line each — name + what it does. Example:
- **Predictive Maintenance Dashboard** — real-time equipment health scores + failure alerts
- **Maintenance Genie Space** — natural language queries over maintenance history

## Build Steps
Numbered list, 4-6 steps that implement the Proposed Solution end-to-end. Every capability \
mentioned in Proposed Solution must map to at least one Build Step, and every Build Step must \
trace back to the Proposed Solution. Each step names the **Databricks service or capability** \
being used. Example:
1. **Synthetic Data Generation** (Spark + Faker) — Generate sensor and maintenance data
2. **Medallion Pipeline** (Spark Declarative Pipelines) — Build bronze→silver→gold pipeline

## Architecture
A Mermaid flowchart (`graph LR`) showing the data flow from the Proposed Solution. \
This diagram must be consistent with the Build Steps and Outputs above. Rules:
- Use `graph LR` (left-to-right).
- For medallion layers, use ONE node per layer listing tables: \
`bronze["Bronze Layer | table1, table2"]:::data_asset %% tier=bronze, format=delta`. \
Do NOT use subgraphs or individual table nodes for medallion layers.
- Compute nodes connect layers: `bronze -->|"Raw data"| pipeline1` then `pipeline1 -->|"Cleaned"| silver`.
- Applications (dashboards, Genie, apps) connect downstream of gold via SQL warehouse or directly.
- Node format: `id["skill-id | Description"]:::class %% metadata`.
- The `skill-id` in each node label MUST be from this registry — do NOT invent names:\n\
{_arch_components_catalog()}\n\
For medallion layers use `Bronze Layer`, `Silver Layer`, `Gold Layer` as the skill-id.
- Classes: `data_asset`, `compute`, `application`, `external`.
- Keep it minimal — only components from the Proposed Solution, no extras.

Example:
```mermaid
graph LR
  synth["synthetic-data-gen | Generate data"]:::compute
  bronze["Bronze Layer | raw_events, raw_users"]:::data_asset %% tier=bronze, format=delta
  pipeline1["declarative-pipeline | Cleanse and enrich"]:::compute
  gold["Gold Layer | user_metrics, event_summary"]:::data_asset %% tier=gold, format=delta
  wh["sql-warehouse | Query engine"]:::compute
  dash["aibi-dashboard | Analytics"]:::application
  synth -->|"Generated"| bronze
  bronze -->|"Raw"| pipeline1
  pipeline1 -->|"Enriched"| gold
  gold -->|"Query"| wh
  wh -->|"Results"| dash
```

## Rules
- Keep the ENTIRE proposal under 80 lines of markdown. Short and punchy.
- DATABRICKS ONLY. No external tools, middleware, or competing platforms. \
Everything runs natively on Databricks: SDP pipelines, Unity Catalog, Model Serving, \
AI/BI Dashboards, Genie, Databricks Apps, etc.
- Be specific — real numbers, realistic company names, domain terminology
- Use modern conventions: SDP (not DLT), Asset Bundles, serverless, Liquid Clustering
- Output ONLY the markdown. No commentary. Start with `# Demo Proposal: <Name>`"""


async def stream_proposal(
    topic: str,
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[str]:
    """Stream a demo proposal (storyline + architecture) for a use-case topic."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {"role": "system", "content": _build_proposal_system_prompt()},
            {
                "role": "user",
                "content": (
                    f"Generate a demo proposal for this use-case:\n\n{topic}\n\n"
                    f"Infer the best industry, audience, Databricks features, and demo structure. "
                    f"Output ONLY the proposal markdown."
                ),
            },
        ],
        "max_tokens": 6144,
        "temperature": 0.7,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


async def stream_proposal_refinement(
    current_proposal: str,
    user_message: str,
    history: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
    focused_sections: list[str] | None = None,
) -> AsyncIterator[str]:
    """Stream a refined proposal based on user feedback."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }

    focus_note = ""
    if focused_sections:
        section_list = ", ".join(f'"{s}"' for s in focused_sections)
        focus_note = (
            f"\n\nSECTION FOCUS: Concentrate modifications on: {section_list}. "
            f"Keep all other sections identical."
        )

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                f"{_build_proposal_system_prompt()}\n\n"
                "You are now REFINING an existing demo proposal. "
                "Output the COMPLETE updated proposal (not a diff). "
                "Preserve all sections the user did not ask to change. "
                f"No commentary before or after.{focus_note}"
            ),
        },
        {
            "role": "user",
            "content": f"Here is the current proposal:\n\n{current_proposal}",
        },
        {
            "role": "assistant",
            "content": "I've reviewed the proposal. What changes would you like?",
        },
    ]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    payload = {
        "messages": messages,
        "max_tokens": 6144,
        "temperature": 0.5,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


# ---------------------------------------------------------------------------
# Stage 2: Multi-file buildout
# ---------------------------------------------------------------------------

async def _stream_llm(
    messages: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str,
    max_tokens: int = 8192,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Shared streaming LLM call helper."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


# ---------------------------------------------------------------------------
# Stage 2: Agent-based buildout (generates reference.md)
# ---------------------------------------------------------------------------

# Read the luxebeauty reference example and capabilities catalog
# These are bundled as constants read from the skill directory at module load
_SKILL_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / ".claude" / "skills" / "databricks-demo-generator"
_REFERENCE_EXAMPLE = ""
_CAPABILITIES = ""
try:
    _ref_path = _SKILL_DIR / "references" / "luxebeauty-returns" / "reference.md"
    if _ref_path.exists():
        _REFERENCE_EXAMPLE = _ref_path.read_text()
    _cap_path = _SKILL_DIR / "capabilities.md"
    if _cap_path.exists():
        _CAPABILITIES = _cap_path.read_text()
except Exception:
    pass  # graceful fallback if files not found


def _build_buildout_system_prompt(proposal_md: str) -> str:
    """Build the system prompt for the agent that generates reference.md."""
    return f"""\
You are a Databricks demo architect. Your job is to generate a single reference.md \
file that completely specifies a demo — story, data schemas, component configurations, \
and walkthrough script.

# Format Example

Study this example carefully. Your output MUST match this structure and density level:

{_REFERENCE_EXAMPLE}

# Available Databricks Capabilities

{_CAPABILITIES}

# Approved Proposal

{proposal_md}

# Instructions

Generate a reference.md for the demo described in the proposal above.

RULES:
1. Match the example's section structure EXACTLY: Story, Data, Documents, Dashboard, \
Genie, Knowledge Assistant, Multi-Agent Supervisor, Walkthrough, Coherence Contract
2. Every line must be load-bearing — no filler, no explanatory prose
3. Include Scale Targets in the Data section with explicit math
4. Include Transformations showing Silver/Gold table names and join semantics
5. The Coherence Contract must list every identifier that appears across components
6. Dashboard must include ASCII layout with the 5-second test
7. Genie/KA instructions must be complete instruction blocks (not summaries)
8. Use fixed dates, NOT CURRENT_DATE()
9. Business metrics in $ terms
10. Target 400-500 lines total

Output ONLY the reference.md content. No commentary, no code fences wrapping the whole file."""


async def stream_agent_buildout(
    proposal_md: str,
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[str]:
    """Generate reference.md from an approved proposal using a single LLM call.

    Uses the same streaming pattern as stream_proposal but with buildout-specific
    system prompt that includes the luxebeauty example and capabilities catalog.
    """
    system_prompt = _build_buildout_system_prompt(proposal_md)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": (
            "Generate the reference.md for this demo now. "
            "Follow the format example exactly. Every section must be present."
        )},
    ]

    async for chunk in _stream_llm(
        messages=messages,
        databricks_host=databricks_host,
        databricks_token=databricks_token,
        model=model,
        max_tokens=16384,
        temperature=0.7,
    ):
        yield chunk


# ---------------------------------------------------------------------------
# Parallel multi-file buildout (collection-aware)
# ---------------------------------------------------------------------------


def _build_file_system_prompt(
    filename: str,
    purpose: str,
    block_context: str,
    proposal_md: str,
    dependency_outputs: dict[str, str],
) -> str:
    """Build a focused system prompt for generating a single output file."""
    deps_section = ""
    if dependency_outputs:
        deps_parts = []
        for dep_name, dep_content in dependency_outputs.items():
            deps_parts.append(f"### {dep_name}\n\n{dep_content}")
        deps_section = (
            "\n\n# Already-Generated Files (use for consistency)\n\n"
            + "\n\n---\n\n".join(deps_parts)
        )

    return f"""\
You are a Databricks demo architect generating a single build instruction file.

# Your Task

Generate **{filename}** — {purpose}

# Domain & Capability Context

{block_context}

# Approved Proposal

{proposal_md}
{deps_section}

# Rules

1. Output ONLY the content for {filename}. No commentary, no code fences wrapping the file.
2. Every line must be load-bearing — no filler, no explanatory prose.
3. Use identifiers, dates, and metrics that are CONSISTENT with any already-generated files above.
4. If this file defines data schemas, include exact column names, types, and realistic row counts.
5. If this file defines a dashboard, include ASCII layout and the 5-second anomaly test.
6. If this file defines agent instructions, include complete instruction blocks with sample questions.
7. If this is a walkthrough, write a 5-act demo script with specific timing and talk track.
8. Use fixed dates (not CURRENT_DATE). Express business impact in dollar terms.
9. Reference Databricks services by their official modern names (SDP not DLT, etc.)."""


async def _generate_file(
    filename: str,
    purpose: str,
    block_context: str,
    proposal_md: str,
    dependency_outputs: dict[str, str],
    databricks_host: str,
    databricks_token: str,
    model: str,
) -> str:
    """Generate a single file (non-streaming, for use in parallel tiers)."""
    system_prompt = _build_file_system_prompt(
        filename, purpose, block_context, proposal_md, dependency_outputs,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Generate {filename} now. Follow the rules exactly."},
    ]

    collected = ""
    async for chunk in _stream_llm(
        messages, databricks_host, databricks_token, model,
        max_tokens=8192, temperature=0.7,
    ):
        collected += chunk
    return collected.strip()


async def stream_parallel_buildout(
    proposal_md: str,
    collection_slug: str,
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[dict]:
    """Generate multiple output files in parallel tiers using the collection's dependency graph.

    Yields SSE-ready event dicts:
      - {"type": "tier_start", "tier": N, "files": [...]}
      - {"type": "file_start", "filename": "..."}
      - {"type": "file_complete", "filename": "...", "content": "..."}
      - {"type": "tier_complete", "tier": N}
      - {"type": "all_complete", "files": {...}}
      - {"type": "error", "content": "..."}
    """
    import asyncio
    from .collection_service import collection_service
    from .block_registry import registry

    coll = collection_service.get_collection_obj(collection_slug)
    if not coll:
        yield {"type": "error", "content": f"Collection '{collection_slug}' not found"}
        return

    block_context = registry.load_blocks(coll.block_slugs)
    tiers = coll.dependency_tiers()
    completed_files: dict[str, str] = {}

    # Generate meta.md — the context router for this package
    meta_lines = [
        f"# {coll.name}",
        "",
        f"**Collection**: `{coll.slug}`  ",
        f"**Industry**: {coll.industry}  ",
        f"**Description**: {coll.description}",
        "",
        "## Context Blocks",
        "",
        "These blocks provided the structured context for generating this package:",
        "",
    ]
    for slug in coll.block_slugs:
        block = registry.get_block(slug)
        if block:
            meta_lines.append(f"- **{block['name']}** (`{slug}`, {block['category']}) — {block['description'][:100]}")
        else:
            meta_lines.append(f"- `{slug}` (not found)")

    meta_lines += [
        "",
        "## Output Files",
        "",
        "Files in this package, listed in generation/execution order:",
        "",
    ]
    for tier_idx_m, tier in enumerate(tiers):
        parallel_note = f" (parallel)" if len(tier) > 1 else ""
        meta_lines.append(f"### Tier {tier_idx_m}{parallel_note}")
        meta_lines.append("")
        for f in tier:
            deps = ", ".join(f.depends_on) if f.depends_on and f.depends_on != ["*"] else "all previous"
            meta_lines.append(f"- **`{f.filename}`** — {f.purpose}  ")
            meta_lines.append(f"  Dependencies: {deps if f.depends_on else 'none'}")
        meta_lines.append("")

    meta_lines += [
        "## Reading Order",
        "",
        "1. Start with `00-meta.md` (this file) for package overview",
        "2. Read `01-story-and-data.md` for the narrative and data schemas",
        "3. Read capability files (02-xx through 05-xx) for component specs",
        "4. Read the walkthrough last for the demo script",
        "",
        "## Execution Order",
        "",
        "An agent executing this package should follow the tier order above.",
        "Files within the same tier can be built in parallel.",
        "Each file contains self-contained build instructions for its component.",
    ]

    meta_content = "\n".join(meta_lines)
    completed_files["00-meta.md"] = meta_content
    yield {"type": "file_start", "filename": "00-meta.md"}
    yield {"type": "file_complete", "filename": "00-meta.md", "content": meta_content}

    for tier_idx, tier_files in enumerate(tiers):
        filenames = [f.filename for f in tier_files]
        yield {"type": "tier_start", "tier": tier_idx, "files": filenames}

        async def _gen_one(output_file):
            """Generate a single file and return (filename, content)."""
            # Gather dependency outputs for this file
            deps = {}
            for dep_name in output_file.depends_on:
                if dep_name == "*":
                    deps = dict(completed_files)
                    break
                if dep_name in completed_files:
                    deps[dep_name] = completed_files[dep_name]

            content = await _generate_file(
                output_file.filename,
                output_file.purpose,
                block_context,
                proposal_md,
                deps,
                databricks_host,
                databricks_token,
                model,
            )
            return output_file.filename, content

        # Emit file_start for all files in this tier
        for f in tier_files:
            yield {"type": "file_start", "filename": f.filename}

        # Generate all files in this tier concurrently
        tasks = [_gen_one(f) for f in tier_files]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception):
                yield {"type": "error", "content": f"File generation failed: {result}"}
                continue
            filename, content = result
            # Strip markdown fences if present
            clean = content.strip()
            if clean.startswith("```"):
                clean = clean[clean.index("\n") + 1:]
            if clean.rstrip().endswith("```"):
                clean = clean[:clean.rfind("```")]
            clean = clean.strip()

            completed_files[filename] = clean
            yield {"type": "file_complete", "filename": filename, "content": clean}

        yield {"type": "tier_complete", "tier": tier_idx}

    yield {"type": "all_complete", "files": completed_files}


async def stream_file_refinement(
    filename: str,
    file_content: str,
    all_files: dict[str, str],
    proposal_md: str,
    user_message: str,
    history: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
) -> AsyncIterator[str]:
    """Stream a refined version of a single package file."""
    other_files_ctx = "\n\n".join(
        f"### {name}\n\n{content}" for name, content in all_files.items() if name != filename
    )

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                f"You are editing {filename} in a demo package. "
                f"Output the COMPLETE updated {filename} content. "
                "Preserve consistency with the other package files.\n\n"
                f"Other package files for context:\n\n{other_files_ctx}"
            ),
        },
        {
            "role": "user",
            "content": f"Current {filename}:\n\n{file_content}",
        },
        {
            "role": "assistant",
            "content": f"I've reviewed {filename}. What changes would you like?",
        },
    ]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    async for chunk in _stream_llm(
        messages, databricks_host, databricks_token, model, max_tokens=8192, temperature=0.5,
    ):
        yield chunk


def parse_proposal_metadata(proposal_md: str) -> dict[str, str]:
    """Extract name from proposal title line."""
    result: dict[str, str] = {"name": "untitled", "description": ""}
    for line in proposal_md.split("\n"):
        if line.startswith("# Demo Proposal:"):
            result["name"] = line.split(":", 1)[1].strip()
            break
        if line.startswith("# "):
            result["name"] = line[2:].strip()
            break
    return result


def parse_skill_metadata(skill_md: str) -> dict[str, str]:
    """Extract name and description from SKILL.md YAML frontmatter."""
    result: dict[str, str] = {"name": "untitled", "description": "", "industry": ""}
    if not skill_md.startswith("---"):
        return result
    end = skill_md.index("---", 3) if "---" in skill_md[3:] else -1
    if end == -1:
        return result
    fm = skill_md[3:end].strip()
    for line in fm.split("\n"):
        if line.startswith("name:"):
            result["name"] = line.split(":", 1)[1].strip().strip("\"'")
        elif line.startswith("description:"):
            result["description"] = line.split(":", 1)[1].strip().strip("\"'")
    return result


# ---------------------------------------------------------------------------
# Block agent: modify collection blocks via tool-use loop
# ---------------------------------------------------------------------------

BLOCK_AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_blocks",
            "description": "Search available blocks by keyword. Returns matching blocks with slug, name, category, and description.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query (e.g. 'healthcare', 'dashboard', 'streaming')"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_blocks",
            "description": "Get the current list of blocks in this collection with their names and categories.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_block",
            "description": "Add an EXISTING block to the collection by its slug. Only use slugs returned by search_blocks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The block slug to add"},
                },
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_block",
            "description": "Remove a block from the collection by its slug.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The block slug to remove"},
                },
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_block",
            "description": "Create a NEW block that doesn't exist yet. Use this when the user needs context that isn't covered by any existing block. Provide a slug, name, category, and the full content (markdown with structured context).",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "Unique kebab-case slug for the new block"},
                    "name": {"type": "string", "description": "Display name for the block"},
                    "category": {"type": "string", "enum": ["domain", "capability", "pattern"], "description": "Block category"},
                    "tags": {"type": "string", "description": "Comma-separated tags"},
                    "description": {"type": "string", "description": "One-paragraph description of what context this block provides"},
                    "content": {"type": "string", "description": "Full block content in markdown — industry terms, KPIs, personas, configuration guidance, etc."},
                },
                "required": ["slug", "name", "category", "description", "content"],
            },
        },
    },
]


async def stream_block_agent(
    current_slugs: list[str],
    user_message: str,
    history: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str,
) -> AsyncIterator[dict]:
    """Agent loop that modifies collection blocks via tool calls.

    Yields SSE-ready events:
      - {"type": "agent_thinking", "content": "..."}
      - {"type": "block_added", "slug": "..."}
      - {"type": "block_removed", "slug": "..."}
      - {"type": "agent_message", "content": "..."}
      - {"type": "blocks_updated", "slugs": [...]}
    """
    from .block_registry import registry

    working_slugs = list(current_slugs)
    block_index = registry.get_block_index()

    system_prompt = f"""\
You are a collection editor. You modify which context blocks are in a demo collection.

# Available Blocks
{block_index}

# CRITICAL RULES — read carefully

1. **MINIMAL CHANGES ONLY.** Only add/remove the blocks the user specifically asked about. \
NEVER remove blocks the user didn't mention. If the user says "switch to retail," that means \
swap the domain block — keep ALL capability and pattern blocks untouched.

2. **Always call `get_current_blocks` FIRST** to see what's in the collection before making changes.

3. **Search before adding.** Use `search_blocks` to find the right slug. Don't guess slugs.

4. **Swaps = remove old + add new.** When the user says "change X to Y" or "switch to Y", \
remove only the block that matches X (same category), then add Y. Keep everything else.

5. **Create blocks when needed.** If the user asks for something that doesn't exist as a \
block (e.g. "add context about supply chain optimization"), use `create_block` to generate \
a new block with rich, useful content. Write 40-80 lines of structured markdown with \
terminology, KPIs, personas, and practical guidance.

6. After changes, respond with a brief summary of what changed and what the collection now contains."""

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
    ]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    for _iteration in range(10):
        try:
            response = await _call_llm_with_tools(
                messages, BLOCK_AGENT_TOOLS, databricks_host, databricks_token, model,
            )
        except Exception as exc:
            yield {"type": "error", "content": f"Agent call failed: {exc}"}
            return

        choice = response.get("choices", [{}])[0]
        message = choice.get("message", {})
        finish_reason = choice.get("finish_reason", "")

        messages.append(message)

        tool_calls = message.get("tool_calls")
        if not tool_calls or finish_reason == "stop":
            text = message.get("content", "")
            if text:
                yield {"type": "agent_message", "content": text}
            yield {"type": "blocks_updated", "slugs": working_slugs}
            return

        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            try:
                fn_args = json.loads(tc["function"]["arguments"])
            except json.JSONDecodeError:
                fn_args = {}
            call_id = tc["id"]

            if fn_name == "search_blocks":
                query = fn_args.get("query", "")
                results = registry.search_blocks(query)[:5]
                tool_result = json.dumps(results, indent=2)
                messages.append({"role": "tool", "tool_call_id": call_id, "content": tool_result})
                yield {"type": "agent_thinking", "content": f"Searching blocks for \"{query}\"..."}

            elif fn_name == "get_current_blocks":
                current = []
                for slug in working_slugs:
                    block = registry.get_block(slug)
                    if block:
                        current.append({"slug": slug, "name": block["name"], "category": block["category"]})
                    else:
                        current.append({"slug": slug, "name": slug, "category": "unknown"})
                tool_result = json.dumps(current, indent=2)
                messages.append({"role": "tool", "tool_call_id": call_id, "content": tool_result})
                yield {"type": "agent_thinking", "content": "Checking current blocks..."}

            elif fn_name == "add_block":
                slug = fn_args.get("slug", "")
                if slug and slug not in working_slugs:
                    block = registry.get_block(slug)
                    if block:
                        working_slugs.append(slug)
                        messages.append({"role": "tool", "tool_call_id": call_id, "content": f"Added {slug} ({block['name']})"})
                        yield {"type": "block_added", "slug": slug, "name": block["name"], "category": block["category"]}
                    else:
                        messages.append({"role": "tool", "tool_call_id": call_id, "content": f"Block '{slug}' not found"})
                elif slug in working_slugs:
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": f"{slug} is already in the collection"})
                else:
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": "No slug provided"})

            elif fn_name == "remove_block":
                slug = fn_args.get("slug", "")
                if slug and slug in working_slugs:
                    working_slugs.remove(slug)
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": f"Removed {slug}"})
                    yield {"type": "block_removed", "slug": slug}
                elif slug:
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": f"{slug} is not in the collection"})
                else:
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": "No slug provided"})

            elif fn_name == "create_block":
                slug = fn_args.get("slug", "")
                name = fn_args.get("name", slug)
                category = fn_args.get("category", "capability")
                tags_str = fn_args.get("tags", "")
                description = fn_args.get("description", "")
                content = fn_args.get("content", "")

                if not slug or not content:
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": "slug and content are required"})
                else:
                    from .block_registry import Block
                    tags = [t.strip() for t in tags_str.split(",") if t.strip()] if tags_str else []
                    new_block = Block(
                        slug=slug,
                        name=name,
                        category=category,
                        tags=tags,
                        description=description,
                        content=content,
                        related=[],
                    )
                    registry.save_block(new_block, created_by="block-agent")
                    working_slugs.append(slug)
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": f"Created and added new block: {slug} ({name})"})
                    yield {"type": "block_created", "slug": slug, "name": name, "category": category}
                    yield {"type": "block_added", "slug": slug, "name": name, "category": category}

            else:
                messages.append({"role": "tool", "tool_call_id": call_id, "content": f"Unknown tool: {fn_name}"})

    yield {"type": "blocks_updated", "slugs": working_slugs}


# ---------------------------------------------------------------------------
# Agent mode: cross-file editing via tool-use loop
# ---------------------------------------------------------------------------

from ..models import PACKAGE_FILES as _PACKAGE_FILES  # noqa: E402

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the full content of a file in the demo package.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "enum": list(_PACKAGE_FILES),
                        "description": "The file to read.",
                    },
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Overwrite a file in the demo package with new content. Use this after reading the file to make targeted edits.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "enum": list(_PACKAGE_FILES),
                        "description": "The file to write.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The complete new content for the file.",
                    },
                },
                "required": ["filename", "content"],
            },
        },
    },
]

_AGENT_MAX_ITERATIONS = 15


def _build_agent_system_prompt(files: dict[str, str]) -> str:
    """Build a system prompt for the agent, including file summaries."""
    file_summaries = []
    for fn in _PACKAGE_FILES:
        content = files.get(fn, "")
        if content:
            first_line = content.split("\n", 1)[0][:120]
            size = len(content)
            file_summaries.append(f"  - {fn} ({size} chars): {first_line}")
        else:
            file_summaries.append(f"  - {fn}: (empty)")
    summaries = "\n".join(file_summaries)

    return f"""You are a demo package editor for Databricks industry demos. The package has 6 interconnected markdown files:

{summaries}

## How to work
1. Use `read_file` to inspect any file before editing it.
2. Use `write_file` to update a file with its complete new content.
3. When a change affects multiple files (e.g. changing the industry), read and update ALL affected files for consistency.
4. Keep the existing markdown structure and formatting conventions.
5. Preserve YAML frontmatter in SKILL.md.
6. Be thorough but concise — make the requested changes and maintain cross-file consistency.
7. After finishing edits, respond with a brief summary of what you changed."""


async def _call_llm_with_tools(
    messages: list[dict],
    tools: list[dict],
    databricks_host: str,
    databricks_token: str,
    model: str,
    max_tokens: int = 8192,
    temperature: float = 0.5,
) -> dict:
    """Non-streaming LLM call with tool definitions. Returns full response dict."""
    url = f"{databricks_host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {databricks_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": messages,
        "tools": tools,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0),
    ) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def stream_agent_refine(
    files: dict[str, str],
    user_message: str,
    history: list[dict[str, str]],
    databricks_host: str,
    databricks_token: str,
    model: str,
) -> AsyncIterator[dict]:
    """Agentic loop: LLM decides which files to read/write via tool calls.

    Yields SSE-ready event dicts:
      - {"type": "agent_thinking", "content": "..."}
      - {"type": "agent_reading", "filename": "..."}
      - {"type": "file_start", "filename": "..."}
      - {"type": "file_content", "filename": "...", "content": "..."}
      - {"type": "file_complete", "filename": "..."}
      - {"type": "agent_message", "content": "..."}
    """
    working_files = dict(files)  # mutable copy

    messages: list[dict] = [
        {"role": "system", "content": _build_agent_system_prompt(working_files)},
    ]
    # Append conversation history
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    # Append current user message
    messages.append({"role": "user", "content": user_message})

    for iteration in range(_AGENT_MAX_ITERATIONS):
        logger.info("Agent iteration %d", iteration + 1)

        try:
            response = await _call_llm_with_tools(
                messages, AGENT_TOOLS, databricks_host, databricks_token, model,
            )
        except httpx.HTTPStatusError as exc:
            yield {"type": "error", "content": f"LLM call failed: {exc.response.status_code}"}
            return
        except Exception as exc:
            yield {"type": "error", "content": f"LLM call failed: {exc}"}
            return

        choice = response.get("choices", [{}])[0]
        message = choice.get("message", {})
        finish_reason = choice.get("finish_reason", "")

        # Append assistant message to history
        messages.append(message)

        # If no tool calls, we're done — the model gave a final text response
        tool_calls = message.get("tool_calls")
        if not tool_calls or finish_reason == "stop":
            text = message.get("content", "")
            if text:
                yield {"type": "agent_message", "content": text}
            return

        # Process all tool calls
        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            try:
                fn_args = json.loads(tc["function"]["arguments"])
            except json.JSONDecodeError:
                fn_args = {}
            call_id = tc["id"]

            if fn_name == "read_file":
                filename = fn_args.get("filename", "")
                yield {"type": "agent_reading", "filename": filename}
                content = working_files.get(filename, "")
                tool_result = content if content else f"(file {filename} is empty)"
                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": tool_result,
                })

            elif fn_name == "write_file":
                filename = fn_args.get("filename", "")
                content = fn_args.get("content", "")
                working_files[filename] = content
                yield {"type": "file_start", "filename": filename}
                yield {"type": "file_content", "filename": filename, "content": content}
                yield {"type": "file_complete", "filename": filename}
                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": f"Successfully wrote {len(content)} chars to {filename}.",
                })

            else:
                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": f"Unknown tool: {fn_name}",
                })

    # Hit iteration cap
    yield {"type": "agent_message", "content": "Reached the maximum number of editing steps. Please review the changes and continue if needed."}
