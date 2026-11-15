# MedVault PA Copilot — Prior Authorization Automation

An **operational AI application** where the agent reviews prior authorization (PA)
requests against medical policies, auto-approves eligible cases, drafts provider
requests for missing documentation, and writes decisions back to the data warehouse
— all in one conversation. Lakebase, MLflow, SQL warehouse,
AI Functions, a Genie agent (tables + policy documents), and an OpenAI Agents SDK brain, all stitched into a single
payer UM (utilization-management) workbench.

The app reads an open PA queue (pre-indexed clinical notes, member data, provider
info), runs AI Functions to extract policy criteria evidence from notes, identifies
auto-approval-eligible cases, and routes the rest to nurse or Medical Director review
with auto-drafted provider requests — all traced in MLflow and written back to Delta.

> **Start here →** [`TEMPLATE_MAP.md`](./TEMPLATE_MAP.md) — comprehensive map of
> every file, schema, route, agent tool, and component. Read it instead of scanning
> the codebase.

---

## Why this app exists

There's a natural arc for a UM (utilization-management) AI system at a health plan:

1. **Route cases fast** → AI Functions read clinical notes and extract evidence
   against policy criteria; cases split into auto-approve, nurse-review, and
   physician-review lanes.
2. **Respect compliance** → CMS-0057-F requires decisions within 72h (expedited)
   or 7 days (standard); SLA clocks must be visible, over-deadline cases flagged.
3. **Draft provider requests** → when a case lacks documentation, auto-draft a
   letter to the provider asking for specifics (no LLM hallucination — exact
   criteria from policy).
4. **Write decisions back** → approvals, denials, and pending-for-info decisions
   land in Lakebase and Delta; CMS metrics (approval rate, turnaround time,
   clean-on-first-review %) update live.
5. **Trust the system** → every decision traced in MLflow; nurse/physician
   thumbs-up/down logged as human assessments; audit trail stored with the case.

This app bakes in that full arc for healthcare prior authorization. When you
adapt it to a new operational domain (claims triage, claims appeals, credential
verification, utilization monitoring, etc.), you're mostly rewriting
`config/app.json` + the agent in `server/agent/paops.ts` + the Lakebase schema.
The chrome (conversations, streaming, thinking panel, feedback, trace links,
Lakebase mirror, Delta sync, MLflow init, dashboard embed) comes along for free.

## What it shows off

| Databricks capability     | Where you see it                                     |
| ------------------------- | ---------------------------------------------------- |
| **Lakebase Postgres**     | OLTP mirror of the PA queue + decisions; agent writes land here, transactional, under Unity Catalog governance. `server/db/`                                  |
| **Delta → Lakebase sync** | One-shot pull at boot via the Databricks SQL API (pa_requests, clinical_notes, members, providers, policies). `server/db/sync.ts`                                                                               |
| **OpenAI Agents SDK**     | Responses API + reasoning summaries + tool-calling loop, pointed at a Databricks model endpoint. `server/agent/paops.ts`                         |
| **AI Functions**          | `ai_query` runs across pre-extracted clinical-note evidence to classify cases (auto-approve lane, nurse, physician). `server/lib/ai-functions.ts` |
| **Genie agent**           | Exposed as the `ask_data` tool (Agent mode): CMS metrics over the tables (approval %, turnaround, denials by policy, pend drivers) AND the medical policy documents volume (rule details, criteria, denial authority), cited. `server/agent/tools/genie.ts` |
| **MLflow tracing**        | Every agent run emits a root + per-tool + per-LLM span. Agent traces linked from the header. `server/lib/mlflow.ts`                |
| **MLflow assessments**    | 👍 / 👎 on any message writes a HUMAN-source assessment against the trace, with optional rationale. `client/src/chat/FeedbackRow.tsx`               |
| **SQL warehouse**         | Analytics page runs CMS metrics (expedited/standard compliance, clean-on-first-review %) via AppKit's `analytics` plugin.                      |
| **AI/BI dashboard embed** | Published Lakeview dashboard (2 pages: compliance KPIs + drill-downs by policy/practice/decision path). `client/src/dashboard/DashboardView.tsx`                                                |
| **OBO auth**              | Every outbound call uses `x-forwarded-access-token` in prod, SDK chain in dev. `server/lib/auth.ts`                                                 |

## What the user experiences

- **Briefing page** (`/`) — a triage board: four lanes (auto-approve / nurse fast-track / request info / physician review) of request cards, each with its CMS SLA clock and criteria-met ticks; KPI strip above, auto-approval release button in the header. Weekend-fax backlog tile in the KPI strip; entry to the agent via starter chips and the "Release auto-approvals" button.
- **Worklist** (`/worklist`) — open PA queue sorted by SLA clock (red overdue, amber
  at-risk). Filter by urgency (expedited/standard), decision lane, practice group,
  policy. Click a case to open the drawer.
- **Case drawer** — clinical summary with evidence highlighted + tagged by policy
  criterion (C1, C2, C3, etc.), provider request letter (auto-drafted if missing docs),
  decision buttons (Approve / Pend / Deny — deny only for Medical Director), activity
  timeline. An "Ask the medical policy" button opens the dock with context.
- **Case detail page** (`/case/:id`) — full-page case view with same evidence + letter
  + decision trail + linked member record + prior PA history + provider profile.
- **Floating assistant dock** — bottom-right on every page. One persistent
  conversation per user; survives reload; scoped by `user_email`.
- **Full-page chat** — `/c/:id` for the dedicated view; same backend, same
  Thinking panel, same Feedback row.
- **Live reasoning + tools** — the Thinking panel (top-right) streams live
  reasoning tokens, tool calls, and tool outputs. When the agent calls `ask_data`
  (the Genie agent), each SQL statement and document search is bubbled up and
  streamed in real time — so the user *watches* the agent find policy rules + query
  CMS metrics while it works.
- **Analytics** — warehouse-backed CMS metrics (expedited/standard compliance %,
  turnaround by decision path, pend rate by practice group, top pend reasons).
- **Dashboard** — embedded Lakeview dashboard (page 1: CMS compliance KPIs + trends;
  page 2: drill-downs by policy + practice + decision path).
- **Header pills** — "Agent traces ↗" deep-links to the
  MLflow experiment. "Reset demo" truncates the Lakebase mirror and re-syncs from Delta.

## Adapting to a new payer operational domain

Six files + one folder do most of the work. In order:

1. **`config/app.json`** — app name, starter prompts, `assistantScript`
   (the 4-beat PA review script with trigger keywords), data backend (the Genie
   agent id), MLflow experiment path, SQL warehouse, dashboard ID,
   Delta source tables. This is the storytelling layer.

2. **`server/db/schema.ts`** — reshape the "Delta mirror" group (pa_requests,
   clinical_notes, members, providers, medical_policies, policy_criteria, ai_case_review,
   ai_criteria_evidence) to your domain entities (claims, appeals, credential requests,
   utilization reviews, etc.). Keep the "chat state" group (conversations, messages, feedback) verbatim.

3. **`server/db/sync.ts`** — rewrite the SELECTs that populate the mirror from your Delta tables.

4. **`server/db/queries/cases.ts`** — rename to your domain. Rewrite lookup + update helpers
   used by the agent's tools (queue overview, case details, auto-approval lane, write decisions)
   and the worklist/case routes.

5. **`server/agent/paops.ts`** — rename to your domain. Rewrite `makeTools(ctx)`
   (Zod-schema'd tool defs: case summary, case detail, auto-approval candidates, auto-approve batch,
   ask policy, ask genie) and the `instructions` string. Keep `configureAgentsSdk()` as-is — it
   handles the Databricks Responses API wiring, the `Connection: close` header workaround,
   and the 64-char `input[*].id` strip. On any non-2xx response, the shim retries once with
   the app service principal (OBO -> SP) for 401/403 failures.

6. **`client/src/`** — your surfaces. Case list in `worklist/WorklistView.tsx`,
   case drawer + evidence highlight in `case/CaseDrawer.tsx`, decision buttons + timeline tabs,
   KPIs in `briefing/BriefingView.tsx`, auto-approval lane bar.

The rest (`chat/`, `shell/`, `home/JourneyDiagram`, `lib/`, route wiring,
Drizzle migrations, MLflow init, sync runner, auth, AppKit plugins) is
generic and should not need changes.

## Architecture at a glance

```
Browser ── SSE ── Express (AppKit server plugin)
                     │
                     ├── /api/chat/stream
                     │     └── OpenAI Agents SDK (paops agent)
                     │           tools:
                     │            queue_overview            ── Lakebase (case summary + lane breakdown)
                     │            get_case                  ── Lakebase (full case + clinical notes + evidence)
                     │            auto_approval_candidates  ── Lakebase (cases in auto-approve lane)
                     │            auto_approve_batch (WRITE)── Lakebase (approve lane; write decisions)
                     │            ask_data                  ── Genie agent (CMS metrics + medical policy docs)
                     │
                     ├── /api/conversations  ── Lakebase
                     ├── /api/cases/*        ── Lakebase (worklist, case detail, decisions)
                     ├── /api/me, /api/config, /api/warehouse
                     ├── /api/messages/:id/feedback  ── MLflow assessments
                     └── /api/admin/reset    ── truncate + re-sync
                            │
                            └── Delta (Unity Catalog) ── SQL API ── healthcare_lifesciences.prior_auth_automation.*
                                                                      (pa_requests, clinical_notes, members, providers,
                                                                       medical_policies, policy_criteria,
                                                                       ai_case_review, ai_criteria_evidence,
                                                                       um_decisions [write-back])
                                                                      (Lakebase mirrors these; AI Functions pre-extract evidence)

MLflow experiment (linked in the header):
  - Agent traces   ← OpenAI Agents SDK + per-tool spans (via mlflow-tracing)
```

---

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI
- A Databricks workspace with:
  - A **Lakebase** Postgres instance (enabled on the app)
  - A **SQL warehouse** (for CMS metrics queries)
  - A **Genie agent** over the tables + the medical policy documents volume (created by the setup job)
  - A **Genie-enabled model endpoint** (e.g., `databricks-gpt-5-4`, supporting Responses API)
  - **AI Functions** (`ai_query`) configured to extract clinical-note evidence against policy criteria
  - A Lakeview / AI/BI dashboard to embed (optional but recommended)
  - Unity Catalog access to the source Delta tables (pa_requests, clinical_notes, members, providers, policies)
  - A UC volume with policy documents (PDFs)

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
  agent/paops.ts              # OpenAI Agents SDK agent + tools (queue_overview, get_case, auto-approve…)
  chat-stream/                # SSE dispatcher (agent tool streaming)
  db/{schema,sync,migrate,queries/}   # Lakebase layer
       cases.ts               # Queries: queue, case detail, auto-approval lane, write decisions
  routes/                     # Express routes (config, chat, cases, …)
  lib/{auth,endpoint,mlflow,templates,user,ai-functions,writeback}  # shared helpers
client/src/
  App.tsx                     # Router + layout (Sidebar / Header / ChatDock)
  briefing/BriefingView.tsx   # Hero KPIs + pre-review lanes bar + auto-approval release button
  chat/                       # ChatView (full page) + ChatDock (floating)
                              # + ThinkingPanel + FeedbackRow + streamChat
  worklist/                   # Case queue (sorted by SLA clock) + CaseDrawer (evidence highlight + decision buttons)
  case/                       # Full-page case view + clinical summary + provider letter + timeline
  analytics/                  # Warehouse-backed CMS metrics (compliance %, turnaround, pend drivers)
  dashboard/                  # Embedded Lakeview iframe (2 pages: KPIs + drill-downs)
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
