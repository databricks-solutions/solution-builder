# Deploying the Warranty Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database_id` / `lakebase_database` / `lakebase_owner_role`, `notice_model`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

Nothing is created by hand. `bundle deploy` builds the app (`app/scripts/build-app.sh`) and creates the Lakebase database,
the AI/BI dashboard, the agent-traces MLflow experiment, the app and the setup job. The job (~30 min on first run; ai_classify over the
notes is the long pole) creates the schema + `supplier_quality_docs` volume, the data, the AI Functions output
(`ai_classify` + `ai_extract` over ~4k technician notes), the gold tables + metric view, the Genie agent (tables + documents volume).
It grants the app's service principal (UC read, READ VOLUME, CAN_RUN on the Genie agent) and writes the resolved
IDs to `<catalog>.<schema>.demo_resources`, which the app reads at boot. `bundle run warranty_app` deploys the source and starts the
app; on first boot it mirrors signals + claims into Lakebase.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/mfg-warranty-cost-optimization` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `manufacturing.warranty_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run warranty_setup -p <profile>
databricks bundle run warranty_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Local run: copy `app/.env.template` to `app/.env` and fill in DEMO_CATALOG/SCHEMA, the warehouse and the Lakebase PG* values.
GENIE_SPACE_ID is optional (read from `demo_resources`). Then run
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8823 ./app/start.sh`. Point local runs at a separate database: the
deployed app's service principal owns the `app` schema in the bundle's database.

Notes
- The Genie agent `Brightwater - Warranty & Supplier Quality` is looked up by name + catalog.schema, so re-runs update it in
  place (and wait for the `supplier_quality_docs` index).
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target. Credentials are embedded.
- Numbers are relative to the day the job runs (90-day windows, remaining warranty). Re-run the setup job to refresh them, then
  click **Reset the demo** (or `POST /api/admin/reset`) to re-sync signals + claims from Delta and clear analyses, quality cases
  and chat.
- The notice writer defaults to `databricks-claude-sonnet-4-5` (`notice_model`). The chat agent needs a Responses-API
  model (`databricks-gpt-5-4`).
