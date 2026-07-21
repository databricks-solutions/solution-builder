# Deploy — AI/BI Portfolio Assistant

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_portfolio_assistant \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data (REAL prices via yfinance) + build the medallion, then deploy the Genie space
databricks bundle run portfolio_assistant_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_portfolio_assistant \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie task (wired via
`environment_key: sdk_latest`). The data task pulls real daily prices from Yahoo Finance
(`yfinance`, wired into `sdk_default`) — the workspace's serverless compute must have
outbound internet access for that fetch.

After the run:
- **Data** — `dbdemos_templates.aibi_portfolio_assistant` (9 base tables + 9 gold
  tables/views + the `portfolio_metrics` metric view).
- **Dashboard** — "[AI/BI] AIBI - Portfolio Assistant".
- **Genie space** — "AI/BI - Portfolio Assistant: Concentrated in the AI trade".

Re-runs are idempotent (data overwrites; Genie updates in place).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
