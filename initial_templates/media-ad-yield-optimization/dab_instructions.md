# Deploying the Ad Yield Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_id` / `lakebase_branch_id` / `lakebase_database` / `lakebase_owner_role`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/media-ad-yield-optimization` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `media_advertising.ad_yield_optimization`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: nothing to prepare — the bundle creates its own Lakebase project `lakebase_project_id` (default `ad-yield-copilot`, must be unique in the workspace; override with `--var lakebase_project_id=…`).

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
databricks bundle deploy -p <profile>
databricks bundle run ad_yield_setup -p <profile>
databricks bundle run ad_yield_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema>]`
(same `--var`'s on each `bundle run`).

`bundle deploy` builds the app and creates the Lakebase project, the dashboard, the app (+ its SQL warehouse and Lakebase
bindings) and the setup job. The setup job (~15 min on first run, mostly the documents index):
generate_data → forecast_avails (ai_forecast) → build_gold; upload_ad_sales_docs → deploy_genie (tables + the ad_sales_library
volume, waits for its index) → grant_app_access (UC, Genie CAN_RUN) → export_resources (writes `<catalog>.<schema>.app_config`:
Genie agent id, documents volume, dashboard id). At boot the app runs its Drizzle migrations, reads app_config and mirrors live campaigns +
yield opportunities from Delta into Lakebase.

Prereqs: Databricks CLI >= 0.283 (bundle postgres_projects + app config support), node 20+, a serverless / Pro SQL warehouse (ai_forecast), CREATE SCHEMA on the catalog.

Local run: copy `app/.env.template` to `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, and a Lakebase **dev branch** —
e.g. `databricks postgres create-branch projects/ad-yield-copilot dev …` — so local migrations never touch the app's
`production` database). Then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8805 ./app/start.sh`.
The header's **Reset the demo** re-syncs campaigns + opportunities and clears plans, floor changes and chat.

Notes
- The Genie agent `Aurora Crest - Ad Yield & Pricing` is created by name + catalog.schema, so re-runs are idempotent.
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target.
- `app/drizzle/` is generated at build (gitignored) with a pinned `0000_init` baseline (`scripts/db-generate.js`), so
  redeploys against the existing Lakebase database are no-ops. If you change `server/db/schema.ts` after the first
  deploy, keep the generated `drizzle/` folder so the change lands as an incremental migration.
- Numbers are computed against the run date (flight days elapsed, last 28 days), so they drift slightly day to day.
  The avails forecast is `ai_forecast` clamped to ±10% of the trailing 4-week same-weekday average (`BAND` in
  `src/forecast/forecast_avails.py`): raw `ai_forecast` can swing 2.6x between runs (it once cut the Summit plan to 78% coverage).
  `ai_forecast_raw` and `baseline_avails` are kept in `gold_avails_forecast`.
- The agent traces go to a bundle-owned experiment `<workspace_folder>/<app_name>-agent-traces` (the app SP gets CAN_EDIT through
  the app resource; it could not create an experiment in the demo folder itself).
- Models: the agent needs a Responses-API model (`databricks-gpt-5-4`); the plan write-up uses `databricks-claude-sonnet-4-5`.
