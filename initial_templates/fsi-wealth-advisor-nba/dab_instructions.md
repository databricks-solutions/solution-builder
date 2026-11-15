# Deploying the Advisor Morning Book demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database` / `lakebase_database_id` / `lakebase_owner_role`,
`draft_model`, `advisor_id`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/fsi-wealth-advisor-nba` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `financial_services.wealth_advisor_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run wealth_advisor_setup -p <profile>
databricks bundle run wealth_advisor_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Nothing is created by hand. The bundle creates the Lakebase database, the AI/BI dashboard, the app (+ its agent-traces MLflow
experiment) and the setup job. The job creates the schema, the data, the AI Functions output, the UC model + scores + suitability, the
policy volume, the Genie agent (tables + documents volume); it grants the app's service principal (UC, Genie CAN_RUN) and
writes the resolved IDs to `<catalog>.<schema>.demo_resources`, which the app reads at boot.

Prereqs: Databricks CLI >= 1.10, node 20+, a serverless SQL warehouse, CREATE SCHEMA on the catalog, an existing Lakebase (autoscaling) project/branch with a Postgres role to own the database (lakebase_owner_role).

Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, ADVISOR_ID=ADV-007, warehouse, Lakebase PG* values, DASHBOARD_ID;
GENIE_SPACE_ID is optional — read from `demo_resources`), then
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8821 ./app/start.sh`. Point local runs at a separate database: the deployed
app's service principal owns the `app` / `drizzle` schemas in the bundle's database. The header's **Reset the demo**
(`POST /api/admin/reset`) re-syncs the book and empties `advisor_decisions`.

Notes
- The Genie agent (`Calder Pine - Wealth Desk`) is looked up by name + catalog.schema, so re-running the job updates it in place
  (and re-attaches the `policy_docs` volume if it was never indexed).
- Data is anchored on a fixed as-of date (2026-09-28), so re-running the job reproduces the same numbers. Each run registers a new
  model version and moves `@champion`.
- Redeploying against an existing Lakebase database is safe: `app/drizzle/` is regenerated on build with a pinned baseline
  (`scripts/db-generate.js`, `0000_init`), so the migration identity never changes for an unchanged schema.
- Meeting prep uses `databricks-claude-sonnet-4-5` (`draft_model`); the chat agent needs a Responses-API model (`databricks-gpt-5-4`).
- To demo another advisor's book set `--var advisor_id=ADV-101`.
