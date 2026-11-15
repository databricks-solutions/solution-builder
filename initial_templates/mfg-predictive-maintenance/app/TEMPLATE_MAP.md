# App Template Map

Reference for agents customizing this template. Read this instead of scanning every file.

## What this app is (functional)

This is the **operations surface** for predictive maintenance — the place where the AI investigates asset failure risk, roots it in maintenance history and manuals, finds the fix, and books the work under human approval. It pairs with a failure-risk model (trained on sensor telemetry), a Genie agent (analytics over the tables + the plant manuals), and an AI/BI dashboard (plant manager view). Its unique job: show the reliability engineer investigating a drifting asset, confirming root cause, scoping the fleet impact, and booking transactional work orders with cost-avoided calculation — with every decision traced in MLflow.

**Canonical demo arc** (TechRobotics PdM example, transferable to any predictive maintenance domain):
1. User opens the Control Room, sees KPIs (1 Critical, 2 Watch assets, $224K risk), the priority alert (RA-207 at 94 risk).
2. User clicks the RA-207 tile → asset drawer shows condition trend (J3 vibration 2.6× baseline), the red-flagged PM (substitute grease).
3. User clicks "Which machine should I worry about?" → agent calls `get_fleet_risk`, `get_asset_details`, `ask_data` (the Genie agent over the manuals) → investigates and confirms the root cause (wrong lubricant per engineering standard ES-ROB-014).
4. User asks "Is it just RA-207?" → agent calls `find_pm_batch` → finds RA-211 (drifting), RA-214 (model says Healthy, but got the same bad grease — the trap).
5. User asks "Plan the fix in Saturday's window" → agent calls `list_windows`, `check_parts`, `ask_data` → returns a plan (3 work orders, crew, reserved parts, $210K avoided) and **stops for approval**.
6. User approves ("Book it") → agent calls `book_work_order` three times → Lakebase writes WO-PDM-31001/2/3, reserves parts, consumes window hours, flips assets to protected.
7. Work Orders page updates live. Plant manager sees the decision in the dashboard. Genie answers follow-ups ("Which practice group drives the most downtime?").

The demo lands because the user watched the AI *take a real transactional action with calculated financial impact* under human approval — not because the agent said something clever.

## Surfaces — what each one is for

| Surface | Functional role | Customize per demo? |
|---------|-----------------|---------------------|
| **Control Room** (`/`) | Hero KPIs (asset risk counts, downtime risk, cost avoided), priority alert, plant floor tile grid (risk tier, model score, condition drift, bottleneck badge). Entry to the agent via starter chips / asset tile click. | **YES** — KPI layout, tile dimensions, asset grouping (line vs plant), alert thresholds |
| **Chat dock** (floating + `/c/:id`) | The reliability engineer's steering wheel. Scripted progression (`config.assistantScript`) with `triggerAfter` keywords unlocks each step. | **YES** — script steps + trigger keywords |
| **Asset drawer** (`/`) | Click a tile to see condition trend, maintenance history (with highlighted PM notes), failure history with CAPA cross-links, booked work orders. An "Ask the assistant" banner opens the dock. | **YES** — trend chart layout, PM table columns, drawer tabs |
| **Work Orders** (`/operations`) | The write surface — where booked work orders live. Table shows root cause, tasks, crew, window, reserved parts, status. Approve/Complete/Cancel buttons. Live refresh on agent writes. | **YES** — table columns, drawer tabs, filter dimensions (status, window, crew type) |
| **Analytics** (`/analytics`) | Light, bespoke charts over Delta (via warehouse SQL): Line OEE trend, MTBF by asset type, downtime by failure mode. Secondary to the dashboard — useful for drill-downs tied to the story. | **YES** — SQL files in `config/queries/` |
| **Dashboard** (`/dashboard`) | Embedded AI/BI iframe (plant manager view). Just a viewport onto the real dashboard. | **NO** — just set `config.dashboardId` |

## What to touch, and when

Three tiers, not two — because some defaults fit the canonical arc but don't survive every story. Use judgment.

### Tier 1 — Structural (keep unless you know what you're doing)

These are load-bearing plumbing. Break them and the app doesn't boot, or a core feature silently dies.

- **OBO auth** (`lib/auth.ts`) — Databricks identity forwarding. No demo works without it.
- **MLflow tracing wiring** (span creation, trace_id on message, feedback → assessments) — trace viewer links break if removed.
- **SSE streaming pipeline** (agent-stream → sseWrite → streamChat → useChatTurn → ThinkingPanel) — break this and the chat just hangs.
- **Delta → Lakebase sync-at-boot + reset endpoint** — without it, a fresh app has no data.
- **Drizzle migration runner on boot** — schema changes won't apply without it.
- **dbdemos usage tracker** (`lib/tracker.ts`, registered first in `appkit.server.extend`) — keep it; set a unique `config/app.json` `dbdemosAppId` (`<demo-slug>-<resource_suffix>`, see app.md). Empty = off.

### Tier 2 — Canonical defaults (the demo's "house style" — change with intent)

These fit the canonical arc (investigate → approve → act). They *usually* survive a rewrite because most maintenance / operations demos want the same shape — but swap them if the story genuinely differs.

| Default | Keep when… | Change when… |
|---------|------------|--------------|
| **4-phase chain** (investigate via data backend → root-cause via the manuals (Genie agent) → scope via fleet batch → book work orders) | Story has a "fix it" moment where the user approves action after verification | Story is read-only (pure investigation, no action) → drop phases 3–4. Story has simpler actions (single-asset fix) → collapse to 2–3 phases. |
| **Genie agent over tables + manuals** (OEE, MTBF, failure trends + standards, CAPA, procedures) | Demo has a Genie agent with a documents volume of domain manuals | No manuals → don't attach a volume; the agent answers from the tables only. |
| **`triggerAfter` keyword progression** on `assistantScript` | Linear demo script (SA clicks chips in order) | Free-form exploration demo → drop triggers, use plain prompts. |
| **Append-only audit** (`aiAuditTrail[]` JSONB on primary entity — e.g., work order) | Demo shows "the AI booked this at 10:03 AM" action + timestamp timeline | No timeline tab, no action history needed → drop the JSONB column. |
| **`dataMutated` pub-sub** | Operations page should update live when the agent writes | Read-only demo, no writes to react to → harmless but dead weight. |
| **Filter-driven bulk writes** (no echoed IDs) | Bulk action is transactional (work-order booking, multi-asset batch approvals) | Single-row actions → simplify to direct ID + write. |
| **ChatDock + Control Room chips with script** | Plant engineer is the presenter; demo is scripted | End-user-driven demo → surface the chat on its own page, drop the dock's "next chip" mechanic. |

### Tier 3 — Always rewrite per demo (content, not infra)

Every demo touches these. They're what makes your demo yours, not TechRobotics'.

- **KPIs and alerts** — hardcoded constants at the top of `client/src/home/ControlRoom.tsx`. Replace: KPI thresholds (risk tier cutoffs), alert trigger conditions, priority sort order.
- **`config/app.json`** — `branding`, `assistantScript` steps, `data.tables`, `dashboardId`, `genieSpaceId` (Genie Agent space: tables + documents volume), `mlflowExperimentPath`, `agentModel`. Each field has a `_*_help` sibling explaining what it does + which file consumes it.
- **Domain schema** (`server/db/schema.ts`) — the "Delta mirror" group swaps. Primary entities: assets → work_orders → spare_parts → maintenance_windows (in PdM); adapt to your domain (tickets, cases, claims, requests, etc.). If you keep Tier 2 audit columns, their shape is fixed; the surrounding columns are yours.
- **Agent tools** (`server/agent/pdmops.ts`) — the file is renamed per demo and the import in `chat-stream/agent-stream.ts` updated. Tool names and bodies swap; if you keep the 4-phase chain, the *shape* of the tools (fleet overview → entity details → batch lookup → manuals/genie → parts check → booking) is what's preserved.
- **Domain CRUD** (`server/db/queries/pdm.ts`, `server/routes/pdm.ts`) — all queries rewritten for your domain entities.
- **Control Room view** — tile grid layout, KPI cards, alert triggering, drawer tab content.
- **Work Orders page** — table columns, actions (Start/Complete/Cancel), filter dimensions.
- **Analytics SQL** in `config/queries/` — rewrite or delete every file for your demo's domain. 2–4 queries aligned to your story's key numbers, hitting your actual Delta tables. Until each `.sql` is updated, `/analytics` will log `TABLE_OR_VIEW_NOT_FOUND`. Also update `client/src/analytics/ChartsView.tsx` so its `queryKey` list matches.
- **Theme tokens** in `client/src/index.css` — brand palette (primary, accent, status colors).

## Adapting to a reduced capability set

Not every demo has every Databricks capability. Drop tools and surfaces that don't map:

| If demo has no… | Do this |
|-----------------|---------|
| **Documents** (no manuals) | Don't attach a volume. Arc shortens: investigate via `ask_data` (tables) + maintenance history → scope + book. |
| **ML risk model** | Drop `get_fleet_risk`. Arc shortens: investigate specific asset (`get_asset_details`) → scope batch → book. No proactive "which machines are critical?" — only reactive investigation. |
| **Fleet batch lookup** | Drop `find_pm_batch`. Agent cannot find related machines. Risk of missed scope — each asset is fixed in isolation. |
| **Part inventory** | Drop `check_parts` tool. Work-order plan cannot verify parts availability. Booking still happens, but an upstream manual must confirm crib/DC stock. |
| **Dashboard** | Remove `/dashboard` route + nav item. Demo relies on analytics charts + chat for plant manager visibility. |
| **Analytics charts** | Remove `/analytics` route; demo relies on the embedded dashboard. Or keep both (redundant but reinforcing). |
| **Write action** (read-only demo) | Drop `book_work_order`. Arc shortens to investigate → plan → approval (no execution). Less impressive — only choose this if the story is pure investigation + recommendation. |

The smallest viable demo: Control Room + Chat dock + Asset drawer + `get_asset_details` + `ask_data` + one KPI chart. Everything else is additive.

## File structure

Files marked `[D]` are domain-specific (PdM example — adapt per demo). Others are generic infrastructure.

```
config/
  app.json              [D] App name, resource IDs, data sources, assistant script steps
  queries/*.sql         [D] Analytics SQL (Delta via SQL Warehouse): line-oee.sql, mtbf-by-type.sql, etc.

server/
  server.ts                 Boot: load config → AppKit app → runDbInit (migrations + Delta sync) → MLflow init → routes
  agent/
    pdmops.ts           [D] Agent definition, tools, system prompt (OpenAI Agents SDK).
                            Renamed per demo (e.g. claimsops.ts, paops.ts). Update import in chat-stream/agent-stream.ts.
    tools/
      types.ts              Shared types for data-backend tools (ToolProgressEvent, DataCallResult, DataToolContext)
      genie.ts              askDataTool factory + callGenieAgent helper — the Genie Agent (Agent mode, SSE): SQL over the tables + search over the documents volume
  db/
    schema.ts           [D] Lakebase tables (Drizzle ORM): assets, asset_trend, maintenance_history, failures, spare_parts, maintenance_windows, work_orders, conversations, messages, feedback
    sync.ts             [D] Delta → Lakebase sync queries (asset health, maintenance history, parts, windows)
    migrate.ts              Migration runner
    init.ts                 Boot DB-init policy: migrations FATAL, Delta sync BEST-EFFORT (a missing/rebuilding source table degrades the mirror, never 503s the whole app). Unit-tested in init.test.ts.
    index.ts                DB pool init
    queries/
      chat.ts               Conversation + message CRUD
      pdm.ts            [D] Domain entity queries: listFleet, getAsset, recentPmBatch, findParts, listWindows, bookWorkOrder, etc.
  chat-stream/
    agent-stream.ts         Drives the OpenAI Agents SDK loop, translates SDK events → SSE taxonomy
    index.ts                /api/chat/stream entry point: persist user msg → sanitize history → streamAgentTurn
    sse.ts                  SSE helpers
  routes/
    chat.ts                 Conversations CRUD, streaming turns, feedback
    pdm.ts              [D] Domain entity endpoints: GET /api/pdm/assets, /api/pdm/work-orders, POST book-work-order, etc.
    config.ts               /api/config, /api/me, /api/warehouse
    activity.ts             Recent activity feed
    admin.ts                Demo reset (truncate + re-sync)
  lib/
    auth.ts                 Databricks OBO auth headers (+ SP retry on 401/403 for model endpoint)
    mlflow.ts               Experiment get-or-create, feedback → assessments
    user.ts                 User identity from request headers
    endpoint.ts             fixMojibake helper (UTF-8 / Latin-1 re-decode for streaming gateway quirks)
    templates.ts        [D] Work-order template placeholder filling (if domain uses templated text)

client/src/
  App.tsx                   Routes: / (Control Room), /c/:id (Chat), /operations, /analytics, /dashboard, /platform
  shared/types.ts       [D] Domain entity types (AssetRow, WorkOrderRow, FailureRow, etc.)
  shell/                    AppSidebar (nav), AppHeader (chrome)
  home/ControlRoom.tsx  [D] Hero KPIs, priority alert card, plant floor asset tile grid, starter chips, activity feed
  chat/                     ChatDock (floating), ChatView (full-page), ThinkingPanel, MessageBubble,
                            useChatTurn (hook), streamChat (SSE parser), script.ts, dockController, FeedbackRow
  operations/           [D] OperationsView (work orders), KpiCards, WorkOrdersTable, WorkOrderDrawer, tabs/ (Details, Tasks, Activity)
  analytics/            [D] ChartsView (warehouse-backed KPI charts: line OEE, MTBF, etc.)
  dashboard/                DashboardView (embedded AI/BI iframe from config.dashboardId)
  platform/                 PlatformView — "Databricks Data + AI" corporate pitch page (do not edit, generic)
  lib/
    api.ts                  Config + user fetch wrappers, plus shared `okOrThrow(res, label)` and `useResource(loader)` hook. EVERY fetch helper goes through okOrThrow so errors carry the server's actual message; views use useResource for boot-time loads so failures land as visible `{error, retry}` instead of "Loading…" forever.
    conversations.ts        Client conversation store (useSyncExternalStore). Exposes per-id `useConversationError(id)` so a failed `/api/conversations/:id` renders an error + Retry button in ChatView instead of a permanent empty state.
    pdm.ts              [D] Domain entity fetch wrappers (all using okOrThrow): fetchAssets, fetchWorkOrders, etc.
    events.ts               dataMutated pub/sub (invalidate on agent writes)
    usePulseOnChange.ts     Hook: returns true for ~1.5s when a scalar value changes between renders. Wired into KpiCards (counts), WorkOrdersTable rows (status), activity rows (new entries). See pattern #8.
```

## Lakebase schema (`server/db/schema.ts`)

**Chat state (generic):**
- `conversations`: id (uuid), userEmail, title, kind (`default`|`demo_dock`), timestamps
- `messages`: id (uuid), conversationId (FK), role, content, position, traceId (MLflow), thinking (jsonb[]), error, createdAt. **UNIQUE INDEX `messages_convo_pos_uq` on (conversation_id, position)** — turns the `SELECT MAX(position)+1` race in `appendMessage` into a 23505 unique_violation that the function retries (up to 5 attempts in a transaction); without it, two concurrent inserts would silently collide and break on-reload ordering.
- `feedback`: id (uuid), messageId (FK), userEmail, value (`up`|`down`), rationale, traceId, mlflowAssessmentId

**Domain tables (PdM example — adapt to your domain):**
- `assets` (primary entity): id (e.g. `RA-207`), model, line, location, downtime_cost_per_hour_usd, is_bottleneck, risk_score_current (double, 0–100), risk_tier (`critical`|`watch`|`healthy`), predicted_failure_mode, est_days_to_failure, latest_ml_update_at, work_order_booked (boolean), timestamps
- `assetTrend` (condition time-series): id, assetId (FK), measurement_date, vibration (double), vibration_baseline (double), temperature (double), temperature_baseline (double), pressure (double), notes
- `maintenanceHistory` (CMMS mirror): id, assetId (FK), work_order_id, vendor, technician, service_date, lubricant (important: this field captures substitutions like "Mobilgrease XHP 222 (EP2) — Vigo RE0 backordered"), duration_hours, notes, **aiAuditTrail** (jsonb[], append-only: when booked via app, this records `{at, by: 'agent', action: 'booked_wo', notes: 'WO-PDM-31001'}`)
- `failures` (failure history with root causes): id, assetId (FK), failure_date, failure_mode, root_cause, capa_reference, investigation_notes, downtime_hours, estimated_cost_usd
- `spareParts` (MRO inventory, live including reservations): id, part_number, description, compatible_models, qty_at_plant, qty_at_regional_dc, unit_cost_usd, lead_time_days, last_restock_date
- `maintenanceWindows` (planned windows): id (e.g. `SAT-LINE2-8h`), line, window_name, scheduled_date, duration_hours, total_capacity_hours (2 crews x duration), booked_hours, free_hours, status (`open`|`full`|`completed`)
- `workOrders` (WRITE surface — agent writes here): id (e.g. `WO-PDM-31001`), assetId (FK), priority (`P1`|`P2`|`P3`), title, root_cause, tasks (jsonb[]), window_id (FK), duration_hours, technicians_assigned, reserved_parts (jsonb[]), cost_avoided_usd, net_savings_usd, status (`planned`|`in_progress`|`completed`|`cancelled`), booked_at, started_at, completed_at, cancelled_at, **aiAuditTrail** (jsonb[], append-only), timestamps

JSONB types: TaskEntry `{seq, title, assigned_to?, duration_hours?, status?}`, PartReservation `{part_number, qty, source: 'plant_crib'|'dc_transfer', unit_cost_usd}`, AuditEntry `{at, by: 'agent'|'user', action: 'booked'|'started'|'cancelled', notes?, tool?}`

## Delta → Lakebase sync (`server/db/sync.ts`)

One-shot at boot (skips if populated). Pulls via Databricks SQL Statements API — all **4** warehouse queries fire in parallel (customers, orders, returns, **customer_premium**), then inserts run sequentially in FK order (customers → orders → returns → customer_premium). Chunk sizes kept under Postgres's 65,535 parameter ceiling (rows × columns): 5k rows for customers/orders/premium, 2.5k for returns (16 cols including the new anger_score). Idempotent via `onConflictDoNothing`. Table names from `config.data.tables`. If `customerPremium` is unset in config, that query is skipped and the app degrades to no per-row tiering (the bulk tool falls every row through to the `standard` offer). Reset endpoint calls `wipeMirroredTables()` + re-sync.

## Agent (`server/agent/pdmops.ts`)

AgentContext: `{db, userEmail, req, genieSpaceId, databricksHost, model, onToolProgress?, modelError?}`. The Genie agent id is read from env (or `demo_resources`) by the agent.

**Tool flow** (see pattern #5 "Filter-driven bulk writes" below): the agent investigates via `get_fleet_risk` (which assets are at risk), deep-dives via `get_asset_details` (condition trend + maintenance history), roots cause via `ask_data` (the Genie agent: standards, CAPA reports + analytics), scopes fleet impact via `find_pm_batch` (same vendor/lubricant cohort), verifies parts via `check_parts` + `list_windows`, then triggers `book_work_order` with a **filter** (the asset) plus work-order metadata — not a list of IDs. The SQL re-derives the row set inside the same transaction; the agent never has to echo IDs back.

| Tool | Input → Output | Effect |
|------|---------------|--------|
| `get_fleet_risk` | `{line?, top_n}` → asset risk rankings | Read-only Lakebase query joining `assets × asset_trend × maintenance_history`; returns top-N assets by risk_score, risk_tier, failure drivers, downtime cost at risk, last PM vendor. |
| `get_asset_details` | `{asset_id}` → full asset + trend + CMMS + failure history + booked WOs | Read-only Lakebase query; returns condition trend (first 60d, drift start, latest), last 12 CMMS work orders (with **lubricant used highlighted if substitute**), failure history with CAPA cross-links, any booked work orders. |
| `find_pm_batch` | `{lubricant_contains?, vendor?, days}` → assets with matching preventive PMs | Read-only query: find every asset that received the same PM type in the look-back window. Answers "Is RA-207 alone, or was the same contractor + lubricant event on RA-211 and RA-214?" |
| `ask_data` | `{question}` → `{answer, trace_id}` | Genie Agent (`POST /api/2.0/genie/agents/{id}/responses`, SSE). One turn runs `execute_sql` for numbers and `search_context_files` for the documents; streams each SQL statement and document search via onToolProgress; returns markdown with `[n](url)` citations. Keeps a Genie conversation per chat thread. From `tools/genie.ts`. |
| `check_parts` | `{model?, query?}` → parts inventory | Read-only search of MRO spare-parts inventory (Lakebase, live with reservations). Returns part_number, compatible_models, qty at plant + DC, unit_cost, lead_time. |
| `list_windows` | `{line?}` → maintenance windows | Read-only query: upcoming planned maintenance windows. Returns window_id, line, scheduled_date, capacity_hours, booked_hours, free_hours, status. |
| `book_work_order` | `{asset_id, priority, title, root_cause, tasks[], window_id, duration_hours, technicians, parts[], cost_avoided_usd}` → `{work_order_id, premium_coupon, labor_cost, part_cost, net_savings_usd, ...}` | **WRITE, TRANSACTIONAL**: within `db.transaction()`, locks the asset + window, reserves parts from plant crib (first) or DC transfer, consumes window hours, inserts work order with **aiAuditTrail** `{at, by: 'agent', action: 'booked', notes: 'via pdm-copilot', tool: 'book_work_order'}`, flips asset to work_order_booked. Returns reserved parts + cost avoided + net savings. Fails cleanly if parts or window capacity insufficient. |

SDK setup: OpenAI client → `${host}/serving-endpoints`, **Responses API** (SDK default), custom fetch (Connection: close, strips long IDs >64 chars + `annotations` arrays for compat), MLflow tracing (not OpenAI). On any non-2xx, the shim writes the response body into `ctx.modelError` so the catch block in agent-stream.ts can surface a real error. **On 401/403, retries once with the app service principal** (OBO fallback) for model endpoint auth issues — important for cross-workspace deploys.

> **Model constraint: needs the Responses API.** The Agents SDK defaults to `/responses`, and Databricks gates that route per-model. `databricks-gpt-5-4` is the baseline that works today; a newer GPT endpoint (gpt-5-5, gpt-6, …) is fine **if it has `openai/v1/responses` in its `api_types`** — the version isn't the constraint, the Responses API is. Keep `agentModel` on `databricks-gpt-5-4` or a newer Responses-capable GPT in `config/app.json`.

Instructions: MODE A (investigation — `get_fleet_risk` + `get_asset_details` + `ask_data`) or MODE B (action — 4-phase: investigate → root-cause via manuals → scope via `find_pm_batch` → plan (windows + parts) → book after approval).

## Routes

**Chat routes** (`server/routes/chat.ts`): GET/POST/DELETE `/api/conversations[/:id]`, GET `/api/dock-conversation`, POST `/api/chat/stream` (SSE), POST `/api/messages/:id/feedback`

**Domain routes** (`server/routes/pdm.ts`): GET `/api/pdm/fleet[?line=&top_n=]`, GET `/api/pdm/assets/:id`, GET `/api/pdm/work-orders[?status=&window_id=]`, GET `/api/pdm/work-orders/summary`, GET `/api/pdm/by-line[?status=]` (Control Room tile drill), POST `/api/pdm/work-orders/:id/status` (Start/Complete/Cancel WO), GET `/api/pdm/activity/recent`

**Other**: GET `/api/config`, `/api/me`, `/api/warehouse`, `/api/activity/recent`, POST `/api/admin/reset`

## Domain queries (`server/db/queries/pdm.ts`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `listFleet` | `(db, {line?, tier?, limit?})` | Sorted asset risk ranking. LEFT JOIN on `asset_trend` (latest row) + `maintenance_history` (last PM). Returns risk_score, risk_tier, predicted_failure_mode, est_days_to_failure, downtime_cost_at_risk, top_drivers, last_pm_vendor, lubricant_used, work_order_booked flag. Powers the agent's `get_fleet_risk` tool and Control Room tile grid. |
| `getAsset` | `(db, asset_id)` | Full asset registry + condition trend (first 60d, drift start, latest vibration/temperature vs baseline) + maintenance history (last 12 CMMS work orders with **lubricant_used highlighted if substitute**) + failure history with CAPA cross-links + any booked work orders. Powers agent's `get_asset_details` tool and asset drawer. |
| `recentPmBatch` | `(db, {lubricant_contains?, vendor?, days})` | Find every asset that received a preventive PM in the look-back window matching the lubricant substring and/or vendor substring. Returns asset_id, model, risk_score, PM work_order_id, date, vendor, lubricant (with substitution notes), duration, technician, notes. Powers agent's `find_pm_batch` tool for "same event, different asset" scope. |
| `findParts` | `(db, {model?, query?})` | Search spare-parts inventory (live, including reservations made by booked work orders). Filter by asset model (compatible parts) and/or keyword in description/part_number. Returns part_number, description, compatible_models, qty_at_plant (on-hand minus reserved), qty_at_dc (1-day transfer), unit_cost, lead_time_days. Powers agent's `check_parts` tool. |
| `listWindows` | `(db, line?)` | Upcoming planned maintenance windows. Filter by exact line name or null for all. Returns window_id, line, scheduled_date, duration_hours, capacity_hours (2 crews × duration), booked_hours, free_hours, status. Powers agent's `list_windows` tool. |
| `listWorkOrders` | `(db, {status?, window_id?})` | Filtered work-order queue. JOIN on assets + windows. Returns work_order_id, asset_id, priority, title, root_cause, technicians_assigned, window, duration, reserved_parts[], cost_avoided_usd, net_savings_usd, status, booked_at, aiAuditTrail. Powers Work Orders page. |
| `fleetSummary` | `(db)` | GROUP BY risk_tier → `{critical_count, watch_count, healthy_count, total_downtime_risk_usd, cost_avoided_usd_booked}[]`. Powers Control Room KPI cards. |
| `bookWorkOrder` | `(db, {asset_id, priority, title, root_cause, tasks[], window_id, duration_hours, technicians, parts: [{part_number, qty, source}], cost_avoided_usd, userEmail})` | **WRITE, transactional**: `db.transaction(tx => …)` locks the asset + window, re-checks parts availability (plant crib first, else DC transfer for each part), consumes window hours, inserts work order with **aiAuditTrail** `{at: now(), by: 'agent', action: 'booked', tool: 'book_work_order', notes: 'via pdm-copilot', cost_avoided: $X}`, flips asset.work_order_booked = true. Returns work_order_id, reserved_parts (final allocation: plant/DC per part), total_labor_cost, total_part_cost, net_savings. Fails cleanly if parts or window capacity insufficient. Powers agent's `book_work_order` tool. |
| `recentActivity` | `(db, limit)` | UNION of aiAuditTrail[] entries from work_orders + maintenance_history (PMs), sorted by time DESC. Powers activity feed. |

## Chat streaming

Server (`agent-stream.ts`): wraps agent run in MLflow span, emits SSE events — `output_text.delta`, `reasoning_summary_text.delta/done`, `output_item.done` (tool_call/tool_output/message), `response.completed` (trace_id). Genie agent sub-events (reasoning, SQL statements, document searches) bubble up via `ctx.onToolProgress` and are SSE-written as `genie_narration` / `genie_tool_call` / `genie_tool_output` (persisted as `genie:sql` / `genie:documents`).

Client: `streamChat.ts` parses SSE → `useChatTurn.ts` accumulates state → `ThinkingPanel.tsx` renders live (merges tool_call + output by callId). Persisted on message as `thinking[]` JSONB for reload-safe history.

## ChatDock

Persistent per-user conversation (`kind='demo_dock'`). Script progression from `config.assistantScript` — next chip appears when previous message contains `triggerAfter` substring. External control via `dockController.openAndSend(prompt)` from any page (e.g., asset drawer's "Ask the assistant" banner).

## config/app.json structure

Every field has a `_*_help` sibling key in `app.json` that explains the field + names the file that consumes it. Open the file directly for inline docs; this section is the structural overview.

```json
{
  "_README": "...",
  "_dataBackend_help": "...", "genieSpaceId": "${GENIE_SPACE_ID:}",
  "_agentModel_help": "...", "agentModel": "databricks-gpt-5-4" /* must support Responses API */,
  "_mlflow_help": "...", "mlflowExperimentId": "", "agentMlflowExperimentPath": "${AGENT_MLFLOW_EXPERIMENT_PATH:}" /* empty → app self-derives */,
  "_dashboard_help": "...", "dashboardId": "${DASHBOARD_ID:}",
  "_data_help": "...", "data": { "catalog": "${DEMO_CATALOG}", "schema": "${DEMO_SCHEMA}", "tables": { "assetHealth": "asset_health_current", "features": "asset_health_features", "workOrders": "maintenance_work_orders", "failures": "failure_events", "spareParts": "spare_parts", "windows": "maintenance_windows" } },
  "_branding_help": "...", "branding": { "appName": "TechRobotics PdM Control Room" },
  "_assistantScript_help": "...", "assistantScript": [ { "prompt": "Which machine should I worry about this week, and why?" }, { "prompt": "Is it just RA-207? Check which other robots got the same PM.", "triggerAfter": ["RA-207", "grease"] }, { "prompt": "Plan the fix in Saturday's Line 2 window: work orders, technicians and parts for all exposed robots, with the downtime cost avoided.", "triggerAfter": ["RA-214", "RA-211"] }, { "prompt": "Book it.", "triggerAfter": ["book it", "Book it"] } ]
}
```

Set `genieSpaceId` to the Genie space ID (from your workspace). It is the Genie agent the `ask_data` tool queries (tables + the manuals volume). The `_help` keys are ignored at runtime — they're for the engineer adapting this to a new domain.

KPI thresholds, alert conditions, and tile layout live **hardcoded at the top of `client/src/home/ControlRoom.tsx`** as constants — rewrite those for your domain. Only `assistantScript` + `branding` need to stay in config (script is reused by the chat dock, branding by the shell).

## Client component details

**ControlRoom** (Control Room): Hero KPI cards (asset risk tier counts, total downtime at risk, cost avoided — hardcoded thresholds at top of file), priority alert card (top critical asset by downtime risk), plant floor tile grid (one tile per asset, showing risk_tier badge, model score, vibration trend direction, bottleneck badge if line-pacing, click → asset drawer). Starter question chips (each → `dockController.openAndSend`), featured action card (gradient CTA → sends a prompt), activity feed (fetches `/api/activity/recent`, shows booked work orders + PMs + audit with relative timestamps).

**OperationsView** (Work Orders): Fetches `/api/pdm/work-orders?status={filter}&window_id={window}` + `/api/pdm/work-orders/summary`. Subscribes to `dataMutated` (refetches on agent writes). URL-synced filters (`?status=planned`). Renders KpiCards (from summary: planned/in-progress/completed counts + cost avoided), WorkOrdersTable (columns: Asset, WO#, Priority, Title, Technicians, Window, Reserved Parts, Status — click selects row), WorkOrderDrawer (slide-over, 4 tabs). "Ask the assistant" banner opens dock.

**WorkOrderDrawer tabs**: DetailsTab (full work order with root_cause + tasks + reserved parts + cost_avoided), AssetsTab (the asset's current condition + fleet risk), ActivityTab (merged timeline from work_order.aiAuditTrail[] + recent PMs for the asset), StatusTab (Start/Complete/Cancel buttons → POST `/api/pdm/work-orders/:id/status`).

**AnalyticsView**: Warehouse badge (name + state), LineChart (Line 2 OEE trend vs baseline), BarChart (MTBF by asset type), DataTable (worst assets by downtime risk), LinePanel (drill-down → assets by line → click asset → navigate to `/`).

**Asset drawer** (from tile click): Hero section (Asset name + model + risk_tier badge), Trend chart (60d vibration + temperature vs baseline with drift-start marker), Maintenance tab (last 12 PMs, **red-highlighted if substitute lubricant**), Failure tab (failure history with CAPA cross-links), Booked tab (any active work orders for this asset), Ask button → opens dock.

## Analytics SQL (`config/queries/`)

- `line_oee_trend.sql` — `SELECT production_date, line_name, oee_pct FROM gold_line_oee WHERE line_name='Line 2 — Robotic Assembly' AND production_date >= CURRENT_DATE - INTERVAL 30 days ORDER BY production_date` (Line OEE 30-day trend vs baseline)
- `mtbf_by_asset_type.sql` — `SELECT asset_type, COUNT(DISTINCT asset_id) as equipment_count, AVG(days_to_failure) as mtbf_days, SUM(unplanned_downtime_hours) as total_downtime_hours FROM gold_failure_metrics GROUP BY asset_type ORDER BY mtbf_days` (MTBF by asset type + downtime hours)
- `worst_assets.sql` — `SELECT asset_id, model, line, risk_score, downtime_cost_at_risk_usd, est_days_to_failure, last_pm_date, last_pm_vendor FROM asset_health_current WHERE risk_score >= 50 ORDER BY downtime_cost_at_risk_usd DESC LIMIT 20` (Worst assets by risk)
- Optional: `robot_lubricant_history.sql` — `SELECT asset_id, model, line, vendor, lubricant_used, pm_date, is_substitute, current_risk_score FROM gold_maintenance_by_robot WHERE is_substitute=true ORDER BY pm_date DESC` (Robots with substitute lubricants — roots the same-event failure mode)

## How the agent runner works (`server/chat-stream/agent-stream.ts`)

Uses `@openai/agents` SDK. Flow:
1. Start MLflow span (`pdmops.turn`, spanType: AGENT)
2. Build agent via `buildAgent(ctx)` — returns `Agent` with name, model, modelSettings (`reasoning: {effort: 'low', summary: 'auto'}`), instructions, tools (get_fleet_risk, get_asset_details, find_pm_batch, ask_data, check_parts, list_windows, book_work_order)
3. Normalize conversation history (assistant messages → `{role: 'assistant', content: [{type: 'output_text', text}]}`)
4. Call `runAgent(agent, input, {stream: true})` → async event stream
5. Event loop dispatches:
   - `raw_model_stream_event` → unwrap: `reasoning_summary_text.delta/done` (thinking), `output_text.delta` (final text)
   - `run_item_stream_event` → `tool_called` / `tool_output` (pushed to thinking[])
6. Each event → `sseWrite(res, event)` to client
7. On completion: emit `response.completed` with trace_id, persist thinking[] to message

Data-backend events bubble up via `ctx.onToolProgress`: the data tool (`ask_data` from `tools/genie.ts`) emits `ToolProgressEvent` (`genie_narration` | `genie_tool_call{callId, subAgent: "sql" | "documents", query}` | `genie_tool_output{callId, subAgent, snippet}`) — these are SSE-written and pushed to thinking[]. Persisted thinking names are `genie:sql` / `genie:documents` (older trails may say `mas:*`).

## Thinking event flow (end-to-end)

```
Agent SDK event / onToolProgress callback
  → server pushes to thinking[] array + sseWrite(res, event)
    → client streamChat.ts parses SSE, calls onToolCall/onToolOutput/onReasoningDelta handlers
      → useChatTurn accumulates thinkingEvents[] state
        → ThinkingPanel renders (merges tool_call + output by callId, reasoning inline)
          → on completion: thinking[] persisted to message JSONB
            → on reload: MessageBubble renders collapsed "Reasoning · N tools" toggle from persisted thinking[]
```

## Real-time update flow

```
Agent completes turn (e.g., books work orders in Lakebase)
  → useChatTurn.onTurnEnd() fires
    → calls dataMutated.emit()
      → OperationsView (subscribed via dataMutated.subscribe) refetches work_orders + summary
        → KPI counters update, table rows reflect new status, work order appears in queue
      → ControlRoom (subscribed) refetches fleet summary + asset list
        → KPI counts update, risk_tier badges change, booked flags appear on tiles
```

Same flow for the WorkOrderDrawer Activity tab — it refetches the single work order, whose aiAuditTrail[] array now has new entries from the agent's booking action.

## Drizzle migration workflow

When changing `server/db/schema.ts`:
1. Edit the schema
2. Run `npm run db:generate` → creates new migration SQL in `drizzle/`
3. Migrations auto-apply on boot (`server/db/migrate.ts`)

## Theming & brand (`client/src/index.css`)

All colors are centralized as CSS custom properties in `:root`. No hardcoded color values in components — everything references tokens. To rebrand:

- **Primary palette**: `--primary`, `--primary-foreground`, `--primary-light`, `--on-primary-hover`
- **Accent**: `--accent`, `--accent-foreground` (used in gradients, highlights)
- **Status tints** (badge/pill backgrounds): `--success-subtle`, `--warning-subtle`, `--info-subtle` + their `-foreground` pairs
- **Action buttons**: `--success`/`--warning`/`--destructive` + `-foreground` pairs
- **Tier badges**: `--tier-gold`, `--tier-silver`, `--tier-bronze`, `--tier-platinum` + `-foreground` (domain-specific, swap per demo)
- **Status dots**: `--status-running`, `--status-idle`
- **Charts**: `--chart-1` through `--chart-5`
- **Fonts**: `--font-sans`, `--font-display`, `--font-mono` (loaded via `<link>` in `index.html`)
- **Sidebar**: separate `--sidebar-*` token family

Components use `var(--token)` via Tailwind arbitrary values (`bg-[var(--success-subtle)]`) or inline styles for gradients/animations. Changing the `:root` block rebrands the entire app.

## Key patterns

1. **Delta mirror**: Lakebase mirrors Delta subset for OLTP. Agent writes Postgres; analytics queries Delta. Manual sync at boot + reset.
2. **Append-only audit**: Primary entity carries `emails[]` + `aiAuditTrail[]` JSONB. Every write appends. Activity tab renders timeline from one row.
3. **3-phase action chain**: Discover → Draft+confirm (STOP) → Execute. Mandatory approval stop = demo trust moment.
4. **Narrative split**: script steps + branding live in `config/app.json` (reused by dock/shell); home-page copy (persona, headline, situation, goal, starter questions, featured action) is hardcoded at the top of `HomeView.tsx` as constants — treat the template content as a reference to replace per demo.
5. **Filter-driven bulk writes** (the demo's "AI takes action" moment):
   - **Investigate** via the Genie Agent (`ask_data`) — open-ended SQL + document reasoning across the warehouse and the documents volume.
   - **Show** the affected rows to the user via a read-only lookup tool (`find_returns_for_lot`) — they confirm scope before anything destructive runs.
   - **Write** via a tool whose only inputs are a FILTER (a scalar lot id, status, region — never a list of IDs) plus the per-row template (email subject/body, coupon, etc.). Wrap SELECT + UPDATE in `db.transaction(tx => …)`; use `SELECT … FOR UPDATE OF <primary table>` so a concurrent manual decision / agent retry can't flip rows between read and write; do ONE `UPDATE … FROM (VALUES …) … RETURNING id` re-asserting the same filter so writes can't drift from reads; derive counts/totals from the RETURNING ids (NOT from intent) so the agent's final summary reflects reality.
   - Why this shape: agents echoing back N IDs in `IN (…)`/`ANY (…)` hits param caps, blows up the request, and is easy for the model to miscount. With a scalar filter, the agent only ever holds a string — and the read and write can't disagree because they share the same predicate AND the row lock.
6. **Data tool**: `ask_data` is registered via `askDataTool` in `server/agent/tools/genie.ts` (one Genie Agent, Agent mode). Its SQL and document-search steps stream to ThinkingPanel via `onToolProgress` → SSE.
7. **MLflow tracing**: Per-turn spans, tool child spans, trace ID on message → "View trace" link. Thumbs → human assessments.
8. **Diff-aware pulse on agent writes**: `dataMutated.emit()` triggers a refetch on every subscribing surface. Each surface compares prev-vs-next scalar values via `usePulseOnChange(value)` and only the elements whose value actually changed flash a ring/row highlight for ~1.5s. Wired into KpiCards (counts), ReturnsTable rows (status), CountryPanel rows (totals).

## `config/app.json` validation (server-side, at boot)

`server/server.ts` Zod-validates `config/app.json` at boot via `loadAppConfig()`. The validator fails fast (the app refuses to start) when:

- The JSON is malformed (typo, missing comma).
- Required structural fields are missing (`branding.appName`, `dashboardId`, `data.catalog`, `data.schema`, `data.tables.*`).
- Any of `dashboardId`, `branding.appName`, `data.catalog`, `data.schema` still contain an unfilled `<placeholder>` (e.g. `<your-catalog>`). The build agent MUST replace these before the app can boot.

It warns (and continues) for unfilled `<placeholder>` in MLflow paths (`agentMlflowExperimentPath`, `mlflowExperimentId`) — those are opt-in features and a missing path just shows "Trace pending…" in the UI.

`_*_help` sibling keys and any unknown extra keys pass through unread (`.passthrough()`).
