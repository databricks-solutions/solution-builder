# Deploying Grid Ops Copilot with the bundle

Everything is created by the bundle + setup job, from an empty schema — no id is hand-copied anywhere.

Prereqs: Databricks CLI ≥ 0.283 (dashboard `dataset_catalog`), Node 20+ (the bundle builds the app),
the target catalog (CREATE SCHEMA on it), a serverless SQL warehouse, and a Foundation Model endpoint that
supports the Responses API (`databricks-gpt-5-4`). No Lakebase (the write-back is the Delta table `operator_actions`).

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/energy-grid-operations` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `energy_utilities.grid_operations_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- No Lakebase (write-backs are Delta tables).

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
databricks bundle deploy -p <profile>
databricks bundle run grid_ops_setup -p <profile>
databricks bundle run grid_ops_copilot_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema>]`
(same `--var`'s on each `bundle run`).

Other variables: `agent_model` (`genie_space_id` stays `auto`).

Users of the app need CAN_USE on the warehouse, access to the Genie space (the `ask_data` tool runs on the
viewer's OBO token) and CAN_VIEW on the dashboard (embedded on the Dashboard page).

Local run: `cd app && cp .env.template .env` (DATABRICKS_HOST, DATABRICKS_WAREHOUSE_ID, DEMO_CATALOG,
DEMO_SCHEMA, GENIE_SPACE_ID, DASHBOARD_ID), then `DATABRICKS_CONFIG_PROFILE=<profile> ./start.sh` → http://localhost:8816.

Gotchas: the repo-root `.gitignore` ignores `package.json`/`package-lock.json`, so `databricks.yml` whitelists
them in `sync.include` (without them the container cannot `npm install`). Keep the lockfile on
`registry.npmjs.org` (build-app.sh rewrites corporate-proxy URLs) or the container install fails.
`generate_data.py` also runs locally (`--dry-run` prints the planted signal without Spark).
