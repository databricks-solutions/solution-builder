# 03 — AI/BI dashboard: "Corvane - S&OP Supply Health"

`dashboard/supply_planning.lvdash.json` — schema-less datasets (the DAB injects `dataset_catalog` / `dataset_schema`),
published with embedded credentials, parent = the demo workspace folder. Embedded in the app at `/dashboard`.

**Page 1 — Supply health:** header text; counters (fill rate last 4 weeks, Dayton fill rate, revenue at risk 13 weeks,
projected stock-outs, E&O value, delayed inbound POs); HX-220 Dayton projection lines (revised ETA vs if on time vs
safety stock); revenue at risk by exposure; exposures table joined to `sop_plan_decisions` (plan status, actions, cost,
revenue protected — shows the app's write-back); weekly fill rate by plant; supplier on-time delivery by month;
E&O by plant × category; delayed inbound POs.

**Page 2 — Demand & inventory:** Dayton servo demand actual vs AI_FORECAST; days of supply by component × plant (bar +
table with E&O category).
