# Databricks Asset Bundles (DAB) — authoring guide

When asked to package a demo as a DAB, produce a single `databricks.yml` at the project root + a short `dab_instructions.md`. Both shapes are demonstrated in [example_databricks.yml](example_databricks.yml) — **read it first**, then adapt to the demo at hand. Drop optional sections (App, Lakebase) if the demo doesn't ship them.

## Prerequisites for the deploying user

- Databricks CLI **v0.283.0+** (dashboard `dataset_catalog`/`dataset_schema` rewriting requires it).
- SDK `databricks-sdk>=0.102.0` for any task that touches Genie / KA / MAS APIs — wire via `environment_key: sdk_latest`.

---

## Resource types (what to put in `databricks.yml`)

| Demo asset | DAB resource | Notes |
|------------|--------------|-------|
| SQL files | `jobs.<key>.sql_task` | |
| Python notebooks | `jobs.<key>.notebook_task` | |
| SDP/DLT pipeline | `pipelines` | |
| AI/BI dashboard (`.lvdash.json`) | `dashboards` | Set `dataset_catalog` + `dataset_schema` so queries rebind per-target. |
| Databricks App | `apps` | Native (CLI 0.239.0+). Bindings under `apps.<key>.resources:` — see App section. |
| Lakebase Postgres | `postgres_projects` / `postgres_branches` / `postgres_endpoints` | Bundle-declarable. **But** prefer the script approach (see Lakebase section). |
| UC schemas / volumes / catalogs | `schemas` / `volumes` / `catalogs` | Use `grants` on volumes, not `permissions`. |

**Not declarable in DAB** — deploy via SDK notebook tasks in the day workflow. Reference scripts ship under [`scripts/`](scripts/):

| Component | Reference script | SDK version |
|-----------|------------------|-------------|
| Genie Spaces | [`scripts/deploy_genie.py`](scripts/deploy_genie.py) | `>=0.102.0` |
| Knowledge Assistants | [`scripts/deploy_ka.py`](scripts/deploy_ka.py) | `>=0.102.0` |
| Multi-Agent Supervisors | [`scripts/deploy_mas.py`](scripts/deploy_mas.py) | `>=0.102.0` |
| File upload to volume | [`scripts/upload_pdfs.py`](scripts/upload_pdfs.py) | upload to workspace, then `dbutils.fs.cp` |

Each script is idempotent (get-then-create) and parameterized via `argparse` — copy into the project `src/deploy/` and wire as a `notebook_task` (or `python_wheel_task`) in the bundle job.

### CRITICAL — copy verbatim, do NOT rewrite SDK call shapes

The reference scripts use SDK signatures that match `databricks-sdk>=0.102.0`. **Only edit business content** — `KA_NAME`, `SPACE_TITLE`, `INSTRUCTIONS`, table identifiers, document paths. **Preserve everything else verbatim** — imports, model-object construction, generator iteration, kwarg names. If a call shape *looks* wrong to you, do NOT rewrite it from memory; the reference script's pattern is the current SDK contract.

Three rewrites that have caused runtime failures (last seen 2026-05-29):

**1. Knowledge Assistant create — must pass a `KnowledgeAssistant` model object, NOT kwargs.**

```python
# WRONG — older SDK pattern; raises TypeError: unexpected keyword argument 'display_name'
result = w.knowledge_assistants.create_knowledge_assistant(
    display_name=KA_NAME, description="..."
)

# CORRECT — current SDK signature
from databricks.sdk.service.knowledgeassistants import KnowledgeAssistant
new_ka = KnowledgeAssistant(display_name=KA_NAME, description="...", instructions="...")
result = w.knowledge_assistants.create_knowledge_assistant(knowledge_assistant=new_ka)
```

**2. Knowledge sources — must use `KnowledgeSource(files_spec=FilesSpec(...))`, NOT inline kwargs.**

```python
# WRONG — silently regressed; create succeeds but indexing never finds the files
w.knowledge_assistants.create_knowledge_source(
    parent=name, display_name="docs", source_type="files", files={"path": "..."}
)

# CORRECT
from databricks.sdk.service.knowledgeassistants import KnowledgeSource, FilesSpec
src = KnowledgeSource(
    display_name="docs",
    source_type="FILES",         # uppercase enum value
    files_spec=FilesSpec(path="..."),  # NOT files_knowledge_source
)
w.knowledge_assistants.create_knowledge_source(parent=name, knowledge_source=src)
```

**3. `list_*()` returns a Python generator, NOT a paginated response.**

```python
# WRONG — AttributeError: 'generator' object has no attribute 'knowledge_assistants'
while True:
    resp = w.knowledge_assistants.list_knowledge_assistants(page_size=100, page_token=tok)
    for ka in resp.knowledge_assistants or []: ...
    if not resp.next_page_token: break
    tok = resp.next_page_token

# CORRECT
for ka in w.knowledge_assistants.list_knowledge_assistants(page_size=100):
    if ka.display_name == KA_NAME: ...
```

The same generator-iteration pattern applies to `w.genie.list_spaces(...)`.

---

## Bundle skeleton — what `databricks.yml` must have

One file at project root, all resources under one top-level `resources:` block.

- **Variables** for catalog, schema, warehouse_id — never hardcode. No workspace host — rely on CLI profile.
- **`sync.include`** for static files (PDFs) AND the app's gitignored build outputs (`app/dist/**`, `app/client/dist/**`).
- **Paths** are relative to `databricks.yml` — `./src/...`, `./dashboard/...`.
- **Two `environments:`** in any job that calls SDK APIs: `sdk_only` (default) and `sdk_latest` (`databricks-sdk>=0.102.0`) for Genie/KA/MAS tasks.
- **`artifacts.default.build: ./app/scripts/build-app.sh`** if shipping an App (build runs before sync).
- **`lifecycle.prevent_destroy: true`** on any stateful resource (Lakebase project, the App).

---

## Workflow patterns (inside the bundle's `jobs:`)

### Parallel + dependent tasks
Tasks without `depends_on` run in parallel. Use `depends_on` only where a real dependency exists (downstream needs upstream's output).

### Passing IDs between tasks (task values)
When task B needs an ID created by task A (e.g. MAS needs the Genie space id):

```python
# Producer (Python notebook only — task values are Python-only)
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
```

```yaml
# Consumer
- task_key: deploy_mas
  depends_on:
    - task_key: deploy_genie
  notebook_task:
    base_parameters:
      genie_space_id: "{{tasks.deploy_genie.values.genie_space_id}}"
```

Task values only work within a single job run; cross-job sharing requires another channel.

### SDP `read_files` paths
SDP SQL `read_files(...)` can't interpolate Spark conf vars. Two options:
- **Python bronze** (recommended): `spark.conf.get("demo.volume_path")` + `spark.readStream...load(f"{volume_path}/...")`.
- **SQL bronze with hardcoded paths**: must match the DAB's default `${var.catalog}/${var.schema}` — note this in `dab_instructions.md`.

---

## App-specific sections

### Build pipeline (Node apps)

For AppKit / Node apps shipping a built `dist/`, three things must happen on every `databricks bundle deploy`:

1. **Local build** — produces `app/dist/server.js` + `app/client/dist/`. Wire via `artifacts.default.build: ./app/scripts/build-app.sh`.
2. **Sync override** — both `dist/` dirs are gitignored. Whitelist via `sync.include: ["app/dist/**", "app/client/dist/**"]`.
3. **Lockfile registry rewrite** — local installs on VPN bake `npm-proxy.dev.databricks.com` into `package-lock.json`; the App container can't reach that proxy. `build-app.sh` rewrites those URLs to `registry.npmjs.org` (idempotent — no-op off-VPN).

The app ships `app/scripts/build-app.sh` covering all three. Reuse it.

### App container lifecycle

After bundle deploy, the container runs `npm install` → `npm run build` → `command:` from `app.yaml`. Two non-obvious requirements:
- `npm run build` is **always** invoked by the platform. Override `package.json`'s `build` to a no-op `echo` (the real build is local). Rename the real script to `build:source`. Otherwise the container tries to invoke `tsdown`/`vite` which aren't installed (`omit=dev` strips them).
- Frontend-only packages (`react`, `tailwindcss-*`, `lucide-react`, etc.) belong in `devDependencies`, not `dependencies` — they're bundled into `client/dist/` at build time. With `omit=dev` this cuts the container install from ~700 to ~440 packages.

### App resource bindings

Each downstream resource the app uses goes under `apps.<key>.resources:`. The app SP automatically gets the listed `permission` on the binding — no separate grant step needed for those.

| Binding key | Permission |
|-------------|------------|
| `genie_space` | `CAN_RUN` |
| `sql_warehouse` | `CAN_USE` |
| `serving_endpoint` | `CAN_QUERY` |
| `postgres` | `CAN_CONNECT_AND_CREATE` (Lakebase — see below) |
| `secret` | `READ` |
| `job` | `CAN_MANAGE_RUN` |
| `uc_securable` | `CAN_USE` |

### Bindings ≠ env vars — `app.yaml` wires them through

The Apps platform does NOT auto-inject env vars from bindings. Each binding needs a matching entry in `app/app.yaml`:

```yaml
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse        # matches `name: sql-warehouse` in databricks.yml
  - name: LAKEBASE_ENDPOINT
    valueFrom: postgres
```

Missing `valueFrom` entries → app boots and crashes with `Warehouse ID not found` / `PGHOST missing`.

---

## Lakebase (special handling)

Two gaps in the bundle CLI (v0.299.1) force a two-script wrap:

1. **No `postgres_databases` resource type** → the database can't be declared in YAML, so it must exist before `bundle deploy`. The `postgres` binding in the App requires the full slugged path (`projects/<id>/branches/<branch>/databases/db-<slug>`).
2. **No post-deploy hook** → the App SP's auto-created Postgres role only has CONNECT. Drizzle migrations fail with `pg=42501 permission denied for schema public` without a GRANT.

**The recommended pattern: do NOT declare any `postgres_*` resources in `databricks.yml`.** Use the two scripts the App template ships:

- `app/scripts/lakebase_setup_db.sh` — creates project + branch + endpoint + database via CLI. Defaults to the shared `dbdemos-asset-generator` project (each demo gets its own DB inside; auto-bumps to `-2`, `-3`, ... if full). Run **before** `bundle deploy`.
- `app/scripts/lakebase_grant_app_credential.sh` — GRANTs the App SP CREATE+USAGE on `public`. Run **after** `bundle deploy`.

Same scripts work for the interactive `databricks apps deploy` path too — single source of truth.

When both ship (a future DAB version), fold all four resources back into `databricks.yml` in one change.

### App `postgres` binding shape (when present)

```yaml
- name: postgres
  postgres:
    branch: projects/${var.lakebase_project_id}/branches/${var.lakebase_branch_id}
    database: projects/${var.lakebase_project_id}/branches/${var.lakebase_branch_id}/databases/${var.lakebase_database_id}
    permission: CAN_CONNECT_AND_CREATE
```

`lakebase_database_id` is derived by `lakebase_setup_db.sh` as `db-` + DB name with underscores → hyphens (e.g. `dbgen_luxebeauty` → `db-dbgen-luxebeauty`).

With the binding in place, `app.yaml` only needs `LAKEBASE_ENDPOINT: valueFrom: postgres` — the platform auto-injects `PGHOST` / `PGDATABASE` / `PGSSLMODE` / `PGUSER` / `PGPORT` / `PGAPPNAME`.

---

## Project structure

```
project/
├── databricks.yml              # Single bundle config — see example_databricks.yml
├── dab_instructions.md         # Short deploy commands (see "Generate dab_instructions.md" below)
├── src/
│   ├── data_generation/        # Data generation notebooks
│   ├── deploy/                 # SDK deployment notebooks (Genie, KA, MAS, file upload)
│   └── pipeline/               # SDP/DLT pipeline code
├── dashboard/                  # .lvdash.json files
├── raw_data/pdf/               # PDFs to upload (synced via sync.include)
└── app/                        # (Optional) Databricks App source
    ├── app.yaml                # `command:` + env wiring (valueFrom for each binding)
    ├── package.json            # `build` is a no-op echo; real build is `build:source` (dev only)
    ├── .npmrc                  # ignore-scripts=true, omit=dev, loglevel=verbose
    ├── .env / .env.template    # Local dev: APP_NAME + Lakebase values
    ├── scripts/
    │   ├── build-app.sh                     # Wired into artifacts.default.build (install + build + lockfile rewrite)
    │   ├── deploy.sh                        # One-shot interactive `databricks apps deploy` (uploads, creates, grants, starts)
    │   ├── lakebase_setup_db.sh             # Lakebase project/branch/endpoint/db — run BEFORE bundle deploy
    │   └── lakebase_grant_app_credential.sh # GRANT App SP on schema public — run AFTER bundle deploy
    ├── server/                 # backend source (built to dist/server.js)
    ├── client/                 # frontend source (built to client/dist/)
    ├── dist/                   # gitignored — built locally, shipped via sync.include
    └── client/dist/            # gitignored — same
```

---

## Generate `dab_instructions.md`

Short, command-driven. Tell the user what to run; don't restate `databricks.yml`'s contents.

**Template when the demo ships an App + Lakebase:**

````markdown
# Deploy — <Demo Name>

Three commands. The two Lakebase scripts wrap what the bundle CLI (v0.299.1) can't do yet — no `postgres_databases` resource type and no post-deploy hook.

```bash
./app/scripts/lakebase_setup_db.sh --db-name <db> --project-id <id>
databricks bundle deploy
./app/scripts/lakebase_grant_app_credential.sh --app-name <name> --project-id <id> --db-name <db>
```

Start the app: `databricks bundle run <app-resource-key>`.

## First-time setup (cold-start only — skip on redeploys)

(Include only what this demo actually needs.)
- `python data/generate_data.py` — synthetic data into UC volumes.
- `python src/deploy/deploy_genie.py --catalog ... --schema ... --warehouse-id ...` — create the Genie space. Save the returned `space_id` into `resources.json` and `app/config/app.json`.

## Teardown
`databricks bundle destroy --auto-approve`
(Does not drop UC tables/volumes or the Genie space.)
````

**When the demo has no App (workflow-only):** just `databricks bundle deploy` + the per-demo `bundle run` commands. No Lakebase scripts needed.

---

## Common pitfalls (after a successful `bundle deploy`)

| Symptom | Cause + fix |
|---------|-------------|
| `DATATYPE_MISMATCH.UNEXPECTED_INPUT_TYPE` on a BOOLEAN | `avg()` doesn't accept boolean — cast: `F.avg(F.col("bool_col").cast("int"))`. |
| Dashboard deploy silently ignores `dataset_catalog`/`dataset_schema` | CLI < 0.283.0. Require v0.283.0+. |
| Pipeline fails on non-default catalog/schema | Hardcoded paths in SDP SQL bronze. Use Python bronze or document the constraint. |
| App deploy "Field 'name' expects projects/.../databases/..." | `postgres` binding's `database:` needs the full slugged path. Use `${var.lakebase_database_id}`. |
| App migrations fail with `pg=42501` | Binding grants CONNECT only. Run `app/scripts/lakebase_grant_app_credential.sh` post-deploy. |
| `postgres_projects` deploy fails with "workspace projects limit exceeded" | Workspace at 1000-project Lakebase quota. Use the shared `dbdemos-asset-generator` project via `lakebase_setup_db.sh` (auto-bumps to `-2`, `-3`, ...). |
| `bundle destroy` wiped Lakebase or the App | Missing `lifecycle.prevent_destroy: true`. Add to any stateful resource. |
| App container `npm install` hangs ~8 min then fails with `Exit handler never called!` | Lockfile has `npm-proxy.dev.databricks.com` URLs (VPN-baked). `scripts/build-app.sh` rewrites them — make sure the artifact hook is wired. |
| App container `npm run build` fails with `tsdown: not found` | `omit=dev` strips build tools. Make `package.json`'s `build` a no-op echo; real build runs as `build:source` locally. |
| App boots crashes with `Warehouse ID not found` / `PGHOST missing` | Binding declared but `app.yaml` is missing the matching `valueFrom: <binding-name>` entry. |
| App boot fails with `Error installing packages` and no stderr | Container install logs are too quiet. Add `loglevel=verbose` to `.npmrc` to see per-package fetch progress. |
| `dist/` / `client/dist/` missing on container after deploy | Bundle CLI honored `.gitignore`. Add `sync.include: ["app/dist/**", "app/client/dist/**"]`. |

For component-specific pitfalls (Genie API requirements, KA document formats), see the reference scripts in [`scripts/`](scripts/).
