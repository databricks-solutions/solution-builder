# TEMPLATE_MAP — Supply Planning Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the Corvane
S&OP supply-planning story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, planning-data warm-up, route registration, MLflow experiment |
| `agent/planner.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent), `list_exposures`, `get_exposure`, `evaluate_mitigations`, `simulate_plan`, `propose_plan`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/planner.ts` `[D]` | Deterministic planning engine: loads the gold tables, prices every mitigation lever, re-simulates the 13-week projection |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, plans, plan_events |
| `db/sync.ts` `[D]` | Planning-data warm-up, Lakebase wipe (reset), `execSql` (SQL warehouse, app SP) |
| `db/queries/{chat,plans}.ts` | Drizzle queries for chat + plans |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations |
| `routes/planning.ts` `[D]` | `/api/overview`, `/api/exposures/:id`, `POST …/simulate`, `POST …/propose`, `POST …/book` (Lakebase + Delta write-back), `/api/plan-events`, `/api/inventory` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + the app's rows in `sop_plan_decisions` ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/exposures/:id`, `/inventory`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Headline, KPI tiles, exposure board, SG-400 demand vs AI_FORECAST, supply signals, starter questions, plans booked |
| `planning/ExposureWorkbench.tsx` `[D]` | Projection chart, inbound POs, signals, orders at risk, mitigation plan builder, book plan, audit trail |
| `planning/{ProjectionChart,InventoryView,api,ui}.tsx` `[D]` | Chart, inventory-health page, typed API client, UI atoms |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- App command, OBO scopes and env live in the bundle (`databricks.yml` → `resources.apps.supply_planning_app.config`);
  there is no `app.yaml`. `GENIE_SPACE_ID` is read at boot from `<catalog>.<schema>.demo_resources`
  (written by the setup job) by `server/services/resources.ts`
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config (copilot starter script) + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `scripts/db-generate.js` (Drizzle migrations with a pinned baseline so a
  redeploy never re-runs CREATE TABLE), `lakebase_grant_app_credential.sh` (local-dev helper)
- `start.sh` — local run
