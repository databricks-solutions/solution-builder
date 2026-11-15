# Deploying the NOC Copilot demo (DAB)

Prereqs: Databricks CLI >= 0.283, Node 20+ (`bundle deploy` builds the app via `app/scripts/build-app.sh`), a serverless
SQL warehouse, a catalog you can create schemas in, Lakebase + Apps enabled, and the `databricks-claude-sonnet-4-5`
(triage agent, chat completions + tools) and `databricks-gpt-5-4` (chat dock, Responses API) serving endpoints.

## Deploy (default target, no pinned host)

```bash
ARGS="--var catalog=<catalog> --var schema=<schema> --var warehouse_id=<id> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>"

databricks bundle deploy -p <profile> $ARGS          # builds the app; schema, SDP pipeline, Lakebase database, experiment, dashboard, app, setup job
databricks bundle run noc_copilot_setup -p <profile> $ARGS   # ~20 min the first time (documents indexing)
databricks bundle run noc_app -p <profile> $ARGS              # deploys the source and starts the app
```

The setup job runs: generate_data (reference tables + raw telemetry in the `raw_telemetry` volume) → run_pipeline
(Lakeflow SDP bronze → silver → gold, full refresh) → train_anomaly (Isolation Forest, UC @champion →
cell_health_daily) → build_incident_queue (topology correlation → noc_incidents; ai_classify on ticket notes) →
upload_runbooks → deploy_genie (tables + the `noc_runbooks` volume, waits for the index) → grant_app_uc (UC + Genie
CAN_RUN for the app SP) → export_resources (`<catalog>.<schema>.demo_resources` + exit JSON). The app reads the Genie
agent id from `demo_resources` at boot.

Upgrade = run the same three commands again, then click **Reset the demo** in the app header (or
`POST /api/admin/reset`): the app only mirrors the incident queue into Lakebase when its table is empty, so after a job
re-run the reset re-syncs it with the fresh data. The commands are idempotent: the Genie agent (by title + catalog.schema)
is looked up and updated; the pipeline, dashboard, app, experiment and Lakebase database are bundle-owned; the Drizzle
baseline migration is pinned (`app/scripts/db-generate.js`) so the app's migrations are a no-op on an existing database.
Each job run registers a new UC model version and moves `@champion`.

Prereqs for a new workspace: `CREATE CATALOG` (or an existing catalog you can create schemas in), and an existing Lakebase
project with a group role that will own the app database (`lakebase_owner_role`). No Lakebase grant script is needed: the
app's postgres resource (`CAN_CONNECT_AND_CREATE`) is enough.

## Notes
- The data is generated relative to the day the job runs (the storm is always at 05:55 on the run day, NOW = 08:40) —
  re-run the job before an important demo, then reset the app.
- The pipeline is re-run with `full_refresh: true` by the job (the raw volume files are regenerated each run).
- The app reads `GENIE_SPACE_ID` from its env when set, else from `demo_resources`
  (`app/server/services/resources.ts`). There is no `app/app.yaml`: the app config (command + env) lives in
  `databricks.yml` (`resources.apps.noc_app.config`).
- The app retries every model / Genie call as its SP when the viewer's token is rejected (hence the grants).
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target. The Genie JSON is
  committed with `telecommunications.network_ops_copilot`; `deploy_genie` rewrites that qualifier and attaches `noc_runbooks`.
- Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, Lakebase values, optionally
  GENIE_SPACE_ID), then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8804 ./app/start.sh`.
