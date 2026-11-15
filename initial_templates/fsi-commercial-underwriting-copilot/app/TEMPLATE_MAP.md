# TEMPLATE_MAP — Underwriting Copilot app (Tidewell Specialty Insurance)

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the
Tidewell commercial P&C underwriting story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/underwriting.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): tools `ask_data` (Genie agent), `list_queue`, `get_submission`, `run_underwriting_review`, `refer_to_cuo`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/underwrite.ts` `[D]` | The underwriting review: documents vs application → risk model (as submitted vs verified) → deterministic appetite / authority rules → guideline question to the Genie agent → TSI-RATE-03 pricing per location → rationale + broker letter, streamed step by step |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, submissions (+ review JSON, audit trail), sov_locations, loss_run_claims, documents, rating_factors, appetite_rules |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of today's triaged queue; `execSql` (warehouse) |
| `db/queries/uw.ts` `[D]` | Desk queries: queue, summary, submission detail, review save / refer / issue, referrals, activity |
| `routes/submissions.ts` `[D]` | `/api/submissions*`, `POST …/review` (SSE), `…/issue`, `…/approve`, `…/send-back`, `/api/referrals`, `/api/documents/:id/pdf`, Delta write-back (uw_decisions) |
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
| `App.tsx`, `main.tsx` | Router: `/`, `/queue`, `/submissions/:id`, `/referrals`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Masthead headline, KPI ribbon, hero dossier (property & peril schedule + hail-belt Leaflet map), authority ladder, rate-adequacy gauge, ask panel, queue log, desk activity |
| `uw/{QueueView,SubmissionWorkbench,ReferralsView,ui,api}.tsx` `[D]` | Submission queue, workbench (application vs documents, PDFs, review, pricing, rules, guideline answer, broker letter), CUO referrals |
| `analytics/AnalyticsView.tsx` `[D]` | Charts from `config/queries/*.sql` (loss ratio by cell, roof-age split, queue + decisions write-back) |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D palette]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- no `app.yaml`: command + env (`DEMO_CATALOG/SCHEMA`, `DASHBOARD_ID`, `NOTICE_MODEL`, …) + scopes live in the bundle's app
  resource (`databricks.yml` → `resources.apps.uw_app.config`); `GENIE_SPACE_ID` is read at boot from
  `<catalog>.<schema>.demo_resources` (`server/services/resources.ts`), written by the setup job
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `scripts/db-generate.js` (Drizzle migrations with a pinned baseline)
- `start.sh` — local run (`DATABRICKS_CONFIG_PROFILE=<p> DATABRICKS_APP_PORT=8801 ./start.sh`)
