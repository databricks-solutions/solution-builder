# Deploying the AML / SAR Copilot bundle

Prereqs: Databricks CLI ≥ 0.283, Node 20+ (the bundle builds the app with `app/scripts/build-app.sh`), a serverless SQL
warehouse, Foundation Model API access (`databricks-claude-sonnet-4-5` or any chat model with tool calling), an existing
catalog you can create a schema in.

## Deploy to your own workspace — portable `default` target

`default` is the bundle's default target and pins **no host**: it deploys to whatever workspace `-p <profile>` points at
(forks, Solution Builder "Download DAB"). Bundle files, dashboard, Genie space and experiments go under
`/Workspace/Users/<you>/fsi-aml-sar-copilot` (`--var workspace_folder=…` to change).

- **Required:** `--var warehouse_id=<sql-warehouse-id>` (no default — validate/deploy fail without it).
- Usually overridden: `catalog` / `schema` (default `financial_services.aml_sar_copilot`; the catalog must exist and you need CREATE SCHEMA on it),
  `app_name` (must be unique in the workspace).
- No Lakebase (write-backs are Delta tables).

```bash
# Variables resolve per command, so set them once for the shell (or pass the same --var's to all three commands):
export BUNDLE_VAR_warehouse_id=<sql-warehouse-id>                 # required
export BUNDLE_VAR_catalog=<catalog> BUNDLE_VAR_schema=<schema>    # optional
databricks bundle deploy -p <profile>
databricks bundle run aml_sar_setup -p <profile>
databricks bundle run aml_app -p <profile>
```
One-line equivalent: `databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema>]`
(same `--var`'s on each `bundle run`).


Notes
* The DAB syncs `app/package.json` + lockfile explicitly (`sync.include`) because a repo-level `.gitignore` may ignore
  them. Without them the Apps container has no dependencies and crashes with `ERR_MODULE_NOT_FOUND`.
* Re-running `generate_data` rebuilds the source data (deterministic). The write-back tables are never truncated by the
  job — use the reset endpoint.
* The model trains on alerts raised before 2026-08-01 (labels mature slowly). The ring's in-flight August closures are not
  treated as ground truth, which mirrors real label-maturity practice.
