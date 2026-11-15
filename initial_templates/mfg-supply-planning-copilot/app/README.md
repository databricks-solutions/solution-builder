# Supply Planning Copilot — Databricks App (Corvane Motion Systems)

The S&OP planner console of the *supply planning + inventory optimization* demo (see the template's top-level
`README.md` for the story and the demo script). Node + Express (`@databricks/appkit`) + React, Lakebase for the
plans and audit trail, OpenAI Agents SDK for the copilot, MLflow tracing.

## Pages
| Route | View |
|---|---|
| `/` | Home — S&OP planning grid: 13-week projected-inventory grid (stock-outs in red), supply/demand bridge + supplier lanes for the top exposure, supply signals (ai_extract), copilot starters, plans booked |
| `/exposures/:id` | Exposure workbench — 13-week projection, delayed inbound POs, customer orders at risk, priced mitigation levers, live re-simulation, **Ask the copilot to build the plan**, **Book plan** |
| `/inventory` | Inventory health — E&O, days of supply, fill rate, supplier on-time delivery, plans written back to Delta |
| `/dashboard` | The embedded AI/BI dashboard (`DASHBOARD_ID`) |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Planning engine** (`server/services/planner.ts`): reads the gold tables (projection, exposures, POs, sourcing,
  transfer lanes, orders, signals, inventory health) through the SQL warehouse, prices transfer / alternate supplier /
  air expedite / safety-stock levers and re-simulates the projection. Numbers never come from the LLM.
- **Copilot** (`server/agent/planner.ts`): `ask_data` (the Genie agent: S&OP analytics + the policy manual), `list_exposures`,
  `get_exposure`, `evaluate_mitigations`, `simulate_plan`, `propose_plan` (stages a plan in Lakebase).
- **Book plan** (`POST /api/exposures/:id/book`): Lakebase `app.plans` + `app.plan_events`, then INSERT into Delta
  `sop_plan_decisions` so the dashboard and Genie see it.
- **Auth**: model / Genie calls use the viewer's OBO token and retry once as the app service principal if it is
  rejected (`server/lib/auth.ts::authedFetch`); Delta reads/writes run as the app SP.
- **Reset** (header button): clears plans, audit and chat history in Lakebase and the app's rows in `sop_plan_decisions`.

## Run / deploy
Local: `cp .env.template .env`, fill it in, then `DATABRICKS_CONFIG_PROFILE=<profile> ./start.sh`.
Deploy: see `../dab_instructions.md` (bundle deploy → setup job → `databricks apps deploy`). `TEMPLATE_MAP.md` lists every file.
