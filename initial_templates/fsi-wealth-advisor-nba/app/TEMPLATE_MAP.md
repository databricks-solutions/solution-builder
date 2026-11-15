# TEMPLATE_MAP — Advisor Morning Book app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the Calder Pine
wealth-advisor story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/advisor.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent), `get_morning_book`, `get_client_brief`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/prep.ts` `[D]` | Meeting prep: model ranking → suitability → deterministic agenda → Genie agent (documents) → brief + outreach, streamed step by step |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, clients |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the advisor's book; `execSql` / `execWarehouseSql` (warehouse, write-back) |
| `db/queries/*` | Drizzle queries for chat + the book |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations |
| `routes/book.ts` `[D]` | `/api/book`, `/api/book/summary`, `/api/clients/:id`, `POST …/prep` (SSE), `POST …/decision` (Lakebase + Delta) |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` `[D]` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse |
| `routes/activity.ts` | Recent activity for the Morning Book |
| `routes/admin.ts` `[D]` | `POST /api/admin/reset` — wipes app tables, empties `advisor_decisions`, re-syncs from Delta |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/book`, `/clients/:id`, `/insights`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Morning book landing: serif greeting, money-in-motion ribbon by signal, numbered call-list cards (model pick vs suitable action), copilot starters, brass guardrail note, activity |
| `book/{BookView,ClientView,ui,api}.tsx` `[D]` | Ranked book + client page (signals, notes + AI, NBA × suitability, meeting prep, outreach, decision) |
| `insights/InsightsView.tsx` `[D]` | Charts from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5` pine / brass palette), events |

## Config + scripts
- `app.yaml` — command, OBO scopes, env (`DEMO_CATALOG/SCHEMA`, `ADVISOR_ID`, `DASHBOARD_ID`, `GENIE_SPACE_ID`, `DRAFT_MODEL`, …)
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `finalize_app.sh` (fill app.yaml from the setup job output),
  `lakebase_setup_db.sh`, `lakebase_grant_app_credential.sh`, `deploy.sh` (standalone deploy without the bundle)
- `start.sh` — local run
