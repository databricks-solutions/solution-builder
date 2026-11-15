# Deploying the Trial Site Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database_id` / `lakebase_database` / `lakebase_owner_role`, `memo_model`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/hls-clinical-trial-site-selection` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `healthcare_lifesciences.trial_site_selection`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run trial_site_setup -p <profile>
databricks bundle run trial_site_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Nothing is created by hand. The bundle creates the Lakebase database, the AI/BI dashboard, the agent-traces experiment, the app and
the setup job. The job creates the schema, the data, the AI Functions output, the gold tables, the UC model and the
Genie agent (tables + the protocol_docs volume, waits for its index). It also grants the app's service principal (UC, CAN_RUN on the Genie agent) and
writes the resolved IDs to `<catalog>.<schema>.demo_resources`, which the app reads at boot.

Prereqs: Databricks CLI >= 1.10, node 20+, a serverless SQL warehouse, CREATE SCHEMA on the catalog, an existing Lakebase (autoscaling) project/branch where a Postgres role (lakebase_owner_role) can own the database.

Local run: create `app/.env` from `app/.env.template` (DEMO_CATALOG / DEMO_SCHEMA, the warehouse, the Lakebase PG* values). GENIE_SPACE_ID
is optional because the app reads it from `demo_resources`. Then run
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8822 ./app/start.sh`. Point local runs at a separate database: the deployed
app's service principal owns the `app` schema in the bundle's database. The header's **Reset demo** button (`POST /api/admin/reset`)
wipes rescue plans and conversations and re-syncs the site network from Delta.

Notes
- The Genie agent (`Halcyra ClinOps - Trial Enrollment & Site Selection`) is created by name + catalog.schema, so re-running the job
  updates it in place (and re-attaches the `protocol_docs` volume if it was never indexed).
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target. Credentials are embedded.
- Models: chat agent `databricks-gpt-5-4` (Responses API), memo writer `databricks-claude-sonnet-4-5` (`memo_model`), AI Functions
  `databricks-gpt-oss-20b` for the SGLT2i-duration extraction.
- Each setup run registers a new version of `site_enrollment_model` and moves `@champion` to it.
- Redeploying against an existing Lakebase database is safe: `app/drizzle/` is regenerated on build with a pinned baseline
  (`0000_init`, `scripts/db-generate.js`), so the migration identity never changes for an unchanged schema.
