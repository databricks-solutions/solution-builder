# TechRobotics PdM Control Room — Predictive Maintenance Copilot

An **operational AI application** where the agent investigates asset failure risk,
roots it in maintenance history and plant manuals, finds related machines, and books
work orders with approved parts and windows — all in one conversation. Lakebase,
MLflow, SQL warehouse, a Genie agent (tables + plant manuals), and an OpenAI Agents SDK brain,
all stitched into a single reliability engineering UX.

The app reads a failure-risk model (`failure_risk_model@champion`, trained on a year
of plant telemetry), pairs it with CMMS maintenance history, searches plant manuals
(engineering standards, CAPA reports), and writes transactional work orders to Lakebase
with cost-avoided calculation.

> **Start here →** [`TEMPLATE_MAP.md`](./TEMPLATE_MAP.md) — comprehensive map of
> every file, schema, route, agent tool, and component. Read it instead of scanning
> the codebase.

---

## Why this app exists

There's a natural arc for an operational AI system in manufacturing:

1. **Model scores the risk** → a failure-risk model trained on sensor telemetry
   flags assets at risk of failure.
2. **Root-cause it** → pair the model score with maintenance history + plant
   manuals (engineering standards, CAPA reports) to explain *why* the asset
   is drifting and which other machines got the same bad maintenance event.
3. **Plan the fix** → search MRO inventory and maintenance windows, check
   part availability and window capacity, draft work orders with crew and cost.
4. **Book it** → agent writes work orders to Lakebase (transactional, with part
   reservations and window booking) and calculates unplanned cost avoided.
5. **Trust it** → every decision traced in MLflow; live KPIs; dashboard for
   plant management; Genie for ad-hoc questions.

This app bakes in that full arc for manufacturing predictive maintenance. When you
adapt it to a different operational domain, you're mostly rewriting
`config/app.json` + the agent in `server/agent/pdmops.ts` + the Lakebase schema.
The chrome (conversations, streaming, thinking panel, feedback, trace links,
Lakebase mirror, Delta sync, MLflow init, dashboard embed) comes along for free.

## What it shows off

| Databricks capability     | Where you see it                                     |
| ------------------------- | ---------------------------------------------------- |
| **Lakebase Postgres**     | OLTP mirror of lakehouse data + transactional work orders; agent writes land here, transactional, under Unity Catalog governance. `server/db/`                                  |
| **Delta → Lakebase sync** | One-shot pull at boot via the Databricks SQL API. Mirrors asset health, maintenance history, parts inventory, windows. `server/db/sync.ts`                                                                               |
| **OpenAI Agents SDK**     | Responses API + reasoning summaries + tool-calling loop, pointed at a Databricks model endpoint. `server/agent/pdmops.ts`                         |
| **Genie agent**           | Exposed as the `ask_data` tool (Agent mode): OEE, downtime, MTBF, failure analytics over the tables AND the plant manuals volume (standards, CAPA, procedures), cited; steps streamed into the Thinking panel. `server/agent/tools/genie.ts` |
| **MLflow tracing**        | Every agent run emits a root + per-tool + per-LLM span. Agent traces linked from the header. `server/lib/mlflow.ts`                |
| **MLflow assessments**    | 👍 / 👎 on any message writes a HUMAN-source assessment against the trace, with optional rationale. `client/src/chat/FeedbackRow.tsx`               |
| **SQL warehouse**         | KPI queries (line OEE, MTBF, downtime) run via AppKit's `analytics` plugin; warehouse name + state shown in the header.                      |
| **AI/BI dashboard embed** | Published Lakeview dashboard for plant management (Line 2 OEE, asset risk, root-cause trends). `client/src/dashboard/DashboardView.tsx`                                                |
| **OBO auth**              | Every outbound call uses `x-forwarded-access-token` in prod, SDK chain in dev. `server/lib/auth.ts`                                                 |

## What the user experiences

- **Control room** — a plant-floor HMI on a dark instrument-panel theme: a plant status strip (risk counts,
  $ at risk, cost avoided), the production-line schematic (every machine is a tile on its line, colored by ML
  risk tier, with a bottleneck badge), a priority-asset panel (remaining-useful-life gauge + drivers), and the
  work-order event log.
- **Floating assistant dock** — bottom-right on every page. One persistent
  conversation per user; survives reload; scoped by `user_email`.
- **Full-page chat** — `/c/:id` for the dedicated view; same backend, same
  Thinking panel, same Feedback row.
- **Live reasoning + tools** — the Thinking panel (top-right) streams live
  reasoning tokens, tool calls, and tool outputs. When the agent's `ask_data`
  tool asks the Genie agent, each SQL statement and manuals search is bubbled up and streamed in real time — so the user
  *watches* the agent investigate root cause + confirm the failure mode.
- **Asset drawer** — click a tile to see condition trend (vibration, temperature
  vs baseline), maintenance history with highlighted red substitute lubricant
  notes, failure history with CAPA cross-links. An "Ask the assistant" banner
  opens the dock with a scripted prompt.
- **Work orders** — a write-capable queue of booked maintenance. Agent writes
  land here live (the page auto-refetches on stream completion). Approve/Complete/Cancel
  actions release parts and window hours if cancelled.
- **Dashboard** — embedded Lakeview dashboard (plant manager view: Line 2 OEE,
  MTBF by asset type, fleet-risk table, robot PMs by lubricant).
- **Header pills** — "Agent traces ↗" deep-links to the
  MLflow experiment. "Reset demo" truncates the Lakebase mirror and re-syncs from Delta.

## Adapting to a new operational domain

Six files + one folder do most of the work. In order:

1. **`config/app.json`** — app name, starter prompts, `assistantScript`
   (the 4-beat demo script with trigger keywords), data backend (the Genie
   agent id), MLflow experiment path, SQL warehouse, dashboard ID,
   Delta source tables. This is the storytelling layer.

2. **`server/db/schema.ts`** — reshape the "Delta mirror" group (assets,
   asset trend, maintenance history, failures, work orders, spare parts, windows)
   to your domain entities. Keep the "chat state" group (conversations, messages, feedback) verbatim.

3. **`server/db/sync.ts`** — rewrite the SELECTs that populate the mirror from your Delta tables.

4. **`server/db/queries/pdm.ts`** — rename to your domain. Rewrite lookup + update helpers
   used by the agent's tools (e.g., asset risk list, part search, work-order booking)
   and the ops page routes.

5. **`server/agent/pdmops.ts`** — rename to your domain. Rewrite `makeTools(ctx)`
   (Zod-schema'd tool defs) and the `instructions` string. Keep `configureAgentsSdk()` as-is — it
   handles the Databricks Responses API wiring, the `Connection: close` header workaround,
   and the 64-char `input[*].id` strip (needed for model compatibility).
   On any non-2xx response from the model endpoint, the shim now retries once with
   the app service principal (OBO -> SP) for 401/403 failures.

6. **`client/src/`** — your surfaces. Machine tiles + drawer in `home/HomeView.tsx`,
   work-order table in `operations/WorkOrdersTable.tsx`, KPIs in `KpiCards.tsx`,
   tabs in drawers, chart queries in `analytics/ChartsView.tsx`.

The rest (`chat/`, `shell/`, `home/JourneyDiagram`, `lib/`, route wiring,
Drizzle migrations, MLflow init, sync runner, auth, AppKit plugins) is
generic and should not need changes.

## Architecture at a glance

```
Browser ── SSE ── Express (AppKit server plugin)
                     │
                     ├── /api/chat/stream
                     │     └── OpenAI Agents SDK (pdmops agent)
                     │           tools:
                     │            get_fleet_risk            ── Lakebase (ML scores + PM history)
                     │            get_asset_details         ── Lakebase (condition trend + CMMS history)
                     │            find_pm_batch             ── Lakebase (same PM vendor cohort)
                     │            ask_data                  ── Genie agent (OEE analytics + standards, CAPA)
                     │            check_parts               ── Lakebase (MRO inventory)
                     │            list_windows              ── Lakebase (maintenance windows)
                     │            book_work_order (WRITE)   ── Lakebase (transactional: WO + parts + window)
                     │
                     ├── /api/conversations  ── Lakebase
                     ├── /api/pdm/*          ── Lakebase (assets, work orders)
                     ├── /api/me, /api/config, /api/warehouse
                     ├── /api/messages/:id/feedback  ── MLflow assessments
                     └── /api/admin/reset    ── truncate + re-sync
                            │
                            └── Delta (Unity Catalog) ── SQL API ── asset_health_current / asset_health_features
                                                                      maintenance_work_orders / failure_events
                                                                      spare_parts / maintenance_windows
                                                                      (Lakebase mirrors these; failure_risk_model scores pulled daily)

MLflow experiment (linked in the header):
  - Agent traces   ← OpenAI Agents SDK + per-tool spans (via mlflow-tracing)
```

---

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI
- A Databricks workspace with:
  - A **Lakebase** Postgres instance (enabled on the app)
  - A **SQL warehouse** (for KPI queries)
  - A **Genie agent** over the tables + the plant manuals volume (created by the setup job)
  - A **Genie-enabled model endpoint** (e.g., `databricks-gpt-5-4`, supporting Responses API)
  - A Lakeview / AI/BI dashboard to embed (optional but recommended)
  - Unity Catalog access to the source Delta tables (asset_health_current, maintenance_work_orders, etc.)
  - A UC volume with plant manuals (PDFs)

## Local development

```bash
cp .env.example .env
# edit .env:
#   DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
#   (Lakebase envs are injected by `databricks apps run-local` / deploy)

databricks auth login --host https://your-workspace.cloud.databricks.com
npm install
./start.sh              # frees the port, kills stale tsx/vite watchers, runs `npm run dev`
# or just:
npm run dev
```

Open `http://localhost:8765`. The first boot runs Drizzle migrations and syncs
Delta → Lakebase (~10s for a few thousand rows).

## Deploy

Standard AppKit flow:

```bash
databricks bundle validate
databricks bundle deploy
databricks bundle run <APP_NAME> -t dev
```

See `databricks.yml` + `app.yaml`.

## Key commands

```bash
./start.sh            # clean-restart dev server
npm run typecheck     # type-check client + server
npm run db:generate   # regenerate Drizzle migration after schema.ts edits
npm run lint          # eslint
npm run format        # prettier
npm run build         # production bundle
```

## Project layout

```
config/app.json               # App name, script, data backend, dashboard, warehouse
server/
  server.ts                   # Boot: plugins, migrations, Delta sync, MLflow
  agent/pdmops.ts             # OpenAI Agents SDK agent + tools (get_fleet_risk, get_asset_details, …)
  chat-stream/                # SSE dispatcher (agent tool streaming)
  db/{schema,sync,migrate,queries/}   # Lakebase layer
       pdm.ts                 # Queries: fleet risk, asset details, PM batch, parts, windows, book WO
  routes/                     # Express routes (config, chat, pdm, …)
  lib/{auth,endpoint,mlflow,templates,user}   # shared helpers
client/src/
  App.tsx                     # Router + layout (Sidebar / Header / ChatDock)
  home/HomeView.tsx           # HMI: status strip + line schematic + RUL priority panel + event log
  chat/                       # ChatView (full page) + ChatDock (floating)
                              # + ThinkingPanel + FeedbackRow + streamChat
  operations/                 # Work orders table + drawer with tabs (write surface)
  analytics/                  # Warehouse-backed KPI charts
  dashboard/                  # Embedded Lakeview iframe
  shell/{AppSidebar,AppHeader}.tsx   # Navigation + Databricks-context pills
  lib/                        # Fetch helpers + client store
drizzle/                      # Generated migrations (committed)
```

## Tech stack

- **Backend** — Node.js, Express (via `@databricks/appkit`), Drizzle ORM,
  OpenAI Agents SDK, mlflow-tracing
- **Frontend** — React, TypeScript, Vite, Tailwind, AppKit UI / shadcn
- **Data** — Databricks Lakebase (Postgres), Delta (via SQL warehouse),
  MLflow experiments
