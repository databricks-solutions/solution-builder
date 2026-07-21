# Deploy — AI/BI Marketing Campaign

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_marketing_campaign \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion, then deploy the Genie space
databricks bundle run marketing_campaign_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_marketing_campaign \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie task (wired via
`environment_key: sdk_latest`).

After the run:
- **Data** — `dbdemos_templates.aibi_marketing_campaign` (6 base tables +
  `campaign_performance_enriched` + the `metrics_campaign` metric view).
- **Dashboard** — "[AI/BI] AIBI - Marketing Campaign effectiveness".
- **Genie space** — "AI/BI - Marketing Campaign effectiveness".

Re-runs are idempotent (data overwrites; Genie updates in place).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
