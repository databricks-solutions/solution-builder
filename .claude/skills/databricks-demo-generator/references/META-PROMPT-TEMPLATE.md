# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of spec files in the `specifications/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read `README.md` and `resources.json` to understand the demo story, potential existing assets, scope, and infrastructure. Then read all spec files (numbered `*.md` in `specifications/`).

**Phase 2 - Plan**: Create a task list based on spec file order. Each task should be a concrete implementation step. For each task, identify which skill to use (check `/skills` for available skills).

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
├── resources.json                    # Capabilities + created resource IDs
├── specifications/                   # Detailed specs for each component
│   └── NN-*.md                       # Numbered spec files
├── src/                              # Implementation files
│   ├── data_generation/              # Data generation scripts
│   ├── documents/                    # Document generation scripts (if applicable)
│   └── pipeline/                     # Pipeline SQL files (if applicable)
└── databricks.yml                    # (Optional) DAB bundle config for deployment
```

**Workflow**: Write code to project folder → Upload to Databricks → Create resources via APIs → Validate.

---

## Build Order

Follow the numbered spec files in `./specifications/`. Each file specifies what to build and how to validate it.

General ordering principle: **data first, then transformations, then consumption layers** (dashboards, Genie, AI components).

**Not all demos have all components.** Only build what's in the spec files.

### Build-Order Gates — DO NOT SKIP

A consumption resource must never be created before its upstream data exists. These are hard gates, not suggestions:

- **Before creating the dashboard**: the pipeline must have completed successfully AND every table referenced in any dataset query must return `COUNT(*) > 0` via `execute_sql`. If any table is missing or empty, STOP and fix.
- **Before creating the Genie space**: every table listed in its config must exist with rows.
- **Before creating the Knowledge Assistant**: source documents must be uploaded and the vector index must have finished syncing.
- **Before creating the Multi-Agent Supervisor**: every downstream tool must be created and have its ID in `resources.json.created_resources`.

---

## Resource Tracking

**IMPORTANT**: The `resources.json` file at the project root tracks capabilities and all created Databricks resources. It is created during the specification phase with capabilities; update its `created_resources` object after each resource is created during build.

Add resource IDs as you create them:
```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "catalog": "{CATALOG}",
    "schema": "{SCHEMA}",
    "workspace_folder": "/Workspace/...",
    "pipeline_id": "<id>",
    "metric_view_name": "<catalog>.<schema>.<name>",
    "dashboard_id": "<id>",
    "genie_space_id": "<id>",
    "knowledge_assistant_id": "<id>",
    "multi_agent_supervisor_id": "<id>",
    "app_name": "<name>",
    "lakebase_project_id": "<uuid from `databricks postgres get-project | jq -r .uid`>",
    "lakebase_project_slug": "<slug passed to lakebase_setup_db.sh>",
    "lakebase_database": "<db name>"
  }
}
```

---

## Validation After Each Step

After each step that creates tables or data, validate before moving to the next. **Each spec file has its own validation section** — follow those specific checks.

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

**PyPI failures**: If pip/uv fails to install packages, use the internal Databricks proxy:
```bash
--index-url https://pypi-proxy.dev.databricks.com/simple/
```

---

## Begin

Start with Phase 1 - read `README.md`, `resources.json`, and all spec files.
