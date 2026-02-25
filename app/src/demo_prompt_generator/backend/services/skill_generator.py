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
    ("databricks-spark-declarative-pipelines", "Lakeflow Declarative Pipelines (DLT/SDP)"),
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
"Use `create_or_update_pipeline` to deploy the DLT pipeline."

## Available ai-dev-kit skills

{_skills_catalog()}

## Skill structure to follow

```
---
name: <demo-name>
description: "<What this demo builds and when to use it. Third person.>"
---

# <Demo Title>

## Overview
One paragraph: audience, business problem, what makes it compelling. No fluff.

## Prerequisites
Catalog, schema, and workspace assumptions. Keep it to a short list.

## Datasets
One subsection per table. Each has a markdown table for schema (column | type | description).
Include source type, approximate row count, and key relationships.

## Transformations
Describe silver/gold layer logic: joins, filters, aggregations, business rules.
Reference table names from Datasets. Prose, not SQL — the executing LLM writes the SQL.

## Outputs
One subsection per deliverable (dashboard, Genie space, model, app, etc.).
Describe what it shows/does with enough detail to build.

## Build Steps

Checklist:
- [ ] Step 1: ...
- [ ] Step 2: ...

Then numbered steps, each referencing an ai-dev-kit skill and/or MCP tool.

## Acceptance Criteria
Checklist of what "done" looks like.
```"""


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
