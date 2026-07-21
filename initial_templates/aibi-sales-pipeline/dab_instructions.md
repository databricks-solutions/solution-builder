# Deploy — AI/BI Sales Pipeline Review

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_sales_pipeline \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion, then deploy the Genie space
databricks bundle run sales_pipeline_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_sales_pipeline \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie task (wired via
`environment_key: sdk_latest`).

After the run:
- **Data** — `dbdemos_templates.aibi_sales_pipeline` (7 base tables +
  `orders_enriched` + the `metrics_sales` metric view).
- **Dashboard** — "[AI/BI] AIBI - Sales Pipeline Review".
- **Genie space** — "AI/BI - Sales Pipeline Review".

Re-runs are idempotent (data overwrites; Genie updates in place).

> **Note on the AI forecast.** The dashboard's `ds_target` / `ds_forecast` datasets
> use `AI_FORECAST`, which runs on a **SQL warehouse** (validate there) but is
> disabled on databricks-connect serverless — so the medallion build in
> `generate_data.py` deliberately does not call it.

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
