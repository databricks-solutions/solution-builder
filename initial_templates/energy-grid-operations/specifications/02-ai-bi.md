# 02 — AI/BI dashboard + Genie space

## Dashboard `Grid Ops Copilot - MREC heat-wave peak` (`dashboard/dashboard.lvdash.json`)
Datasets are **schema-less** (bare table names); the DAB injects `dataset_catalog` / `dataset_schema`.
Every dataset query was executed on warehouse `<your-warehouse-id>` before deploy.

1. **Tomorrow's peak** — KPI counters (system peak vs capacity, worst transformer %, transformers over
   nameplate, customers at risk, SAIDI 12 m), T-104 line chart (5 days SCADA + 48 h forecast + P90 + nameplate),
   substation symbol map coloured by worst forecast loading, forecast-peak bar by transformer (only T-104 > 100 %),
   at-risk asset table with risk drivers.
2. **Asset health & relief options** — DGA ethylene T-104 vs fleet, daily max hot-spot (90 days) vs 110 °C,
   risk matrix scatter (health index × forecast loading), costed relief option table.
3. **Reliability (SAIDI/SAIFI)** — counters vs target, monthly SAIDI bars (August spike = the T-104 trip),
   customer-minutes by cause, outage log with SAIDI contribution.

## Genie space `Grid Ops Copilot - MREC heat-wave overload` (`genie/genie_space.json`, serialized v2)
18 tables (sorted), text instructions (time anchor, loading/hot-spot limits, risk tiers, SAIDI = SUM of monthly),
8 sample questions, 6 example SQLs. Deployed by `src/deploy/deploy_genie.py` (idempotent by title).

Demo questions (verified answers):
- *Which transformers are at risk of overload tomorrow?* → T-104 CRITICAL 107.2 %, T-109 WATCH 92.1 %.
- *What are the relief options for T-104 and which one is recommended?* → rank 1 demand response, 5.32 MVA, $23,000, 94.8 %.
- *What was our SAIDI and SAIFI over the last 12 months?* → 139.1 min, 1.253.
- *Which critical facilities are served by T-104?* → 6 (Mercy Regional Hospital, water plant, 2 cooling centers, senior living, data center).
