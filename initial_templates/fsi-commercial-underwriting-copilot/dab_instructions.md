# Deploying the Underwriting Copilot demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`, `app_name`,
`lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database_id` / `lakebase_database` / `lakebase_owner_role`, `notice_model`.

Targets:
- `default` (portable, the default target) — no pinned host; see "Deploy to your own workspace" below.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/fsi-commercial-underwriting-copilot` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `financial_services.commercial_underwriting_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- Lakebase: the bundle creates the app database in an **existing** Lakebase (autoscaling) project, `lakebase_project_slug` (branch `lakebase_branch_id`, default `production`), owned by the Postgres role `lakebase_owner_role` (a GROUP role for the workspace `admins` group: `databricks postgres create-role projects/<project>/branches/production --role-id admins --json '{"spec":{"identity_type":"GROUP","postgres_role":"admins","auth_method":"LAKEBASE_OAUTH_V1"}}'`). Pass `--var lakebase_project_slug=… --var lakebase_owner_role=…` if yours differ.

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
export BUNDLE_VAR_lakebase_project_slug=<project> BUNDLE_VAR_lakebase_owner_role=<role-id>
databricks bundle deploy -p <profile>
databricks bundle run uw_copilot_setup -p <profile>
databricks bundle run uw_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]`
(same `--var`'s on each `bundle run`).

Nothing is created by hand. The bundle creates the Lakebase database, the AI/BI dashboard, the agent-traces experiment, the app and
the setup job. The job creates the schema, the data + broker PDFs, the AI Functions output, the UC model, the gold tables and the
Genie agent (tables + the guidelines volume, waits for its index). It also grants the app's service principal and writes the resolved IDs to
`<catalog>.<schema>.demo_resources`, which the app reads at boot.

Prereqs: Databricks CLI >= 1.10, node 20+, a serverless SQL warehouse, CREATE SCHEMA on the catalog, Foundation Model endpoints databricks-gpt-5-4 (Responses API, chat agent), databricks-claude-sonnet-4-5 (review memo), databricks-gpt-5-4-mini (ai_query extraction); ai_parse_document enabled on the workspace; an existing Lakebase (autoscaling) project/branch where a Postgres role can own the database (lakebase_owner_role).

Local run: copy `app/.env.template` → `app/.env` (DEMO_CATALOG/SCHEMA, the warehouse, the Lakebase PG* values). GENIE_SPACE_ID is
optional because the app reads it from `demo_resources`. Then run
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8801 ./app/start.sh`. Point local runs at a separate database: the deployed
app's service principal owns the `app` schema in the bundle's database. The header's **Reset the demo** button (`POST
/api/admin/reset`) re-syncs the queue and deletes the desk's Delta write-back rows (`uw_decisions`).

Notes
- The Genie agent ("Tidewell Commercial Underwriting - Portfolio & Queue") is created by name + catalog.schema (idempotent);
  `deploy_genie` attaches the target catalog's `uw_guidelines` volume and waits for its documents index.
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target; `embed_credentials: true`.
- Lakebase migrations: `app/drizzle/` is generated at build time by `scripts/db-generate.js` with a pinned baseline
  (`0000_init`, fixed `when`), so rebuilding against an existing database does not re-run the CREATE TABLEs.
- The app SP needs `MODIFY` on `uw_decisions` and `READ_VOLUME` on `submission_docs` (the grant_app task does it) — without
  them the decision still lands in Lakebase and the UI reports the Delta write-back error / the PDF link fails.
- `extract_submissions` fails loudly if the hero packet (SUB-26-0417) is mis-read, so a broken demo never ships silently.
- The story date is fixed (Monday 28 September 2026) in the generator, gold SQL and the agent prompt, so numbers do not drift with
  the run day. Each setup-job run registers a new `submission_risk_model` version and moves `@champion`.
