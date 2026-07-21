# Action-Taking Agent — Databricks App Template

A **template** for building a Databricks App where AI doesn't just analyze — it
*acts*. One person, one conversation, the whole workflow: investigate, decide,
execute. Lakebase, MLflow, SQL warehouse, MAS, and an OpenAI Agents SDK brain,
all stitched into a single UX.

The current use case is a D2C-beauty returns-operations demo (LuxeBeauty —
Claire handles bad-lot returns). **Treat the use case as skin, not bone.** The
underlying template works for any write-capable operational scenario (claims
triage, billing disputes, support escalations, inventory reconciliation,
credit-decision review, …).

> **Start here →** [`TEMPLATE_MAP.md`](./TEMPLATE_MAP.md) — comprehensive map of
> every file, schema, route, tool, and component. Read it instead of scanning
> the codebase.

---

## Why this template exists

There's a natural arc for a "mature" AI app on top of Databricks:

1. **See what's happening** → warehouse-backed analytics on lakehouse data.
2. **Ask why** → a multi-agent supervisor that can query data and read
   documents (Genie + vector search via MAS).
3. **Take action** → an agent with *tools*: real DB writes, emails,
   approvals. All gated by human confirmation.
4. **Trust the system** → every turn traced in MLflow; thumbs-up/down
   captured as assessments; audit trail stored next to the row it mutated.

This template bakes in that full arc. When you repurpose it, you're mostly
rewriting `config/app.json` + the agent in `server/agent/*.ts`. The chrome
(conversations, streaming, thinking panel, feedback, trace links, Lakebase
mirror, Delta sync, MLflow init, dashboard embed) comes along for free.

## What it shows off

| Databricks capability     | Where you see it                                     |
| ------------------------- | ---------------------------------------------------- |
| **Lakebase Postgres**     | OLTP mirror of lakehouse data; agent writes land here, transactional, under Unity Catalog governance. `server/db/`                                  |
| **Delta → Lakebase sync** | One-shot pull at boot via the Databricks SQL API. `server/db/sync.ts`                                                                               |
| **OpenAI Agents SDK**     | Responses API + reasoning summaries + tool-calling loop, pointed at a Databricks model endpoint. `server/agent/refundops.ts`                         |
| **Multi-Agent Supervisor**| Exposed as an `ask_data` tool; MAS activity (sub-agent calls, SQL results, KA retrieval) streamed live into the Thinking panel. `server/chat-stream/` |
| **MLflow tracing**        | Every agent run emits a root + per-tool + per-LLM span. Two experiments (agent + MAS) linked from the header. `server/lib/mlflow.ts`                |
| **MLflow assessments**    | 👍 / 👎 on any message writes a HUMAN-source assessment against the trace, with optional rationale. `client/src/chat/FeedbackRow.tsx`               |
| **SQL warehouse**         | Analytics page runs typed queries via AppKit's `analytics` plugin; warehouse name + state shown in the header to make it real.                      |
| **AI/BI dashboard embed** | Published Lakeview dashboard dropped in an iframe with SSO. `client/src/dashboard/DashboardView.tsx`                                                |
| **OBO auth**              | Every outbound call uses `x-forwarded-access-token` in prod, SDK chain in dev. `server/lib/auth.ts`                                                 |

## What the user experiences

- **Home page** — a persona + story + 4-card journey. Each card wires into the
  floating assistant (or routes to another page). One click and the demo runs.
- **Floating assistant dock** — bottom-right on every page. One persistent
  conversation per user; survives reload; scoped by `user_email`.
- **Full-page chat** — `/c/:id` for the dedicated view; same backend, same
  Thinking panel, same Feedback row.
- **Live reasoning + tools** — the Thinking panel (top-right) streams live
  reasoning tokens, tool calls, and tool outputs. When the agent's `ask_data`
  tool hits the MAS, MAS's sub-agent activity is bubbled up and streamed in
  real time too — so the user *watches* the agent query data + read incident
  reports while it works.
- **Operations page** — a write-capable queue (returns, in the current use
  case). Agent writes land here live (the page auto-refetches on stream
  completion). An "Ask the assistant about this spike" banner opens the dock
  with a scripted prompt.
- **Analytics** — warehouse-backed charts + facility/lot breakdowns.
- **Dashboard** — embedded Lakeview dashboard.
- **Header pills** — "Agent traces ↗" / "MAS traces ↗" deep-link to the
  MLflow experiments. "Reset demo" truncates the Lakebase mirror and
  re-syncs from Delta.

## Repurposing for a new use case

Five files + one folder do most of the work. In order:

1. **`config/app.json`** — hero persona, story headline/situation/goal, 4-card
   journey quotes, starter prompts, featured action, `assistantScript`
   (the 3-step scripted chain the chip walker surfaces), MAS endpoint name,
   MLflow experiment path, SQL warehouse, dashboard ID, Delta source tables.
   This is the storytelling layer.

2. **`server/db/schema.ts`** — reshape the "Delta mirror" group (customers,
   orders, returns today) to whatever your domain entities are. Keep the
   "chat state" group (conversations, messages, feedback) verbatim.

3. **`server/db/sync.ts`** — rewrite the SELECTs that populate the mirror.

4. **`server/db/queries/<yourDomain>.ts`** — lookup + update helpers used by
   the agent's tools and the Operations page routes.

5. **`server/agent/<yourAgent>.ts`** — rename `refundops.ts` to something
   domain-appropriate. Rewrite `makeTools(ctx)` (Zod-schema'd tool defs)
   and the `instructions` string. Keep `configureAgentsSdk()` as-is — it
   handles the Databricks Responses API wiring, the `Connection: close`
   header workaround, and the 64-char `input[*].id` strip (see the
   comment in-file for why).

6. **`client/src/operations/`** — your write-surface. Columns in
   `ReturnsTable.tsx`, tabs in `ReturnDrawer.tsx`, KPIs in `KpiCards.tsx`.

The rest (`chat/`, `shell/`, `home/JourneyDiagram`, `lib/`, route wiring,
Drizzle migrations, MLflow init, sync runner, auth, AppKit plugins) is
generic and should not need changes.

## Architecture at a glance

```
Browser ── SSE ── Express (AppKit server plugin)
                     │
                     ├── /api/chat/stream
                     │     ├── mode=agent  → OpenAI Agents SDK
                     │     │                   tools:
                     │     │                    find_returns_for_lot      ── Lakebase (returns + churn_risk JOIN)
                     │     │                    find_lot_premium_breakdown  ── Lakebase (ML tier split)
                     │     │                    create_coupon             (pure, called per tier)
                     │     │                    process_return_batch      ── Lakebase write, tier-aware
                     │     │                    ask_data                  ── MAS endpoint (streaming)
                     │     └── mode=mas    → raw MAS passthrough
                     │
                     ├── /api/conversations  ── Lakebase
                     ├── /api/returns*       ── Lakebase
                     ├── /api/me, /api/config, /api/warehouse
                     ├── /api/messages/:id/feedback  ── MLflow assessments
                     └── /api/admin/reset    ── truncate + re-sync
                            │
                            └── Delta (Unity Catalog) ── SQL API ── app.customers / app.orders / app.returns / app.customer_premium
                                                                      (Lakebase mirror; churn_risk is the ML model's predictions table, read-only from the app)

MLflow experiments (two, linked in the header):
  - Agent traces   ← OpenAI Agents SDK + per-tool spans (via mlflow-tracing)
  - MAS traces     ← returned by the MAS endpoint in `databricks_output.trace`
```

---

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI
- A Databricks workspace with:
  - A **Lakebase** Postgres instance (enabled on the app)
  - A **SQL warehouse** (for the analytics plugin)
  - A deployed **MAS** serving endpoint (or any agent endpoint supporting the
    Responses API)
  - A Lakeview / AI/BI dashboard to embed (optional but recommended)
  - Unity Catalog access to the source Delta tables

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
config/app.json               # Story + wiring knobs (storytelling layer)
server/
  server.ts                   # Boot: plugins, migrations, Delta sync, MLflow
  agent/refundops.ts          # OpenAI Agents SDK agent + tools
  chat-stream/                # SSE dispatcher (agent vs MAS paths)
  db/{schema,sync,migrate,queries/}   # Lakebase layer
  routes/                     # Express routes (config, chat, returns, …)
  lib/{auth,endpoint,mlflow,templates,user}   # shared helpers
client/src/
  App.tsx                     # Router + layout (Sidebar / Header / ChatDock)
  home/HomeView.tsx           # Hero + story + journey diagram + starter chips
  chat/                       # ChatView (full page) + ChatDock (floating)
                              # + ThinkingPanel + FeedbackRow + streamChat
  operations/                 # Queue + drawer with tabs (write surface)
  analytics/                  # Warehouse-backed charts
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
