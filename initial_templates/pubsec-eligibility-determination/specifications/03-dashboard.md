# 03 — AI/BI dashboard: "Westbrook DHS - Eligibility Timeliness & Equity"

File: `dashboard/eligibility_operations.lvdash.json` (datasets are **schema-less**; the DAB rebinds
`dataset_catalog` / `dataset_schema`). Deployed + published by the bundle into
`/Shared/pubsec-eligibility-determination/PUBSEC-Eligibility-Copilot/`. Persona: Marcus Webb, Director of Economic Assistance.

Datasets (all tested on the warehouse): `kpis`, `monthly`, `scorecard`, `equity_race`, `channel_mix`, `denials`, `extraction`.

**Page 1 — Timeliness & backlog**: counters (SNAP on-time statewide last 3 mo ≈ 84.5%, Tamarack ≈ 29.2%, open
backlog 762, past federal deadline 96, expedited past 7 days 3); line chart SNAP on-time % by county by month
(Tamarack falls from ~80% to <30% after the mill closure); bar open cases per eligibility worker (Tamarack 58 vs 2–9);
county scorecard table.

**Page 2 — Equity & access**: approval rate by race/ethnicity (flat 76–78%); procedural-denial rate by county
(Tamarack 14% vs 4–9%); application channel by region type (rural = mail heavy); avg processing days by channel;
denial reasons by county; documents read by `ai_extract` by type.
