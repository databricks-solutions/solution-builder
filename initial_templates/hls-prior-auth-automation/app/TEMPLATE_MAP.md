# App Template Map

Reference for agents customizing this template. Read this instead of scanning every file.

## What this app is (functional)

This is the **UM workbench surface** for payer prior authorization — the place where the AI pre-screens cases against policy, auto-approves eligible ones, drafts provider requests for missing docs, and writes decisions back to Delta. It pairs with AI Functions (evidence extraction), a Genie agent (CMS metrics over the tables + policy lookup over the medical policy documents), and an AI/BI dashboard (compliance tracking). Its unique job: show a nurse reviewing a PA request, confirming auto-approve eligibility + provider request drafts + case history + policy rules, then clicking Approve (decision written to Lakebase + Delta).

**Canonical demo arc** (MedVault PA example, transferable to any payer decision support domain):
1. User (Dana, UM nurse) opens Briefing. KPIs show: 196 cases waiting, ~90 meet every policy criterion, 5 expedited past 72h, ~40 auto-approvable. The AI pre-review lanes bar shows counts by lane (Auto-approve / Nurse / Request info / Physician).
2. User clicks Worklist, filters to Expedited. The two weekend-faxed lumbar MRIs show red clocks (7h and 11h left — both already in Auto-approve lane).
3. User clicks one MRI case. Case drawer shows: clinical summary with evidence highlighted + tagged by criterion (C1, C2 missing, C3). A pre-drafted provider request letter offers to send (auto-drafted from policy gaps). "Ask the medical policy" banner opens the dock.
4. Agent calls `queue_overview` (case summary + lanes), then `auto_approval_candidates` (count + list), then `ask_data` (the Genie agent: policy rule from the documents, "who can deny?") → streams investigation into Thinking panel.
5. User clicks "Release auto-approvals" → agent calls `auto_approve_batch` (approves the lane, writes decisions) and **stops after confirming the count**.
6. User approves → Lakebase updates with decisions, Delta `um_decisions` table now holds the write-backs. Briefing auto-refetches: approved count up, auto-approve lane count down. CMS dashboard now shows the new decisions.
7. **"Decided" tab on Briefing fills with the decisions** the agent just wrote. Plant manager sees the approval rate tick up in the dashboard.

The demo lands because the user watched the AI *make scalable, compliant decisions* at a payer's decision pace — not because the agent said something clever.

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
- **dbdemos usage tracker** (`lib/tracker.ts`, registered first in `appkit.server.extend`) — keep it; set a unique `config/app.json` `dbdemosAppId` (`<demo-slug>-<resource_suffix>`, see app.md). Empty = off.

### Tier 2 — Canonical defaults (the demo's "house style" — change with intent)

These fit the canonical arc (investigate → approve → act). They *usually* survive a rewrite because most demos want the same shape — but swap them if the story genuinely differs.

| Default | Keep when… | Change when… |
|---------|------------|--------------|
| **3-phase chain** (discover → draft+confirm → execute) | Story has a "fix it" moment where the user approves a batch action | Story is read-only (pure investigation, no action) → drop phases 2–3. Story has multiple action types → document each chain. |
| **ML-driven tiering** in phase 2 (call a premium / propensity table to split the cohort + draft two emails) | Demo has a buildable model in spec 03 whose predictions can change the agent's action per-row | Story has no ML → drop `find_lot_premium_breakdown`, collapse `tier_offers` back to a single `{coupon_code, email_subject, email_body}`, drop the `final_tier` JOIN inside the bulk tool, drop the `customer_premium` sync. |
| **`triggerAfter` keyword progression** on `assistantScript` | Linear demo script (SA clicks chips in order) | Free-form exploration demo → drop triggers, use plain prompts. |
| **Append-only audit** (`emails[]` + `aiAuditTrail[]` JSONB on primary entity) | Demo shows "the AI did X at Y" timeline | No timeline tab, no action history needed → drop the JSONB columns. |
| **`dataMutated` pub-sub** | Operations page should update live when the agent writes | Read-only demo, no writes to react to → harmless but dead weight. |
| **`ask_data` (Genie Agent)** | Demo has a Genie Agent space (the default) | No Genie space → drop the tool and the `genieSpaceId` config. Need a second data backend → register another tool with a distinct name and tell the model when to use each. |
| **ChatDock + Home chips with script** | SA is the presenter; demo is scripted | End-user-driven demo → surface the chat on its own page, drop the dock's "next chip" mechanic. |

### Tier 3 — Always rewrite per demo (content, not infra)

Every demo touches these. They're what makes your demo yours, not MedVault's.

- **Persona/story/copy** — hardcoded constants at the top of `BriefingView.tsx`. Replace wholesale: persona name, KPI thresholds, alert conditions, lane descriptions.
- **`config/app.json`** — `branding`, `assistantScript` steps, `data.tables`, `dashboardId`, `genieSpaceId` (Genie Agent space: tables + documents volume), `mlflowExperimentPath`, `agentModel`. Each field has a `_*_help` sibling explaining what it does + which file consumes it.
- **Domain schema** (`server/db/schema.ts`) — the primary entity swaps (pa_requests → claims → appeals → whatever). If you keep Tier 2 audit columns, their shape is fixed; the surrounding columns are yours.
- **Agent tools** (`server/agent/paops.ts`) — the file is renamed per demo and the import in `chat-stream/agent-stream.ts` updated. Tool names and bodies swap; if you keep the queue-overview → case-detail → auto-approve-lane → write-decision chain, the *shape* of the tools is what's preserved. The data tool (`ask_data`) comes from the `askDataTool` factory in `server/agent/tools/genie.ts` — one Genie Agent for SQL + documents.
- **Domain CRUD** (`server/db/queries/cases.ts`, `server/routes/cases.ts`).
- **Worklist + Case drawer** — table columns, evidence highlight tags, decision buttons, drawer tabs.
- **Analytics SQL** in `config/queries/` — rewrite every file for your payer's domain. 2–4 queries aligned to your KPIs (approval %, turnaround, denials by policy, pend drivers). Update `client/src/analytics/AnalyticsView.tsx` so its `queryKey` list matches whichever files you keep.
- **Theme tokens** in `client/src/index.css` — brand palette (health plan colors), status badges (approved/denied/pending).

## Adapting to a reduced capability set

Not every demo has every Databricks capability. Drop surfaces that don't map:

| If demo has no… | Do this |
|-----------------|---------|
| **Documents** (no policy docs) | Don't attach a volume. The Genie Agent answers from the tables only; skip the "look up the policy" beat. |
| **ML model (no spec 03)** | Clear `config.data.tables.customerPremium` (empty string). Sync skips the premium query, the predictions mirror stays empty. Drop the `find_lot_premium_breakdown` tool from `makeTools`, collapse `process_return_batch`'s `tier_offers` back to a single `{coupon_code, email_subject_template, email_body_template}`, drop the `final_tier` JOIN in `processReturnBatchForLot`. Agent instructions revert to one email template, one coupon. Drawer's "Premium tier" panel hides itself when `final_tier` is null. |
| **Dashboard** | Remove `/dashboard` route + nav item + journey card. |
| **Analytics charts** | Remove `/analytics` route; demo relies on the embedded dashboard instead. |
| **Write action** (read-only demo) | Skip the bulk-action tool. Arc shortens to discover → answer (no approval step). Much less impressive — only choose this if the story genuinely doesn't need a fix. |

The smallest viable demo: Home + Chat dock + Operations + one agent tool that reads Lakebase. Everything else is additive.

## File structure

Files marked `[D]` are domain-specific (PA example — adapt per payer/domain). Others are generic infrastructure.

```
config/
  app.json              [D] App name, resource IDs, data sources, assistant script steps
  queries/*.sql         [D] Analytics SQL (Delta via SQL Warehouse): compliance %, turnaround, pend drivers, etc.

server/
  server.ts                 Boot: load config → AppKit app → runDbInit (migrations + Delta sync) → MLflow init → routes
  agent/
    paops.ts            [D] Agent definition, tools, system prompt (OpenAI Agents SDK).
                            Renamed per payer (e.g. claimsops.ts, appealsops.ts). Update import in chat-stream/agent-stream.ts.
    tools/
      types.ts              Shared types for the data-backend tools (ToolProgressEvent, DataCallResult, DataToolContext)
      genie.ts              askDataTool factory + callGenieAgent helper — the Genie Agent (Agent mode, SSE): CMS metrics over the tables + search over the medical policy documents
  db/
    schema.ts           [D] Lakebase tables (Drizzle ORM): pa_requests, clinical_notes, members, providers, policies, criteria, decisions, etc.
    sync.ts             [D] Delta → Lakebase sync queries
    migrate.ts              Migration runner
    init.ts                 Boot DB-init policy: migrations FATAL, Delta sync BEST-EFFORT. Unit-tested in init.test.ts.
    index.ts                DB pool init
    queries/
      chat.ts               Conversation + message CRUD
      cases.ts          [D] Domain entity (case) CRUD + queue operations
  chat-stream/
    agent-stream.ts         Drives the OpenAI Agents SDK loop, translates SDK events → SSE taxonomy
    index.ts                /api/chat/stream entry point: persist user msg → sanitize history → streamAgentTurn
    sse.ts                  SSE helpers
  routes/
    chat.ts                 Conversations CRUD, streaming turns, feedback
    cases.ts            [D] Domain entity (case) endpoints: queue, case detail, decisions
    config.ts               /api/config, /api/me, /api/warehouse
    activity.ts             Recent activity feed
    admin.ts                Demo reset (truncate + re-sync)
  lib/
    auth.ts                 Databricks OBO auth headers (+ SP retry on 401/403 for model endpoint)
    mlflow.ts               Experiment get-or-create, feedback → assessments
    user.ts                 User identity from request headers
    endpoint.ts             fixMojibake helper (UTF-8 / Latin-1 re-decode for streaming gateway quirks)
    templates.ts        [D] Provider request letter template placeholder filling
    writeback.ts        [D] Write decisions back to Delta um_decisions table

client/src/
  App.tsx                   Routes: / (Briefing), /worklist, /case/:id, /c/:id (Chat), /analytics, /dashboard, /platform
  shared/types.ts       [D] Domain entity types (CaseRow, ClinicalNoteRow, DecisionRow, etc.)
  shell/                    AppSidebar (nav), AppHeader (chrome)
  home/HomeView.tsx [D] triage board: 4 lanes of request cards (SLA clock, criteria ticks), KPI strip, auto-approve release button, decision feed
  chat/                     ChatDock (floating), ChatView (full-page), ThinkingPanel, MessageBubble,
                            useChatTurn (hook), streamChat (SSE parser), script.ts, dockController, FeedbackRow
  worklist/             [D] WorklistView (case queue sorted by SLA clock, color-coded), CaseDrawer (evidence + letter + decision buttons)
  case/                 [D] CaseDetailView (full-page case view), ClinicalSummary (with criterion tagging), ProviderLetter, Timeline
  analytics/            [D] AnalyticsView (CMS metrics charts: compliance %, turnaround, pend drivers)
  dashboard/                DashboardView (embedded AI/BI iframe from config.dashboardId)
  platform/                 PlatformView — "Databricks Data + AI" corporate pitch page (do not edit, generic)
  lib/
    api.ts                  Config + user fetch wrappers, plus shared `okOrThrow(res, label)` and `useResource(loader)` hook.
    conversations.ts        Client conversation store (useSyncExternalStore). Exposes per-id `useConversationError(id)`.
    cases.ts            [D] Domain entity (case) fetch wrappers (all using okOrThrow).
    events.ts               dataMutated pub/sub (invalidate on agent writes)
    usePulseOnChange.ts     Hook: returns true for ~1.5s when a scalar value changes between renders. Wired into KpiCards, worklist rows, decision list. See pattern #8.
```

## Lakebase schema (`server/db/schema.ts`)

**Chat state (generic):**
- `conversations`: id (uuid), userEmail, title, kind (`default`|`demo_dock`), timestamps
- `messages`: id (uuid), conversationId (FK), role, content, position, traceId (MLflow), thinking (jsonb[]), error, createdAt. **UNIQUE INDEX `messages_convo_pos_uq` on (conversation_id, position)** — turns the `SELECT MAX(position)+1` race into a 23505 unique_violation that the function retries (up to 5 attempts in a transaction); without it, two concurrent inserts would silently collide and break on-reload ordering.
- `feedback`: id (uuid), messageId (FK), userEmail, value (`up`|`down`), rationale, traceId, mlflowAssessmentId

**Domain tables (PA example — adapt per payer/domain):**
- `pa_requests` (primary entity): id, request_id (e.g. PA-00195), member_id (FK), provider_id (FK), policy_id (FK), request_date, service_date, urgency (`expedited`|`standard`), status (`open`|`approved`|`denied`|`pending_info`), sla_deadline, sla_clock (int, hours until deadline), ai_lane (`auto_approve`|`nurse_review`|`request_info`|`physician_review`), approved_by, denied_by_reason, **aiAuditTrail** (jsonb[], append-only — who reviewed, when, what action), approved_at, decided_at, timestamps
- `clinical_notes`: id, pa_request_id (FK), member_id (FK), note_text, indexed_at, ai_case_review_id (FK) — the clinical summary from the member's record + the note excerpt used for the case
- `members`: id, member_id (PK), firstName, lastName, dob, effectiveDate, plan_type (`Medicare`|`Commercial`|`Medicaid`)
- `providers`: id, provider_id (PK), providerName, specialization, practice_group_name, state, zip, pend_rate_pct (calculated from historical PAs)
- `medical_policies`: id, policy_id (PK), policy_name (e.g. `MV-UM-001`), policy_title, version, effective_date, criteria_count, criteria[] (jsonb)
- `policy_criteria`: id, policy_id (FK), criterion_name (e.g. `C1_age`), criterion_description, evidence_required_text
- `ai_case_review` (results from AI Functions): id, pa_request_id (FK), reviewed_at, ai_lane, confidence, criteria_evidence[] (jsonb) — evidence extracted from notes + matched to policy criteria
- `decisions` (WRITE surface — agent writes here): id, pa_request_id (FK), decision (`approved`|`denied`|`pending_info`), decision_by (`agent`|`nurse`|`physician`), decided_at, rationale, **aiAuditTrail** (jsonb[])

JSONB types: CriteriaMatch `{criterion_name, found: bool, evidence_text?, confidence?: double}`, AuditEntry `{at, by: 'agent'|'nurse'|'physician', action: 'approved'|'denied'|'pending_requested', notes?}`, ThinkingEntry `{kind: tool_call|tool_output|intermediate_message, ...}`

## Delta → Lakebase sync (`server/db/sync.ts`)

One-shot at boot (skips if populated). Pulls via Databricks SQL Statements API — all **4** warehouse queries fire in parallel (customers, orders, returns, **customer_premium**), then inserts run sequentially in FK order (customers → orders → returns → customer_premium). Chunk sizes kept under Postgres's 65,535 parameter ceiling (rows × columns): 5k rows for customers/orders/premium, 2.5k for returns (16 cols including the new anger_score). Idempotent via `onConflictDoNothing`. Table names from `config.data.tables`. If `customerPremium` is unset in config, that query is skipped and the app degrades to no per-row tiering (the bulk tool falls every row through to the `standard` offer). Reset endpoint calls `wipeMirroredTables()` + re-sync.

## Agent (`server/agent/paops.ts`)

AgentContext: `{db, userEmail, req, genieSpaceId, databricksHost, model, onToolProgress?, modelError?}`. The Genie agent id is resolved at boot (env, else `demo_resources`).

**Tool flow** (see pattern #5 "Filter-driven bulk writes" below): the agent starts with `queue_overview` (summary + lanes), investigates a case via `get_case`, checks auto-approval eligibility via `auto_approval_candidates`, looks up policy rules AND queries pend trends via the Genie agent (`ask_data`), and triggers `auto_approve_batch` with a **lane filter** (the auto-approve lane) — not a list of case IDs. The SQL re-derives the case set inside the same transaction; the agent never has to echo IDs back.

| Tool | Input → Output | Effect |
|------|---------------|--------|
| `queue_overview` | `{}` → `{summary: {total_open, expedited_count, breached_count, pending_auto_approvals, decisions_today}, breakdown: {lanes[]}}` | Read-only Lakebase query joining pa_requests + ai_case_review. Returns lane split (Auto-approve / Nurse / Request info / Physician) with counts + sample case IDs. |
| `get_case` | `{case_id}` → full case: request metadata + clinical summary + evidence tags + prior history + provider profile + pending letter + decision log | Read-only Lakebase query. Returns everything the drawer needs (no secrets, audit-trail only). |
| `auto_approval_candidates` | `{}` → `{count, cases[], total_approval_value_usd}` | Read-only query: cases in the Auto-approve lane (ai_lane='auto_approve'). Lists by SLA clock (reddest first). |
| `ask_data` | `{question}` → `{answer, trace_id}` | Genie Agent (`POST /api/2.0/genie/agents/{id}/responses`, SSE). One turn runs `execute_sql` for CMS metrics and `search_context_files` for the medical policy documents; streams each SQL statement and document search via onToolProgress; returns markdown with `[n](url)` citations. Answers: "Who can deny?", "Why are lumbar MRIs pended?", "Approval % this week?". From `tools/genie.ts`. |
| `auto_approve_batch` | `{lane_filter: 'auto_approve', comment: 'Released via PA Copilot'}` → `{approved_count, total_value_usd, case_ids[], decisions_written_at}` | **WRITE, transactional**: `db.transaction(tx => …)` re-verifies auto-approve eligibility for each case in the lane (filters may have changed since the `auto_approval_candidates` call), writes decisions to `decisions` table and `um_decisions` (Delta write-back) with `aiAuditTrail` `{at: now(), by: 'agent', action: 'approved', comment: '...'}`, flips status to approved. Returns approved count + case IDs + timestamp. Fails cleanly if lane verification fails. |

SDK setup: OpenAI client → `${host}/serving-endpoints`, **Responses API** (SDK default), custom fetch (Connection: close, strips long IDs >64 chars), MLflow tracing. On any non-2xx, the shim writes the response body into `ctx.modelError`. **On 401/403, retries once with the app service principal** (OBO -> SP) for model endpoint auth issues — important for cross-workspace deploys.

> **Model constraint: needs the Responses API.** `databricks-gpt-5-4` is the baseline; a newer GPT (gpt-5-5, gpt-6) is fine **if it has `openai/v1/responses` in its `api_types`**. Anthropic models return 400 BAD_REQUEST. Keep `agentModel` on `databricks-gpt-5-4` or a newer Responses-capable GPT in `config/app.json`.

Instructions: MODE A (queue review — `queue_overview` + `auto_approval_candidates` + "release?") or MODE B (case investigation — `get_case` + `ask_data` + "approve/pend/deny?").

## Routes

**Chat routes** (`server/routes/chat.ts`): GET/POST/DELETE `/api/conversations[/:id]`, GET `/api/dock-conversation`, POST `/api/chat/stream` (SSE), POST `/api/messages/:id/feedback`

**Domain routes** (`server/routes/cases.ts`): GET `/api/cases/queue[?status=&urgency=&lane=&sort=sla_clock]`, GET `/api/cases/summary`, GET `/api/cases/:id`, GET `/api/cases/:id/decisions`, POST `/api/cases/:id/decide` (Approve/Deny/Pend), GET `/api/cases/lanes`, GET `/api/providers/:id`, GET `/api/members/:id`

**Other**: GET `/api/config`, `/api/me`, `/api/warehouse`, `/api/activity/recent`, POST `/api/admin/reset`

## Domain queries (`server/db/queries/cases.ts`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `caseQueue` | `(db, {status?, urgency?, lane?, sort?, limit?})` | Filtered PA queue for the Worklist. JOIN pa_requests × members × providers × policies. Returns request_id, patient_name, provider_name, policy_name, service_date, urgency, sla_clock (hours until deadline — red if <0, amber if <24), ai_lane, status, today_decision_count. `sort='sla_clock'` orders by clock ASC (reddest first). |
| `caseSummary` | `(db)` | GROUP BY status + urgency → `{open_count, expedited_count, breached_count, pending_auto_approvals_count, decisions_today}`. Powers Briefing KPIs. |
| `getCase` | `(db, case_id)` | Full case: pa_request + clinical_notes + evidence (from ai_case_review) + member profile + provider profile + prior PA history + booked decision (if exists) + aiAuditTrail. |
| `decideCase` | `(db, {case_id, userEmail, decision, decision_by, rationale?})` | Write decision to `decisions` table + `um_decisions` (Delta) + append aiAuditTrail + flip pa_request.status. Transactional. |
| `queueBreakdown` | `(db)` | Breakdown by lane (auto_approve, nurse_review, request_info, physician_review) → `{lane, count, sample_case_ids[], total_cases}[]`. Powers the lanes bar on Briefing. |
| `autoApprovalCandidates` | `(db)` | Cases in auto_approve lane (ai_lane='auto_approve' AND status='open'). Returns case_id, member_name, provider_name, policy_name, request_date, sla_clock, confidence. Sorted by SLA clock DESC (reddest first). |
| `autoApproveBatch` | `(db, {lane_filter: 'auto_approve', userEmail, comment?})` | **Transactional bulk write**: `db.transaction()` re-verifies auto-approve eligibility for each case in the lane (in case lane changed since the `autoApprovalCandidates` call), writes decisions to `decisions` + `um_decisions` with aiAuditTrail `{at, by: 'agent', action: 'approved'}`, flips status. Returns approved_count + case_ids + timestamp. Fails cleanly if lane verification fails. |
| `recentActivity` | `(db, limit)` | UNION of aiAuditTrail[] entries from all decisions + recent case updates, sorted by time DESC. Powers activity feed on Briefing + timeline in CaseDetailView. |
| `practiceGroupStats` | `(db)` | GROUP BY practice_group → `{practice_group, total_cases, pend_count, pend_rate_pct, denial_rate_pct}[]`. Powers pend-driver drill-downs. |

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
  "_dataBackend_help": "...", "genieSpaceId": "" /* empty → read from demo_resources */,
  "_agentModel_help": "...", "agentModel": "databricks-gpt-5-4",
  "_mlflow_help": "...", "mlflowExperimentId": "...", "agentMlflowExperimentPath": "" /* empty → app self-derives /Shared/solution_builder/<app_name>-agent-traces */,
  "_dashboard_help": "...", "dashboardId": "...",
  "_data_help": "...", "data": { "catalog": "...", "schema": "...", "tables": { ... } },
  "_branding_help": "...", "branding": { "appName": "..." },
  "_assistantScript_help": "...", "assistantScript": [ { "prompt": "..." }, { "prompt": "...", "triggerAfter": ["keyword"] } ]
}
```

`genieSpaceId` is the Genie Agent the `ask_data` tool queries (tables + the medical policy documents). The `_help` keys are ignored at runtime — they're for the LLM customizing this template.

Narrative copy (hero persona, headline, situation, goal, starter questions, featured-action CTA) lives **hardcoded at the top of `client/src/home/HomeView.tsx`** as constants — rewrite those for your demo. Only `assistantScript` + `branding` need to stay in config (script is reused by the chat dock, branding by the shell).

## Client component details

**BriefingView** (Briefing): KPI tiles (open cases, expedited, breached SLA clocks, pending auto-approvals, today's decisions — hardcoded thresholds at top of file), priority alert (top-N overdue expedited cases), pre-review lanes bar (pie chart: Auto-approve / Nurse / Request info / Physician), "Release auto-approvals" button (calls agent with count confirmation), starter question chips (each → `dockController.openAndSend`), activity feed (fetches `/api/activity/recent`, shows decisions + case events with relative timestamps).

**WorklistView**: Fetches `/api/cases/queue?status={filter}&urgency={urgency}&lane={lane}&sort=sla_clock`. Subscribes to `dataMutated` (refetches on agent writes). URL-synced filters (`?lane=auto_approve`). Renders CaseTable (columns: Request ID, Patient, Provider, Policy, Service Date, Urgency, SLA Clock [color-coded red/amber/green], Lane, Status — click selects case). "Ask the assistant" banner opens dock.

**CaseDrawer** (WorklistView slide-over): Clinical summary with evidence highlighted + tagged by policy criterion (C1, C2, C3 — red if missing), provider request letter (auto-drafted from policy gaps + case facts — "Send to provider" button pre-opens an email window), decision buttons (Approve / Pend / Deny — deny only visible if user_role='physician'or 'director'), activity timeline (merged from case.aiAuditTrail[]), tabs for (Details, Evidence, Prior History, Timeline).

**CaseDetailView** (full-page case view): Same as drawer but expanded — clinical summary full-width, evidence with full notes rendered, member profile card (enrollee ID, group, plan type, coverage), prior PA history (table: date, service, decision, result), provider profile + stats (pend rate for this provider), decision trail (who, when, what, notes).

**AnalyticsView**: Warehouse badge (name + state), LineChart (expedited compliance % + standard compliance % over 30 days), BarChart (turnaround by decision path: Auto-approve / Nurse / Physician), DataTable (top 10 pend reasons by count + practice group), FacilityPanel (practice-group drill-down → select practice → navigate to `/worklist?practice_group=…`).

## Analytics SQL (`config/queries/`)

- `compliance_expedited.sql` — `SELECT approved_count, denied_count, pending_count, total_count, (approved_count * 100.0 / total_count) as approval_pct, (COUNT(CASE WHEN days_to_decision <= 3 THEN 1 END) * 100.0 / total_count) as within_72h_pct FROM pa_decisions WHERE decision_date >= CURRENT_DATE - INTERVAL 30 days` (CMS compliance: 72h expedited window)
- `turnaround_by_decision_path.sql` — `SELECT decision_path, AVG(hours_to_decision) as avg_turnaround, COUNT(*) as decision_count FROM pa_decisions WHERE decision_date >= CURRENT_DATE - 7 days GROUP BY decision_path ORDER BY avg_turnaround` (Turnaround by Auto-approve / Nurse / Physician)
- `pend_drivers.sql` — `SELECT top_pend_reason, COUNT(*) as pend_count, practice_group_name FROM pa_pends WHERE pend_date >= CURRENT_DATE - 30 days GROUP BY top_pend_reason, practice_group_name ORDER BY pend_count DESC LIMIT 15` (Top reasons cases are pending for info + practice group)

## How the agent runner works (`server/chat-stream/agent-stream.ts`)

Uses `@openai/agents` SDK. Flow:
1. Start MLflow span (`paops.turn`, spanType: AGENT)
2. Build agent via `buildAgent(ctx)` — returns `Agent` with name, model, modelSettings (`reasoning: {effort: 'low', summary: 'auto'}`), instructions, tools (queue_overview, get_case, auto_approval_candidates, ask_data, auto_approve_batch)
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
   - **Investigate** via the Genie Agent (`ask_data`) — open-ended SQL + policy-document reasoning across the warehouse and the documents volume.
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
