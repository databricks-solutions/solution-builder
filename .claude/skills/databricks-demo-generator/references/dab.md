# Databricks Asset Bundles (DAB) Reference

When asked to package a demo as a DAB, follow this guide to create a `databricks.yml` that enables deployment to any workspace.

## Step 1: Read the DAB Skill

Before proceeding, read the **databricks-bundles** skill from the ai-dev-kit for comprehensive DAB syntax and best practices. The skill covers:
- Bundle structure and configuration
- Resource definitions (jobs, pipelines, dashboards, apps)
- Variable substitution for multi-environment deployments
- Permission configuration

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
| SQL Alerts | `alerts` | SQL alerts (v2) |
| Clusters | `clusters` | Compute clusters |
| SQL Warehouses | `sql_warehouses` | SQL compute |
| MLflow Experiments | `experiments` | ML experiments |
| Registered Models | `registered_models` | Unity Catalog models |
| Model Serving Endpoints | `model_serving_endpoints` | Serving endpoints |
| Quality Monitors | `quality_monitors` | Data quality monitors |
| Secret Scopes | `secret_scopes` | Secret management |
| External Locations | `external_locations` | UC external locations |
| Lakebase Instances | `database_instances` | Lakebase databases |
| Lakebase Catalogs | `database_catalogs` | Lakebase catalogs |

## Step 4: Components NOT Directly Supported in DAB

Some Databricks components cannot be declared in DAB YAML and require alternative approaches:

### Components Requiring Python/REST API Deployment

| Component | Workaround |
|-----------|------------|
| **Genie Spaces** | Create via `manage_genie` SDK in a deployment job |
| **Knowledge Assistants** | Create via REST API in a deployment job |
| **Multi-Agent Supervisors** | Create via REST API in a deployment job |

> **Note**: Genie Spaces DAB support is [pending](https://github.com/databricks/cli/pull/4191) as of April 2025. Until merged, create Genie Spaces via SDK in a workflow task.

For these components, create a **deployment job** that runs Python code using the Databricks SDK:

```yaml
resources:
  jobs:
    deploy_resources:
      name: "[${bundle.target}] Deploy Additional Resources"
      tasks:
        - task_key: deploy_assistants
          notebook_task:
            notebook_path: ../src/deploy/deploy_resources.py
          environment_key: default
      environments:
        - environment_key: default
          spec:
            client: "4"
            dependencies:
              - databricks-sdk
              - plutoprint
```

### Example deploy_resources.py Structure

Use the `mas_manager.py` wrapper (see [mas_manager.py](mas_manager.py)) for simplified MAS operations:

```python
# Deploy components not supported by DAB
from databricks_tools_core.agent_bricks import AgentBricksManager
import mas_manager  # Copy mas_manager.py to your deployment folder

# Get variables from job parameters or Databricks widgets
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")

manager = AgentBricksManager()

# ============================================================================
# Deploy Knowledge Assistant (create or update by name)
# ============================================================================
ka_result = manager.ka_create_or_update(
    name="Demo Knowledge Assistant",
    knowledge_sources=[
        {
            "files_source": {
                "name": "documentation",
                "type": "files",
                "files": {"path": f"/Volumes/{catalog}/{schema}/docs"}
            }
        }
    ],
    description="Answers questions about the demo documentation",
    instructions="Be helpful and cite sources when answering questions.",
)
print(f"KA {ka_result['operation']}: tile_id={ka_result['tile_id']}")

# Wait for KA to be ready before adding examples
manager.ka_wait_until_active(ka_result['tile_id'], timeout_s=600)

# Add example questions
manager.ka_add_examples_batch(ka_result['tile_id'], [
    {"question": "What is this demo about?", "guideline": "Should describe the main use case"},
    {"question": "How do I get started?", "guideline": "Should provide step-by-step instructions"},
])

# ============================================================================
# Deploy Multi-Agent Supervisor using mas_manager wrapper
# ============================================================================

# First, find dependent agents
genie_ids = manager.genie_find_by_name("Demo Genie Space")
ka_ids = manager.find_by_name("Demo Knowledge Assistant")

# Build agent list
agents = []
if genie_ids:
    agents.append({
        "name": "Data Explorer",
        "description": "Use for SQL queries and data analysis questions about sales, customers, and products",
        "genie_space_id": genie_ids.space_id,
    })
if ka_ids:
    agents.append({
        "name": "Documentation Assistant",
        "description": "Use for questions about documentation, setup guides, and how-to instructions",
        "ka_tile_id": ka_ids.tile_id,
    })

# Create or update MAS using the wrapper
if agents:
    existing = mas_manager.find_mas("Demo Supervisor")

    if existing.get("found"):
        # Update existing MAS
        result = mas_manager.update_mas(
            tile_id=existing["tile_id"],
            name="Demo Supervisor",
            agents=agents,
            description="Routes queries to the appropriate agent based on question type",
            instructions="Route data questions to Data Explorer, documentation questions to Documentation Assistant",
        )
        print(f"MAS updated: {result}")
    else:
        # Create new MAS
        result = mas_manager.create_mas(
            name="Demo Supervisor",
            agents=agents,
            description="Routes queries to the appropriate agent based on question type",
            instructions="Route data questions to Data Explorer, documentation questions to Documentation Assistant",
        )
        print(f"MAS created: {result}")

    # Add examples (queued if endpoint not ready yet)
    mas_manager.add_examples_queued(
        tile_id=result["tile_id"],
        examples=[
            {"question": "What were the top selling products last month?", "guideline": "Should route to Data Explorer"},
            {"question": "How do I configure the dashboard?", "guideline": "Should route to Documentation Assistant"},
        ]
    )
```

### Agent Types for MAS

When building agents for a Multi-Agent Supervisor, use these configuration options:

| Agent Type | Config Key | Example |
|------------|-----------|---------|
| Genie Space | `genie_space_id` | `{"genie_space_id": "abc123"}` |
| Knowledge Assistant | `ka_tile_id` | `{"ka_tile_id": "def456"}` |
| Serving Endpoint | `endpoint_name` | `{"endpoint_name": "my-model"}` |
| UC Function | `uc_function_name` | `{"uc_function_name": "catalog.schema.func"}` |

## Step 5: Bundle Template

Create a `databricks.yml` at the project root:

```yaml
bundle:
  name: demo-name

include:
  - resources/*.yml

variables:
  catalog:
    default: "main"
    description: "Unity Catalog to deploy resources"
  schema:
    default: "default"
    description: "Schema for tables and views"
  warehouse_id:
    lookup:
      warehouse: "Serverless Starter Warehouse"

targets:
  dev:
    default: true
    mode: development
    workspace:
      host: https://your-workspace.cloud.databricks.com

  prod:
    mode: production
    workspace:
      host: https://prod-workspace.cloud.databricks.com
    variables:
      catalog: "prod_catalog"
      schema: "prod_schema"
```

## Step 6: Project Structure

Organize files for DAB deployment:

```
project/
├── databricks.yml              # Main bundle config
├── resources/
│   ├── jobs.yml               # Job definitions
│   ├── pipelines.yml          # DLT pipeline definitions
│   ├── dashboards.yml         # Dashboard definitions
│   └── deploy.yml             # Deployment job for non-DAB components
└── src/
    ├── notebooks/             # Python/SQL notebooks
    ├── pipelines/             # DLT pipeline code
    ├── dashboards/            # .lvdash.json files
    └── deploy/                # Deployment scripts
        └── deploy_resources.py
```

## Key Guidelines

1. **Use variables** for catalog, schema, and warehouse to enable multi-environment deployment
2. **Parameterize everything** that differs between environments
3. **Include SQL files as job tasks** - they run on a warehouse via `sql_task`
4. **Create deployment jobs** for components not natively supported by DAB
5. **Use target modes** - `development` for dev, `production` for prod
6. **Path resolution** - use `../src/` from `resources/*.yml`, `./src/` from `databricks.yml`

## Step 7: Create dab_instructions.md

**IMPORTANT**: When creating a DAB, you MUST also create a `dab_instructions.md` file with deployment instructions for the user. This file will be displayed in the UI when the user downloads the DAB.

Create `dab_instructions.md` at the project root with this structure:

```markdown
# DAB Deployment Instructions

## Overview
This bundle deploys [DEMO_NAME] to your Databricks workspace, including:
- [List the resources: tables, dashboards, jobs, Genie spaces, etc.]

## Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `catalog` | Unity Catalog where tables will be created | `main` |
| `schema` | Schema within the catalog for this demo | `default` |
| `warehouse_name` | SQL warehouse name for running queries | `Serverless Starter Warehouse` |
| `workspace_path` | Workspace folder for notebooks/files | `/Users/${current_user}/[demo_name]` |

## Deployment Commands

After downloading, extract the zip file and run these commands from the extracted folder:

### Step 1: Deploy Bundle

```bash
databricks bundle deploy --var="catalog=YOUR_CATALOG" --var="schema=YOUR_SCHEMA" --var="warehouse_name=YOUR_WAREHOUSE" --var="workspace_path=/Users/you@company.com/demo_name"
```

Creates Unity Catalog resources (schema, volume, tables) and deploys jobs/dashboards.

### Step 2: Run Workflow (if applicable)

```bash
databricks bundle run demo_workflow --var="catalog=YOUR_CATALOG" --var="schema=YOUR_SCHEMA" --var="warehouse_name=YOUR_WAREHOUSE" --var="workspace_path=/Users/you@company.com/demo_name"
```

Executes the workflow to generate data, run SQL transformations, and deploy agent bricks.

## Resources Created

After deployment, you will have:
- [List specific resources created by the bundle]
```

**Customize this template** based on the actual resources and variables in the `databricks.yml`. Make sure:
- All variables from `databricks.yml` are documented
- The deployment commands include all required `--var` flags
- The resources list matches what the bundle actually creates

## Step 8: Typical Demo Workflow Setup

Demos typically require a specific execution sequence because components have dependencies on each other. The generated Python scripts run on **serverless compute** via workflow tasks using the `environment_key` pattern.

### Complete Resource Definitions

A typical demo needs these resources defined in `resources/` YAML files:

**resources/pipelines.yml** - SDP Pipeline:
```yaml
resources:
  pipelines:
    demo_pipeline:
      name: "[${bundle.target}] Demo Data Pipeline"
      catalog: ${var.catalog}
      target: ${var.schema}
      libraries:
        - notebook:
            path: ../src/pipelines/transformations.py
      serverless: true
      continuous: false
      development: true
      channel: current
      permissions:
        - level: CAN_VIEW
          group_name: "users"
```

**resources/dashboards.yml** - AI/BI Dashboard:
```yaml
resources:
  dashboards:
    demo_dashboard:
      display_name: "[${bundle.target}] Demo Dashboard"
      file_path: ../src/dashboards/demo.lvdash.json
      warehouse_id: ${var.warehouse_id}
      dataset_catalog: ${var.catalog}
      dataset_schema: ${var.schema}
      permissions:
        - level: CAN_RUN
          group_name: "users"
```

**src/deploy/deploy_genie.py** - Genie Space (created via SDK):
```python
# Genie Space creation via SDK (DAB support pending)
# Uses AgentBricksManager from databricks-tools-core for simplified API
from databricks_tools_core.agent_bricks import AgentBricksManager

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")

manager = AgentBricksManager()

# Check if Genie Space already exists (idempotent)
existing = manager.genie_find_by_name("Demo Data Explorer")

if existing:
    # Update existing Genie Space
    result = manager.genie_update(
        space_id=existing.space_id,
        display_name="Demo Data Explorer",
        description=f"Ask questions about {catalog}.{schema} data",
        table_identifiers=[
            f"{catalog}.{schema}.customers",
            f"{catalog}.{schema}.orders",
            f"{catalog}.{schema}.products",
        ],
        sample_questions=[
            "What were total sales last month?",
            "Who are our top 10 customers?",
            "How many orders by region?",
        ],
    )
    print(f"Genie Space updated: {result}")
else:
    # Create new Genie Space
    result = manager.genie_create(
        display_name="Demo Data Explorer",
        warehouse_id=warehouse_id,
        table_identifiers=[
            f"{catalog}.{schema}.customers",
            f"{catalog}.{schema}.orders",
            f"{catalog}.{schema}.products",
        ],
        description=f"Ask questions about {catalog}.{schema} data",
    )
    space_id = result.get("id") or result.get("space_id")
    print(f"Genie Space created: {space_id}")

    # Add sample questions after creation
    manager.genie_add_sample_questions_batch(space_id, [
        "What were total sales last month?",
        "Who are our top 10 customers?",
        "How many orders by region?",
    ])
```

> **Note**: The raw Databricks SDK (`w.genie.create_space()`) requires a `serialized_space` JSON string. AgentBricksManager simplifies this with a cleaner API. See [SDK Genie docs](https://databricks-sdk-py.readthedocs.io/en/latest/workspace/dashboards/genie.html).

### Recommended Workflow Structure

**resources/jobs.yml** - Main setup workflow with task dependencies:

```yaml
resources:
  jobs:
    demo_setup:
      name: "[${bundle.target}] Demo Setup Workflow"
      tasks:
        # Task 1: Generate synthetic data
        - task_key: generate_data
          notebook_task:
            notebook_path: ../src/data_generation/generate_data.py
          environment_key: default

        # Task 2: Run SDP pipeline to process data
        - task_key: run_pipeline
          depends_on:
            - task_key: generate_data
          pipeline_task:
            pipeline_id: ${resources.pipelines.demo_pipeline.id}

        # Task 3: Deploy Genie Space (depends on tables existing)
        - task_key: deploy_genie
          depends_on:
            - task_key: run_pipeline
          notebook_task:
            notebook_path: ../src/deploy/deploy_genie.py
          environment_key: default

        # Task 4: Deploy Knowledge Assistant (depends on data being ready)
        - task_key: deploy_ka
          depends_on:
            - task_key: run_pipeline
          notebook_task:
            notebook_path: ../src/deploy/deploy_ka.py
          environment_key: default

        # Task 5: Deploy Multi-Agent Supervisor (depends on KA + Genie)
        - task_key: deploy_mas
          depends_on:
            - task_key: deploy_ka
            - task_key: deploy_genie
          notebook_task:
            notebook_path: ../src/deploy/deploy_mas.py
          environment_key: default

      # Serverless compute for Python tasks
      environments:
        - environment_key: default
          spec:
            client: "4"
            dependencies:
              - databricks-sdk
              - plutoprint
```

### Execution Sequence

| Step | Task | Purpose | Dependencies |
|------|------|---------|--------------|
| 1 | `generate_data` | Create synthetic demo data in Unity Catalog tables | None |
| 2 | `run_pipeline` | Run SDP to transform/enrich data | Data tables exist |
| 3 | (Dashboard auto-deploys) | Dashboard queries processed tables | SDP complete |
| 4 | `deploy_genie` | Create Genie Space via SDK | Tables exist |
| 5 | `deploy_ka` | Create Knowledge Assistant with docs | Volume with docs |
| 6 | `deploy_mas` | Create Multi-Agent Supervisor | KA + Genie exist |

### Why This Order Matters

1. **Data first**: SDP pipelines and dashboards need tables to exist
2. **SDP before dashboards**: Dashboards query the processed/aggregated tables
3. **Genie after tables**: Genie needs to index the table schemas
4. **KA can run in parallel**: Only needs Volume with documentation files
5. **MAS last**: Orchestrates KA + Genie, so both must exist first

### Project Structure for Workflow

```
project/
├── databricks.yml
├── dab_instructions.md
├── resources/
│   ├── jobs.yml              # Main workflow job
│   ├── pipelines.yml         # SDP pipeline definitions
│   └── dashboards.yml        # Dashboard definitions
└── src/
    ├── data_generation/
    │   └── generate_data.py  # Synthetic data with Polars/dbldatagen
    ├── pipelines/
    │   └── sdp_pipeline.py   # Spark Declarative Pipeline code
    ├── dashboards/
    │   └── demo.lvdash.json  # AI/BI dashboard
    └── deploy/
        ├── deploy_genie.py   # Genie Space creation (via SDK)
        ├── deploy_ka.py      # Knowledge Assistant creation
        └── deploy_mas.py     # Multi-Agent Supervisor creation
```

### Deployment Commands

After `databricks bundle deploy`, run the workflow:

```bash
# Deploy all resources
databricks bundle deploy --var="catalog=YOUR_CATALOG" --var="schema=YOUR_SCHEMA"

# Run the setup workflow (executes all tasks in order)
databricks bundle run demo_setup --var="catalog=YOUR_CATALOG" --var="schema=YOUR_SCHEMA"
```

The workflow handles the execution order automatically via task dependencies.
