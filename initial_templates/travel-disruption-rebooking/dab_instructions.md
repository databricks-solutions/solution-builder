# Deploying the IROPS Copilot demo (DAB)

Everything is created by the bundle + its setup job from an EMPTY schema — no IDs are copied by hand. The bundle owns the
AI/BI dashboard, the agent-traces MLflow experiment, the Databricks App (+ its Lakebase database, in the default target) and the setup job; the setup job builds the data, the UC model, the Genie agent (tables + documents volume), grants
the app's service principal, and writes every resolved ID to `<catalog>.<schema>.demo_resources`, which the app reads at boot.

## Deploy to your workspace (default target, no pinned host)
Needs an existing Lakebase (autoscaling) project and a Postgres role on its branch to own the new database:
```bash
databricks bundle deploy -p <profile> --var catalog=<cat> --var schema=<schema> --var warehouse_id=<id> \
   --var lakebase_project_slug=<project> --var lakebase_owner_role=<role id> [--var app_name=<unique name>]
databricks bundle run irops_setup -p <profile> [same --var …]
databricks bundle run irops_app -p <profile> [same --var …]
```
Bundle files land in `/Workspace/Users/<you>/travel-disruption-rebooking`. Prerequisites: Databricks CLI >= 0.283, node 20+,
a serverless SQL warehouse, CREATE SCHEMA on the catalog, Foundation Model endpoints `databricks-gpt-5-4` (Responses API, chat
agent) and `databricks-claude-sonnet-4-5` (notifications).

## Notes
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target; `embed_credentials: true`.
- The Genie space JSON is rewritten to the target catalog.schema and attaches the target's `policy_docs` volume (documents are answered in Agent mode).
- The app SP needs `MODIFY` on `rebooking_plans` / `rebooking_decisions` (the `grant_app` task does it, plus READ VOLUME
  and Genie `CAN_RUN`) — without it the commit still lands in Lakebase and the UI reports the Delta write-back error.
- Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, Lakebase values, GENIE_SPACE_ID,
  DASHBOARD_ID), then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8828 ./app/start.sh`.
