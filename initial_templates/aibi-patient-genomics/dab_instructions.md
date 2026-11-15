# Deploy — AI/BI Patient Genomics

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard (published, embedded credentials) + setup job
databricks bundle deploy -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion + metric view, then create/update the Genie space
databricks bundle run patient_genomics_setup -t dev -p <profile> \
  --var catalog=<catalog> --var schema=<schema> --var warehouse_id=<your-serverless-warehouse-id>
```

Upgrades run the same two commands: data regenerates deterministically, the dashboard is updated in place, and the
Genie space is updated in place (looked up by its exact title).

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` / `dataset_schema` rewrite) and
`databricks-sdk>=0.114.0` for the Genie task (wired via `environment_key: sdk_latest`).

After the run:
- **Data** — `<catalog>.<schema>` (4 raw tables + `patient_cohort` + 6 survival rollups + the `genomics_metrics`
  metric view).
- **Dashboard** — "[AI-BI] AIBI - Patient Genomics Review for Precision Oncology".
- **Genie space** — "AI-BI - Patient Genomics: OncoTarget-1 real-world evidence".

Re-runs are idempotent (data overwrites; dashboard and Genie update in place).

## Teardown
```bash
databricks bundle destroy -t dev -p <profile> --auto-approve
```
(Drops the bundle-owned schema + dashboard + job. The Genie space is created by the setup job, so trash it by its id.)
