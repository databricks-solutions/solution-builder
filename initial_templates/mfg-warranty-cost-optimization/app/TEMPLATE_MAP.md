# TEMPLATE_MAP — Warranty Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the
Brightwater Cycle Works warranty story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/warranty.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent), `list_warranty_signals`, `get_root_cause_evidence`, `open_quality_case` (write-back); OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/analyze.ts` `[D]` | The root-cause case: claims evidence → cohort isolation → alternatives tested (live SQL) → telemetry → Genie agent (documents) → exposure + priced containment (deterministic) → notice model write-up, streamed step by step |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, signals, claims, quality_cases |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the flagged signals (+ cohort + exposure) and every classified claim; `execSql` (warehouse) |
| `db/queries/*` | Drizzle queries for chat + warranty (signals, claims explorer, quality-case write-back, activity) |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations |
| `routes/signals.ts` `[D]` | `/api/signals`, `/api/signals/:id`, `POST …/analyze` (SSE), `POST …/case` (write-back), `/api/claims`, `/api/quality-cases` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` `[D]` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse (allowlist of 5 keys) |
| `routes/activity.ts` | Recent quality activity for Home |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + re-syncs from Delta ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint}.ts` | Tracing/feedback, log gating, viewer identity, streaming text helper |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/signals`, `/signals/:id`, `/claims`, `/cases`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Headline, KPI tiles, early-warning signal cards, starter questions, recent activity |
| `signals/{SignalsView,SignalWorkbench}.tsx` `[D]` | Early-warning board + signal workbench (root-cause case, containment, supplier notice, quality case) |
| `claims/ClaimsView.tsx` `[D]` | Claims explorer: dealer labor code vs AI failure mode |
| `cases/QualityCasesView.tsx` `[D]` | Quality cases written back to Lakebase |
| `warranty/{api,ui}.ts(x)` `[D]` | API client + shared UI atoms (pills, KPI, sparkline) |
| `analytics/AnalyticsView.tsx` `[D]` | Charts from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- No `app.yaml`: command, OBO scopes and env (`DEMO_CATALOG/SCHEMA`, `DASHBOARD_ID`, `NOTICE_MODEL`, …) live in the bundle
  (`../databricks.yml` → `apps.warranty_app.config`). GENIE_SPACE_ID is read at boot from
  `<catalog>.<schema>.demo_resources` (`server/services/resources.ts`), written by the setup job.
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `db-generate.js` (Drizzle migrations with a pinned baseline),
  `lakebase_setup_db.sh` (legacy `demo` target only), `lakebase_grant_app_credential.sh`
- `start.sh` — local run
