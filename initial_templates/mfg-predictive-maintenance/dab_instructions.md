# Deploy this demo (DAB)

Prereqs: Databricks CLI ≥ 0.283 (tested 1.10), Node 22 (`bundle deploy` builds the app via `app/scripts/build-app.sh`),
a SQL warehouse, a catalog you can create schemas in, Lakebase + Apps enabled, and the `databricks-gpt-5-4`
(Responses-API) serving endpoint.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/mfg-predictive-maintenance` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `manufacturing.predictive_maintenance_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run pdm_setup -p <profile>
databricks bundle run pdm_copilot_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

The bundle owns the Lakebase database, the agent-traces experiment and the app resources
(`targets.default.resources`); the setup job creates the schema + manuals volume.

## Notes
- The dashboard JSON datasets are **schema-less**; `dataset_catalog` / `dataset_schema` in `databricks.yml` rebind them.
- The Genie JSON is committed with `manufacturing.predictive_maintenance_copilot`; `deploy_genie` rewrites that
  qualifier to your catalog/schema and attaches that schema's `manuals` volume.
- Data is generated **relative to "now"** (seed 42): re-run `pdm_setup` before an important demo so the drift is "the
  last 16 days" and next Saturday's window is in the future. Then click **Reset the demo** in the app
  (`POST /api/admin/reset`, re-syncs Lakebase from Delta).
- The app reads `GENIE_SPACE_ID` from its env when set, else from `demo_resources`
  (`app/server/services/resources.ts`). Restart the app (`bundle run pdm_copilot_app`) if it ever changes.
- Local dev: copy `app/.env.template` → `app/.env`, fill it, `DATABRICKS_CONFIG_PROFILE=<p> DATABRICKS_APP_PORT=8813 ./start.sh`.
