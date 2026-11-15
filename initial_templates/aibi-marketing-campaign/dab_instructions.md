# Deploy — AI/BI Marketing Campaign

No app and no Lakebase, so a deploy is two commands. Both targets are portable (no pinned host): the profile picks the workspace.

```bash
# 1. Create the schema, the dashboard (published, embedded credentials) and the setup job
databricks bundle deploy -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<warehouse-id>

# 2. Generate the data, build the medallion + metric view, then create/update the Genie space
databricks bundle run marketing_campaign_setup -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<warehouse-id>
```

The dashboard and Genie space go to `/Workspace/Users/<you>/aibi-marketing-campaign`, or wherever
`--var workspace_folder=...` points. Every dashboard dataset is schema-less and gets rebound by `dataset_catalog` /
`dataset_schema`. That includes the metric view, which is queried through a SQL dataset (`MEASURE()` at the filter
grain; the widgets `SUM`, and ratios are `SUM()/SUM()`) instead of an `asset_name` dataset, because Lakeview never
rebinds an `asset_name`. No file edits are needed.

Requirements: Databricks CLI **v0.283.0+** (for `dataset_catalog` / `dataset_schema`) and `databricks-sdk>=0.114.0`
for the Genie task (wired via `environment_key: sdk_latest`).

**Upgrades** run the same two commands. They are idempotent: the data is overwritten with identical values (the
generator is seeded), the dashboard and job are bundle-owned, and the Genie space is looked up by title **and**
parent folder and then updated in place.

After the run:
- **Data**: `<catalog>.<schema>`, with 6 base tables + `campaign_performance_enriched` + the `metrics_campaign`
  metric view.
- **Dashboard**: "AI-BI - Marketing Campaign effectiveness". A dashboard with a `parent_path` is a workspace item,
  so its name cannot contain `/`.
- **Genie space**: "AI-BI - Marketing Campaign effectiveness", in the workspace folder.

## Teardown
```bash
databricks bundle destroy -t dev -p <profile> --auto-approve
```
This does not drop the Genie space or the UC tables that the setup job created.
