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
- **Optional**: a Databricks App with native resource bindings (Genie / SQL warehouse / Lakebase)
- **Optional**: a Lakebase Postgres project (autoscaling, scale-to-zero)
- Remember: your job is to make a DAB that works for the current demo/story, it might have many more or less components, you must adapt this example to your story. Drop the optional sections (app, Lakebase) if the demo doesn't ship them.

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
| Apps | `apps` | Native DAB (CLI 0.239.0+). Bindings in `resources:` — see App section below |
| Lakebase Postgres | `postgres_projects` / `postgres_branches` / `postgres_endpoints` | Autoscaling PG. Use `lifecycle.prevent_destroy` for stateful demos |
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

## Step 5b: Optional — Databricks App + Lakebase Postgres

If the demo ships a Databricks App or needs managed Postgres, both go in the same `databricks.yml`. Skip this section entirely if the demo is workflow-only.

### Lakebase resource tree

`postgres_projects` → (auto `production`) `postgres_branches` → `postgres_endpoints`. The CLI auto-creates a default `production` branch + endpoint on first deploy, so for most demos you only declare `postgres_projects`. Declare branches/endpoints explicitly only when you need additional dev/staging branches or non-default endpoint configs.

| Field | Where | Why |
|-------|-------|-----|
| `default_endpoint_settings.suspend_timeout_duration: 300s` | `postgres_projects` | Endpoint scales to zero after 5 min idle. First query pays the wake-up. |
| `no_suspension: true` | `postgres_projects` (rare) | Opt OUT of scale-to-zero. Always-on is more expensive — only use if first-query latency is unacceptable. |
| `lifecycle.prevent_destroy: true` | `postgres_projects` AND `apps` | Blocks `bundle destroy` from wiping stateful resources. |
| `pg_version: 17` | `postgres_projects` | Pin the major. Defaults change. |

The DATABASE inside the branch is NOT a DAB resource (no `postgres_databases` type). Create it once via psql, or have the app's first-boot code do `CREATE DATABASE IF NOT EXISTS` against the maintenance DB.

### App resource bindings

The `apps.<name>.resources:` block declares each downstream resource the app can reach. Each entry has a `name` (handle the app uses to look up the resource) and **exactly one** keyed object describing the target type:

| Binding key | Purpose | Permission |
|-------------|---------|------------|
| `genie_space` | Bind an existing Genie Space (pass the id as a var) | `CAN_RUN` |
| `sql_warehouse` | SQL warehouse for app-issued queries | `CAN_USE` |
| `serving_endpoint` | Model-serving endpoint (LLM, embedding) | `CAN_QUERY` |
| `postgres` | Lakebase branch — **legacy Provisioned only, see pitfall below for autoscaling** | `CAN_CONNECT_AND_CREATE` |
| `secret` | Workspace secret scope/key | `READ` |
| `job` | Existing job (manage runs from app) | `CAN_MANAGE_RUN` |
| `uc_securable` | UC catalog/schema/table (read-only browse) | `CAN_USE` |

The app's auto-provisioned service principal gets the listed `permission` on each binding — no separate grant step needed.

### Bindings ≠ env vars — `app.yaml` must wire them

The Apps platform does **not** auto-inject env vars from these bindings. Each binding must be surfaced explicitly in the app's `app.yaml` (under `source_code_path`) via a `valueFrom: <binding-name>` entry that **references the binding's `name:` field exactly**:

```yaml
# app.yaml (sits at app/app.yaml inside the source tree)
command: ['node', '--env-file-if-exists=.env', 'dist/server.js']
env:
  - name: NODE_ENV
    value: production
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse        # matches `name: sql-warehouse` in databricks.yml
  - name: DATABRICKS_GENIE_SPACE_ID
    valueFrom: genie-space
```

If `app.yaml` is missing the `valueFrom:` entries, the app boots and crashes at runtime with `Warehouse ID not found / Please configure the DATABRICKS_WAREHOUSE_ID environment variable` (or the equivalent for whichever binding is missing).

### Building + shipping the app — single-command deploy

For Node-based apps (AppKit, etc.) shipping a built `dist/`, three things must happen on `databricks bundle deploy`:

1. **Local build** — produce `app/dist/server.js` (server bundle) and `app/client/dist/` (vite client). Wire this through `artifacts.<name>.build:` in `databricks.yml` so the build runs automatically before sync.
2. **Sync override** — `app/dist/` and `app/client/dist/` are gitignored. The bundle CLI honors `.gitignore`, so add explicit `sync.include` entries to whitelist them past the gitignore.
3. **Lockfile registry rewrite** — `package-lock.json`'s `resolved` URLs are baked at install time. If the developer is on the Databricks VPN, their `~/.npmrc` resolves through `https://npm-proxy.dev.databricks.com/` and the lockfile gets those proxy URLs. The Apps container can't reach the internal proxy, so its `npm install` ETIMEDOUTs after 3 retries × ~2 min per package, looking like an 8-minute hang followed by `npm error Exit handler never called!`. Fix: a build-time `sed` step that rewrites proxy URLs → `registry.npmjs.org` in the lockfile. Idempotent (no-op for off-VPN users whose lockfiles already use the public registry).

The `app_template` skill ships these as `scripts/build-app.sh` (does install + build + rewrite) and `scripts/strip-internal-registry.sh` (the lockfile rewrite). Reuse them in generated demos.

### Container lifecycle for Node apps

After `databricks bundle deploy` uploads source, the App container runs:

1. `npm install` — uses our shipped `.npmrc` (`omit=dev` so only runtime deps install, `ignore-scripts=true` so postinstall doesn't try to run dev tooling).
2. `npm run build` — Apps **always** runs this. Override the script in `package.json` to be a no-op echo (the real build already produced `dist/` locally and shipped it via sync.include). If `build` is left as the real build, it'll try to invoke `tsdown`/`vite` which aren't installed at runtime → exit 127.
3. The `command:` from `app.yaml` runs.

Move every frontend-only package (`react`, `tailwindcss-*`, `lucide-react`, `embla-carousel-react`, `next-themes`, `react-router`, `react-markdown`, `react-resizable-panels`, `remark-gfm`, `clsx`, `zod`, `@databricks/appkit-ui`, `@tailwindcss/typography`) from `dependencies` → `devDependencies`. They're bundled into `client/dist/` at build time and aren't needed at runtime; with `omit=dev` this drops the container install from ~700 packages to ~440.

See the `apps:` block in [example_databricks.yml](example_databricks.yml) for the working bundle config.

## Step 6: Bundle Template

Create a **single `databricks.yml`** at the project root containing bundle metadata, sync config, variables, targets, and ALL resources under one top-level `resources:` block. See [example_databricks.yml](example_databricks.yml) for the complete working example to mirror.

**Key points:**
- One file — do NOT split into `resources/*.yml`. Keeping everything in `databricks.yml` is easier to read, edit, and maintain.
- No hardcoded workspace hosts - use environment variables or CLI profiles
- Variables for catalog/schema with sensible defaults
- `sync.include` for static files (PDFs, etc.) AND for the app's gitignored build outputs (`app/dist/**`, `app/client/dist/**`)
- Two environments: `sdk_only` and `sdk_latest`
- **If shipping an app**: `artifacts.default.build: ./scripts/build-app.sh` so a single `databricks bundle deploy` builds the frontend locally + ships the result.

## Step 7: Project Structure example

```
project/
├── databricks.yml              # Single bundle config — all resources in one file (see example_databricks.yml)
├── dab_instructions.md         # Deployment instructions for users
├── scripts/                    # (Optional, only if shipping an app)
│   ├── build-app.sh           # Wired into artifacts.default.build — runs npm install + build + lockfile rewrite
│   └── strip-internal-registry.sh  # Lockfile URL rewrite (proxy → public registry)
├── src/
│   ├── data_generation/       # Data generation notebooks
│   ├── deploy/                # SDK deployment notebooks (Genie, KA, MAS, file upload)
│   └── pipeline/              # SDP/DLT pipeline code
├── dashboard/                  # .lvdash.json files
├── app/                        # (Optional) Databricks App source
│   ├── app.yaml               # `command:` + env wiring (valueFrom for each binding)
│   ├── package.json           # build:source script + frontend deps in devDependencies
│   ├── .npmrc                 # ignore-scripts=true, omit=dev
│   ├── server/                # backend source (built to dist/server.js)
│   ├── client/                # frontend source (built to client/dist/)
│   ├── dist/                  # gitignored — built by scripts/build-app.sh, shipped via sync.include
│   └── client/dist/           # gitignored — built by scripts/build-app.sh, shipped via sync.include
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
7. **Path resolution** - all resource paths are relative to `databricks.yml`, so use `./src/...`, `./dashboard/...`, etc.
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
| App `postgres` binding rejecting an autoscaling Lakebase project slug | Deploy error "Database instance X does not exist" / "Field 'name' expects projects/.../databases/..." | Apps' postgres binding API only knows legacy Provisioned Lakebase. For autoscaling Lakebase: omit the binding, grant the App SP `CAN_CONNECT_AND_CREATE` via the Lakebase UI, and inject `PGHOST` / `PGDATABASE` / `LAKEBASE_ENDPOINT` / `PGPORT` / `PGSSLMODE` directly via plain `value:` entries in `app.yaml`. |
| Workspace at the 1000-project Lakebase quota | `postgres_projects` deploy fails | `postgres_projects` has no "use existing" mode — `project_id` is a slug for CREATE. Comment out the `postgres_projects` block and pass an existing project's UID via vars. |
| Missing `lifecycle.prevent_destroy` on app/Lakebase | `bundle destroy` wipes user data | Add `lifecycle: { prevent_destroy: true }` to any stateful resource. |
| App container `npm install` hangs ~8 min then fails with `npm error Exit handler never called!` | Looks like OOM, isn't | The shipped `package-lock.json` has `resolved` URLs pointing at `npm-proxy.dev.databricks.com` (developer's local VPN proxy). Container can't reach it; every fetch ETIMEDOUTs after 3 retries × ~2 min. Fix: `scripts/strip-internal-registry.sh` rewrites lockfile URLs → `registry.npmjs.org` in a build hook. |
| App container `npm run build` fails with `sh: 1: tsdown: not found` (or `vite: not found`) | Apps platform always runs `npm run build` after `npm install` | With `omit=dev` in `.npmrc`, dev deps aren't installed. Make `package.json`'s `build` a no-op echo (the real build runs locally; rename the real one to `build:source`). Ship `dist/` + `client/dist/` via `sync.include`. |
| App boot crashes with `Warehouse ID not found` / `PGHOST missing` despite resources being declared | Bindings declared in `databricks.yml` don't auto-inject env vars | Add matching `env: - name: X / valueFrom: <binding-name>` entries in `app.yaml` for each binding. |
| App boot fails with `Error installing packages` and no stderr lines | Default Apps install logs are too quiet to debug | Add `loglevel=verbose` to the app's `.npmrc`. The container will dump per-package fetch progress to the platform logs so you can see exactly where install dies. |
| App's `dist/` and `client/dist/` missing on the container after a successful deploy | Bundle CLI honored `.gitignore` and skipped them | Add `sync.include: ["app/dist/**", "app/client/dist/**"]` to override the gitignore. |

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
