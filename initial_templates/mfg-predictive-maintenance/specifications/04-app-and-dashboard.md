# 04 — App (Lakebase write-back) + AI/BI dashboard

## Databricks App `pdm-copilot` (Node/Express + React, forked from the Solution Builder app template)
- **Control room** (`/`): hero with the 3-beat script, KPI strip (critical / watch / protected assets / $ at risk / cost
  avoided), **priority alert** (top ML risk + drivers + last PM lubricant), **plant-floor map** (48 tiles colored by risk
  tier, bottleneck badge, booked-WO check), activity feed of every write.
- **Asset drawer**: vibration + temperature vs baseline (60 d), CMMS history with the substitute grease highlighted,
  failure history, work orders, "Ask PdM Copilot why".
- **Work orders** (`/work-orders`): booked WOs with root cause, tasks, crew, window, parts (crib vs Charlotte DC transfer),
  cost avoided / net savings; Start / Complete / Cancel (cancel releases parts + window hours); live windows capacity and
  reducer/lubricant inventory.
- **Dashboard** (`/dashboard`): embedded AI/BI dashboard. Floating **assistant dock** everywhere.

### Lakebase (project `pdm-copilot`, db `pdm_copilot`, schema `app`)
Mirror (synced from Delta at boot / reset): `assets`, `asset_trend`, `maintenance_history`, `failures`, `spare_parts`,
`maintenance_windows`. Write surface: `work_orders` (+ `ai_audit_trail` JSONB). `book_work_order` is one transaction:
lock asset + window + parts → reserve crib stock or transfer from DC → insert WO → consume window hours → flip asset to
`work_order_booked`. **Cost avoided** = `failure_prob_7d × unplanned_failure_cost_usd` (MPS-004); net = avoided − parts − labor ($60/h).

## AI/BI dashboard — "TechRobotics — Plant Reliability & OEE" (`dashboard/plant_reliability.lvdash.json`, schema-less)
Page 1 (plant manager): Line 2 OEE last 7 d vs baseline, downtime h (30 d), plant MTBF, breakdown cost 12 m, $ at risk
(ML) · weekly OEE by line · MTBF by asset type · breakdown cost by failure mode · downtime by month/line · fleet risk table.
Page 2 (root cause): 60-day vibration of RA-201/203/207/211/214 · robot PMs by lubricant (who got the substitute).
Regenerate with `python dashboard/build_dashboard.py dashboard/plant_reliability.lvdash.json`.
