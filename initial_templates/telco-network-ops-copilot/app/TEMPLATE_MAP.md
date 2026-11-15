# TEMPLATE_MAP — NOC Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the
Halcyon Wireless NOC story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/copilot.ts` `[D]` | Chat-dock agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent: telemetry + NOC runbooks), `find_incidents`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/triage.ts` `[D]` | The triage agent: chat-completions tool loop (Claude Sonnet) over parameterized SQL (incident, topology, alarm history, optics, KPIs, impact, planned activity, technicians) + the NOC runbooks (Genie agent, documents) → `submit_triage` (verdict, root cause, impact, timeline, actions, dispatch) |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, incidents, trouble_tickets |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the open incident queue; `execSql` (warehouse, named parameters) |
| `db/queries/*` | Drizzle queries for chat + incidents / trouble tickets |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations (pinned `0000_init` baseline via scripts/db-generate.js) |
| `routes/incidents.ts` `[D]` | `/api/incidents`, `/summary`, `/:id`, `/:id/evidence`, `POST …/triage` (SSE), `POST …/ticket`, `POST …/close`, `/api/tickets` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` `[D]` | `/api/charts/:key` → `config/queries/<key>.sql` (noc_kpis, alarm_timeline, slow_burn, early_warning) |
| `routes/activity.ts` `[D]` | Recent workbench activity for Home |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + re-syncs from Delta ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers (fixMojibake) |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/incidents`, `/incidents/:id`, `/tickets`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | NOC wall: SEV banner, vitals, cell-site map (`noc/NetworkMap.tsx`), storm timeline + topology + silent-degradation panels (`noc/WallPanels.tsx`), incident strip, Copilot command line, recent activity |
| `noc/{IncidentsView,IncidentWorkbench,TicketsView,ui,api}.tsx` `[D]` | Incident queue, incident workbench (blast radius / KPI trend, alarms, triage, impact, plan, dispatch, write-back), trouble tickets |
| `analytics/AnalyticsView.tsx` `[D]` | Storm timeline, slow-burn sector charts, ignored-warning table from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- no `app.yaml`: command + env live in `databricks.yml` (`resources.apps.noc_app.config`); the Genie agent id is read at boot from `<catalog>.<schema>.demo_resources` (`server/services/resources.ts`)
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build),
  `lakebase_setup_db.sh`, `lakebase_grant_app_credential.sh`, `deploy.sh` (standalone deploy without the bundle)
- `start.sh` — local run
