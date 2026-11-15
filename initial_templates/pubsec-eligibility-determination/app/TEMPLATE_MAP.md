# TEMPLATE_MAP — Eligibility Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to
the Westbrook DHS eligibility story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/eligibility.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent), `find_open_cases`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/assess.ts` `[D]` | The eligibility check: deterministic rule engine → Genie agent (documents) → notice model, streamed step by step |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, cases, case_documents |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the open caseload; rulebook loader; `execSql` (warehouse) |
| `db/queries/*` | Drizzle queries for chat + cases |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations |
| `routes/cases.ts` `[D]` | `/api/cases`, `/api/cases/summary`, `/api/cases/:id`, `POST …/assess` (SSE), `POST …/decision` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse |
| `routes/activity.ts` `[D]` | Recent workbench activity for Home |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + re-syncs from Delta ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/cases`, `/cases/:id`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | USWDS-style page: official-status alert, Tamarack case clock (30-day chips), county map (`home/CountyMap.tsx`, OSM), SNAP trend, county scorecard, policy manual, starter questions, recent activity |
| `cases/{CaseloadView,CaseWorkbench,ui,api}.tsx` `[D]` | Queue + case workbench (documents, AI check, notice, decision) |
| `analytics/AnalyticsView.tsx` `[D]` | Charts from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback, starter script (`script.ts` `[D]`) |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- App command, OBO scopes and env live in the bundle (`databricks.yml` → `resources.apps.eligibility_app.config`);
  there is no `app.yaml`. `GENIE_SPACE_ID` is read at boot from `<catalog>.<schema>.demo_resources`
  (written by the setup job) by `server/services/resources.ts`
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `scripts/db-generate.js` (Drizzle migrations with a pinned baseline so a
  redeploy never re-runs CREATE TABLE), `lakebase_grant_app_credential.sh` (local-dev helper)
- `start.sh` — local run
