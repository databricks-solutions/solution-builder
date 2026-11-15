# 05 — Genie agent (tables + policy manual)

**Genie agent: "Corvane - S&OP Supply Planning"** (`src/genie/genie_space.json`, serialized v2, tables sorted; created by
`src/deploy/deploy_genie.py`). 18 tables incl. `stockout_exposures`, `inventory_projection`, `demand_forecast`,
`gold_fill_rate_weekly`, `gold_inventory_health`, `gold_supplier_performance_monthly`, `gold_open_purchase_orders`,
`sop_plan_decisions`, `supplier_signals` and the metric view `mv_supply_performance`. Instructions define the
horizon, fill rate (SUM ratio), OTD, E&O and booked plans, and route numbers to the tables / rules to the documents;
7 verified example SQLs.

Sample questions: projected stock-outs + revenue at risk · Nanhai on-time trend · E&O by plant · weekly fill rate by
plant (12 weeks) · delayed inbound POs · SG-400 AI forecast at Dayton · expedite approvals + alternate sources (documents).

**Documents:** the Genie agent's `supply_policy` volume (`src/policy_manual/*.md`,
chapters CSP-01 … CSP-06: decision rights and approval thresholds, safety stock incl. the +1-week trigger for a
disrupted lane, expediting / premium freight, transfers + E&O first, alternate sources (Ridgeline share limit),
customer allocation). Answered in Agent mode; the agent cites the section.
