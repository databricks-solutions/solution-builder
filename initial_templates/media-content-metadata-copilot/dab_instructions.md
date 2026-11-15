# Deploying the Content Metadata Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: the catalog and schema for the data, the workspace folder for everything else, the app database (in an existing Lakebase project), and a Vector Search endpoint dedicated to this demo (`content-metadata-copilot-vs` by default, created by the setup job if missing).

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/media-content-metadata-copilot` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `media_advertising.content_metadata_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run metadata_setup -p <profile>
databricks bundle run metadata_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Also: `vector_search_endpoint` (default `content-metadata-copilot-vs`, created by the setup job if missing — or name an
existing one). Prereqs as in step 0 above (Foundation Model endpoints included).

Upgrade = run the same three commands again. They are idempotent: the Genie agent is looked up by name + catalog.schema, the
VS endpoint/indexes are reused (indexes re-synced), the dashboard / app / experiment / Lakebase database are bundle
resources, and the Drizzle baseline migration id is pinned (`app/scripts/db-generate.js`) so migrations are a no-op.

Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, Lakebase values, DASHBOARD_ID;
GENIE_SPACE_ID is optional — read from demo_resources otherwise), then
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8825 ./app/start.sh`. The app mirrors the library into
Lakebase on first boot; the header's **Reset demo** re-syncs it.

Notes
- The Genie agent `Orbitline+ - Content Discovery & Metadata` is created by name + catalog.schema (idempotent); `deploy_genie`
  attaches the target catalog's `standards_guide` volume and waits for its documents index.
- `grant_app_uc` gives the app SP SELECT on the schema (tables + vector indexes), READ VOLUME, CAN_RUN on the
  Genie agent and CAN_USE on the Vector Search endpoint — the app retries as its SP when a
  viewer's token lacks a scope (Vector Search has no user scope, so those calls always go through the SP).
- Re-running the setup job re-runs `ai_query`, so a few AI tags can differ run to run; use **Reset demo** afterwards so
  the app's Lakebase mirror matches Delta.
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target.
