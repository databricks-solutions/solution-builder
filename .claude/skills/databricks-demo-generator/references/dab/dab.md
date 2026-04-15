# Databricks Asset Bundles (DAB) Reference

When asked to package a demo as a DAB, follow this guide to create a `databricks.yml` that enables deployment to any workspace.

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

## Reference Scripts

Working deployment scripts for components not natively supported by DAB:

| Script | Purpose | SDK Requirement |
|--------|---------|-----------------|
| [upload_pdfs.py](scripts/upload_pdfs.py) | Copy PDFs from workspace to UC volume | Pre-installed SDK |
| [deploy_genie.py](scripts/deploy_genie.py) | Create/update Genie Space | `>=0.102.0` |
| [deploy_ka.py](scripts/deploy_ka.py) | Create/update Knowledge Assistant | `>=0.102.0` |
| [deploy_mas.py](scripts/deploy_mas.py) | Create/update Multi-Agent Supervisor | `>=0.102.0` |

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

Some Databricks components cannot be declared in DAB YAML and require workflow tasks:

| Component | Workaround | Reference Script |
|-----------|------------|------------------|
| **Genie Spaces** | SDK in workflow task | [deploy_genie.py](scripts/deploy_genie.py) |
| **Knowledge Assistants** | SDK in workflow task | [deploy_ka.py](scripts/deploy_ka.py) |
| **Multi-Agent Supervisors** | REST API in workflow task | [deploy_mas.py](scripts/deploy_mas.py) |
| **PDF/File Upload to Volume** | Workflow task | [upload_pdfs.py](scripts/upload_pdfs.py) |

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
│   ├── deploy/                # Deployment scripts
│   │   ├── upload_pdfs.py     # Copy PDFs to volume
│   │   ├── deploy_genie.py    # Genie Space creation
│   │   ├── deploy_ka.py       # Knowledge Assistant creation
│   │   └── deploy_mas.py      # Multi-Agent Supervisor creation
│   └── pipelines/             # DLT pipeline code
├── pipeline/                   # Alternative location for DLT code
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

## Step 8: Create dab_instructions.md

Create a short `dab_instructions.md` with just the deployment commands. Keep it under 40 lines — no prerequisites, troubleshooting, or detailed explanations.

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
