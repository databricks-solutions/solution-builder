# Deploy — AI/BI Customer Support

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_customer_support \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion, then deploy the Genie space
databricks bundle run customer_support_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_customer_support \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie task (wired via
`environment_key: sdk_latest`).

After the run:
- **Data** — `dbdemos_templates.aibi_customer_support` (8 base tables +
  `support_cases_enriched` + the `support_metrics` metric view).
- **Dashboard** — "[AI/BI] AIBI - Customer Support: AI Efficiency".
- **Genie space** — "AI/BI - Customer Support: AI Efficiency".

Re-runs are idempotent (data overwrites; Genie updates in place).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
