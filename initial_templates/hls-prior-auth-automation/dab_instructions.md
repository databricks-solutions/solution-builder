# Deploying MedVault PA Copilot (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database` / `lakebase_owner_role`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/hls-prior-auth-automation` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `healthcare_lifesciences.prior_auth_automation`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run pa_setup -p <profile>
databricks bundle run prior_auth_copilot -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Nothing is created by hand. The bundle creates the Lakebase database, the AI/BI dashboard, the agent-traces
MLflow experiment, the app and the setup job. The setup job (the documents index is the long pole):
1. `generate_data` — schema, synthetic PA history + Monday-08:00 open queue, policy docs → `policy_docs` volume;
2. `ai_criteria_review` — `ai_query` criteria review of every open case (`ai_case_review`, `ai_criteria_evidence`);
3. `semantic_layer` — `pa_ops_metrics` metric view + `um_decisions` write-back table;
4. `deploy_genie` — "MedVault Prior Authorization Operations" Genie agent (looked up by title + catalog.schema) in the workspace
   folder, over the tables + the `policy_docs` volume; waits for the documents index;
5. `grant_app` — the app SP (read at run time): USE CATALOG/SCHEMA + SELECT, MODIFY on `um_decisions`, READ VOLUME,
   Genie CAN_RUN;
6. `export_resources` — writes the resolved IDs to `<catalog>.<schema>.demo_resources`; the app reads the Genie agent id from it at boot
   (`app/server/lib/resources.ts`), so no ID is ever hand-edited.

Prereqs: Databricks CLI ≥ 0.283, Node 20+, a serverless SQL warehouse, CREATE SCHEMA on the catalog, an existing Lakebase
(autoscaling) project/branch with a Postgres role for `lakebase_owner_role`, Foundation Model endpoints `databricks-gpt-5-4` and
`databricks-gpt-5-4-mini`.

Local run: `cd app && cp .env.template .env` (DEMO_CATALOG / DEMO_SCHEMA, warehouse, Lakebase PG* values; GENIE_SPACE_ID is
optional — read from `demo_resources`), `DATABRICKS_CONFIG_PROFILE=<p> DATABRICKS_APP_PORT=8812 ./start.sh`.
Point local runs at a separate database: the deployed app's SP owns the `app` schema in the bundle's database.

## Gotchas
- **Repo-root `.gitignore` ignores `package.json`/`package-lock.json`.** `app/.gitignore` re-includes them and
  `databricks.yml` `sync.include`s them — without both the container crashes with `ERR_MODULE_NOT_FOUND`.
- **Drizzle baseline is pinned** (`app/scripts/db-generate.js`: tag `0000_init`, fixed `when`), so rebuilding `app/drizzle/`
  never renames the migration an existing Lakebase DB already applied (a random tag used to re-run CREATE TABLE → `42P07` → 503).
- The queue snapshot is anchored on the most recent **Monday 08:00 UTC** of the day the job runs; re-run the job to move it, then
  **Reset demo** in the app (`POST /api/admin/reset`) to re-mirror the queue into Lakebase and clear `um_decisions`.
- `ai_query` output is non-deterministic: lane counts move by a few cases on every `build_ai_review.sql` run; the README numbers are
  approximate on purpose.
- **MLflow trace export on Apps**: don't pass a pinned token to `mlflow.init` when the SP's `DATABRICKS_CLIENT_ID/SECRET` are in env
  ("more than one authorization method config") — fixed in `server/server.ts`.
