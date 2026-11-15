# Trade Promo Copilot (Crestwood Snacks Co.)

Databricks App (Node/Express + React, AppKit) for revenue-growth-management teams: review next quarter's
draft promo calendar, see every past promotion against its ML baseline, and let an agent flag the
money-losing events, propose a compliant re-plan and write the approved plan back to Lakebase.

| Page | What it shows | Data |
|---|---|---|
| **Promo calendar** (`/`) | 13-week calendar by retailer, each event colored by forecast (money-losing / below target / on track); event drawer with the lift-vs-baseline waterfall (baseline → lift → pantry dip → cannibalization), the retailer chips and the re-plan options (Apply = write-back) | `app.plan_events`, `app.plan_scenarios` (Lakebase, synced from `gold_plan_forecast` / `gold_plan_scenarios`) |
| **Post-event analysis** (`/events`) | ROI by retailer × tactic; every completed promotion with its weekly curve vs the ML baseline, pantry-loading dip, cannibalization, forward buy | `app.promo_events` (synced from `gold_event_roi` + `gold_event_weekly`) |
| **Approved re-plans** (`/decisions`) | The write-back log: before/after net profit, ROI, trade spend, volume, retailer notice | `app.plan_decisions` |
| **Trade ROI dashboard** (`/dashboard`) | Embedded AI/BI dashboard | Delta gold tables |
| **Copilot** (dock + `/c/:id`) | OpenAI Agents SDK on `databricks-gpt-5-4` with tools `get_promo_calendar`, `get_post_event_analysis`, `get_replan_options`, `ask_data` (Genie agent: gold tables + policy documents), `approve_replan` (write-back) | Lakebase + Genie agent, traced in MLflow |

Key files: `server/agent/promoplanner.ts` (agent + tools), `server/db/queries/promo.ts` (queries +
the `applyReplan` transaction), `server/db/sync.ts` (Delta → Lakebase at boot / on "Reset the demo"),
`server/routes/promo.ts` (REST), `client/src/planner|events|decisions/` (pages), `config/app.json`.

Local dev: copy `.env.template` → `.env`, fill it from the setup job's `export_resources` output, then
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8803 ./start.sh`. Deploy: see `../dab_instructions.md`.
