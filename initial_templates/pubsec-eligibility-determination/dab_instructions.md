# Deploying the Eligibility Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database_id` / `lakebase_database` / `lakebase_owner_role`,
`notice_model`.

Targets:
- `default` (portable, default target) — NO pinned host: deploys wherever your profile points (forks, Solution Builder
  "Download DAB"). Pass `--var warehouse_id=<id>`; bundle folder `/Workspace/Users/<you>/pubsec-eligibility-determination`,
  Lakebase: pass `--var lakebase_project_slug=… --var lakebase_owner_role=…`.

Generic (any workspace):

Nothing is created by hand. The bundle creates the Lakebase database, the AI/BI dashboard, the agent-traces experiment, the app and
the setup job. The job creates the schema, the data, the ai_extract output over ~2.4k documents, gold + the metric view, the policy
manual volume, the Genie agent (tables + documents volume). It also grants the app's service principal (UC, Genie
CAN_RUN) and writes the resolved IDs to `<catalog>.<schema>.demo_resources`, which the app reads at boot.

```bash
# 0. prerequisites: Databricks CLI >= 1.10, node 20+, a serverless SQL warehouse, CREATE SCHEMA on the catalog,
#    an existing Lakebase (autoscaling) project/branch where a Postgres role exists for lakebase_owner_role.

# 1. Deploy: builds the app (app/scripts/build-app.sh), uploads the bundle, creates the Lakebase DB, dashboard, experiment, app, job
databricks bundle deploy -p <profile> [--var catalog=<cat> --var schema=<schema> --var warehouse_id=<id> \
    --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]

# 2. Run the setup job (~20-30 min: data → ai_extract → gold + metric view → policy documents (Genie agent) → Genie → grants → demo_resources)
databricks bundle run eligibility_setup -p <profile>

# 3. Deploy the app source and start it
databricks bundle run eligibility_app -p <profile>
```

Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, warehouse, Lakebase PG* values). GENIE_SPACE_ID is
optional (read from `demo_resources`). Then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8815
./app/start.sh`. Point local runs at a separate database: the deployed app's service principal owns the `app` schema.
The app mirrors the open caseload into Lakebase on first boot; the header's **Reset demo** button (`POST /api/admin/reset`)
re-syncs it.

Notes
- Redeploying against an existing Lakebase database is safe: `app/scripts/db-generate.js` generates `app/drizzle/` with a pinned
  baseline (`0000_init`, fixed `when`), so an unchanged schema never re-runs CREATE TABLE.
- The Genie agent `Westbrook DHS - Eligibility Operations` is created by name + catalog.schema (idempotent); `deploy_genie`
  attaches the target catalog's `policy_manual` volume and waits for its documents index.
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target; `embed_credentials: true`.
- The notice writer defaults to `databricks-claude-sonnet-4-5` (`notice_model`); the chat agent needs a Responses-API model
  (`databricks-gpt-5-4`, `config/app.json`).
- All synthetic dates are relative to the day `generate_data.py` runs (days open, deadlines, "last 3 complete months"): re-run
  the setup job to refresh, then **Reset demo** — the Lakebase caseload mirror is only re-synced from Delta by the reset.
- The app reads the Genie agent id from `demo_resources` at boot — restart the app (`bundle run eligibility_app`) if it changes.
