# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of instruction files in the `instructions/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all instruction files starting with `00-demo-overview.md` to understand the full demo scope, story, and technical requirements.

**Phase 2 - Plan**: Create a task list based on the build order below. Each task should be a concrete implementation step. For each task, identify which skill to use (check `/skills` for available skills).

**Phase 3 - Implement**: Work through the task list one by one:
- **IMPORTANT - Check skills first**: Before starting each task, list your available skills and check if any are relevant (e.g., data generation, pipelines, dashboards, Genie, agents). If a relevant skill exists, read it first for patterns and best practices.
- **IMPORTANT - Write all files to the project folder first** (Python scripts, SQL files, configs). This keeps everything tracked, backed up, and exportable. The folder structure below shows where each file type goes.
- Upload to Databricks (volumes for data, workspace for code)
- Create Databricks resources via APIs (not DAB)
- Validate after each step that creates data or tables
- If validation fails, fix the issue before moving to the next task

**Why write locally first?**
- All files are automatically tracked and backed up to the database
- You can iterate on code locally before deploying
- Later you can export everything as a DAB (Databricks Asset Bundle) or push to git
- Clean state for reproducibility - rebuild from source at any time

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the walkthrough. Verify all components interact correctly. Fix any issues.

**Before starting**: Run the pre-flight check to ensure required infrastructure exists. Ask me if any resources already contain data.

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `luxebeauty` |
| **Schema** | `analytics` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/luxebeauty_demo/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`
- **Incident PDFs Volume**: `/Volumes/{catalog}/{schema}/raw_data/incident_pdf/`

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

**Write all files to this project folder** (the folder containing this META-PROMPT.md). This structure is automatically tracked and backed up:

```
./                                    # Project root (this folder)
├── README.md                         # Demo story and walkthrough
├── architecture.md                   # Architecture diagram schema (JSON)
├── META-PROMPT.md                    # This file - build instructions
├── instructions/                     # Detailed specs for each component
│   ├── resources.json                # Tracks created Databricks resource IDs
│   └── *.md                          # Component-specific instructions
├── src/
│   ├── data_generation/
│   │   └── generate_data.py          # Script to generate synthetic parquet files
│   ├── documents/
│   │   └── generate_docs.py          # Script to generate PDFs/documents
│   └── pipeline/
│       ├── 01_bronze_ingestion.sql   # Bronze layer: raw parquet ingestion
│       ├── 02_silver_transformation.sql # Silver layer: joins and enrichment
│       └── 03_gold_aggregation.sql   # Gold layer: aggregations for analytics
└── databricks.yml                    # (Optional) DAB bundle config for deployment
```

**Workflow**: Write code to project folder → Upload to Databricks → Create resources via APIs → Validate.

Files written here are:
1. **Tracked** - Automatically synced to the database as you write them
2. **Versioned** - Changes are preserved, enabling iteration
3. **Exportable** - Download as ZIP, create a DAB bundle, or push to git

---

## Build Order

Follow this sequence. Each step has a dedicated instruction file.

| Step | Task | Instruction File | Output |
|------|------|------------------|--------|
| 1 | Create catalog, schema, volume | (infrastructure) | Databricks resources |
| 2 | Generate synthetic data | `01-data-generation.md` | Parquet files in volume |
| 3 | Generate incident PDFs | `02-unstructured-docs.md` | PDF in volume |
| 4 | Create SDP pipeline | `03-pipelines.md` | Bronze/Silver/Gold tables |
| 5 | Validate pipeline data | `03b-pipeline-validation.md` | Confirmed data matches story |
| 6 | Create Genie Space | `04-genie-space.md` | Genie with smart instructions |
| 7 | Create dashboard | `05-dashboard.md` | Dashboard with Genie embedded ← *requires step 6* |
| 8 | Create Knowledge Assistant | `06-knowledge-assistant.md` | KA indexing incident docs |
| 9 | Create Multi-Agent Supervisor | `07-multi-agent-supervisor.md` | MAS routing to Genie + KA |
| 10 | Test demo flow | `00-demo-overview.md` (walkthrough section) | Working end-to-end demo |

---

## Resource Tracking

**IMPORTANT**: Maintain a `resources.json` file in the instructions folder to track all created Databricks resources. This makes it easy to reference IDs across steps.

Create this file at the start of Phase 3 and update it after each resource is created:

```json
{
  "catalog": "luxebeauty",
  "schema": "analytics",
  "volume_path": "/Volumes/luxebeauty/analytics/raw_data",
  "workspace_folder": "/Workspace/Users/.../luxebeauty_demo",
  "pipeline_id": null,
  "dashboard_id": null,
  "genie_space_id": null,
  "knowledge_assistant_id": null,
  "multi_agent_supervisor_id": null
}
```

Update each `*_id` field immediately after creating the corresponding resource.

---

## Validation After Each Step

After each step that creates tables or data, validate before moving to the next:

| After Step | What to Check |
|------------|---------------|
| Data generation | Parquet files exist in volume, row counts match spec |
| Pipeline | Bronze/Silver/Gold tables populated, affected lot has ~30% return rate |
| Genie | "Why do I have so many returns?" returns meaningful analysis |
| Dashboard | Spike visible at a glance, filters work on all widgets |
| KA | "Incident for lot LOT-2025-0212" returns the report |
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

Start with Phase 1 - read all the instruction files beginning with `00-demo-overview.md`.
