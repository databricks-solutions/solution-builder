# Ad Yield Copilot — Databricks App (Aurora Crest Media)

The yield & pricing desk of the *ad yield & pricing optimization* demo (see the template's top-level `README.md` for
the story and the demo script). Node + Express (`@databricks/appkit`) + React, Lakebase for the operational state +
write-back, OpenAI Agents SDK for the chat agent, MLflow tracing.

## Pages
| Route | View |
|---|---|
| `/` | Home (the yield desk) — dark trading-desk layout: CPM ticker, sell-through heatmap (daypart × property, `/api/charts/sell_through_heatmap`), pacing blotter of at-risk IOs, yield-leak panel, *Ask the Copilot* command line, recent activity |
| `/yield` | Yield board — programmatic eCPM vs rate card vs open-auction clearing per product, floor group in force vs rate card, revenue gap; **Restore floor** write-back |
| `/campaigns` | Live IOs with pacing and projected delivery vs the 95% make-good threshold |
| `/campaigns/:id` | Campaign workbench — line items, avails trend, **Build recovery plan** (streamed), findings, spare avails, priced reallocation, floor fix, IO terms (Genie agent over the documents), agency notice, **Approve plan & send to ad ops** |
| `/plans` | Yield actions — approved plans and floor changes written to Lakebase |
| `/analytics` | Revenue & forecast charts (`config/queries/*.sql` on the SQL warehouse) |
| `/dashboard` | The embedded AI/BI dashboard (`DASHBOARD_ID`) |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Recovery plan** (`server/services/plan.ts`, `POST /api/campaigns/:id/plan`): live SQL on the Delta gold tables
  (line pacing, weekly avails, `gold_avails_forecast` from `ai_forecast`, spare avails × audience share, floor groups)
  → the Genie agent (`GENIE_SPACE_ID`, Agent mode: IO terms, make-good policy, rate card documents) → deterministic allocation and money
  → `NOTICE_MODEL` writes the diagnosis, the agency notice and the ad-ops instructions.
- **Write-backs** (Lakebase): `POST /api/campaigns/:id/approve` → `app.yield_plans` (+ its `app.floor_changes`);
  `POST /api/opportunities/:id/floor` → `app.floor_changes`. The chat tools `approve_recovery_plan` / `apply_floor_change`
  do the same when asked.
- **Chat agent** (`server/agent/yield.ts`): `ask_data` (the Genie agent: analytics + ad-sales documents), `list_campaigns_at_risk`,
  `list_yield_opportunities`, `build_recovery_plan`, `approve_recovery_plan`, `apply_floor_change`.
- **Config**: `DEMO_CATALOG` / `DEMO_SCHEMA` / `DASHBOARD_ID` come from the bundle's app `config.env`; the Genie agent id is
  read at boot from `<catalog>.<schema>.app_config` (written by the setup job). Env vars win when set.
- **Auth**: every model / Genie call goes out with the viewer's OBO token and retries once as the app service
  principal if the token is rejected (`server/lib/auth.ts::authedFetch`).
- **Reset** (`POST /api/admin/reset`, header button): re-syncs campaigns + opportunities from Delta into Lakebase and
  clears plans, floor changes and chat history.

## Run / deploy
Local: `cp .env.template .env`, fill it in (use a Lakebase dev branch, not `production`), then
`DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8805 ./start.sh`.
Deploy: see `../dab_instructions.md` (`bundle deploy` → `bundle run ad_yield_setup` → `bundle run ad_yield_app`).
`TEMPLATE_MAP.md` lists every file.
