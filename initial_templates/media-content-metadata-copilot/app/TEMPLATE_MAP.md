# TEMPLATE_MAP — Metadata Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to
the Orbitline+ content-metadata story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/copilot.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent), `find_titles`, `more_like_this`, `find_clips`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/retag.ts` `[D]` | The AI re-tag: AI Functions proposal → Standards Guide rules → Genie agent (documents) → Vector Search look-alikes → editor brief, streamed step by step |
| `lib/metadata.ts` `[D]` | Standards Guide as code: completeness score, brand-safety tier, rating floor, home-row eligibility, field diff |
| `lib/vs.ts` `[D]` | Vector Search query helper (title profiles + scenes indexes) |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, titles, title_scenes |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the library; collection rules + pilot multiplier loader; `execSql` (warehouse) |
| `db/queries/*` | Drizzle queries for chat + titles (queue, summary, proposal, decision write-back, activity) |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations |
| `routes/titles.ts` `[D]` | `/api/titles`, `/summary`, `/:id`, `/:id/similar`, `POST …/retag` (SSE), `POST …/decision`, `/api/clips` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` | `/api/charts/:key` → `config/queries/<key>.sql` on the SQL warehouse |
| `routes/activity.ts` | Recent workbench activity for Home |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + re-syncs from Delta ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/library`, `/titles/:id`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | Headline, Harborlight tiles, workflow steps, impressions per title by source, starter questions, activity |
| `titles/{LibraryView,TitleWorkbench,ui,api}.tsx` `[D]` | Queue + title workbench (live metadata, scenes, AI re-tag, diff, checks, Standards Guide answer, look-alikes, clips, publish) |
| `analytics/AnalyticsView.tsx` `[D]` | Charts from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback, starter script |
| `shell/{AppHeader,AppSidebar}.tsx` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- `app.yaml` — command, env (`DEMO_CATALOG/SCHEMA`, `DASHBOARD_ID`, `GENIE_SPACE_ID`, `WRITER_MODEL`, …); OBO scopes come from `databricks.yml` `user_api_scopes`
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `finalize_app.sh` (fill app.yaml from the setup job output),
  `lakebase_setup_db.sh`, `lakebase_grant_app_credential.sh`, `deploy.sh` (standalone deploy without the bundle)
- `start.sh` — local run
