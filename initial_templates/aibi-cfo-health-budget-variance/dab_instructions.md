# Deploy — AI/BI Healthcare CFO: Budget Variance & Comp Controls

No app, no Lakebase — deploy is two commands.

```bash
# 1. Create the schema + dashboard shell + setup job
databricks bundle deploy \
  --var catalog=dbdemos_templates \
  --var schema=aibi_cfo_health_budget_variance \
  --var warehouse_id=<your-serverless-warehouse-id>

# 2. Generate data + build the medallion, materialise the AI_FORECAST table on the
#    warehouse, deploy the Genie space, and apply the comp-masking policy
databricks bundle run healthcare_cfo_setup \
  --var catalog=dbdemos_templates \
  --var schema=aibi_cfo_health_budget_variance \
  --var warehouse_id=<your-serverless-warehouse-id>
```

Requires Databricks CLI **v0.283.0+** (for the dashboard `dataset_catalog` /
`dataset_schema` rewrite) and `databricks-sdk>=0.114.0` for the Genie + SQL tasks
(wired via `environment_key: sdk_latest`).

The setup job runs four tasks:
1. **generate_data_and_build** — synthetic feeds + medallion (6 `gold_*` tables,
   incl. `gold_facility_variance` for the hospital map). The actual months of
   `gold_opex_monthly` only; the forecast (`gold_opex_forecast`) is built next.
2. **build_forecast** — runs `src/deploy/build_forecast.sql` on the **warehouse** to
   materialise `gold_opex_forecast` via `AI_FORECAST`. This runs on a SQL warehouse
   (not databricks-connect serverless, where `AI_FORECAST` is disabled) — hence the
   separate task.
3. **deploy_genie** — creates/updates the Genie space "AI-BI - Healthcare CFO Budget
   Variance".
4. **comp_masking** — runs `src/deploy/comp_masking.sql` on the warehouse: a Unity
   Catalog column-mask on the `compensation` table (Finance sees full comp; everyone
   else sees `NULL` for salary/comp columns, real headcount).

After the run:
- **Data** — `dbdemos_templates.aibi_cfo_health_budget_variance` (7 raw tables incl.
  `facilities` + 6 `gold_*` tables incl. `gold_facility_variance` + `gold_opex_forecast`
  + the `metrics_budget_variance` metric view).
- **Dashboard** — "[AI/BI] Healthcare CFO — Budget Variance" (two pages).
- **Genie space** — "AI-BI - Healthcare CFO Budget Variance".

Re-runs are idempotent (data overwrites; Genie updates in place; `SET MASK` re-applies).

## Comp-controls groups (the governance demo moment)

`comp_masking.sql` masks the salary columns for anyone **not** in the `finance`
**account** group, and grants both demo groups SELECT on the table. The two groups —
`finance` and `ops_managers` — must be provisioned as **account-level** groups (UC
resolves grants and `is_account_group_member()` against account groups, not
workspace-local ones) with members assigned to the workspace. Create them once as an
account admin:

```bash
databricks account groups create --json '{"displayName":"finance"}'
databricks account groups create --json '{"displayName":"ops_managers"}'
# then add users, and add the groups to the workspace
```

If those groups don't exist at deploy time, the mask + tags still apply (the demo
still shows masked salaries to non-Finance users); only the two `GRANT SELECT`
statements are skipped (the task reports them and continues). Add the groups + grants
to complete the "Finance vs. Operations manager" side-by-side.

## Teardown
```bash
databricks bundle destroy --auto-approve
```
(Does not drop the Genie space or UC tables created by the setup job.)
