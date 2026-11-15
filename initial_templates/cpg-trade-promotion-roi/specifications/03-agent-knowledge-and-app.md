# 03 — Genie agent (tables + documents), dashboard, app

## Documents — volume `trade_policy_docs` (searched by the Genie agent)
Source: (src/trade_docs/*.md, uploaded by `upload_trade_docs`):
TPG-2027 guidelines (ROI hurdle 0%, target +15%, depth ≤ 30%, BOGO discouraged, scan-based preferred, re-plan
rules: keep JBP slots, 4-week notice), PEA-2027 methodology, JBP-VALUMAX-FY27 (≥ 6 events + ≥ 2 displays per
quarter, up to 8 display slots, scan-down for TPR / Feature + Display, 4-week notice), trade terms matrix,
ValuMax BOGO recap memo (the KAM's volume-only view).

## Genie agent — "Crestwood - Trade Promotion ROI"
Data sources: the documents volume above + tables: gold_event_roi, gold_event_weekly, gold_tactic_response, gold_plan_forecast, gold_plan_scenarios,
promo_events, pos_weekly_sales, retailer_shipments, retailers, products + metric view trade_promo_metrics.
Text instructions define ROI as a ratio of sums, the leakage measures, "last 52 weeks" = is_last_52_weeks and
"next quarter" = gold_plan_forecast, and route numbers to the tables and policy questions to the documents.
7 example SQLs, 7 sample questions (one answered from the documents). Documents are answered in Agent mode only.

## AI/BI dashboard — "Crestwood - Trade Spend & Promotion ROI" (2 pages, schema-less datasets)
Page 1 Post-event ROI: KPIs (last 52 weeks), volume lift vs ROI scatter by tactic, ROI by tactic × retailer,
where the lift goes (net vs pantry loading vs cannibalization), trade spend by quarter × retailer, all events table.
Page 2 Next quarter plan: KPIs, as-planned vs recommended for the money-losing events, the draft calendar.

## App — trade-promo-copilot (Node/Express + React, Lakebase `dbgen_trade_promo`)
- Promo calendar (home): 13-week × retailer grid colored by forecast flag, event drawer (decomposition, re-plan
  options with Apply = write-back, decision log, revert).
- Post-event analysis: retailer × tactic roll-up, events table, event drawer with the weekly curve vs baseline.
- Approved re-plans: `app.plan_decisions` with before/after + retailer notice.
- Copilot (OpenAI Agents SDK, `databricks-gpt-5-4`, MLflow tracing): get_promo_calendar, get_post_event_analysis,
  get_replan_options, ask_data (the Genie agent: analytics + policy documents), approve_replan (write-back, only after explicit approval).
- Reset the demo: wipes conversations + decisions and re-syncs the calendar from Delta.
