# App Specification — Overview, Home & Assistant

> **Build-time note.** Read `DEMO_SKILL_DIR/app/app.md` FIRST and follow it end-to-end — that's the playbook (rsync template → customize → Lakebase → env → smoke test → deploy). This is **not** a from-scratch build: the template at `DEMO_SKILL_DIR/app/app_template/` is a Node.js + React + Express app with Lakebase, MLflow tracing, OBO auth, chat dock, and scripted demo chain already wired. You rsync it into `PROJECT/app/`, read `TEMPLATE_MAP.md` for what's preserved vs. customized, then rewrite domain pieces (home narrative, agent tools, Lakebase schema, analytics SQL, theming) to match the story. Typically run as a subagent spawned once `01-lakeflow.A` is ready. **Do NOT rebuild in Streamlit / Gradio** — you'd lose streaming, MLflow tracing, the scripted chain, and the OBO/audit pattern. On conflict: `app.md` governs *how*, this spec governs *what*.

> **Simple-demo contract.** A focused Returns Console: dashboard + Genie + a single Genie-backed agent that drafts a flat 10% goodwill offer for the affected-lot customers and waits for one approval before bulk-processing the refunds.

## Pitch

A clean Returns Console where Claire's team triages refunds. KPI cards tick live as the queue moves, the dock assistant answers *"why so many returns?"* by streaming a Genie investigation into the conversation, and one featured-action click bulk-approves the ~250 affected-lot returns with a flat 10% goodwill coupon. Every action is traced in MLflow; every write lands in Lakebase under the same Unity Catalog governance as the lakehouse.

## Databricks capabilities mapped

| Capability | Where it shows |
|---|---|
| **SQL Warehouse on Delta** | Analytics charts query live `gold_*` tables |
| **AI/BI Genie (single-agent tool)** | The dock assistant has one `ask_data` tool that calls Genie directly. |
| **Lakebase** | OLTP write surface — approve returns, append audit trail, record the goodwill email. Same UC governance as Delta. |
| **MLflow tracing** | Per-turn traces with tool spans. Thumbs up/down → human assessments on traces. Header links to the experiment. |
| **Databricks Apps** | SSO, OBO auth (actions stamped with Claire's email), secrets, auto-scaling. |
| **AI/BI Dashboards** | Embedded as iframe with SSO — no chart rebuilding. |

## Pages

| Page | Purpose | Key capability |
|---|---|---|
| **Home** | Narrative landing — story, persona, journey diagram, starter chips, featured action card, activity feed | Config-driven (`config/app.json`) |
| **Operations** | Returns queue — status tabs, search, lot filter, KPI cards (Pending / Approved / Escalated), detail drawer with decision buttons + audit timeline | **Lakebase** OLTP |
| **Analytics** | Warehouse-backed charts (`@databricks/appkit-ui/react`): daily refund trend, returns by product, worst lots, facility drill-down → links to Operations filtered by lot | **SQL Warehouse** on Delta |
| **Dashboard** | Embedded AI/BI dashboard iframe. Remove the page if the build skipped the dashboard. | **AI/BI Dashboards** |

## Assistant

Lives on every page. Two surfaces, one brain:

- **Floating dock** (bottom-right) — persistent conversation per user (`kind='demo_dock'`), survives navigation.
- **Full-page chat** — for longer conversations or reviewing history.

### Thinking panel

Top-right floating panel, streams live during agent turns:

- Reasoning steps as the model thinks.
- Tool calls with inputs/results (Genie query streamed, lot ID found, etc.).
- Auto-dismisses after completion. Persisted on the message as `thinking[]` JSONB → survives reload (collapsed by default, expandable "Reasoning · N tools" toggle).

### Human-in-the-loop

**Read-only queries** — assistant calls Genie, synthesizes the answer. No side effects.

**Action chains** — strict 3-phase:

1. **Discover** — find affected returns for the lot, count by status, sum the refund (read-only).
2. **Draft + confirm** — generate ONE coupon (10% goodwill), draft ONE apology email template, show the customer count + sample customers + total refund → **STOP, wait for approval**.
3. **Execute** (after "yes") — bulk-process every affected return in one atomic UPDATE: fill the personalized email, record `coupon_pct_applied = 10`, append audit entry, flip status → `approved`.

### MLflow tracing

Under every assistant message:

- **"View trace"** → MLflow span tree (agent turn → tool calls → Genie call).
- **Thumbs up/down** → human-source assessments on the trace (down opens rationale modal).
- Header links to the single MLflow experiment where every agent turn lands.

### Agent tools (LuxeBeauty Simple)

The agent has exactly **four tools** wired in this order to make the demo loop visible: (1) **ask Genie** what's happening, (2) **read Lakebase** for the operational context, (3) **draft** a coupon, (4) **write Lakebase** after approval.

| Tool | What it does | Phase |
|---|---|---|
| `ask_data` | Calls Genie. Streams the question + Genie's tool calls into the Thinking panel. | Investigation |
| `find_returns_for_lot` | Queries Lakebase: pending returns for a lot (count, customers, refund subtotal, top countries). | Discovery |
| `create_coupon` | Generates a coupon code (pure function, fake). Called **once** with `percent_off=10` — flat offer for everyone. | Draft |
| `process_return_batch` | Bulk: SELECTs pending returns for the lot, fills the personalized email per row, records `coupon_pct_applied = 10`, appends audit entries, approves refunds — **one atomic UPDATE against Lakebase**. Input: a single `offer: {coupon_code, percent_off: 10, email_subject_template, email_body_template}`. | Execution (requires approval) |

> **Write tools must trigger a visible UI refresh.** Every Lakebase-write tool (here, `process_return_batch`) MUST publish a `dataMutated` event when it commits. The Operations page subscribes to that event and refetches its data: KPI counters tick from Pending → Approved, the affected-lot queue rows flip status and gain the **10%** `Offer` badge, the country panel re-renders, and any open detail drawer re-fetches its activity timeline. The user must **see** the queue change without reloading — this is the moment the demo lands. If the UI doesn't visibly update when the agent finishes, `dataMutated` is not being emitted (or the page isn't subscribed) — fix that before declaring the app ready.


## Home page

Narrative landing — tells the story in 10s, plays it in 90s.

**Story section:** Persona badge (*"Claire Dubois · VP of Operations · LuxeBeauty Co."*), headline (*"Returns are running 3x normal"*), situation (returns jumped $60K → $180K/week, 3 SKUs at ~30% return rate, still elevated ~$80K — *team pinged her this morning to take a look*), goal (root cause → blast radius → handle the affected customers), preview bullets.

**Journey diagram:** 3-beat horizontal strip — *See the spike* → Operations | *Ask why* → starts chat | *Fix it* → action flow.

**Starter chips:** *"Why do I have so many returns?"* / *"Was there an incident for that lot?"* / *"How many customers are affected?"* — each starts a fresh conversation.

**Featured action card:** *"Handle the bad-lot returns"* — one click triggers the full investigate → draft 10% goodwill → approve flow.

**Activity feed:** Live tail of agent actions (*"Sent 10% goodwill apology to 250 customers"*, *"Approved 250 refunds for LOT-2026-0222"*). Auto-refreshes.

## Scripted demo flow (~2–3 min)

Assistant supports a scripted chain via `config.assistantScript`. After each response, a "Suggested next" chip appears if trigger keywords are detected in the previous answer. Chips are convenience — Claire can always type freely.

**Step 1 — "Why do I have so many returns?"**
Always available. Agent calls `ask_data` → Genie streams the investigation: 3x spike → 3 SKUs → one lot → texture complaints → **quotes `gold_production_lots.incident_summary`** (homogenizer pressure, Lyon, released anyway). Suggests handling the affected customers.

**Step 2 — "Handle these 250 customers."**
Unlocks when *"lot"* / *"batch"* / *"customers"* appears in the previous answer. Agent calls `find_returns_for_lot` → reports the count (~250) and total refund (~$45K). Calls `create_coupon` once (10%). Drafts ONE goodwill email template. Shows the customer count, sample customers, total refund, and the draft → **stops and waits**.

**Step 3 — "Yes — send them and approve the refunds."**
Unlocks when *"coupon"* / *"approve"* / *"send"* appears. `process_return_batch` runs one atomic UPDATE on Lakebase: personalized email per row, status → `approved`, `coupon_pct_applied = 10`, audit entry appended. Then emits `dataMutated`. On screen: the Pending KPI card visibly drops (250 → 0), the Approved card jumps (… → +250), affected-lot rows in the queue flip status and gain the `10%` Offer badge, and the country panel re-renders for the new Approved scope — all without Claire touching anything. **That live cascade is the story beat — confirm it works before demoing.**

**Performance:** Single Genie call per investigation (~20–40s).

All narrative config lives in `config/app.json` — persona, story, starter questions, assistantScript (with `triggerAfter` keywords), `featuredAction`, resource IDs. Read it directly.
