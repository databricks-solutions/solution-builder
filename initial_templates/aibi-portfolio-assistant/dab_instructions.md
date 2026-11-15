# Deploy — AI/BI Portfolio Assistant

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard + setup job (all bundle-owned)
databricks bundle deploy -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data (REAL prices via yfinance) + build the medallion + metric view, then create/update the Genie space
databricks bundle run portfolio_assistant_setup -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<your-serverless-warehouse-id>
```

Upgrades run the same two commands: they are idempotent (tables are overwritten, the dashboard/job are bundle-owned,
the Genie space is looked up by its exact title — bundle var `genie_space_title` — and updated in place). Setup job ≈ 3 min.
The Genie reuse lookup is scoped to spaces whose tables live in your `<catalog>.<schema>`, so a same-titled space from
another install is never touched.

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` / `dataset_schema` rewrite) and
`databricks-sdk>=0.114.0` for the Genie task (wired via `environment_key: sdk_latest`). The data task pulls real daily
prices from Yahoo Finance (`yfinance`, wired into `sdk_default`) for a fixed window (2024-06-01 → 2026-06-10) — the
workspace's serverless compute must have outbound internet access for that fetch.

After the run:
- **Data** — `<catalog>.<schema>` (9 base tables + 9 gold tables + the `holdings_asof` view + the `portfolio_metrics`
  metric view).
- **Dashboard** — "AI-BI Portfolio Assistant - AI Growth Fund" (published, embedded credentials).
- **Genie space** — "Portfolio Assistant - AI Growth Fund Concentration Risk".

## Teardown
```bash
databricks bundle destroy -t dev -p <profile> --auto-approve
```
(Drops the bundle-owned schema, dashboard and job; does not delete the Genie space created by the setup job.)
