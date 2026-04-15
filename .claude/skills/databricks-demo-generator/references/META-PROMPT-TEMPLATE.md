# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of instruction files in the `instructions/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all instruction files to understand the full demo scope, story, and technical requirements.

**Phase 2 - Plan**: Create a task list based on the build order below. Each task should be a concrete implementation step. For each task, identify which skill to use (check `/skills` for available skills).

**Phase 3 - Implement**: Work through the task list one by one:
- **IMPORTANT - Use ai-dev-kit skills**: Before each task, load the relevant ai-dev-kit skill (e.g., `databricks-synthetic-data-gen`, `databricks-spark-declarative-pipelines`, `databricks-aibi-dashboards`, `databricks-agent-bricks`). Skills use the **Databricks CLI** and **Python SDK** — do NOT use MCP tools.
- **IMPORTANT - Write all files to the project folder first** (Python scripts, SQL files, configs). This keeps everything tracked, backed up, and exportable.
- Upload to Databricks (volumes for data, workspace for code)
- Create Databricks resources via CLI/SDK (not MCP, not DAB)
- Validate after each step that creates data or tables
- If validation fails, fix the issue before moving to the next task

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the walkthrough. Verify all components interact correctly. Fix any issues.

**Before starting**: Run the pre-flight check to ensure required infrastructure exists. Ask me if any resources already contain data.

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `{CATALOG}` |
| **Schema** | `{SCHEMA}` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/{DEMO_NAME}/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{CATALOG}/{SCHEMA}/raw_data/`
- **Documents Volume**: `/Volumes/{CATALOG}/{SCHEMA}/raw_data/documents/` (if demo includes documents)

### Pre-flight Check

Before starting, verify:

**Local environment**:
- Python 3.12 is available (required for Databricks Connect compatibility)
- If not, use `uv` to create a virtual environment: `uv venv --python 3.12`

**Databricks resources** (create if needed). If any already contain data, ask user whether to overwrite or use a different name:
- Catalog and schema
- Volume(s)
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
├── src/                              # Implementation files
│   ├── data_generation/              # Data generation scripts
│   ├── documents/                    # Document generation scripts (if applicable)
│   └── pipeline/                     # Pipeline SQL files (if applicable)
└── databricks.yml                    # (Optional) DAB bundle config for deployment
```

**Workflow**: Write code to project folder → Upload to Databricks → Create resources via APIs → Validate.

---

## Build Order

Follow the sequence defined by the numbered instruction files in `./instructions/`. Each file specifies what to build and how to validate it.

General ordering principle: **data first, then transformations, then consumption layers** (dashboards, Genie, AI components).

---

## Resource Tracking

**IMPORTANT**: Maintain a `resources.json` file in the instructions folder to track all created Databricks resources.

Create this file at the start of Phase 3 and update it after each resource is created:

```json
{
  "catalog": "{CATALOG}",
  "schema": "{SCHEMA}",
  "volume_path": "/Volumes/{CATALOG}/{SCHEMA}/raw_data"
}
```

Add resource IDs as you create them (e.g., `"pipeline_id"`, `"dashboard_id"`, `"genie_space_id"`, etc.).

---

## Validation After Each Step

After each step that creates tables or data, validate before moving to the next. Each instruction file specifies its own validation criteria. General checks:

| After Step | What to Check |
|------------|---------------|
| Data generation | Files exist in volume, row counts match spec, key patterns present |
| Pipeline | Tables populated, key metrics match expected values |
| Dashboard | Key insight visible at a glance, filters work |
| Genie | Sample questions return meaningful answers |
| KA | Key documents retrievable, correct content returned |
| MAS | Routes correctly between components |

---

## Troubleshooting

**CRITICAL - MCP server crashes**: If an MCP server crashes or becomes unresponsive, **STOP immediately**. Ask the user to restart and wait for confirmation before continuing.

**PyPI failures**: If pip/uv fails to install packages, use the internal Databricks proxy:
```bash
--index-url https://pypi-proxy.dev.databricks.com/simple/
```

---

## Begin

Start with Phase 1 — read all the instruction files to understand the full demo scope.
