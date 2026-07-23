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
| **ML-driven tiering** in phase 2 (call a premium / propensity table to split the cohort + draft two emails) | Demo has a buildable model in spec 03 whose predictions can change the agent's action per-row | Story has no ML → drop `find_lot_premium_breakdown`, collapse `tier_offers` back to a single `{coupon_code, email_subject, email_body}`, drop the `final_tier` JOIN inside the bulk tool, drop the `customer_premium` sync. |
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
- **Analytics SQL** in `config/queries/` — the template ships LuxeBeauty example queries (returns/refunds/production lots). **Rewrite or delete every file for your demo's domain** — 2–4 queries aligned to your story's key numbers, hitting whatever tables your synth + SDP wrote. The placeholder `ai_demo_gen.demo_demo_project` in the example `FROM` clauses is from the template and points at nothing — until each `.sql` is updated to your real catalog + schema, `/analytics` will log `TABLE_OR_VIEW_NOT_FOUND` on every widget. Also update `client/src/analytics/AnalyticsView.tsx` so its `queryKey` list matches whichever files you keep.
- **Theme tokens** in `client/src/index.css` — brand palette and, if they exist, tier badges.

## Adapting to a reduced capability set

Not every demo has every Databricks capability. Drop surfaces that don't map:

| If demo has no… | Do this |
|-----------------|---------|
| **MAS** | Use `askGenieTool` from `server/agent/tools/genie.ts` instead of `askMasTool`. Update AgentContext field (`masEndpointName` → `genieSpaceId`) + config/app.json. Same `ToolProgressEvent` stream → no UI changes needed. |
| **Genie** | Use `askMasTool` (the template default). |
| **Both** | Register both factories in `makeTools` with distinct names (`ask_genie`, `ask_mas`); tell the model in agent instructions when to prefer each. |
| **KA** | Skip the "investigate documents" phase. Arc shortens: discover via data → draft → execute. |
| **ML model (no spec 03)** | Clear `config.data.tables.customerPremium` (empty string). Sync skips the premium query, the predictions mirror stays empty. Drop the `find_lot_premium_breakdown` tool from `makeTools`, collapse `process_return_batch`'s `tier_offers` back to a single `{coupon_code, email_subject_template, email_body_template}`, drop the `final_tier` JOIN in `processReturnBatchForLot`. Agent instructions revert to one email template, one coupon. Drawer's "Premium tier" panel hides itself when `final_tier` is null. |
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
  operations/           [D] OperationsView, KpiCards, ReturnsTable, ReturnDrawer, CityMap (react-leaflet bubble map), CountryPanel (bar list), tabs/ (Return, Customer, Activity)
  analytics/            [D] AnalyticsView (charts), FacilityPanel (drill-down)
  dashboard/                DashboardView (embedded AI/BI iframe from config.dashboardId)
  platform/                 PlatformView — "Databricks Data + AI" corporate pitch page (do not edit, generic)
  lib/
    api.ts                  Config + user fetch wrappers, plus shared `okOrThrow(res, label)` and `useResource(loader)` hook. EVERY fetch helper goes through okOrThrow so errors carry the server's actual message; views use useResource for boot-time loads so failures land as visible `{error, retry}` instead of "Loading…" forever.
    conversations.ts        Client conversation store (useSyncExternalStore). Exposes per-id `useConversationError(id)` so a failed `/api/conversations/:id` renders an error + Retry button in ChatView instead of a permanent empty state.
    returns.ts          [D] Domain entity fetch wrappers (all using okOrThrow).
    events.ts               dataMutated pub/sub (invalidate on agent writes)
    usePulseOnChange.ts     Hook: returns true for ~1.5s when a scalar value changes between renders. Wired into KpiCards (counts), ReturnsTable rows (status), CountryPanel rows (totals). The CityMap implements its own pulse via Leaflet's setStyle (className keyframes don't survive map redraws). See pattern #8.
```

## Lakebase schema (`server/db/schema.ts`)

**Chat state (generic):**
- `conversations`: id (uuid), userEmail, title, kind (`default`|`demo_dock`), timestamps
- `messages`: id (uuid), conversationId (FK), role, content, position, traceId (MLflow), thinking (jsonb[]), error, createdAt. **UNIQUE INDEX `messages_convo_pos_uq` on (conversation_id, position)** — turns the `SELECT MAX(position)+1` race in `appendMessage` into a 23505 unique_violation that the function retries (up to 5 attempts in a transaction); without it, two concurrent inserts would silently collide and break on-reload ordering.
- `feedback`: id (uuid), messageId (FK), userEmail, value (`up`|`down`), rationale, traceId, mlflowAssessmentId

**Domain tables (LuxeBeauty example):**
- `customers`: id, email, firstName, lastName, region, country, **city**, **customerLat**, **customerLng** (DOUBLE PRECISION, city-anchored coords + ~5km jitter — drives the Operations bubble map; see synth spec `01-lakeflow.md`), loyaltyTier, registrationDate
- `orders`: id, customerId (FK), orderDate, region, totalUsd, status
- `returns` (primary entity): id, orderId, customerId, returnDate, refundAmountUsd, returnReason, productId, productName, category, lotId, facility, region, status (`pending`|`approved`|`rejected`|`escalated`), **couponPctApplied** (int, null until processed — records the model-driven tier the agent applied), **emails** (jsonb[], append-only), **aiAuditTrail** (jsonb[], append-only), decidedAt, timestamps
- `customerPremium` (read-only ML predictions mirror — populated by sync.ts from the Delta table spec 03-ml-premium.md writes): customerId (PK), premiumProb (double), finalTier (`premium`|`standard`), premiumStatusLabeled (`premium`|`not_premium`|null pass-through from CS hand-tags), predictedAt. The agent's `find_lot_premium_breakdown` tool and the per-row JOIN inside `process_return_batch` read from this table; the app never calls the model directly. `premiumStatusLabeled` lets the UI distinguish "CS-tagged premium" from "model-found hidden premium" without a second query.

JSONB types: EmailEntry `{at, direction, from?, to?, subject, body}`, AuditEntry `{at, by, action, notes?, tool?}`, ThinkingEntry `{kind: tool_call|tool_output|intermediate_message, ...}`

## Delta → Lakebase sync (`server/db/sync.ts`)

One-shot at boot (skips if populated). Pulls via Databricks SQL Statements API — all **4** warehouse queries fire in parallel (customers, orders, returns, **customer_premium**), then inserts run sequentially in FK order (customers → orders → returns → customer_premium). Chunk sizes kept under Postgres's 65,535 parameter ceiling (rows × columns): 5k rows for customers/orders/premium, 2.5k for returns (16 cols including the new anger_score). Idempotent via `onConflictDoNothing`. Table names from `config.data.tables`. If `customerPremium` is unset in config, that query is skipped and the app degrades to no per-row tiering (the bulk tool falls every row through to the `standard` offer). Reset endpoint calls `wipeMirroredTables()` + re-sync.

## Agent (`server/agent/refundops.ts`)

AgentContext: `{db, userEmail, req, masEndpointName, databricksHost, model, onToolProgress?, modelError?}`. For Genie demos, replace `masEndpointName` with `genieSpaceId`.

**Tool flow** (see pattern #5 "Filter-driven bulk writes" below): the agent investigates via the data backend (`ask_mas`/`ask_genie`), calls `find_lot_premium_breakdown` to read the ML model's per-customer premium tier (and the labeled-vs-hidden split) for the lot's pending returns, drafts two emails (premium / standard), and triggers `process_return_batch` with a **filter** (the lot) plus a `tier_offers` dict — not a list of IDs. The SQL re-derives the row set + tier inside the same UPDATE; the agent never has to echo IDs back.

| Tool | Input → Output | Effect |
|------|---------------|--------|
| `ask_mas` | `{question}` → `{answer, trace_id}` | Streams MAS supervisor + sub-agents via onToolProgress → ThinkingPanel. From `tools/mas.ts`. |
| `ask_genie` | `{question}` → `{answer, trace_id}` | Polls Genie REST conversation API; streams reasoning traces (April 2026 release) as narration. From `tools/genie.ts`. Pick this OR `ask_mas`, not both (unless you want both registered). |
| `find_returns_for_lot` | `{lot}` → pending returns list with `final_tier` + `premium_status_labeled` + `premium_prob` + `anger_score` per row | Read-only Lakebase query joining `app.returns × app.customers × app.customer_premium` — for human confirmation, agent does NOT pass these ids anywhere. |
| `find_lot_premium_breakdown` | `{lot}` → `{total, premium_count, standard_count, premium_labeled_count, premium_predicted_hidden_count, no_prediction_count, premium_refund_usd, standard_refund_usd, top_countries[]}` | Read-only aggregation of the same JOIN — the "tiering moment". Reports BOTH the overall premium count AND the labeled-vs-hidden split. Agent quotes these in the Phase 2 draft. |
| `create_coupon` | `{percent_off, reason}` → `{code, ...}` | Pure function, no DB write. Called TWICE in the tiered flow (once per tier). |
| `process_return_batch` | `{lot, tier_offers: {premium: TierOffer, standard: TierOffer}}` → `{premium_coupon, standard_coupon, premium_email_count, premium_labeled_count, premium_predicted_hidden_count, standard_email_count, approved_count, total_refund_usd, skipped_return_ids}` | **WRITE, TIER-AWARE**: SELECT pending rows for `lot` JOIN-ing customer_premium, branch per-row on `final_tier` to pick the right offer (`premium` → `tier_offers.premium`, else `tier_offers.standard`), render that tier's template, one `UPDATE FROM VALUES` re-asserting `lot_id=$lot AND status='pending'` — sets `coupon_pct_applied`, appends emails + audit (with CS-tagged vs hidden notation per premium row), flips to approved. |

SDK setup: OpenAI client → `${host}/serving-endpoints`, **Responses API** (SDK default — we don't call `setOpenAIAPI`), custom fetch (Connection: close, strips long IDs >64 chars + `annotations` arrays from assistant content for compat), MLflow tracing (not OpenAI). On any non-2xx, the shim writes the response body into `ctx.modelError` so the catch block in agent-stream.ts can surface a real error message instead of "400 status code (no body)".

> **Model constraint: needs the Responses API.** The Agents SDK defaults to `/responses`, and Databricks gates that route per-model. `databricks-gpt-5-4` is the baseline that works today; a newer GPT endpoint (gpt-5-5, gpt-6, …) is fine **if it has `openai/v1/responses` in its `api_types`** — the version isn't the constraint, the Responses API is. Anthropic models (Sonnet 4.6, etc.) return 400 BAD_REQUEST: *"Responses API passthrough is not supported for model …"*; supporting Claude would require chat-completions + parsing Anthropic thinking blocks ourselves (~60-100 lines, not done). Keep `agentModel` on `databricks-gpt-5-4` or a newer Responses-capable GPT in `config/app.json`.

Instructions: MODE A (investigation — single `ask_mas`/`ask_genie` call) or MODE B (action — 3-phase: discover via ask_data + find_lot_premium_breakdown → draft TWO tiered emails for confirm → execute one tier-aware bulk call after approval).

## Routes

**Chat routes** (`server/routes/chat.ts`): GET/POST/DELETE `/api/conversations[/:id]`, GET `/api/dock-conversation`, POST `/api/chat/stream` (SSE), POST `/api/messages/:id/feedback`

**Domain routes** (`server/routes/returns.ts`): GET `/api/returns[?status=&lot=&tier=&country=&sort=]`, GET `/api/returns/summary`, GET `/api/returns/by-country[?status=&lot=]` (CountryPanel), GET `/api/returns/by-city[?status=&lot=]` (CityMap), GET `/api/returns/:id`, POST `/api/returns/:id/decide`, GET `/api/lots/summary`, GET `/api/facilities/summary`, GET `/api/facilities/:name/lots`, GET `/api/customers/:id/orders`

**Other**: GET `/api/config`, `/api/me`, `/api/warehouse`, `/api/activity/recent`, POST `/api/admin/reset`

## Domain queries (`server/db/queries/returns.ts`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `listReturns` | `(db, {status?, lot?, tier?, sort?, limit?})` | Filtered list for operations queue. LEFT JOIN on `customer_premium` so each row carries `finalTier` + `premiumStatusLabeled` + `premiumProb`. Also exposes `angerScore` (from the synced silver column). `sort='anger'` orders by anger DESC — the demo's `ai_classify` showcase. |
| `getReturn` | `(db, id)` | Full row with emails[] + aiAuditTrail[] + final_tier + premium_status_labeled + premium_prob + predicted_at + coupon_pct_applied + anger_score + customer country |
| `decideReturn` | `(db, {id, userEmail, decision, notes?})` | Append audit entry + flip status |
| `returnsSummary` | `(db)` | GROUP BY status → `{status, n, total_usd}[]` |
| `facilitySummary` | `(db)` | `{facility, return_count, pending_count, total_refund_usd}[]` |
| `lotsByFacility` | `(db, facility, limit)` | Top lots within a facility |
| `lotSummary` | `(db, limit)` | Global top lots by return count |
| `listCustomerOrders` | `(db, customerId, limit)` | Customer's order history |
| `recentActivity` | `(db, limit)` | UNION of emails[] + aiAuditTrail[] across all rows, sorted by time |
| `lotCountryBreakdown` | `(db, {status?, lot?})` | Per-country aggregation of the filtered queue (`{country, total, premium, premium_labeled, premium_hidden, refund_usd}[]`). Powers the CountryPanel bar list. |
| `lotCityBreakdown` | `(db, {status?, lot?})` | Per-(city, country) aggregation with `AVG(customer_lat/lng)` and `COUNT(DISTINCT customer)`. Skips rows with NULL coords. Powers the CityMap bubble layer. |
| `lotPremiumBreakdown` | `(db, lot)` | Tier-split aggregate joining returns × customers × customer_premium for one lot, with the labeled-vs-hidden premium split. Powers the agent's `find_lot_premium_breakdown` tool. |
| `processReturnBatchForLot` | `(db, {lot, tier_offers: {premium, standard}, userEmail})` | **Tier-aware bulk, transactional**: `db.transaction(tx => …)` runs `SELECT … FOR UPDATE OF r` to lock pending rows for the lot, branches per row on `final_tier` to pick the offer, renders that tier's template, then one `UPDATE … FROM (VALUES …) … RETURNING id` re-asserting `lot_id=$lot AND status='pending'` (sets `coupon_pct_applied`, appends emails + audit with CS-tagged vs hidden notation, flips to approved). Per-tier counts in the returned summary are recomputed from `RETURNING` — anything attempted-but-not-updated lands in `skipped_return_ids` with a warn log so the agent's final message can't lie. Filter is a scalar — no `IN (…)` / ID round-tripping. |

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
  "_agentModel_help": "...", "agentModel": "databricks-gpt-5-4",
  "_mlflow_help": "...", "mlflowExperimentId": "...", "agentMlflowExperimentPath": "" /* empty → app self-derives /Shared/solution_builder/<app_name>-agent-traces */,
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
5. **Filter-driven bulk writes** (the demo's "AI takes action" moment):
   - **Investigate** via the data backend (`ask_mas` / `ask_genie`) — open-ended SQL + KA reasoning across the warehouse.
   - **Show** the affected rows to the user via a read-only lookup tool (`find_returns_for_lot`) — they confirm scope before anything destructive runs.
   - **Write** via a tool whose only inputs are a FILTER (a scalar lot id, status, region — never a list of IDs) plus the per-row template (email subject/body, coupon, etc.). Wrap SELECT + UPDATE in `db.transaction(tx => …)`; use `SELECT … FOR UPDATE OF <primary table>` so a concurrent manual decision / agent retry can't flip rows between read and write; do ONE `UPDATE … FROM (VALUES …) … RETURNING id` re-asserting the same filter so writes can't drift from reads; derive counts/totals from the RETURNING ids (NOT from intent) so the agent's final summary reflects reality.
   - Why this shape: agents echoing back N IDs in `IN (…)`/`ANY (…)` hits param caps, blows up the request, and is easy for the model to miscount. With a scalar filter, the agent only ever holds a string — and the read and write can't disagree because they share the same predicate AND the row lock.
6. **Data backend as a tool**: `ask_mas` (or `ask_genie`) is registered via factories in `server/agent/tools/{mas,genie}.ts`. Sub-agent / reasoning activity streams to ThinkingPanel via `onToolProgress` → SSE. Same `ToolProgressEvent` shape for both, so the UI doesn't care which backend powers it.
7. **MLflow tracing**: Per-turn spans, tool child spans, trace ID on message → "View trace" link. Thumbs → human assessments.
8. **Diff-aware pulse on agent writes**: `dataMutated.emit()` triggers a refetch on every subscribing surface. Each surface compares prev-vs-next scalar values via `usePulseOnChange(value)` and only the elements whose value actually changed flash a ring/row highlight for ~1.5s. Wired into KpiCards (counts), ReturnsTable rows (status), CountryPanel rows (totals). The CityMap implements the same idea differently — see below — because CSS keyframes on SVG paths don't survive Leaflet's redraws.
9. **City bubble map (Leaflet sharp edges)**: `client/src/operations/CityMap.tsx` uses react-leaflet 5 + OSM/CARTO Positron tiles + one CircleMarker per (city, country). Three Leaflet gotchas the file already handles — preserve them:
   - **CSS load order**: `leaflet/dist/leaflet.css` is imported in `client/src/index.css`, NOT in the component. Importing it in the component races the first paint in dev/HMR and renders broken tile sizes.
   - **Pulse via `setStyle`**: bubble pulse is implemented by toggling `pathOptions.weight` (stroke width) and `fillOpacity` for ~1s. Do NOT add a className-based CSS keyframe pulse to the path — Leaflet's `setStyle` only re-applies CSS-style attributes and ignores `className`, so the keyframe never reaches the SVG after the first paint.
   - **No fitBounds on every refetch**: `FitBoundsOnSetChange` re-fits ONLY when the SET of `country:city` keys changes, not when counts move. Re-fitting on every `dataMutated` would make the map wobble during the demo.
   Map data comes from `/api/returns/by-city` (`lotCityBreakdown` query). The synth-data spec (`01-lakeflow.md` for the upstream pipeline) populates `customers.city` + `customers.customer_lat` + `customers.customer_lng` from a city-anchor table per country; the sync pulls those columns into Lakebase. Demos without GPS coords on customers should leave the columns NULL — the query skips NULL-coord rows and the map renders "No affected customers in the current scope".

## `config/app.json` validation (server-side, at boot)

`server/server.ts` Zod-validates `config/app.json` at boot via `loadAppConfig()`. The validator fails fast (the app refuses to start) when:

- The JSON is malformed (typo, missing comma).
- Required structural fields are missing (`branding.appName`, `dashboardId`, `data.catalog`, `data.schema`, `data.tables.*`).
- Any of `dashboardId`, `branding.appName`, `data.catalog`, `data.schema` still contain an unfilled `<placeholder>` (e.g. `<your-catalog>`). The build agent MUST replace these before the app can boot.

It warns (and continues) for unfilled `<placeholder>` in MLflow paths (`agentMlflowExperimentPath`, `mlflowExperimentId`) — those are opt-in features and a missing path just shows "Trace pending…" in the UI.

`_*_help` sibling keys and any unknown extra keys pass through unread (`.passthrough()`).
