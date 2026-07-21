# Deploy — AI/BI Patient Genomics

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_patient_genomics \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion, then deploy the Genie space
databricks bundle run patient_genomics_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_patient_genomics \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie task (wired via
`environment_key: sdk_latest`).

After the run:
- **Data** — `dbdemos_templates.aibi_patient_genomics` (4 raw tables +
  `patient_cohort` + 6 survival rollups + the `genomics_metrics` metric view).
- **Dashboard** — "[AI/BI] AIBI - Patient Genomics Review for Precision Oncology".
- **Genie space** — "AI/BI - Patient Genomics: OncoTarget-1 real-world evidence".

Re-runs are idempotent (data overwrites; Genie updates in place).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
