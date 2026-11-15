# Deploy — AI/BI Customer Support

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy -t dev \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<serverless-warehouse-id>

# 2. Generate data + build the medallion, then deploy the Genie space
databricks bundle run customer_support_setup -t dev \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<serverless-warehouse-id>
```

`dev` and `prod` have no pinned host, so they deploy wherever your profile points (`-p <profile>`). The catalog must
exist. The dashboard and Genie space go in the bundle root, unless you pass `--var workspace_folder=/Workspace/...`.

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` / `dataset_schema` rewrite) and
`databricks-sdk>=0.114.0` for the Genie task (wired via `environment_key: sdk_latest`).

After the run:
- **Data** — `<catalog>.<schema>` (8 base tables + `support_cases_enriched` + the `support_metrics` metric view).
- **Dashboard** — "AI-BI - Customer Support: AI Efficiency" (published, embedded credentials).
- **Genie space** — "AI-BI - Customer Support: AI Efficiency", created by the `deploy_genie` task and updated in
  place on re-runs. The lookup matches on title AND on the bundle folder + `catalog.schema`, so it never picks up a
  same-titled space from another install.

**Upgrade**: re-run the same two commands. It is idempotent: tables are overwritten, the Genie space keeps its id,
and the dashboard, job and schema are bundle-owned. The generator uses fixed 2023-2025 dates, so every run produces
the same data and the same KPIs.

**Dashboard gotchas (why the JSON looks the way it does):**
- Display names cannot contain `/`, because the dashboard is a workspace item in the folder.
- The metric view is read through a schema-less SQL dataset
  (`SELECT <dims>, MEASURE(...) FROM support_metrics GROUP BY ALL`, grouped down to one row per case
  via `Case ID`), and the widgets aggregate on top (SUM of `Total Cases`, AVG of the rest). This gives
  exactly the metric-view numbers.
- An `asset_name` dataset won't work here: Lakeview requires it fully qualified, and
  `dataset_catalog` / `dataset_schema` do not rewrite it.

## Teardown
```bash
databricks bundle destroy -t dev --auto-approve
```
This drops the bundle-owned schema, dashboard and job. It does not delete the Genie space: trash that by its exact id.
