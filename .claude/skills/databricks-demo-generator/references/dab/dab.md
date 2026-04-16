# Databricks Asset Bundles (DAB) Reference

When asked to package a demo as a DAB, follow this guide to create a `databricks.yml` that enables deployment to any workspace.

## Prerequisites

- **Databricks CLI v0.283.0+** — Required for dashboard `dataset_catalog`/`dataset_schema` fields (which rewrite dataset queries at deploy time). Older CLI versions will fail on dashboard deployment.

## Important: Read the Complete Example First

**Before creating any DAB, read the complete working example:**
- [example_databricks.yml](example_databricks.yml) - Consolidated DAB showing all patterns

This example demonstrates:
- Infrastructure (schemas, volumes) created by DAB deploy
- Static file sync (PDFs) via `sync.include`
- Parallel workflow tasks (upload_pdfs + generate_data)
- SDK version requirements for Genie/KA/MAS
- Task value passing between workflow tasks
- Remember: your job is to make a DAB that works for the current demo/story, it might have many more or less components, you must adapt this example to your story.

## SDK Version Requirements

Genie, KA, and MAS APIs require `databricks-sdk>=0.102.0`. Use `environment_key: sdk_latest` for those tasks (see example_databricks.yml).

## Key Patterns

All patterns are demonstrated in [example_databricks.yml](example_databricks.yml) with inline comments.

1. **Infrastructure in YAML** — Schemas/volumes declared in DAB, not Python scripts
2. **Static files via sync.include** — PDFs synced to workspace, then copied to volume by task
3. **Parallel tasks and dependencies** — Tasks without `depends_on` run in parallel, respect the resource dependencies
4. **Task value passing** — Use `dbutils.jobs.taskValues.set()` + `{{tasks.*.values.*}}` to pass the ID of asset created when there is a dependency (ex: MAS needs the KA + Genie id)

---

## Step 1: Read the DAB Skill

Before proceeding, read the **databricks-bundles** skill from the ai-dev-kit for comprehensive DAB syntax and best practices.

## Step 2: Documentation Reference

For the latest configuration options:
- [DABs Settings Reference](https://docs.databricks.com/aws/en/dev-tools/bundles/settings)
- [Supported Resource Types](https://docs.databricks.com/aws/en/dev-tools/bundles/resources#resource-types)

## Step 3: Analyze Project Components

Examine the project files to identify:

| Component Type | DAB Resource | Notes |
|---------------|--------------|-------|
| SQL files | `jobs` with `sql_task` | Schedule via workflow |
| Python notebooks | `jobs` with `notebook_task` | Direct DAB support |
| Python scripts | `jobs` with `python_wheel_task` | Package as wheel first |
| DLT/SDP pipelines | `pipelines` | Spark Declarative Pipelines |
| Dashboards (.lvdash.json) | `dashboards` | AI/BI dashboards |
| Apps | `apps` | Native DAB support (CLI 0.239.0+) |
| Volumes | `volumes` | Use `grants` not `permissions` |
| Schemas | `schemas` | Unity Catalog schemas |
| Catalogs | `catalogs` | Unity Catalog catalogs |

## Step 4: Components NOT Directly Supported in DAB

Some Databricks components cannot be declared in DAB YAML. Deploy them via **SDK notebook tasks** in the workflow. The capability blocks in `blocks/capabilities/` have the API-specific details for each component (serialized_space structure, required fields, SDK patterns). The DAB just wires them into the workflow.

| Component | Workaround | Capability Block | SDK Requirement |
|-----------|------------|-----------------|-----------------|
| **Genie Spaces** | SDK notebook task | `genie.md` | `>=0.102.0` |
| **Knowledge Assistants** | SDK notebook task | `knowledge-assistant.md` | `>=0.102.0` |
| **Supervisor Agents** | SDK notebook task | `supervisor-agent.md` | `>=0.102.0` |
| **PDF/File Upload to Volume** | Notebook task | N/A — use `dbutils.fs.cp` | Pre-installed |

### SDK Deployment Task Pattern

Every SDK deployment notebook follows the same structure:

```python
# 1. Accept parameters via widgets
dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")

# 2. Initialize SDK client
from databricks.sdk import WorkspaceClient
w = WorkspaceClient()

# 3. Idempotent create-or-update (check for existing, update or create)
# ... component-specific logic from the capability block ...

# 4. Output IDs for downstream tasks
dbutils.jobs.taskValues.set(key="component_id", value=created_id)
```

The **capability block** defines steps 2-3 (what API to call, what fields are required). The **DAB** defines how the task is wired in (environment, dependencies, parameter passing).

## Step 5: Task Value Passing Between Workflow Tasks

When deploying components that depend on each other, use **task values** to pass IDs.

### Producer Task
```python
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
```

### Consumer Task Configuration
```yaml
- task_key: deploy_mas
  depends_on:
    - task_key: deploy_genie
  notebook_task:
    base_parameters:
      genie_space_id: "{{tasks.deploy_genie.values.genie_space_id}}"
```

### Key Constraints

| Constraint | Detail |
|------------|--------|
| Task dependency required | Consumer task must `depends_on` the producer task |
| Python only | `dbutils.jobs.taskValues.set/get` only works in Python notebooks |
| Same job run scope | Task values cannot be read by tasks in a different job |

## Step 6: Bundle Template

Create a `databricks.yml` at the project root. See [example_databricks.yml](example_databricks.yml) for a complete working example.

**Key points:**
- No hardcoded workspace hosts - use environment variables or CLI profiles
- Variables for catalog/schema with sensible defaults
- `sync.include` for static files (PDFs, etc.)
- Two environments: `sdk_only` and `sdk_latest`

## Step 7: Project Structure

```
project/
├── databricks.yml              # Main bundle config (see example_databricks.yml)
├── dab_instructions.md         # Deployment instructions for users
├── resources/
│   ├── infrastructure.yml     # Schemas, volumes
│   ├── jobs.yml               # Workflow definitions
│   ├── pipelines.yml          # DLT pipeline definitions
│   └── dashboards.yml         # Dashboard definitions
├── src/
│   ├── data_generation/       # Data generation notebooks
│   ├── deploy/                # SDK deployment notebooks (Genie, KA, MAS, file upload)
│   └── pipeline/              # SDP/DLT pipeline code
├── dashboard/                  # .lvdash.json files
└── raw_data/
    └── pdf/                   # PDFs to upload (synced via sync.include)
```

## Key Guidelines

1. **Use variables** for catalog, schema, and warehouse
2. **Parameterize everything** that differs between environments
3. **No hardcoded workspace hosts** - rely on CLI profile or environment variables
4. **Create infrastructure via DAB** - schemas and volumes in YAML, not Python
5. **Use sync.include** for static file upload to workspace
6. **SDK version matters** - `>=0.102.0` required for Genie/KA/MAS
7. **Path resolution** - use `../src/` from `resources/*.yml`, `./src/` from `databricks.yml`
8. **SDP SQL cannot parameterize `read_files` paths** - see Volume Path Parameterization below

## Volume Path Parameterization in SDP

SDP SQL files (`CREATE STREAMING TABLE ... AS SELECT ... FROM STREAM read_files(...)`) **cannot use Spark conf variables** in the `read_files()` path. Even though the pipeline configuration passes `demo.volume_path`, SQL has no syntax to interpolate it.

**Two approaches:**

| Approach | Tradeoff |
|----------|----------|
| **Python bronze notebook** (recommended) | Uses `spark.conf.get("demo.volume_path")` to build the path dynamically. Fully parameterized. |
| **SQL with hardcoded defaults** | Simpler, but the volume path must match `${var.catalog}/${var.schema}`. Only works when deploying with default variable values. |

If using SQL bronze (simpler demos), ensure the hardcoded path uses the **same default values** as the DAB variables, and document in `dab_instructions.md` that changing catalog/schema requires editing the SQL files.

If using Python bronze, the notebook should read the path from Spark conf:
```python
volume_path = spark.conf.get("demo.volume_path")
df = spark.readStream.format("cloudFiles").option("cloudFiles.format", "parquet").load(f"{volume_path}/table_name")
```

## Common Pitfalls

Mistakes that cause runtime failures after a successful `bundle deploy`:

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| `avg()` on a BOOLEAN column in PySpark | `DATATYPE_MISMATCH.UNEXPECTED_INPUT_TYPE` | Cast first: `F.avg(F.col("bool_col").cast("int"))` |
| Dashboard `dataset_catalog`/`dataset_schema` on old CLI | Deploy fails or fields silently ignored | Require CLI v0.283.0+ |
| Hardcoded volume paths in SDP SQL | Pipeline fails when deploying to non-default catalog/schema | Use Python bronze or match defaults (see above) |

For component-specific pitfalls (Genie API requirements, KA document formats, etc.), see the relevant capability block.

## Step 8: Create dab_instructions.md

Create a short `dab_instructions.md` with deployment commands. Keep it concise. Include:
- **Prerequisite**: Databricks CLI v0.283.0+ (`databricks --version` to check)
- Deploy and run commands with variable overrides
- Variable reference table
- Resources created list

## Step 9: Typical Demo Workflow

See [example_databricks.yml](example_databricks.yml) for the complete workflow pattern.

### Execution Sequence

| Step | Task | Purpose | Dependencies | Outputs |
|------|------|---------|--------------|---------|
| 1a | `upload_pdfs` | Copy PDFs to volume | None | Files in volume |
| 1b | `generate_data` | Create synthetic data | None (parallel) | Tables in UC |
| 2 | `run_pipeline` | Run SDP pipeline | Data tables exist | Processed tables |
| 3 | `deploy_genie` | Create Genie Space | Tables exist | `genie_space_id` |
| 4 | `deploy_ka` | Create Knowledge Assistant | PDFs in volume | `ka_tile_id` |
| 5 | `deploy_mas` | Create Multi-Agent Supervisor | KA + Genie exist | `mas_tile_id` |

### Deployment Commands

```bash
# Deploy all resources (creates schema, volumes, registers jobs)
databricks bundle deploy --var="warehouse_id=abc123"

# Run the setup workflow (executes all tasks in order)
databricks bundle run demo_setup
```
