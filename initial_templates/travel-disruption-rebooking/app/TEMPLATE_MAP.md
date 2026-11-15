# TEMPLATE_MAP — IROPS Copilot app (Aeralis Airways, Winter Storm Harlan)

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the
Aeralis IROPS disruption-response story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/irops.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): tools `ask_data` (Genie agent), `list_disrupted_flights`, `get_priority_passengers`, `plan_reaccommodation`, `submit_plan_for_approval`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/reaccom.ts` `[D]` | The re-accommodation plan: deterministic priority allocation (parties, UMNR/WCHC/nearby-airport rules, partner cost caps, hotel entitlement, guardrails, AutoProtect costing) → Genie agent (documents) → notification writer, streamed step by step |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, flights (+ plan JSON, audit trail), options, passengers, hotels, guardrails |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the Harlan disruption; `execSql` (warehouse) |
| `db/queries/irops.ts` `[D]` | Desk queries: flights, summary, plan save / submit / commit (seats + rooms decrement), approvals, activity |
| `routes/flights.ts` `[D]` | `/api/flights*`, `POST …/plan` (SSE), `…/submit`, `…/approve`, `…/send-back`, `/api/approvals`, Delta write-back |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` `[D keys]` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse |
| `routes/activity.ts` | Recent desk activity for Home |
| `routes/admin.ts` `[D]` | `POST /api/admin/reset` — wipes app tables + desk write-back rows in Delta, re-syncs from Delta |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers (`fixMojibake`) |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/flights`, `/flights/:id`, `/approvals`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Headline, storm KPIs, departures board, route map, priority lanes, rebooking progress, starter questions, recent desk activity |
| `irops/DepartureBoard.tsx`, `irops/RouteMap.tsx`, `irops/FlapText.tsx` `[D]` | Split-flap departures board, OSM route map, split-flap text primitive |
| `lib/airports.ts` `[D]` | Static IATA → lat/lon lookup for the route map (add a code when a new destination appears) |
| `irops/{FlightsView,FlightWorkbench,ApprovalsView,ui,api}.tsx` `[D]` | Disrupted flights, flight workbench (manifest, plan, guardrails, policy answer, notifications), Duty Manager approvals |
| `analytics/AnalyticsView.tsx` `[D]` | Charts from `config/queries/*.sql` (AutoProtect vs pilot, live write-back) |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D palette]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- App command, OBO scopes and env (`DEMO_CATALOG/SCHEMA`, `DASHBOARD_ID`, `NOTICE_MODEL`, …) live in the bundle
  (`databricks.yml` → `resources.apps.irops_app.config`); there is no app.yaml. `GENIE_SPACE_ID`
  is read at boot from `<catalog>.<schema>.demo_resources` (written by the setup job) — `server/services/resources.ts`
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `scripts/db-generate.js` (Drizzle migrations with a pinned baseline,
  so a redeploy against an existing Lakebase DB is a no-op), `lakebase_grant_app_credential.sh` (local-dev only)
- `start.sh` — local run (`DATABRICKS_CONFIG_PROFILE=<p> DATABRICKS_APP_PORT=8828 ./start.sh`)
