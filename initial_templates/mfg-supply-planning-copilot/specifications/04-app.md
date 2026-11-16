# 04 — Databricks App: Supply Planning Copilot (S&OP planner console)

Forked from the solution-builder app template (Node/Express AppKit + React + Lakebase/Drizzle + OpenAI Agents SDK + MLflow tracing).

| Route | What it shows |
|---|---|
| `/` Home | Headline from the top exposure, KPI tiles (revenue at risk, stock-outs, fill rate, E&O), exposure board, SG-400 demand vs AI_FORECAST, ai_extract supply signals, copilot starter chips, plans booked |
| `/exposures/:id` Workbench | KPIs, 13-week projection chart (baseline / if on time / safety stock / with plan), inbound POs with delays, signals, customer orders in the stock-out weeks, **mitigation plan builder** (priced levers, qty inputs, live re-simulation, approver), **Ask the copilot to build the plan**, **Book plan** (Lakebase + Delta write-back), same part at other plants, audit trail |
| `/inventory` | E&O by plant and item, days-of-supply heat table, fill-rate trend, supplier OTD (SQL warehouse via `config/queries/*.sql`), plans written back to Delta |
| `/dashboard` | Embedded AI/BI dashboard |
| Chat dock | Agent (databricks-gpt-5-4): `ask_data` (the Genie agent: analytics + policy manual), `list_exposures`, `get_exposure`, `evaluate_mitigations`, `simulate_plan`, `propose_plan` |

Server: `services/planner.ts` (engine), `routes/planning.ts` (REST + booking + Delta INSERT), `db/queries/plans.ts`,
`agent/planner.ts`, `db/sync.ts` (Delta loader + reset). Lakebase tables `app.plans`, `app.plan_events` (+ chat tables)
in database `dbgen_supply_planning_copilot` (project `solution-builder`). Header **Reset demo** truncates the
Lakebase tables and deletes the app's rows from `sop_plan_decisions`.

Auth: user OBO token first, one retry as the app service principal on 401/403 (`lib/auth.ts authedFetch`) for the model
and Genie calls; Delta reads/writes run as the app SP (granted SELECT on the schema + MODIFY on `sop_plan_decisions`).
