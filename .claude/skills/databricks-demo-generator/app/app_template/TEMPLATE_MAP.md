# App Template Map

Reference for agents customizing this template. Read this instead of scanning every file.

## What this app is (functional)

This template is the **action surface** of a Databricks demo — the place where the AI *does* something, not just answers questions. It pairs with upstream pipelines (the data), a Genie space (conversational analytics), and an AI/BI dashboard (read-only visuals). Its unique job: show the agent investigating an anomaly, drafting a batch action, and executing it after human approval — with every step visible in a live operations queue.

**Canonical demo arc** (LuxeBeauty example, but the shape is universal):
1. User lands on Home, sees a protagonist with a problem (`$X at risk`, anomaly peaked weeks ago).
2. User clicks a starter chip → opens the chat dock → asks the agent.
3. Agent's `ask_mas` (or `ask_genie`) tool hits the configured data backend → investigates → identifies the bad batch.
4. User asks "can you fix it?" → agent drafts a batch action (emails + refunds) and **stops for approval**.
5. User approves → agent writes to Lakebase → Operations page updates live (KPIs, status flips, timeline grows).
6. (Optional) User inspects a single row → sees emails + audit trail in a drawer.

The demo lands because the user watched the AI *take an action with real-world-looking consequences* under human control — not because the agent said something clever.

## Surfaces — what each one is for

| Surface | Functional role | Customize per demo? |
|---------|-----------------|---------------------|
| **Home** (`/`) | Frame protagonist + problem + journey. Entry point to the agent via starter chips / featured action. | **YES** — persona, headline, situation, goal, starter questions, journey cards |
| **Chat dock** (floating + `/c/:id`) | The SA's steering wheel. Scripted progression (`config.assistantScript`) with `triggerAfter` keywords unlocks each step. | **YES** — script steps + trigger keywords |
| **Operations** (`/operations`) | The "truth of the world" — where the anomaly visibly lives and where the AI's action lands. Table + drawer with Approve/Reject/Escalate + live refresh on `dataMutated`. | **YES** — domain entity, table columns, drawer tabs, filter dimensions |
| **Analytics** (`/analytics`) | Light, bespoke charts over Delta (via warehouse SQL). Secondary to the dashboard — useful for one or two drill-downs tied to the story. | **YES** — SQL files in `config/queries/` |
| **Dashboard** (`/dashboard`) | Embedded AI/BI iframe (the "proper" analytics surface). Just a viewport onto the real dashboard. | **NO** — just set `config.dashboardId` |

## What to touch, and when

Three tiers, not two — because some defaults fit the canonical arc but don't survive every story. Use judgment.

### Tier 1 — Structural (keep unless you know what you're doing)

These are load-bearing plumbing. Break them and the app doesn't boot, or a core feature silently dies.

- **OBO auth** (`lib/auth.ts`) — Databricks identity forwarding. No demo works without it.
- **MLflow tracing wiring** (span creation, trace_id on message, feedback → assessments) — trace viewer links break if removed.
- **SSE streaming pipeline** (agent-stream → sseWrite → streamChat → useChatTurn → ThinkingPanel) — break this and the chat just hangs.
- **Delta → Lakebase sync-at-boot + reset endpoint** — without it, a fresh app has no data.
- **Drizzle migration runner on boot** — schema changes won't apply without it.

### Tier 2 — Canonical defaults (the demo's "house style" — change with intent)

These fit the canonical arc (investigate → approve → act). They *usually* survive a rewrite because most demos want the same shape — but swap them if the story genuinely differs.

| Default | Keep when… | Change when… |
|---------|------------|--------------|
| **3-phase chain** (discover → draft+confirm → execute) | Story has a "fix it" moment where the user approves a batch action | Story is read-only (pure investigation, no action) → drop phases 2–3. Story has multiple action types → document each chain. |
| **`triggerAfter` keyword progression** on `assistantScript` | Linear demo script (SA clicks chips in order) | Free-form exploration demo → drop triggers, use plain prompts. |
| **Append-only audit** (`emails[]` + `aiAuditTrail[]` JSONB on primary entity) | Demo shows "the AI did X at Y" timeline | No timeline tab, no action history needed → drop the JSONB columns. |
| **`dataMutated` pub-sub** | Operations page should update live when the agent writes | Read-only demo, no writes to react to → harmless but dead weight. |
| **`ask_mas` (data backend)** | Demo has a MAS endpoint | Genie-only demo → swap to `askGenieTool` from `server/agent/tools/genie.ts` and use `genieSpaceId`. Both → register both factories with distinct names. No data lookup → drop the tool. |
| **ChatDock + Home chips with script** | SA is the presenter; demo is scripted | End-user-driven demo → surface the chat on its own page, drop the dock's "next chip" mechanic. |

### Tier 3 — Always rewrite per demo (content, not infra)

Every demo touches these. They're what makes your demo yours, not LuxeBeauty's.

- **Persona/story/copy** — hardcoded constants at the top of `HomeView.tsx`. Replace wholesale: persona name, headline, situation, goal, starter questions, featured action.
- **`config/app.json`** — `branding`, `assistantScript` steps, `data.tables`, `dashboardId`, `masEndpointName` OR `genieSpaceId` (one of the two), `mlflowExperimentId`, `agentMlflowExperimentPath`, `agentModel`. Each field has a `_*_help` sibling explaining what it does + which file consumes it.
- **Domain schema** (`server/db/schema.ts`) — the primary entity swaps (returns → tickets → accounts → whatever). If you keep Tier 2 audit columns, their shape is fixed; the surrounding columns are yours.
- **Agent tools** (`server/agent/<name>.ts`) — the file is renamed per demo (`refundops.ts` → `supportops.ts`) and the import in `chat-stream/agent-stream.ts` updated. Tool names and bodies swap; if you keep the 3-phase chain, the *shape* of the tools (read-only discovery tool + batch write tool + pure-function draft helper) is what's preserved. The data-backend tool comes from `server/agent/tools/{mas,genie}.ts` factories — pick one based on config.
- **Domain CRUD** (`server/db/queries/<entity>.ts`, `server/routes/<entity>.ts`).
- **Operations view** — table columns, drawer tab content, filter dimensions.
- **Analytics SQL** in `config/queries/` — 2–4 queries aligned to the story's key numbers.
- **Theme tokens** in `client/src/index.css` — brand palette and, if they exist, tier badges.

## Adapting to a reduced capability set

Not every demo has every Databricks capability. Drop surfaces that don't map:

| If demo has no… | Do this |
|-----------------|---------|
| **MAS** | Use `askGenieTool` from `server/agent/tools/genie.ts` instead of `askMasTool`. Update AgentContext field (`masEndpointName` → `genieSpaceId`) + config/app.json. Same `ToolProgressEvent` stream → no UI changes needed. |
| **Genie** | Use `askMasTool` (the template default). |
| **Both** | Register both factories in `makeTools` with distinct names (`ask_genie`, `ask_mas`); tell the model in agent instructions when to prefer each. |
| **KA** | Skip the "investigate documents" phase. Arc shortens: discover via data → draft → execute. |
| **Dashboard** | Remove `/dashboard` route + nav item + journey card. |
| **Analytics charts** | Remove `/analytics` route; demo relies on the embedded dashboard instead. |
| **Write action** (read-only demo) | Skip the bulk-action tool. Arc shortens to discover → answer (no approval step). Much less impressive — only choose this if the story genuinely doesn't need a fix. |

The smallest viable demo: Home + Chat dock + Operations + one agent tool that reads Lakebase. Everything else is additive.

## File structure

Files marked `[D]` are domain-specific (LuxeBeauty example — adapt per demo). Others are generic infrastructure.

```
config/
  app.json              [D] Narrative, resource IDs, data sources, script steps
  queries/*.sql         [D] Analytics SQL (Delta via SQL Warehouse)

server/
  server.ts                 Boot: load config → AppKit app → migrations → syncFromDelta → MLflow init → routes
  agent/
    refundops.ts        [D] Agent definition, tools, ~700-line system prompt (OpenAI Agents SDK).
                            Renamed per demo (e.g. windops.ts, claimsops.ts). Update import in chat-stream/agent-stream.ts.
    tools/
      types.ts              Shared types for the data-backend tools (ToolProgressEvent, DataCallResult, DataToolContext)
      mas.ts                askMasTool factory + callMasEndpoint helper — for demos with a MAS endpoint
      genie.ts              askGenieTool factory + callGenieSpace helper — for demos with a Genie space
  db/
    schema.ts           [D] Lakebase tables (Drizzle ORM)
    sync.ts             [D] Delta → Lakebase sync queries
    migrate.ts              Migration runner
    index.ts                DB pool init
    queries/
      chat.ts               Conversation + message CRUD
      returns.ts        [D] Domain entity CRUD + bulk operations
  chat-stream/
    agent-stream.ts         Drives the OpenAI Agents SDK loop, translates SDK events → SSE taxonomy
    index.ts                /api/chat/stream entry point: persist user msg → sanitize history → streamAgentTurn
    sse.ts                  SSE helpers
  routes/
    chat.ts                 Conversations CRUD, streaming turns, feedback
    returns.ts          [D] Domain entity endpoints
    config.ts               /api/config, /api/me, /api/warehouse
    activity.ts             Recent activity feed
    admin.ts                Demo reset (truncate + re-sync)
  lib/
    auth.ts                 Databricks OBO auth headers
    mlflow.ts               Experiment get-or-create, feedback → assessments
    user.ts                 User identity from request headers
    endpoint.ts             fixMojibake helper (UTF-8 / Latin-1 re-decode for streaming gateway quirks)
    templates.ts        [D] Email template placeholder filling

client/src/
  App.tsx                   Routes: / (Home), /c/:id (Chat), /operations, /analytics, /dashboard, /platform
  shared/types.ts       [D] Domain entity types (ReturnRow, ReturnDetail, LotRow, etc.)
  shell/                    AppSidebar (nav), AppHeader (chrome)
  home/HomeView.tsx     [D] Story section, journey diagram, starter chips, featured action, activity feed
  chat/                     ChatDock (floating), ChatView (full-page), ThinkingPanel, MessageBubble,
                            useChatTurn (hook), streamChat (SSE parser), script.ts, dockController, FeedbackRow
  operations/           [D] OperationsView, KpiCards, ReturnsTable, ReturnDrawer, tabs/ (Return, Customer, Activity)
  analytics/            [D] AnalyticsView (charts), FacilityPanel (drill-down)
  dashboard/                DashboardView (embedded AI/BI iframe from config.dashboardId)
  platform/                 PlatformView — "Databricks Data + AI" corporate pitch page (do not edit, generic)
  lib/
    api.ts                  Config + user fetch wrappers
    conversations.ts        Client conversation store (useSyncExternalStore)
    returns.ts          [D] Domain entity fetch wrappers
    events.ts               dataMutated pub/sub (invalidate on agent writes)
```

## Lakebase schema (`server/db/schema.ts`)

**Chat state (generic):**
- `conversations`: id (uuid), userEmail, title, kind (`default`|`demo_dock`), timestamps
- `messages`: id (uuid), conversationId (FK), role, content, position, traceId (MLflow), thinking (jsonb[]), error, createdAt
- `feedback`: id (uuid), messageId (FK), userEmail, value (`up`|`down`), rationale, traceId, mlflowAssessmentId

**Domain tables (LuxeBeauty example):**
- `customers`: id, email, firstName, lastName, region, loyaltyTier, registrationDate
- `orders`: id, customerId (FK), orderDate, region, totalUsd, status
- `returns` (primary entity): id, orderId, customerId, returnDate, refundAmountUsd, returnReason, productId, productName, category, lotId, facility, region, status (`pending`|`approved`|`rejected`|`escalated`), **emails** (jsonb[], append-only), **aiAuditTrail** (jsonb[], append-only), decidedAt, timestamps

JSONB types: EmailEntry `{at, direction, from?, to?, subject, body}`, AuditEntry `{at, by, action, notes?, tool?}`, ThinkingEntry `{kind: tool_call|tool_output|intermediate_message, ...}`

## Delta → Lakebase sync (`server/db/sync.ts`)

One-shot at boot (skips if populated). Pulls via Databricks SQL Statements API — all 3 warehouse queries fire in parallel, then inserts run sequentially in FK order (customers → orders → returns). Chunk sizes kept under Postgres's 65,535 parameter ceiling (rows × columns): 5k rows for customers/orders, 2.5k for returns (15 cols). Idempotent via `onConflictDoNothing`. Table names from `config.data.tables`. Reset endpoint calls `wipeMirroredTables()` + re-sync.

## Agent (`server/agent/refundops.ts`)

AgentContext: `{db, userEmail, req, masEndpointName, databricksHost, model, onToolProgress?, modelError?}`. For Genie demos, replace `masEndpointName` with `genieSpaceId`.

| Tool | Input → Output | Effect |
|------|---------------|--------|
| `ask_mas` | `{question}` → `{answer, trace_id}` | Streams MAS supervisor + sub-agents via onToolProgress → ThinkingPanel. From `tools/mas.ts`. |
| `ask_genie` | `{question}` → `{answer, trace_id}` | Polls Genie REST conversation API; streams reasoning traces (April 2026 release) as narration. From `tools/genie.ts`. Pick this OR `ask_mas`, not both (unless you want both registered). |
| `find_returns_for_lot` | `{lot}` → pending returns list | Read-only Lakebase query |
| `create_coupon` | `{percent_off, reason}` → `{code, ...}` | Pure function, no DB write |
| `process_return_batch` | `{lot, coupon_code, email_subject_template, email_body_template}` → `{email_count, approved_count, total_refund_usd}` | **WRITE**: renders templates per customer (`{firstname}`, `{lastname}`, `{product_name}`, `{coupon_code}`), appends emails + audit, flips to approved |

SDK setup: OpenAI client → `${host}/serving-endpoints`, **Responses API** (SDK default — we don't call `setOpenAIAPI`), custom fetch (Connection: close, strips long IDs >64 chars + `annotations` arrays from assistant content for compat), MLflow tracing (not OpenAI). On any non-2xx, the shim writes the response body into `ctx.modelError` so the catch block in agent-stream.ts can surface a real error message instead of "400 status code (no body)".

> **Model constraint: `databricks-gpt-5-4` only.** The Agents SDK defaults to `/responses`, and Databricks gates that route per-model. GPT-5-4 is the only Databricks-hosted model with `openai/v1/responses` in its `api_types` today. Anthropic models (Sonnet 4.6, etc.) return 400 BAD_REQUEST: *"Responses API passthrough is not supported for model …"*. Supporting Claude would require switching to chat-completions AND parsing Anthropic thinking blocks ourselves (~60-100 lines, not done). Keep `agentModel: "databricks-gpt-5-4"` in `config/app.json`.

Instructions: MODE A (investigation — single `ask_mas`/`ask_genie` call) or MODE B (action — 3-phase: discover → draft+confirm → execute after approval).

## Routes

**Chat routes** (`server/routes/chat.ts`): GET/POST/DELETE `/api/conversations[/:id]`, GET `/api/dock-conversation`, POST `/api/chat/stream` (SSE), POST `/api/messages/:id/feedback`

**Domain routes** (`server/routes/returns.ts`): GET `/api/returns[?status=&lot=]`, GET `/api/returns/summary`, GET `/api/returns/:id`, POST `/api/returns/:id/decide`, GET `/api/lots/summary`, GET `/api/facilities/summary`, GET `/api/facilities/:name/lots`, GET `/api/customers/:id/orders`

**Other**: GET `/api/config`, `/api/me`, `/api/warehouse`, `/api/activity/recent`, POST `/api/admin/reset`

## Domain queries (`server/db/queries/returns.ts`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `listReturns` | `(db, {status?, lot?, limit?})` | Filtered list for operations queue |
| `getReturn` | `(db, id)` | Full row with emails[] + aiAuditTrail[] |
| `decideReturn` | `(db, {id, userEmail, decision, notes?})` | Append audit entry + flip status |
| `returnsSummary` | `(db)` | GROUP BY status → `{status, n, total_usd}[]` |
| `facilitySummary` | `(db)` | `{facility, return_count, pending_count, total_refund_usd}[]` |
| `lotsByFacility` | `(db, facility, limit)` | Top lots within a facility |
| `lotSummary` | `(db, limit)` | Global top lots by return count |
| `listCustomerOrders` | `(db, customerId, limit)` | Customer's order history |
| `recentActivity` | `(db, limit)` | UNION of emails[] + aiAuditTrail[] across all rows, sorted by time |
| `processReturnBatch` | `(db, {return_ids, coupon_code, email_subject, email_body, userEmail})` | Bulk: render templates, append emails + audit, flip to approved — single UPDATE FROM VALUES |
| `processReturnBatchForLot` | `(db, {lot, ...})` | Fetch pending for lot → call processReturnBatch |

## Chat streaming

Server (`agent-stream.ts`): wraps agent run in MLflow span, emits SSE events — `output_text.delta`, `reasoning_summary_text.delta/done`, `output_item.done` (tool_call/tool_output/message), `response.completed` (trace_id).

Client: `streamChat.ts` parses SSE → `useChatTurn.ts` accumulates state → `ThinkingPanel.tsx` renders live (merges tool_call + output by callId). Persisted on message as `thinking[]` JSONB for reload-safe history.

## ChatDock

Persistent per-user conversation (`kind='demo_dock'`). Script progression from `config.assistantScript` — next chip appears when previous message contains `triggerAfter` substring. External control via `dockController.openAndSend(prompt)` from any page.

## config/app.json structure

Every field has a `_*_help` sibling key in `app.json` that explains the field + names the file that consumes it. Open the file directly for inline docs; this section is the structural overview.

```json
{
  "_README": "...",
  "_dataBackend_help": "...", "masEndpointName": "...", "genieSpaceId": "",
  "_agentModel_help": "...", "agentModel": "databricks-claude-sonnet-4-6",
  "_mlflow_help": "...", "mlflowExperimentId": "...", "agentMlflowExperimentPath": "/Users/<email>/<app>-agent-traces",
  "_dashboard_help": "...", "dashboardId": "...",
  "_data_help": "...", "data": { "catalog": "...", "schema": "...", "tables": { ... } },
  "_branding_help": "...", "branding": { "appName": "..." },
  "_assistantScript_help": "...", "assistantScript": [ { "prompt": "..." }, { "prompt": "...", "triggerAfter": ["keyword"] } ]
}
```

Set ONE of `masEndpointName` / `genieSpaceId` per demo (the other should be empty string). The `_help` keys are ignored at runtime — they're for the LLM customizing this template.

Narrative copy (hero persona, headline, situation, goal, starter questions, featured-action CTA) lives **hardcoded at the top of `client/src/home/HomeView.tsx`** as constants — rewrite those for your demo. Only `assistantScript` + `branding` need to stay in config (script is reused by the chat dock, branding by the shell).

## Client component details

**HomeView**: Hero (persona + headline + situation + goal — hardcoded constants at top of file), journey diagram (4 cards: "Operate" → `/operations`, "Ask" → `dockController.openAndSend(script[0])`, "Investigate" → opens dock, "Take action" → `dockController.openAndSend(script[1])`), starter question chips (each → `dockController.openAndSend`), featured action card (gradient CTA → sends prompt), activity feed (fetches `/api/activity/recent`, shows emails + audit with relative timestamps).

**OperationsView**: Fetches `/api/returns?status={filter}&lot={lot}` + `/api/returns/summary`. Subscribes to `dataMutated` (refetches on agent writes). URL-synced filters (`?lot=LOT-123`). Renders KpiCards (from summary: pending/approved/escalated counts + $), ReturnsTable (columns: Lot, Customer, SKU, Reason, Value, Status — click selects row), ReturnDrawer (slide-over, 3 tabs). "Ask the assistant" banner opens dock.

**ReturnDrawer tabs**: ReturnTab (detail grid + Approve/Reject/Escalate buttons → POST `/api/returns/:id/decide`), CustomerTab (profile + order history from `/api/customers/:id/orders`), ActivityTab (merged timeline from row's emails[] + aiAuditTrail[]).

**AnalyticsView**: Warehouse badge (name + state), BarChart (`returns_by_product`), LineChart (`daily_refund_trend`), DataTable (worst lots), FacilityPanel (dropdown → lots by facility → click lot → navigate to `/operations?lot=`).

## Analytics SQL (`config/queries/`)

- `daily_refund_trend.sql` — `SELECT return_date, SUM(refund_amount_usd) FROM silver_returns WHERE last 30 days GROUP BY return_date`
- `returns_by_product.sql` — `SELECT product_name, COUNT(*), SUM(refund_amount_usd) FROM silver_returns GROUP BY product_name ORDER BY count DESC LIMIT 10`
- `worst_lots.sql` — `SELECT lot_id, product_name, facility, return_count, return_rate_pct, total_refund_usd FROM gold_returns_by_lot ORDER BY return_rate DESC LIMIT 20`

## How the agent runner works (`server/chat-stream/agent-stream.ts`)

Uses `@openai/agents` SDK. Flow:
1. Start MLflow span (`refundops.turn`, spanType: AGENT)
2. Build agent via `buildRefundOpsAgent(ctx)` — returns `Agent` with name, model, modelSettings (`reasoning: {effort: 'low', summary: 'auto'}`), instructions, tools
3. Normalize conversation history (assistant messages → `{role: 'assistant', content: [{type: 'output_text', text}]}`)
4. Call `runAgent(agent, input, {stream: true})` → async event stream
5. Event loop dispatches:
   - `raw_model_stream_event` → unwrap: `reasoning_summary_text.delta/done` (thinking), `output_text.delta` (final text)
   - `run_item_stream_event` → `tool_called` / `tool_output` (pushed to thinking[])
6. Each event → `sseWrite(res, event)` to client
7. On completion: emit `response.completed` with trace_id, persist thinking[] to message

Data-backend events bubble up via `ctx.onToolProgress`: the data-backend tools (`ask_mas` from `tools/mas.ts`, `ask_genie` from `tools/genie.ts`) emit `ToolProgressEvent` (`mas_narration` | `mas_tool_call{callId, subAgent, query}` | `mas_tool_output{callId, subAgent, snippet}`) — these are SSE-written and pushed to thinking[]. Naming is `mas_*` for historical reasons; both tools use the same shape so the UI is backend-agnostic.

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
Agent completes turn (e.g., bulk-approves returns in Lakebase)
  → useChatTurn.onTurnEnd() fires
    → calls dataMutated.emit()
      → OperationsView (subscribed via dataMutated.subscribe) refetches returns + summary
        → KPI counters update, table rows reflect new status
```

Same flow for the ReturnDrawer Activity tab — it refetches the single return, whose emails[] and aiAuditTrail[] arrays now have new entries from the agent's bulk write.

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
5. **Bulk update**: Single `UPDATE FROM VALUES` for N rows. Templates rendered server-side per customer.
6. **Data backend as a tool**: `ask_mas` (or `ask_genie`) is registered via factories in `server/agent/tools/{mas,genie}.ts`. Sub-agent / reasoning activity streams to ThinkingPanel via `onToolProgress` → SSE. Same `ToolProgressEvent` shape for both, so the UI doesn't care which backend powers it.
7. **MLflow tracing**: Per-turn spans, tool child spans, trace ID on message → "View trace" link. Thumbs → human assessments.
