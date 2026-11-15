# 03 — CMO dashboard + Genie

## Dashboard (`dashboard/dashboard.lvdash.json`, one page, region filter)
Counters: monthly churn (Sep), baseline churn, revenue at risk (Critical+High), critical accounts, save rate driver-matched vs blanket.
Charts: churn rate by region by month (line) · churn by segment before vs since July · ARPU at risk by region × SHAP driver · save rate and avg cost by strategy · save rate by offer × driver · worst cell sites (table) · voice of customer by intent × sentiment (AI Functions) · live desk decisions (write-back table).
Datasets are schema-less (bare table names) — the DAB / `lakeview create --dataset-catalog/--dataset-schema` binds them.

## Genie space (`genie/genie_space.json`, serialized v2)
11 tables, text instructions (churn-rate formula, tier thresholds, save-rate definition, migrated sites, Crest markets), 8 sample questions, 7 example SQLs (all executed on the warehouse before shipping).
