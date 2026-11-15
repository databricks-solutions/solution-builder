# Deploy — AI/BI Sales Pipeline Review

No app, no Lakebase — deploy is two commands.

```bash
databricks bundle deploy -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<serverless-warehouse-id>
databricks bundle run sales_pipeline_setup -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<serverless-warehouse-id>
```

The catalog must already exist (`CREATE CATALOG IF NOT EXISTS <catalog>`). The dashboard and Genie space land in the
bundle folder (`--var workspace_folder=...` to change it). Every dashboard dataset is schema-less SQL, including the
metric-view one (``SELECT … MEASURE(`Revenue`) FROM metrics_sales``), so `dataset_catalog` / `dataset_schema` rebind
the whole dashboard to your catalog/schema.

**Upgrades** re-run the same two commands. They are idempotent: the schema, dashboard and job are bundle-owned, data
is overwritten, and the Genie space is looked up by title within the folder and updated in place. The data uses fixed
dates and a seeded RNG, so every run produces identical numbers. The setup job takes about 2.5 minutes.

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` / `dataset_schema` rewrite) and
`databricks-sdk>=0.114.0` for the Genie task (wired via `environment_key: sdk_latest`).

After the run:
- **Data** — `<catalog>.<schema>`: 7 base tables, plus `orders_enriched` and the `metrics_sales` metric view.
- **Dashboard** — "AI-BI - Sales Pipeline Review" (published, embedded credentials).
- **Genie space** — "AI-BI - Sales Pipeline Review".

> **Note on the AI forecast.** The dashboard's `ds_target` / `ds_forecast` datasets use `AI_FORECAST`, which runs on a
> **SQL warehouse** (validate there) but is disabled on databricks-connect serverless — so the medallion build in
> `generate_data.py` deliberately does not call it.

## Teardown
```bash
databricks bundle destroy -t dev -p <profile> --auto-approve
```
(Does not drop the Genie space. `destroy` drops the bundle-owned schema and its tables.)
