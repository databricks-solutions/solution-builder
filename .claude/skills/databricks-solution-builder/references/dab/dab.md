# Databricks Asset Bundles (DAB) — authoring guide

When asked to package a demo as a DAB, produce a single `databricks.yml` at the project root. [example_databricks.yml](example_databricks.yml) is a **complete, working, generic bundle distilled from a proven end-to-end deploy** — **read it first**, copy its shape, rename `demo` → your demo's short name, and drop optional blocks (App, Lakebase, KA/MAS, ML) the demo doesn't ship.

> **Scope: author + verify, do NOT deploy by default.** Your job here is to produce a *correct* bundle — write `databricks.yml`, the scripts, and `dab_instructions.md`, and validate it (`databricks bundle validate` is fine; it's read-only). **Do NOT run `databricks bundle deploy` / `bundle run` / the lakebase + finalize scripts unless the user explicitly asks you to deploy.** Those mutate a workspace (create catalogs, run jobs, deploy an app, provision Lakebase) and may incur cost. The 5-command flow below is the runbook you hand to the user (and write into `dab_instructions.md`) — it is *documentation of how to deploy*, not a checklist for you to execute. When the demo was already built in a workspace during Stage 3, the DAB exists so the demo can be *re-created elsewhere from scratch* — leave the actual re-deploy to the user.

## The deploy is 5 commands (not just `bundle deploy`)

A full demo with an App can't be deployed in one shot, because the Genie / KA / MAS endpoint IDs only exist **after** the setup job's SDK tasks run — the bundle can't know them at `deploy` time. So the flow is:

```bash
# 1. Lakebase DB (pre-deploy — the CLI can't declare a postgres database)
./app/scripts/lakebase_setup_db.sh --db-name dbgen_<demo>
# 2. Create resource SHELLS (schema, volumes, pipeline, dashboard, app) + the setup job
databricks bundle deploy --var catalog=… --var schema=… --var warehouse_id=…
# 3. FILL them in: data → pipeline → metric view + ML → genie/ka/mas → grants → export IDs
databricks bundle run demo_setup --var …
# 4. Grant the app SP on the Lakebase (Postgres) schemas
./app/scripts/lakebase_grant_app_credential.sh --app-name … --project-id … --db-name …
# 5. Harvest the resolved IDs → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

Steps 1+4+5 are shell scripts the App template ships under `app/scripts/`. The skill does NOT run `databricks bundle deploy` itself — it authors the files and points the user at these commands.

## Prerequisites for the deploying user

- Databricks CLI **v0.283.0+** (dashboard `dataset_catalog`/`dataset_schema` rewriting requires it).
- SDK `databricks-sdk>=0.114.0` for any task that touches Genie / KA / MAS APIs — wire via `environment_key: sdk_latest`.

## ⚠️ The footguns that cost the most time (read before editing a deployed app)

- **NEVER `databricks apps update --json` a deployed app out of band** (to tweak scopes, env, etc.). `update` REPLACES the whole app spec — it silently drops the `resources` bindings, which deprovisions the Lakebase SP Postgres role → every DB query fails with `password authentication failed`. Change app config ONLY in `databricks.yml` (+ re-`bundle deploy`) or in `app.yaml` (+ `finalize_app.sh`).
- **Job task-values are NOT retrievable after the run** via the API (`get-run-output` returns them empty). They only work for in-run `{{tasks.X.values.Y}}` substitution. To get IDs OUT of the job (for `finalize_app.sh`), the final task `export_resources.py` calls `dbutils.notebook.exit(json.dumps({...}))` — the notebook **exit value IS** retrievable post-run via `get-run-output → notebook_output.result`.
- **The OBO token needs BOTH `serving.serving-endpoints` AND `ai-gateway`** scopes to call the Responses API (`/serving-endpoints/responses`). With only the first you get `403 Invalid Token` (not "invalid scope") because the Responses API routes through AI Gateway. Scope strings for `user_api_scopes` differ from app.yaml's `user_authorization.scopes` vocabulary — set both.
- **`app/package.json` + `package-lock.json` must NOT be gitignored.** The bundle CLI honors `.gitignore`; without a deps file the Apps container boots and crashes with `ERR_MODULE_NOT_FOUND`. If the repo root ignores `package.json` globally, add a `!.../app/package.json` un-ignore.
- **Exclude `app/node_modules/**` from sync** — otherwise it's dragged into the Apps deployment zip and "Preparing source code" stalls for minutes.

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
| UC schemas / volumes / catalogs | `schemas` / `volumes` / `catalogs` | Avoid `grants:` blocks — on some workspaces a grant to the `users` group fails at deploy (`Could not find principal`). Grant the app SP via the `grant_app_uc` task (targets the SP client_id) instead. |

**Not declarable in DAB** — deploy via notebook tasks in the setup job, or shell scripts the App ships. Reference implementations under [`scripts/`](scripts/):

| Component | Reference script | Wired as | Notes |
|-----------|------------------|----------|-------|
| Genie Spaces | [`scripts/deploy_genie.py`](scripts/deploy_genie.py) | job notebook_task (`sdk_latest`) | Loads the space JSON, substitutes catalog/schema. |
| Knowledge Assistants | [`scripts/deploy_ka.py`](scripts/deploy_ka.py) | job notebook_task (`sdk_latest`) | Loads KA JSON. |
| Multi-Agent Supervisors | [`scripts/deploy_mas.py`](scripts/deploy_mas.py) | job notebook_task (`sdk_latest`) | Reads genie/ka IDs from task-values. |
| App SP UC grants | [`scripts/grant_app_uc.py`](scripts/grant_app_uc.py) | job notebook_task (`sdk_latest`) | USE_CATALOG/SCHEMA, SELECT, READ_VOLUME, EXECUTE-on-model. |
| Export resolved IDs | [`scripts/export_resources.py`](scripts/export_resources.py) | job notebook_task (final) | `dbutils.notebook.exit(json)` — the channel `finalize_app.sh` reads. |
| PDF upload to volume | [`scripts/upload_pdfs.py`](scripts/upload_pdfs.py) | job notebook_task | Copies PRE-rendered PDFs (render locally; in-job render OOMs the small client). |
| Finalize app env + deploy | [`scripts/finalize_app.sh`](scripts/finalize_app.sh) | shell (step 5) | Harvest export JSON → app.yaml env → `apps deploy`. |
| Lakebase DB + grants | [`scripts/lakebase_grant_app_credential.sh`](scripts/lakebase_grant_app_credential.sh) | shell (step 4) | `CREATE ON DATABASE` + drop/recreate/grant app+appkit+drizzle schemas. |

Each notebook script is idempotent (get-then-create-or-update) and parameterized via `dbutils.widgets`. **Copy them, edit only business content (names, config-file paths). Do NOT rewrite the SDK call shapes from memory — they encode hard-won fixes:**

- `genie.list_spaces()` returns a `GenieListSpacesResponse` (NOT a generator) — paginate `resp.spaces` + `next_page_token`.
- `KnowledgeSource(files=FilesSpec(...))` — the field is `files`, NOT `files_spec`. `update_knowledge_assistant(update_mask=FieldMask(paths=[...]))` — a `FieldMask` proto, NOT a comma string.
- **Wait-for-ready ONLY on first create**, never on update — KA re-index + MAS re-provision are async and would block the job ~10–15 min on every re-run. (This alone cut a re-deploy from ~35 min to ~5 min.)
- Genie validates every table identifier on update — if it runs before the metric view exists it 403s; the job's `depends_on` + the task's own retry handle the race.

---

## Bundle skeleton — what `databricks.yml` must have

One file at project root, all resources under one top-level `resources:` block.

- **Variables** for catalog, schema, warehouse_id — never hardcode. No workspace host — rely on CLI profile.
- **`sync.include`** for static files (PDFs) AND the app's gitignored build outputs (`app/dist/**`, `app/client/dist/**`).
- **Paths** are relative to `databricks.yml` — `./src/...`, `./dashboard/...`.
- **Per-task `environments:`** — `sdk_default` for gen/pipeline/grants, a `ml` env (xgboost/sklearn/mlflow) for training, and `sdk_latest` (`databricks-sdk>=0.114.0`) for the Genie/KA/MAS/export tasks.
- **Resolve catalog/schema through the schema resource** (`${resources.schemas.demo_schema.name}`), NOT `${var.schema}`, in pipeline `target` + every task's `base_parameters` — so dev-mode's `dev_<user>_` prefix is applied consistently (else the gen writes to `luxe_demo` while the pipeline reads `dev_me_luxe_demo`).
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

### App env — one source of truth, assembled by `finalize_app.sh`

The app reads its config (`config/app.json`) via `${VAR}` / `${VAR:default}` placeholders that `server.ts` substitutes from `process.env` at boot. So catalog/schema + every resource ID live in **env vars** — never as literals in the JSON. The SAME var names work across all three run modes:

| Run mode | Where env comes from |
|----------|----------------------|
| **Preview** (embedded in the generator) | `.env`, sourced by `start.sh` (the preview runner spawns it) |
| **Local dev** (`./start.sh`) | `.env`, sourced by `start.sh` |
| **Deployed** (DAB) | `app.yaml` env, written by `finalize_app.sh` |

The DAB can't put these in the apps `config.env` block — it's **silently dropped during terraform rendering** (carries the names, loses the values). And it can't bake them at `deploy` time — the Genie/KA/MAS IDs don't exist yet. So:

1. The setup job's final task `export_resources.py` exits a JSON manifest of every resolved ID (catalog, schema, dashboard_id, pipeline_id, warehouse_id, genie_space_id, ka_endpoint_name, mas_endpoint_name + derived model/volume/mlflow paths).
2. `finalize_app.sh` reads that JSON back, renders `app.yaml` from `app.yaml.template` (keeps the header + command + scopes + `valueFrom:` bindings, appends the plain-value env), uploads it, and `databricks apps deploy`s.

Result: a bare `bundle deploy` never ships a half-configured app, and the app env is assembled in exactly one place. **Design config to DEGRADE on empty env** (inert deep-link tile / skipped feature), not crash — so local/preview without every var still boots. (e.g. the app's zod schema must NOT `.min(1)` catalog/schema.)

### Analytics queries — schema-relative, not hardcoded

AppKit's `analytics` plugin query route can't set the SQL statement's catalog/schema, so `queryKey`-based charts would force `catalog.schema.table` literals in every `.sql` (breaks across workspaces). Instead: write the queries **schema-relative** (`FROM silver_returns`), and run them through a thin custom route (`server/routes/charts.ts`) that passes the demo's catalog+schema as the statement **session context** (`executeStatement` honors top-level `catalog`/`schema`). One env var drives analytics tables on any workspace. The charts consume the rows via their `data` prop.

---

## Lakebase (special handling)

Two gaps in the bundle CLI (v0.299.1) force a two-script wrap:

1. **No `postgres_databases` resource type** → the database can't be declared in YAML, so it must exist before `bundle deploy`. The `postgres` binding in the App requires the full slugged path (`projects/<id>/branches/<branch>/databases/db-<slug>`).
2. **No post-deploy hook** → the App SP's auto-created Postgres role only has CONNECT. Drizzle migrations fail with `pg=42501 permission denied for schema public` without a GRANT.

**The recommended pattern: do NOT declare any `postgres_*` resources in `databricks.yml`.** Use the two scripts the App template ships:

- `app/scripts/lakebase_setup_db.sh` — creates project + branch + endpoint + database via CLI. Defaults to the shared `dbdemos-asset-generator` project (each demo gets its own DB inside; auto-bumps to `-2`, `-3`, ... if full). Run **before** `bundle deploy`.
- `app/scripts/lakebase_grant_app_credential.sh` — run **after** `bundle deploy`. GRANTs `CREATE ON DATABASE` to the App SP, then **drops + recreates the `app`, `appkit`, and `drizzle` schemas** and GRANTs the SP `ALL` + default privileges on each.

Why drop+recreate all three schemas, not just grant on `public`: the app creates its own schemas — `app` (Drizzle tables = the Delta→Lakebase mirror), `appkit` (AppKit's cache), `drizzle` (migration tracking). If any was created by an *earlier* deploy under a different role (e.g. a human running psql), the SP gets `permission denied for schema <x>` and can't migrate into it — and you usually **can't** `ALTER SCHEMA … OWNER TO <sp>` (Postgres requires you to be a member of the SP role, and you can't `SET ROLE` to it). Dropping + recreating sidesteps the ownership trap; the `app.*` mirror rebuilds from Delta on the next boot and `appkit`/`drizzle` are regenerable bookkeeping.

Same scripts work for the interactive `databricks apps deploy` path too — single source of truth.

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
├── dab_instructions.md         # The 5 deploy commands (see "Generate dab_instructions.md")
├── src/
│   ├── data_generation/        # generate_data.py (widget catalog/schema in-job, env locally)
│   ├── pipeline/               # SDP SQL (schema-relative — resolved via pipeline target)
│   ├── metric_view/            # mv_*.py — CREATE … WITH METRICS YAML inline (no PySpark API)
│   ├── ml/                     # train + score notebook
│   ├── genie/ knowledge_assistant/ supervisor_agent/   # the demo's *.json configs
│   ├── documents/              # html/ source + html_to_pdf.py; pdf/ (pre-rendered, uploaded)
│   └── deploy/                 # deploy_genie/ka/mas.py, grant_app_uc.py, export_resources.py, upload_pdfs.py
└── app/                        # (Optional) Databricks App source
    ├── app.yaml                # command + scopes + bindings; you write this. finalize_app.sh
    │                           #   snapshots it → app.yaml.template on first run, then re-renders
    │                           #   app.yaml from that snapshot + the harvested env each deploy.
    ├── app.yaml.template       # auto-created by finalize_app.sh (don't hand-write / commit)
    ├── package.json            # `build` is a no-op echo; real build is `build:source` (dev only)
    ├── .npmrc                  # ignore-scripts=true, omit=dev, loglevel=verbose
    ├── .env / .env.template    # local dev + preview: ALL the demo's runtime vars (single source)
    ├── config/
    │   ├── app.json            # JSONC with ${VAR} placeholders → substituted from process.env at boot
    │   └── queries/*.sql        # analytics queries — SCHEMA-RELATIVE (run via charts route)
    ├── scripts/
    │   ├── build-app.sh                     # artifacts.default.build (install + build + lockfile rewrite)
    │   ├── lakebase_setup_db.sh             # Lakebase project/branch/endpoint/db — step 1 (pre-deploy)
    │   ├── lakebase_grant_app_credential.sh # CREATE-on-db + grant app/appkit/drizzle schemas — step 4
    │   └── finalize_app.sh                  # harvest export JSON → app.yaml env → apps deploy — step 5
    ├── server/                 # backend (server.ts substitutes ${VAR}; routes/charts.ts runs analytics)
    ├── client/                 # frontend source (built to client/dist/)
    ├── dist/  client/dist/     # gitignored — built locally, shipped via sync.include
    └── (NOT node_modules — excluded from sync; container runs its own npm install)
```

---

## Generate `dab_instructions.md`

Short, command-driven. Restate the 5-command flow from the top of this doc with the demo's real `--var` values + script args filled in; don't restate `databricks.yml`'s contents.

**Template when the demo ships an App + Lakebase (the full case):**

````markdown
# Deploy — <Demo Name>

```bash
# 1. Lakebase DB (pre-deploy)
./app/scripts/lakebase_setup_db.sh --db-name dbgen_<demo>
# 2. Resource shells + setup job
databricks bundle deploy --var catalog=<cat> --var schema=<schema> --var warehouse_id=<id>
# 3. Run the setup job (data → pipeline → MV/ML → genie/ka/mas → export IDs)
databricks bundle run <demo>_setup --var catalog=<cat> --var schema=<schema> --var warehouse_id=<id>
# 4. Grant the app SP on the Lakebase schemas
./app/scripts/lakebase_grant_app_credential.sh --app-name <app> --project-id <proj> --db-name dbgen_<demo>
# 5. Harvest IDs → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

After a content change to the app, just re-run steps 2 + 5. After a data/resource
change, re-run 2 + 3 + 5. Re-runs are idempotent and fast (agent tasks skip the
provisioning wait on update).

## Teardown
`databricks bundle destroy --auto-approve`
(Does not drop the Lakebase project/DB, UC tables/volumes, or the Genie/KA/MAS.)
````

**When the demo has no App (workflow-only):** drop the `apps:` block + steps 1/4/5; deploy is just `bundle deploy` then `bundle run <demo>_setup`.

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
| App boots then crashes: `ERR_MODULE_NOT_FOUND: Cannot find package '@databricks/appkit'` | `package.json`/`package-lock.json` weren't synced (a repo-root `.gitignore` rule caught them). Un-ignore them; the container needs a deps file to `npm install`. |
| `/serving-endpoints/responses` → `403 Invalid scope, required scopes: model-serving` | OBO token missing the serving scope. Add `serving.serving-endpoints` to `user_api_scopes` AND re-auth (the token is minted at login — a stale session predates the scope change). |
| `/serving-endpoints/responses` → `403 Invalid Token` (scope was fine) | The Responses API routes through AI Gateway — add the `ai-gateway` scope to `user_api_scopes`, re-auth. |
| Every DB query → `password authentication failed for user '<sp-uuid>'` | The app's `postgres` binding got dropped (usually by an out-of-band `apps update --json` that replaced the spec) → SP Postgres role deprovisioned. Re-`bundle deploy` to restore the binding (auto-reprovisions the role), then re-run the lakebase grant script. |
| App boot: `permission denied for schema appkit` / `drizzle` / `app` | A schema exists owned by another role. Re-run `lakebase_grant_app_credential.sh` (it drops+recreates all three + grants the SP). |
| Config crashes app at boot in local/preview (`data.catalog: expected string to have >=1`) | A required-non-empty zod field on a value that's empty when env is unset. Make catalog/schema (and other env-driven fields) accept empty + degrade — they're only set in deployed mode + a fully-configured `.env`. |
| Analytics chart: `TABLE_OR_VIEW_NOT_FOUND` / `INSUFFICIENT_PERMISSIONS: USE CATALOG` | Query hardcodes/omits catalog/schema, or the SP lacks UC grants. Write queries schema-relative + run via the charts route (passes catalog/schema as session context); ensure `grant_app_uc` ran. |
| `bundle run <app>` recreates the app deployment with EMPTY env every time | Expected — a bare app deploy ships no plain-value env. Always finish with `finalize_app.sh` (it writes app.yaml env then deploys). Don't deploy the app via the bundle alone. |

For component-specific pitfalls (Genie API requirements, KA document formats), see the reference scripts in [`scripts/`](scripts/).
