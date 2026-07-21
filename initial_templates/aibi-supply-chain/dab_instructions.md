# Deploy — AI/BI Supply Chain Optimization

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_supply_chain \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion, then deploy the Genie space
databricks bundle run supply_chain_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_supply_chain \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie task (wired via
`environment_key: sdk_latest`).

After the run:
- **Data** — `dbdemos_templates.aibi_supply_chain` (9 base tables +
  `demand_enriched` + `component_status` + the `metrics_demand` metric view).
- **Dashboard** — "[AI/BI] AIBI - Supply Chain Optimization".
- **Genie space** — "AI/BI - Supply Chain Optimization".

The dashboard's AI forecast (`AI_FORECAST`) and depletion projection run on a SQL
warehouse; the setup dataset build runs on serverless.

Re-runs are idempotent (data overwrites; Genie updates in place).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
