# TEMPLATE_MAP — Threat Hunting Copilot app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to
the Cascadia SOC threat-hunting story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/copilot.ts` `[D]` | Chat-dock agent (OpenAI Agents SDK → Databricks Responses API): system prompt + tools `ask_data` (Genie agent: telemetry + IR playbook), `find_leads`; OpenAI client fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie Agent API (Agent mode, SSE: SQL + document search, cited), streams progress into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (MLflow span + progress events) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `services/investigate.ts` `[D]` | The investigation agent: chat-completions tool loop (Claude Sonnet) over parameterized SQL pivots (sign-ins, VPN, EDR, DNS, UEBA, travel, tickets) + the IR playbook (Genie agent, documents) → `submit_investigation` (verdict, timeline, ATT&CK, containment) |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, leads, incident_cases |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the open UEBA leads; `execSql` (warehouse, named parameters) |
| `db/queries/*` | Drizzle queries for chat + leads / incident cases |
| `db/{index,init,migrate}.ts` | Pool, schema bootstrap, drizzle migrations |
| `routes/leads.ts` `[D]` | `/api/leads`, `/summary`, `/:id`, `/:id/evidence`, `POST …/investigate` (SSE), `POST …/case`, `POST …/close`, `/api/cases` |
| `routes/chat.ts` | Conversations CRUD, `/api/chat/stream`, feedback |
| `routes/charts.ts` `[D]` | `/api/charts/:key` → `config/queries/<key>.sql` (spray_daily, rule_efficacy, soc_kpis) |
| `routes/activity.ts` `[D]` | Recent workbench activity for Home |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables + re-syncs from Delta ("Reset demo") |
| `routes/{config,dev-log}.ts` | `/api/config`, `/api/me`, `/api/resources`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally) + `authedFetch` (retries once as the app SP on 401/403) |
| `lib/serving.ts` | Document Q&A via the Genie agent (`askDocuments`) + JSON chat-completion helpers |
| `lib/{mlflow,logger,user,endpoint,templates}.ts` | Tracing/feedback, log gating, viewer identity, text helpers |

## Client (`client/src/`)
| File | Role |
|---|---|
| `App.tsx`, `main.tsx` | Router: `/`, `/leads`, `/leads/:id`, `/cases`, `/analytics`, `/dashboard`, `/c/:id` |
| `home/HomeView.tsx` `[D]` | SOC console: queue ticker, UEBA risk leaderboard, priority-lead swimlane timeline, ATT&CK tactic matrix (`soc/attack-matrix.tsx`, data from `config/queries/attack_matrix.sql`), Copilot query rail, workbench log |
| `soc/{LeadsView,LeadWorkbench,CasesView,ui,api}.tsx` `[D]` | Lead queue, lead workbench (UEBA trend, raw evidence, investigation, ATT&CK, containment, write-back), incident cases |
| `analytics/AnalyticsView.tsx` `[D]` | Spray chart + rule efficacy from `config/queries/*.sql` |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard (CISO) |
| `chat/*` | Chat dock + full-page chat, streaming, Thinking panel, feedback |
| `shell/{AppHeader,AppSidebar}.tsx` `[D]` | Header (Reset demo) + sidebar (nav, conversations) |
| `lib/*`, `index.css` `[D]` | API client, brand tokens (`--brand-1..5`), events |

## Config + scripts
- App config (command, OBO scopes, env `DEMO_CATALOG/SCHEMA`, `DASHBOARD_ID`, `INVESTIGATION_MODEL`, …) lives in the bundle
  (`databricks.yml` → `apps.threat_hunting_app.config`); the Genie agent id is read at boot from
  `<catalog>.<schema>.demo_resources` (`server/services/resources.ts`), written by the setup job
- `config/app.json`, `config/queries/*.sql` `[D]` — AppKit config + analytics SQL
- `scripts/build-app.sh` (bundle artifact build), `db-generate.js` (Drizzle migrations with a pinned baseline id),
  `lakebase_setup_db.sh`, `lakebase_grant_app_credential.sh`, `deploy.sh` (standalone deploy without the bundle)
- `start.sh` — local run
