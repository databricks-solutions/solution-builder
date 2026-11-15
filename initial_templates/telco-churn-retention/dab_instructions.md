# Deploying the Veridian Churn Retention Desk (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database` / `lakebase_database_id` / `lakebase_owner_role`.

Targets:
- `dev` (default, `mode: development`) / `prod` — **portable**: no pinned host, so a fork / "Download DAB" deploys them to
  whatever workspace the profile points at. Bundle files, dashboard, Genie space and experiments land under
  `/Workspace/Users/<you>/telco-churn-retention`; pass the workspace-specific values (`--var catalog=… --var schema=…
  --var warehouse_id=… --var lakebase_project_slug=… [--var lakebase_owner_role=…]`).

Generic (any workspace):

Nothing is created by hand. `bundle deploy` builds the app locally (`app/scripts/build-app.sh`) and creates the schema, the Lakebase
database, the CMO AI/BI dashboard, the app (+ its agent-traces MLflow experiment) and the setup job. The job generates the data, runs
the AI Functions over the care-call transcripts (on the warehouse), trains + registers the churn model (`churn_risk_model@champion`)
and scores every active account, creates/updates the Genie space, grants the app's service principal (UC SELECT on the schema, MODIFY
on `retention_decisions`, Genie CAN_RUN) and writes the resolved IDs to `<catalog>.<schema>.demo_resources`, which the app reads at
boot.

```bash
# 0. prerequisites: Databricks CLI >= 0.283, node 20+ / npm, a serverless SQL warehouse, CREATE SCHEMA on the catalog,
#    an existing Lakebase (autoscaling) project/branch with a Postgres role to own the database (lakebase_owner_role).
databricks bundle deploy -t dev -p <profile> [--var catalog=<cat> --var schema=<schema> --var warehouse_id=<id> \
    --var workspace_folder=<folder> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]
# data → AI Functions over care calls → XGBoost churn model (@champion) + SHAP drivers → Genie → grants → demo_resources
databricks bundle run churn_retention_setup -t dev -p <profile>
# deploy the app source and start it (the app mirrors the worklist + offers into Lakebase on first boot)
databricks bundle run churn_retention_app -t dev -p <profile>
```

Local run: `cd app && cp .env.template .env` (DATABRICKS_HOST, warehouse, LAKEBASE_ENDPOINT/PGHOST/PGDATABASE, DEMO_CATALOG/DEMO_SCHEMA,
DASHBOARD_ID; GENIE_SPACE_ID is optional — read from `demo_resources`) then `./start.sh` → http://localhost:8814. Point local runs at a
separate database: the deployed app's service principal owns the `app` / `drizzle` schemas in the bundle's database.

Notes
- The Genie space (`Veridian Mobile - Churn and Retention`) is looked up by title AND tables in `<catalog>.<schema>`, so re-running
  the job updates it in place while a fork into another schema gets its own space.
- The setup job takes ~17-32 min (the AI Functions over ~5.9K transcripts dominate; slower when the warehouse is busy).
- Data is anchored on a fixed as-of date (2026-09-30) with a fixed seed, so re-running the job reproduces the same numbers (the AI
  Functions output and the model retrain can move slightly). Each run registers a new model version and moves `@champion`.
- Redeploying against an existing Lakebase database is safe: `app/drizzle/` is regenerated on build with a pinned baseline
  (`scripts/db-generate.js`, `0000_init`), so the migration identity never changes for an unchanged schema.
- **Reset the demo** between runs: `POST /api/admin/reset` (bearer token) wipes the desk state + conversations in Lakebase and
  re-syncs the worklist from Delta. Call it after re-running the job too (the boot sync skips tables that already have rows).
  It does not empty the Delta `retention_decisions` write-back table.
- The chat agent needs a Responses-API model (`databricks-gpt-5-4`).
