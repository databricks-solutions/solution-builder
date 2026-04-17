# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of spec files in the `specifications/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read `README.md` and `resources.json` to understand the demo story, scope, and infrastructure. Then read all spec files (numbered `*.md` in `specifications/`).

**Phase 2 - Plan**: Create a task list based on spec file order. Each task should be a concrete implementation step. For each task, identify which skill to use (check `/skills` for available skills).

**Phase 3 - Implement**: Work through the task list one by one:
- **Check skills first**: Before starting each task, list your available skills and check if any are relevant (e.g., data generation, pipelines, dashboards, Genie, agents). If a relevant skill exists, read it first for patterns and best practices.
- **Write all files to the project folder first** (Python scripts, SQL files, configs). This keeps everything tracked, backed up, and exportable.
- Upload to Databricks (volumes for data, workspace for code)
- Create Databricks resources via APIs (not DAB)
- Validate after each step that creates data or tables
- If validation fails, fix the issue before moving to the next task

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the README walkthrough. Verify all components interact correctly.

**Before starting**: Run the pre-flight check. Ask me if any resources already contain data.

---

## Databricks Infrastructure

All project-specific names (catalog, schema, workspace folder) are in `resources.json` at the project root.

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`
- **Documents Volume**: `/Volumes/{catalog}/{schema}/raw_data/{doc_folder}/` (if demo includes documents)

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

**Write all files to this project folder** (the folder containing this META-PROMPT.md):

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

Files written here are:
1. **Tracked** - Automatically synced to the database as you write them
2. **Versioned** - Changes are preserved, enabling iteration
3. **Exportable** - Download as ZIP, create a DAB bundle, or push to git

---

## Build Order

Follow the numbered spec files in `./specifications/`. Each file specifies what to build and how to validate it.

General ordering principle: **data first, then transformations, then consumption layers** (dashboards, Genie, AI components).

**Not all demos have all components.** Only build what's in the spec files.

---

## Resource Tracking

Update `resources.json` after each resource is created. Add resource IDs to the `created_resources` object (e.g., `"pipeline_id"`, `"dashboard_id"`, `"genie_space_id"`, etc.).

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

**CRITICAL - MCP server crashes**: If an MCP server crashes or becomes unresponsive, **STOP immediately**. Ask the user to restart and wait for confirmation before continuing.

**PyPI failures**: If pip/uv fails to install packages, use the internal Databricks proxy:
```bash
--index-url https://pypi-proxy.dev.databricks.com/simple/
```

---

## Begin

Start with Phase 1 - read `README.md`, `resources.json`, and all spec files.
