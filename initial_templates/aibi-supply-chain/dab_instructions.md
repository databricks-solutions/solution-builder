# Deploy — AI/BI Supply Chain Optimization

No app, no Lakebase. Deploying takes two commands.

```bash
databricks bundle deploy -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<serverless-warehouse-id>
databricks bundle run supply_chain_setup -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<serverless-warehouse-id>
```

The catalog must already exist (`CREATE CATALOG IF NOT EXISTS <catalog>`); the bundle creates the schema. The dashboard
and Genie space go to `--var workspace_folder=...` (default `/Workspace/Users/<you>/aibi-supply-chain`).

Requires Databricks CLI **v0.283.0+**, because the dashboard's `dataset_catalog` / `dataset_schema` rebind needs it. The
Genie task uses `databricks-sdk>=0.114.0`, wired in through `environment_key: sdk_latest`.

**Upgrades** run the same two commands. They are idempotent:
- The schema, dashboard and job are owned by the bundle and keep the same IDs.
- The Genie space is updated in place. It is reused only when its title matches and its tables point at this
  catalog.schema, so a fork with the same title is never overwritten.
- The data is overwritten, and it is deterministic, so the story numbers don't change between runs.

The setup job takes about 3 minutes.

## What the setup job builds
- **Data**: 9 base tables, plus `demand_enriched`, `component_status` and the `metrics_demand` metric view.
- **Dashboard**: "Supply Chain Optimization - E-Bike Battery Cell Crunch". It is published with embedded
  credentials. Its datasets are schema-less and get rebound by the bundle. The metric-view dataset is a SQL query over
  `metrics_demand`, because an `asset_name` dataset must be catalog-qualified and can't be rebound.
- **Genie space**: "Supply Chain Optimization - E-Bike Battery Cell Crunch".

The dashboard's AI forecast (`AI_FORECAST`) and depletion projection run on the SQL warehouse. The dataset build runs
on serverless.

## Teardown
```bash
databricks bundle destroy -t dev -p <profile> --auto-approve
```
This drops the schema, the dashboard and the job. It does not delete the Genie space.
