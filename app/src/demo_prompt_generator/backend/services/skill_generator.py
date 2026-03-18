"""Generates a SKILL.md file from demo request form data using a Databricks FM endpoint."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from ..models import DemoRequestIn

logger = logging.getLogger(__name__)

# ai-dev-kit skills the generated skill can reference in build steps.
AI_DEV_KIT_SKILLS: list[tuple[str, str]] = [
    ("databricks-synthetic-data-generation", "Generate realistic synthetic data with Faker and Spark"),
    ("databricks-unstructured-pdf-generation", "Generate synthetic PDFs for RAG use cases"),
    ("databricks-dbsql", "Databricks SQL features and SQL warehouse capabilities"),
    ("databricks-spark-declarative-pipelines", "Spark Declarative Pipelines (SDP) for medallion architecture"),
    ("databricks-spark-structured-streaming", "Spark Structured Streaming for production workloads"),
    ("databricks-aibi-dashboards", "Create AI/BI Lakeview dashboards"),
    ("databricks-genie", "Create and query Genie Spaces for natural language SQL"),
    ("databricks-vector-search", "Vector Search endpoints, indexes, queries for RAG"),
    ("databricks-model-serving", "Deploy and query Model Serving endpoints"),
    ("databricks-mlflow-evaluation", "MLflow GenAI agent evaluation with scorers"),
    ("databricks-agent-bricks", "Knowledge Assistants, Genie Spaces, Supervisor Agents"),
    ("databricks-unity-catalog", "Unity Catalog system tables and volume operations"),
    ("databricks-jobs", "Create, run, and manage Databricks Jobs"),
    ("databricks-asset-bundles", "Databricks Asset Bundles for multi-env deployment"),
    ("databricks-app-apx", "Full-stack Databricks Apps with APX (FastAPI + React)"),
    ("databricks-app-python", "Python Databricks Apps (Streamlit, Dash, Gradio, etc.)"),
    ("databricks-metric-views", "Unity Catalog metric views for governed business metrics"),
    ("databricks-lakebase-provisioned", "Lakebase Provisioned managed PostgreSQL"),
    ("databricks-lakebase-autoscale", "Lakebase Autoscale with branching and scale-to-zero"),
    ("databricks-config", "Databricks profile and auth configuration"),
    ("databricks-python-sdk", "Databricks Python SDK, Connect, CLI, REST API"),
    ("instrumenting-with-mlflow-tracing", "MLflow Tracing for observability"),
    ("databricks-zerobus-ingest", "Zerobus Ingest for real-time Delta table ingestion"),
    ("spark-python-data-source", "Custom Spark data source connectors"),
]


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


def _skills_catalog() -> str:
    return "\n".join(f"- `{name}`: {desc}" for name, desc in AI_DEV_KIT_SKILLS)


def _build_system_prompt() -> str:
    return f"""\
You are a Databricks demo architect. You produce a single SKILL.md file that an LLM \
(with the ai-dev-kit skills and Databricks MCP tools) can read and execute to build a \
complete demo end-to-end.

Follow these authoring rules strictly. They come from the official Claude skill best \
practices.

## Authoring rules

1. **Concise is key.** The executing LLM is already expert at Databricks. Only include \
context it does NOT already know: domain-specific schemas, business logic, dataset \
relationships, acceptance criteria. Never explain what Delta Lake is or how Unity \
Catalog works — just reference them.

2. **YAML frontmatter.** Exactly two fields:
   - `name`: lowercase-hyphen, max 64 chars, describes the demo
   - `description`: third-person, says what the skill does AND when to use it. Max 1024 chars.

3. **Body under 500 lines.** If you need more, tell the LLM to create reference files, \
but the SKILL.md itself must stay concise.

4. **Degrees of freedom.** Use HIGH freedom for creative decisions (dashboard layout, \
chart colors). Use LOW freedom for fragile operations (exact catalog/schema names, \
SQL DDL, table relationships). Provide exact table schemas with column names and types.

5. **Workflow pattern with checklist.** The Build Steps section must be a numbered list \
with a copyable checklist at the top. Each step names the specific ai-dev-kit skill \
to read and may also reference Databricks MCP tools.

6. **Consistent terminology.** Pick one term for each concept and stick with it.

7. **No YAML/JSON config dumps.** Describe datasets as markdown subsections with tables \
for schemas. Describe transformations in prose. This is a skill, not a config file.

8. **Template pattern for outputs.** For dashboards, Genie spaces, or apps, describe \
what they should contain with enough specificity to build but enough freedom to adapt.

9. **Reference ai-dev-kit skills by directory name.** For example: \
"Read the `databricks-synthetic-data-generation` skill and use it to create these tables."

10. **Reference Databricks MCP tools by name where useful.** For example: \
"Use `execute_sql` to run the transformation queries" or \
"Use `create_or_update_pipeline` to deploy the SDP pipeline."

11. **Modern Databricks conventions.** Always use Spark Declarative Pipelines (SDP), NOT \
Delta Live Tables (DLT). Use Databricks Asset Bundles for project structure. Use serverless \
compute by default. Use CLUSTER BY (Liquid Clustering) not PARTITION BY.

## Available ai-dev-kit skills

{_skills_catalog()}

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
Numbered list. Each step names an ai-dev-kit skill in backticks. Keep to 4-7 steps.

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
trace back to the Proposed Solution. Each step names ONE ai-dev-kit skill in backticks. Example:
1. Generate synthetic sensor and maintenance data using `databricks-synthetic-data-generation`
2. Build bronze→silver→gold SDP pipeline using `databricks-spark-declarative-pipelines`

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

## Available ai-dev-kit skills

{_skills_catalog()}

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

_BUILDOUT_FILE_PROMPTS: dict[str, tuple[str, str]] = {
    "SKILL.md": (
        "You are generating SKILL.md — the router/homepage that an LLM reads first when "
        "building this demo. It is NOT a reference document. It contains ZERO data details.\n\n"
        "SKILL.md has exactly these sections:\n"
        "1. **Frontmatter** (---name/description---)\n"
        "2. **Overview** — one paragraph: who it's for, what problem it solves, why it's compelling\n"
        "3. **Before You Start** — mandatory reads list:\n"
        "   - Read [storyline.md](storyline.md) for business context and narrative arc\n"
        "   - Read [architecture.md](architecture.md) for the component diagram and binding contract\n"
        "   - Read [data-schema.md](data-schema.md) for all table schemas and transformation SQL\n"
        "   - Read [project-structure.md](project-structure.md) for target directory layout\n"
        "   - Read [walkthrough.md](walkthrough.md) for demo walkthrough script and talk track\n"
        "4. **Prerequisites** — catalog, schema, workspace assumptions (short bullet list)\n"
        "5. **Build Steps** — numbered checklist, each step references an ai-dev-kit skill "
        "in backticks AND the relevant reference file. IMPORTANT: Each step must include TWO verifications:\n"
        "   - **Component verification:** Run a specific check and output the result. For tables: "
        "run a SELECT query and show output. For endpoints: send a request and show response. "
        "For dashboards/apps: open in Chrome DevTools, take a screenshot, check for console errors. "
        "'It exists' is not verification — show it works.\n"
        "   - **Integration verification:** Confirm the component is connected to its upstream and "
        "downstream neighbors as specified in architecture.md. Show evidence of the live data flow.\n"
        "   Format each step as:\n"
        "   1. **<What should exist>** (<Databricks service>) — <Brief description>.\n"
        "      - **Verify:** <specific check with expected output>\n"
        "      - **Integration:** <what to confirm and how>\n"
        "6. **Acceptance Criteria** — GATE: every item must pass before proceeding to walkthrough. "
        "Checklist of what 'done' looks like. MUST include:\n"
        "   - [ ] Every architecture.md connection is implemented as a live runtime dependency — "
        "for each arrow in the diagram, name the component that makes the call and show evidence it works.\n"
        "7. **App Testing** (REQUIRED if architecture includes `databricks-app`) — "
        "Define end-to-end user journey tests that cover every tab, page, button, form, and "
        "interactive element in the app. Each test specifies: journey name, exact steps "
        "(navigate, click, fill, verify), expected outcome. At minimum test:\n"
        "   - App loads without console errors\n"
        "   - Every tab/page is reachable and renders correctly\n"
        "   - All forms submit successfully\n"
        "   - All data visualizations populate with real data\n"
        "   - All interactive elements respond correctly\n"
        "   Execute tests via Chrome DevTools. If any fail, fix, redeploy, and re-run.\n\n"
        "ABSOLUTE RULES:\n"
        "- NO Datasets section. NO table names. NO schemas. NO column lists. That's data-schema.md's job.\n"
        "- NO Transformations section. NO SQL. That's data-schema.md's job.\n"
        "- NO directory trees. That's project-structure.md's job.\n"
        "- NO architecture diagrams. That's architecture.md's job.\n"
        "- NO Outputs section with detailed descriptions. Build Steps cover what gets built.\n"
        "- SKILL.md is a ROUTING TABLE, not a reference document. Keep it under 100 lines.",
        "Generate SKILL.md from this approved proposal. "
        "Strip ALL data details — no table names, no schemas, no column lists, no SQL, no data generation instructions. "
        "All data information lives ONLY in data-schema.md. SKILL.md just says 'Read data-schema.md'. "
        "Architecture lives ONLY in architecture.md. SKILL.md just says 'Read architecture.md'. "
        "Each build step MUST include component verification and integration verification. "
        "Keep it tight: overview, mandatory reads, prerequisites, build steps with dual verification, "
        "acceptance criteria gate, and app testing if applicable.\n\n"
        "Output ONLY the SKILL.md starting with --- frontmatter. No commentary.",
    ),
    "storyline.md": (
        "You are generating storyline.md — the expanded business narrative for a demo package. "
        "This file is referenced by SKILL.md and provides domain context, company persona, "
        "narrative arc, wow moment, and domain terminology that the downstream LLM uses "
        "when building user-facing outputs (dashboards, Genie spaces, apps).",
        "Generate storyline.md using the proposal's narrative sections as a starting point, "
        "enriched with the concrete scope established in SKILL.md. "
        "Include: Industry Context, Company Persona, Business Problem, Narrative Arc, "
        "Wow Moment, Domain Terminology glossary.\n\n"
        "IMPORTANT: Start the file with an imperative instruction paragraph addressed to the executing agent, e.g.:\n"
        "'Use this narrative when building all user-facing outputs — dashboards, Genie spaces, apps, "
        "and documentation. All labels, descriptions, column aliases, and sample queries should reflect "
        "the company persona, industry terminology, and business context defined below.'\n\n"
        "Output ONLY the storyline.md content starting with `# Storyline`. No frontmatter, no commentary.",
    ),
    "architecture.md": (
        "You are generating architecture.md — the binding contract for every component and "
        "connection in the demo. This is a Mermaid flowchart that defines what gets deployed. "
        "The executing agent MUST implement every component and every connection exactly as specified.\n\n"
        "DEFAULT STARTING POINT: Unless the user specifies a real external data source, "
        "demos begin with synthetic data generation.\n\n"
        "REFERENTIAL INTEGRITY: When synthetic data spans multiple tables with shared keys, "
        "the spec MUST state that all tables are generated from a single keyspace with explicit "
        "parent → child ordering and cardinality constraints.\n\n"
        "## Format rules\n"
        "- Use `graph LR` (left-to-right flow).\n"
        "- Each node ID must be a valid Mermaid identifier (letters, digits, underscores).\n"
        "- Node label format: `id[\"skill-id | Description\"]` — the label contains the skill-id "
        "and a human-readable description separated by ` | `.\n"
        "- Append a `:::` class to each node for its type: `:::data_asset`, `:::compute`, "
        "`:::application`, `:::external`.\n"
        "- Metadata (tier, format, pattern) goes in a Mermaid comment on the same line: "
        "`%% tier=bronze, format=delta`.\n"
        "- Edges use `-->|label|` syntax where the label describes what flows.\n"
        "- **MEDALLION LAYERS (CRITICAL):** When using bronze/silver/gold tiers, represent each layer as a "
        "SINGLE node that lists ALL tables in that layer inside the label. Format:\n"
        "  `bronze[\"Bronze Layer | table1, table2, table3\"]:::data_asset %% tier=bronze, format=delta`\n"
        "  Do NOT use `subgraph` for medallion layers. Do NOT create separate nodes for individual tables "
        "within a layer. Each layer is ONE node. Connections go from layer nodes to compute nodes.\n"
        "  WRONG: `subgraph \"Bronze Layer\"` with individual table nodes inside.\n"
        "  RIGHT: `bronze[\"Bronze Layer | raw_sales, raw_customers\"]:::data_asset %% tier=bronze`\n"
        "- Use `subgraph` only for non-medallion logical groupings (e.g., an \"Analytics\" section).\n"
        "- Data assets connect THROUGH compute nodes, never directly to other data assets.\n\n"
        f"## Valid skill IDs\n"
        f"{_arch_components_catalog()}\n\n"
        "Metadata keys: `tier` (raw/bronze/silver/gold), `format` (delta/csv/json/parquet/pdf/iceberg/avro), "
        "`pattern` (batch/streaming/real-time/on-demand), `compute` (serverless/classic, default serverless).\n\n"
        "## Architecture is a Contract\n"
        "The Architecture section is a binding contract, not a reference diagram. These rules "
        "are non-negotiable:\n"
        "1. **No bypassing components.** If the architecture specifies a component in the data "
        "path (e.g., a model serving endpoint for scoring, a vector search index for retrieval), "
        "the pipeline MUST call that component at runtime. The executing agent must NOT substitute "
        "a simpler inline implementation.\n"
        "2. **Every connection is a runtime dependency.** Each connection must be implemented as "
        "an actual data flow. A component that is deployed but never called is not complete.\n"
        "3. **No merging separate components.** If the architecture lists two distinct components, "
        "they must be implemented as two separate resources, not combined into one.\n"
        "4. **This is a demo, not a production system.** The goal is to showcase Databricks "
        "capabilities. Simpler approaches that skip components defeat the purpose.\n\n"
        "## Example\n"
        "```mermaid\ngraph LR\n"
        "  synth1[\"synthetic-data-gen | Generate synthetic retail data\"]:::compute %% pattern=batch\n"
        "  bronze[\"Bronze Layer | raw_sales, raw_customers, raw_products\"]:::data_asset %% tier=bronze, format=delta\n"
        "  pipeline1[\"declarative-pipeline | Cleanse and enrich\"]:::compute %% pattern=batch\n"
        "  silver[\"Silver Layer | enriched_sales, customer_profiles\"]:::data_asset %% tier=silver, format=delta\n"
        "  pipeline2[\"declarative-pipeline | Build aggregates\"]:::compute %% pattern=batch\n"
        "  gold[\"Gold Layer | sales_summary, customer_ltv\"]:::data_asset %% tier=gold, format=delta\n"
        "  wh1[\"sql-warehouse | Analytics query engine\"]:::compute %% pattern=on-demand\n"
        "  dash1[\"aibi-dashboard | Sales analytics dashboard\"]:::application\n"
        "  synth1 -->|\"Generated records\"| bronze\n"
        "  bronze -->|\"Raw data\"| pipeline1\n"
        "  pipeline1 -->|\"Cleaned data\"| silver\n"
        "  silver -->|\"Enriched data\"| pipeline2\n"
        "  pipeline2 -->|\"Aggregated data\"| gold\n"
        "  gold -->|\"Gold data for queries\"| wh1\n"
        "  wh1 -->|\"SQL query results\"| dash1\n```",
        "Generate architecture.md from the approved proposal and storyline. "
        "Create a complete Mermaid flowchart covering every component and connection in the demo. "
        "Follow the format rules and skill IDs exactly. Every component in the proposal's "
        "Build Steps and Outputs must appear as a node. Every data flow must appear as an edge.\n\n"
        "IMPORTANT: Start the file with an imperative instruction paragraph addressed to the executing agent, e.g.:\n"
        "'Build every component and connection in the following diagram — this is the binding contract "
        "for what gets deployed. The Mermaid flowchart below defines every component, connection, and "
        "logical grouping in the demo. Implement every node as a deployed resource and every edge as "
        "a live runtime dependency. Do NOT bypass, merge, or skip any component.'\n\n"
        "Output ONLY the architecture.md content starting with `# Architecture`. No commentary.",
    ),
    "data-schema.md": (
        "You are generating data-schema.md — the single source of truth for all data in a demo package. "
        "This file has THREE jobs:\n"
        "1. Define exact table schemas for synthetic data generation\n"
        "2. Specify referential integrity, row counts, and data correlations\n"
        "3. Show the transformation SQL that builds silver/gold tables from bronze\n\n"
        "CRITICAL: Do NOT just describe transformations in prose. Show actual SQL code blocks "
        "that demonstrate the joins, filters, aggregations, and business rules. The downstream LLM "
        "will use these SQL examples as the blueprint for building SDP (Spark Declarative Pipelines).\n\n"
        "## Row Count Guidance\n"
        "These are demos, not production systems. Data volumes should be large enough to make "
        "dashboards, queries, and models look realistic, but small enough to generate quickly "
        "(under 2 minutes total). Default ranges unless the user specifies otherwise:\n"
        "- Dimension/reference tables (customers, products, stores, devices): 50–200 rows\n"
        "- Fact/event tables (transactions, orders, readings, visits): 2,000–5,000 rows\n"
        "- High-frequency event streams (clickstream, sensor telemetry, logs): 5,000–10,000 rows\n"
        "Never exceed 10,000 rows for any single table unless the user explicitly requests more.\n\n"
        "## Column Type Safety\n"
        "Only use column types fully compatible with all Databricks features including Vector Search, "
        "Feature Store, and dashboards. Prefer simple types (STRING, INT, DOUBLE, BOOLEAN, DATE, "
        "TIMESTAMP, DECIMAL). Avoid MAP and ARRAY types unless the use case absolutely requires them "
        "— and if used, note any downstream compatibility constraints.\n\n"
        "## Referential Integrity\n"
        "When the spec defines multiple tables linked by shared keys (e.g. customers ↔ transactions), "
        "explicitly state the generation order and key constraints. Specify which table is the parent "
        "(generated first) and which tables reference it. Include approximate cardinality per parent "
        "row. Example: 'Generate 200 customers first, then 5,000 transactions referencing those "
        "customer_ids (10-50 per customer).' Without this, independently generated tables produce "
        "mismatched foreign keys and broken joins.\n\n"
        "## Data Correlations\n"
        "When the demo involves ML, predictive analytics, scoring, or any outcome-driven analysis, "
        "this subsection is REQUIRED. Without explicit correlations, synthetic data is random — "
        "dashboards show flat/meaningless patterns, models overfit on noise, and the demo fails "
        "to tell a story.\n"
        "Define the relationships between features and outcomes. For each target/outcome column, "
        "specify which features influence it, the direction and approximate strength, and the target "
        "distribution. Use concrete rules the data generator can implement.\n"
        "Good examples:\n"
        "- 'fraud_label: amount > 3x avg → 70% fraud rate (vs 1% baseline); distance > 500km → +40%; "
        "velocity > 5 txns/hr → +25%. Overall ~2-3%.'\n"
        "- 'churn_flag: declining usage 3+ months → 80% churn; tickets > 3/90d → +35%; month-to-month "
        "contract → 3x churn vs annual. Target ~15%.'\n"
        "For dashboards and analytics (even without ML), define distributions and trends: "
        "'Revenue: 15% YoY growth, Q4 seasonal peaks. Midwest region outperforms by ~20%.'",
        "Generate data-schema.md with these sections.\n\n"
        "IMPORTANT: Start the file with an imperative instruction paragraph addressed to the executing agent, e.g.:\n"
        "'Generate the following tables as synthetic data in the catalog and schema specified in "
        "the prerequisites. Create tables in the order listed below to preserve referential integrity. "
        "Then build the transformation pipeline using the SQL blueprints in the Transformations section.'\n\n"
        "## Table Schemas\n"
        "For each table: markdown schema table (column | type | description), source type, "
        "approximate row count (following the row count guidance), distribution hints, "
        "relationships to other tables. Use only safe column types.\n\n"
        "## Referential Integrity\n"
        "Explicit parent→child generation order with cardinality constraints for every "
        "foreign key relationship.\n\n"
        "## Data Correlations\n"
        "If the demo involves ML, analytics, or outcome-driven analysis: define feature→outcome "
        "relationships with concrete rules. If dashboard/analytics only: define distributions and trends.\n\n"
        "## Relationships\n"
        "Foreign key relationships between tables. Brief.\n\n"
        "## Transformations\n"
        "For each medallion layer transition, show the ACTUAL SQL in fenced code blocks. Example:\n"
        "```sql\n-- Silver: cleaned transactions\nCREATE OR REFRESH STREAMING TABLE silver_transactions AS\n"
        "SELECT\n  transaction_id,\n  UPPER(customer_id) AS customer_id,\n  amount,\n  "
        "CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END AS status\n"
        "FROM STREAM(bronze_raw_transactions)\nWHERE amount > 0;\n```\n\n"
        "Show bronze→silver (cleaning, standardization) and silver→gold (aggregation, features) SQL. "
        "Use Spark Declarative Pipelines (SDP) syntax: CREATE OR REFRESH STREAMING TABLE, "
        "CREATE OR REFRESH MATERIALIZED VIEW. NOT old DLT @dlt.table syntax.\n"
        "These SQL blocks are the blueprint — the downstream LLM adapts them for the actual pipeline.\n\n"
        "Output ONLY the data-schema.md content starting with `# Data Schema`. No commentary.",
    ),
    "walkthrough.md": (
        "You are generating walkthrough.md — the complete demo script and presenter guide. "
        "After building ALL demo resources, the executing agent must use this file to generate "
        "a concise demo walkthrough script that a sales engineer can follow for a live presentation.\n\n"
        "The script MUST be written to a **Google Doc** (not inline in the chat) so it can be "
        "shared, printed, and used as a presenter's guide. The script MUST be written after "
        "deployment — it should reference actual table names, dashboard titles, and real query "
        "results from the built demo.\n\n"
        "**CRITICAL: Every step that references a Databricks resource must include the direct "
        "clickable URL to that resource.** For example, if a step says 'show the dashboard,' "
        "the full URL to that specific dashboard must be embedded right there in that step "
        "(e.g., `https://<workspace>/sql/dashboards/<id>`). This applies to ALL resource types: "
        "dashboards, apps, Genie spaces, pipelines, tables, notebooks, jobs, model serving "
        "endpoints, SQL warehouses, volumes, etc. The presenter should never have to search for "
        "anything — every link is one click away in the script.\n\n"
        "The walkthrough uses navigation cues formatted as `[Navigate to ...]` and `[Show ...]` "
        "to guide the presenter through the demo environment.\n\n"
        "RULES:\n"
        "- Navigation cues MUST use the exact format: `[Navigate to ...]` or `[Show ...]`\n"
        "- Each demo script step must reference specific Databricks UI elements or outputs\n"
        "- Include time estimates for each major section (e.g., '~2 min')\n"
        "- The executive talk track should work standalone without the demo\n"
        "- Target 10-15 minutes of speaking time\n"
        "- Every feature shown must pass the 'so what?' test\n"
        "- Never teach configuration or admin screens — show outcomes\n"
        "- Match language to the audience: executives want outcomes, technical buyers want architecture",
        "Generate walkthrough.md from the approved proposal and all prior package files. "
        "Use the storyline for narrative arc, architecture.md for the component diagram, "
        "data-schema for technical details to reference, "
        "and project-structure for knowing what artifacts exist.\n\n"
        "STRUCTURE: The file starts with an `## Execution Instructions` section (read by the executing LLM, "
        "not rendered in the UI), followed by the human-readable demo script sections.\n\n"
        "## Execution Instructions (FIRST section, immediately after `# Demo Walkthrough`)\n"
        "This section contains all meta-instructions for the executing agent. Include ALL of the following "
        "verbatim in this section:\n"
        "- After building ALL demo resources and passing all acceptance criteria, write this demo "
        "walkthrough script to a **Google Doc** with title: '{demo name} — Demo Script'.\n"
        "- Each step must include the **direct URL** to every Databricks resource referenced. "
        "Format links as clickable hyperlinks with descriptive text.\n"
        "- Use headings for each section (Opening, Wow Moment, Walkthrough sections, Recap).\n"
        "- Include presenter notes in italics for talking points and transitions.\n"
        "- Include specific click paths, queries to run, and data to highlight — all derived "
        "from the actual built demo resources.\n"
        "- The script is the presenter's single source of truth — if a resource exists, its URL "
        "must appear in the step where it is shown.\n"
        "- The Google Doc MUST begin with a **Demo Assets Overview** — a complete inventory table of "
        "every resource created for the demo (resource name, type, direct clickable URL), grouped by "
        "category (Data, Compute/Pipelines, Applications/Dashboards), followed by a 2-3 sentence "
        "architecture summary.\n\n"
        "## Demo Script\n"
        "Structure the script with these sections in order:\n\n"
        "### Opening (30-60 seconds)\n"
        "Start with a limbic opener — an emotionally resonant hook tied to the audience's pain point "
        "(stat, provocative question, or customer anecdote). State what the audience will see "
        "(2-3 topics max). Do NOT open with login screens or config.\n\n"
        "### Wow Moment (first thing shown)\n"
        "Do the last thing first. Show the highest-value output immediately (dashboard, app UI, "
        "prediction, analytical result). Frame as: 'Here is what [audience role] uses to make this decision.'\n\n"
        "### Walkthrough (2-3 sections)\n"
        "Walk backward from the wow moment through the architecture. Each section uses tell-show-tell: "
        "Frame the business pain (1 sentence), Show the capability with specific screens/queries/click paths, "
        "Bridge to the business value ('which means you can...'). Transition by referencing the roadmap.\n"
        "Each step has:\n"
        "- A title with time estimate (e.g., '#### Step 1: Data Ingestion (~2 min)')\n"
        "- `[Navigate to ...]` or `[Show ...]` cues on their own lines\n"
        "- What to say / what to point out\n"
        "- Where applicable, a 'Without AI' vs 'With AI' contrast\n"
        "- Reference specific Databricks products\n\n"
        "### Recap and Close (30-60 seconds)\n"
        "Summarize 2-3 key business outcomes (not features). Restate the delta between current pain "
        "and improved state. End with a concrete next step.\n\n"
        "## Executive Talk Track\n"
        "### 60-Second Pitch\n"
        "A tight elevator pitch paragraph.\n"
        "### Expanded Summary\n"
        "A 3-minute version with more detail on architecture and business impact.\n\n"
        "## Audience Adaptations\n"
        "### C-Suite\n"
        "Focus on ROI, business metrics, competitive advantage.\n"
        "### Technical Leadership\n"
        "Focus on architecture, scalability, Databricks platform capabilities.\n"
        "### Individual Contributors\n"
        "Focus on implementation details, code patterns, developer experience.\n\n"
        "Output ONLY the walkthrough.md content starting with `# Demo Walkthrough`. No commentary.",
    ),
    "project-structure.md": (
        "You are generating project-structure.md — the target directory layout for the demo package. "
        "This file tells the downstream LLM what files and directories to create.\n\n"
        "CRITICAL: Use MODERN Databricks conventions:\n"
        "- Databricks Asset Bundles (databricks.yml at root)\n"
        "- Spark Declarative Pipelines (SDP) — NOT Delta Live Tables (DLT), NOT notebooks\n"
        "- Raw .sql or .py files in src/<pipeline>/transformations/ — NOT notebooks\n"
        "- Resources defined in resources/*.yml (pipelines, dashboards, jobs, apps)\n"
        "- Serverless compute by default\n"
        "- CLUSTER BY (Liquid Clustering) not PARTITION BY\n\n"
        "KEEP IT LEAN. A typical demo is 15-25 files, not 50+. No tests/, no config/ directories, "
        "no utility directories unless the demo specifically requires them.",
        "Generate project-structure.md using Databricks Asset Bundles as the foundation.\n\n"
        "IMPORTANT: Start the file with an imperative instruction paragraph addressed to the executing agent, e.g.:\n"
        "'Create the following directory layout as a Databricks Asset Bundle. Every file listed below "
        "must be created with the specified content. Use `databricks.yml` as the bundle root.'\n\n"
        "```\n<demo-name>/\n"
        "├── databricks.yml                    # Bundle config + environment targets\n"
        "├── resources/\n"
        "│   ├── pipeline.pipeline.yml         # SDP pipeline resource\n"
        "│   ├── dashboard.dashboard.yml       # AI/BI dashboard resource\n"
        "│   └── [other resources as needed]\n"
        "├── src/\n"
        "│   ├── pipeline/\n"
        "│   │   └── transformations/\n"
        "│   │       ├── bronze_*.sql          # Raw ingestion\n"
        "│   │       ├── silver_*.sql          # Cleaning & standardization\n"
        "│   │       └── gold_*.sql            # Aggregation & features\n"
        "│   └── dashboards/\n"
        "│       └── dashboard.lvdash.json     # AI/BI dashboard definition\n"
        "├── SKILL.md\n├── storyline.md\n├── data-schema.md\n└── project-structure.md\n```\n\n"
        "Adapt this template to match the demo's specific outputs (add src/app/, src/genie/ sections only if needed). "
        "For each file/directory, add a brief purpose comment. Keep the tree under 30 lines.\n\n"
        "Output ONLY the project-structure.md content starting with `# Project Structure`. No commentary.",
    ),
}


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


async def stream_buildout_file(
    filename: str,
    proposal_md: str,
    generated_files: dict[str, str],
    databricks_host: str,
    databricks_token: str,
    model: str = "databricks-claude-sonnet-4",
    user_architecture: str | None = None,
) -> AsyncIterator[str]:
    """Stream generation of a single package file with prior files as context."""
    system_hint, user_hint = _BUILDOUT_FILE_PROMPTS[filename]

    system_content = f"{_build_system_prompt()}\n\n{system_hint}"

    context_parts = [f"## Approved Proposal\n\n{proposal_md}"]
    # Include user-designed architecture as context for all files
    if user_architecture:
        guidance = (
            "Use this as the basis for architecture.md — expand and refine it, "
            "but preserve the components and connections the user specified."
            if filename == "architecture.md"
            else "Reference this architecture when generating content."
        )
        context_parts.append(
            f"## User-Designed Architecture (from visual builder)\n\n"
            f"The user created this architecture diagram during the proposal stage. "
            f"{guidance}\n\n```mermaid\n{user_architecture}\n```"
        )
    for prior_name, prior_content in generated_files.items():
        context_parts.append(f"## {prior_name} (already generated)\n\n{prior_content}")

    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": "\n\n---\n\n".join(context_parts) + f"\n\n---\n\n{user_hint}"},
    ]

    async for chunk in _stream_llm(messages, databricks_host, databricks_token, model):
        yield chunk


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
