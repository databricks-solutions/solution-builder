# TEMPLATE_MAP — Ad Yield Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the
Aurora Crest Media ad-yield story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config (+ Genie / dashboard IDs from `<schema>.app_config`), Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/yield.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent), `list_campaigns_at_risk`, `list_yield_opportunities`, `build_recovery_plan`, `approve_recovery_plan` + `apply_floor_change` (write-backs); OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/{genie,logged-tool,types}.ts` | Genie Conversation API tool, logging wrapper |
| `chat-stream/*` | SSE streaming of agent turns (text, reasoning, tool calls) |
| `services/plan.ts` `[D]` | The recovery plan: pacing diagnosis → ai_forecast avails → spare avails for the booked audience → pricing check (floor group) → ad-sales documents via the Genie agent (IO terms) → allocation + money (deterministic) → notice model write-up, streamed step by step |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, campaigns, opportunities, yield_plans, floor_changes |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of live campaigns (+ lines) and programmatic yield opportunities (+ weekly eCPM); `readAppConfigTable`; `execSql` (warehouse) |
| `db/queries/*` | Drizzle queries for chat + the yield desk (campaigns, opportunities, plan approval + floor-change write-backs, activity, summary) |
| `db/{index,init,migrate}.ts` | Drizzle handle, boot init (migrations fatal, sync best-effort), migrator |
| `routes/yield.ts` `[D]` | `/api/yield/summary`, `/api/campaigns`, `/api/campaigns/:id`, `POST …/plan` (SSE), `POST …/approve` (write-back), `/api/opportunities`, `POST /api/opportunities/:id/floor` (write-back), `/api/plans`, `/api/floor-changes` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` `[D]` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse (allowlist of 5 keys) |
| `routes/activity.ts` | Recent yield activity for Home |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + re-syncs from Delta ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint}.ts` | Tracing/feedback, log gating, viewer identity, streaming text helper |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/yield`, `/campaigns`, `/campaigns/:id`, `/plans`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Headline, KPI tiles, AI workflow, at-risk IOs, starter questions, yield leak, recent activity |
| `yield/YieldBoardView.tsx` `[D]` | Programmatic yield board + product detail (weekly eCPM, floor rule, restore-floor write-back) |
| `yield/CampaignsView.tsx` `[D]` | Live IOs, pacing and projected delivery vs the 95% make-good threshold |
| `yield/CampaignWorkbench.tsx` `[D]` | Campaign workbench (recovery plan, spare avails, reallocation, floor fix, IO terms (Genie agent), agency notice, approve) |
| `yield/YieldActionsView.tsx` `[D]` | Approved plans + floor changes (Lakebase) |
| `yield/{api,ui}.ts(x)` `[D]` | API client + shared UI atoms (pills, KPI) |
| `analytics/AnalyticsView.tsx` `[D]` | Charts from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- Runtime config lives in the bundle (`../databricks.yml` → `apps.ad_yield_app.config`: command + env) — there is no `app.yaml`.
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `scripts/db-generate.js` (Drizzle migrations with a pinned `0000_init` baseline)
- `start.sh` — local run
