# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of spec files in the `specifications/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all spec files starting with `README.md` to understand the full demo scope, story, and technical requirements.

**Phase 2 - Plan**: Create a task list based on the build order below. Each task should be a concrete implementation step. For each task, identify which skill to use (check `/skills` for available skills).

**Phase 3 - Implement**: Work through the task list one by one:
- **IMPORTANT - Check skills first**: Before starting each task, list your available skills and check if any are relevant (e.g., data generation, pipelines, dashboards, Genie, agents). If a relevant skill exists, read it first for patterns and best practices.
- Create all files locally first (Python scripts, SQL files, configs)
- Upload to Databricks (volumes for data, workspace for code)
- Create Databricks resources via APIs (not DAB)
- Validate after each step that creates data or tables
- If validation fails, fix the issue before moving to the next task

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the walkthrough. Verify all components interact correctly. Fix any issues.

**Before starting**: Run the pre-flight check to ensure required infrastructure exists. Ask me if any resources already contain data.

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `meridian_bank` |
| **Schema** | `fraud_ops` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/fraud_detection_demo/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`
- **Security Docs Volume**: `/Volumes/{catalog}/{schema}/raw_data/security_docs/`

### Pre-flight Check

Before starting, verify:

**Local environment**:
- Python 3.12 is available (required for Databricks Connect compatibility)
- If not, use `uv` to create a virtual environment: `uv venv --python 3.12`

**Databricks resources** (create if needed). If any already contain data, ask user whether to overwrite or use a different name:
- Catalog and schema
- Volume (raw_data)
- Workspace folder

---

## Local Project Structure

Create this folder structure locally, then deploy to Databricks:

```
fraud_detection_demo/
├── data_generation/
│   └── generate_data.py              # Script to generate synthetic parquet files
├── documents/
│   └── generate_security_docs.py     # Script to generate security audit PDFs
├── pipeline/
│   ├── transformations/
│   │   ├── 01_bronze_ingestion.sql   # Bronze layer: raw parquet ingestion
│   │   ├── 02_silver_transformation.sql # Silver layer: joins and enrichment
│   │   └── 03_gold_aggregation.sql   # Gold layer: aggregations for analytics
│   └── exploration/
│       └── exploration_notebook.py   # Notebook to verify raw data
└── specifications/                   # These spec files (for reference)
```

**Workflow**: Write code locally → Upload to Databricks → Create resources via APIs → Validate.

---

## Build Order

Follow this sequence. Each step has a dedicated spec file.

| Step | Task | Spec File | Output |
|------|------|------------------|--------|
| 1 | Create catalog, schema, volume | (infrastructure) | Databricks resources |
| 2 | Generate synthetic data | `01-data-generation.md` | Parquet files in volume |
| 3 | Generate security docs | `02-unstructured-docs.md` | PDFs in volume |
| 4 | Create SDP pipeline | `03-pipelines.md` | Bronze/Silver/Gold tables |
| 5 | Validate pipeline data | `03b-pipeline-validation.md` | Confirmed data matches story |
| 6 | Create Genie Space | `04-genie-space.md` | Genie with smart system instructions |
| 7 | Create dashboard | `05-dashboard.md` | Dashboard with Genie embedded |
| 8 | Create Knowledge Assistant | `06-knowledge-assistant.md` | KA indexing security docs |
| 9 | Create Multi-Agent Supervisor | `07-multi-agent-supervisor.md` | MAS routing to Genie + KA |
| 10 | Test demo flow | `README.md` (walkthrough section) | Working end-to-end demo |

---

## Resource Tracking

**IMPORTANT**: The `resources.json` file at the project root tracks capabilities and all created Databricks resources. Update its `created_resources` object after each resource is created:

```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "catalog": "meridian_bank",
    "schema": "fraud_ops",
    "workspace_folder": "/Workspace/Users/.../fraud_detection_demo",
    "pipeline_id": "<id>",
    "dashboard_id": "<id>",
    "genie_space_id": "<id>",
    "knowledge_assistant_id": "<id>",
    "multi_agent_supervisor_id": "<id>"
  }
}
```

---

## Validation After Each Step

After each step that creates tables or data, validate before moving to the next:

| After Step | What to Check |
|------------|---------------|
| Data generation | Parquet files exist in volume, row counts match spec |
| Pipeline | Bronze/Silver/Gold tables populated, affected terminals show ~15% fraud rate |
| Genie | "Why is fraud so high?" returns meaningful analysis |
| Dashboard | Spike visible at a glance, filters work on all widgets |
| KA | "Security issue for QuickMart?" returns the audit report |
| MAS | Routes correctly between Genie and KA |

---

## Troubleshooting

**CRITICAL - MCP server crashes**: If an MCP server crashes or becomes unresponsive, **STOP immediately**. Ask the user to restart the MCP server and wait for confirmation before continuing. Do NOT attempt workarounds.

**PyPI failures**: If pip/uv fails to install packages, use the internal Databricks proxy:
```bash
--index-url https://pypi-proxy.dev.databricks.com/simple/
```

---

## Begin

Start with Phase 1 - read all the spec files beginning with `README.md`.
