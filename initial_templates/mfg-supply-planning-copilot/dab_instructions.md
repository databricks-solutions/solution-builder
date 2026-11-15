# Deploying the Supply Planning Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id` (Pro or serverless — AI_FORECAST runs
there), `workspace_folder`, `app_name`, `lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database_id` /
`lakebase_database` / `lakebase_owner_role`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/mfg-supply-planning-copilot` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `manufacturing.supply_planning_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run supply_planning_setup -p <profile>
databricks bundle run supply_planning_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Nothing is created by hand. The bundle creates the Lakebase database, the AI/BI dashboard, the agent-traces experiment, the app and
the setup job. The job creates the schema, the data, AI_FORECAST + the planning gold tables, the ai_extract signals and the
Genie agent (tables + the supply_policy volume, waits for its index). It also grants the app's service principal (UC, Genie CAN_RUN) and writes the resolved
IDs to `<catalog>.<schema>.demo_resources`, which the app reads at boot.

Prereqs: Databricks CLI >= 1.10, node 20+, a Pro/serverless SQL warehouse, CREATE SCHEMA on the catalog, an existing Lakebase (autoscaling) project/branch where a Postgres role exists for lakebase_owner_role.

Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, Lakebase PG* values). GENIE_SPACE_ID is
optional (read from `demo_resources`). Then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8824
./app/start.sh`. Point local runs at a separate database: the deployed app's service principal owns the `app` schema.

Notes
- Redeploying against an existing Lakebase database is safe: `app/scripts/db-generate.js` generates `app/drizzle/` with a pinned
  baseline (`0000_init`, fixed `when`), so an unchanged schema never re-runs CREATE TABLE.
- The Genie agent `Corvane - S&OP Supply Planning` is created by name + catalog.schema (idempotent); `deploy_genie`
  attaches the target catalog's `supply_policy` volume and waits for its documents index.
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target; `embed_credentials: true`.
- The chat agent needs a Responses-API model (`databricks-gpt-5-4`, `config/app.json`).
- All synthetic dates are relative to the Monday of the week `generate_data.py` runs: re-run the setup job to refresh, then
  **Reset the demo** (header button / `POST /api/admin/reset`). Re-running the job also overwrites `sop_plan_decisions`.
- The app reads the Genie agent id from `demo_resources` at boot — restart the app (`bundle run supply_planning_app`) if it changes.
