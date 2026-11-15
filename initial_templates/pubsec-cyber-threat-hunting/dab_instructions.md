# Deploying the Threat Hunting Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: the catalog and schema for the data, the app database (in an existing Lakebase project), and the workspace folder. Everything else (bundle files, dashboard, Genie space, MLflow experiments) lives under that folder.

```bash
# 0. Prerequisites (one-time, per workspace): Databricks CLI >= 0.283, node 20+, a serverless SQL warehouse, the catalog,
#    a Lakebase project with a GROUP role as owner of the app database, Foundation Model endpoints databricks-gpt-5-4 and
#    databricks-claude-sonnet-4-5.
ARGS="--var catalog=<catalog> --var schema=<schema> --var warehouse_id=<id> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>"

# 1. Deploy: builds the app, uploads the bundle, creates the Lakebase database, dashboard, agent-trace experiment, app and setup job
databricks bundle deploy -p <profile> $ARGS

# 2. Setup job (~25 min first run: telemetry → UEBA models (UC @champion) + lead queue → Genie agent (tables + IR playbook) → grants → demo_resources)
databricks bundle run threat_hunting_setup -p <profile> $ARGS

# 3. Deploy + start the app (reads the Genie agent id from <catalog>.<schema>.demo_resources at boot)
databricks bundle run threat_hunting_app -p <profile> $ARGS
```

The bundle lives in `/Workspace/Users/<you>/pubsec-cyber-threat-hunting` by default (`--var workspace_folder=…` to change).
The Lakebase project and owner role must already exist. The default target has no pinned host, so the profile picks the workspace.
 (no pinned host; bundle under
`/Workspace/Users/<you>/pubsec-cyber-threat-hunting`) — 
Upgrade = run the same three commands again. They are idempotent: the Genie agent is looked up by name + catalog.schema, the
dashboard / app / experiment / Lakebase database are bundle resources, and the Drizzle baseline migration id is pinned
(`app/scripts/db-generate.js`) so migrations are a no-op. After a setup-job re-run, click **Reset demo** in the app
header (or `POST /api/admin/reset`) so the Lakebase lead-queue mirror is re-synced from the fresh Delta data.

Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, Lakebase values, DASHBOARD_ID;
GENIE_SPACE_ID is optional — read from demo_resources otherwise), then
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8827 ./app/start.sh`.

Notes
- The data is generated relative to the day you run the job (the attack is always "D-24 … D-1"), so the demo stays
  fresh; absolute counts vary slightly from run day to run day.
- The Genie agent `Cascadia SOC - Threat Hunting` is created by name + catalog.schema (idempotent); `deploy_genie`
  attaches the target catalog's `ir_playbook` volume and waits for its documents index.
- `grant_app_uc` grants the app SP SELECT on the schema, READ on the playbook volume and
  CAN_RUN on the Genie agent — the app retries every model/Genie call as its SP when the viewer's token is rejected.
- The investigation agent uses `databricks-claude-sonnet-4-5` (chat completions + tools, var `investigation_model`);
  the chat dock needs a Responses-API model (`databricks-gpt-5-4`).
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target.
