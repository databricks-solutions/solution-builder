# App Specification — Overview, Home & Assistant

> **Build-time note.** Read `DEMO_SKILL_DIR/app/app.md` FIRST and follow it end-to-end — that's the playbook (rsync template → customize → Lakebase → env → smoke test → deploy). This is **not** a from-scratch build: the template at `DEMO_SKILL_DIR/app/app_template/` is a Node.js + React + Express (`@databricks/appkit`) app with Lakebase, MAS streaming, MLflow tracing, OBO auth, chat dock, and scripted demo chain already wired. You rsync it into `PROJECT/app/`, read `TEMPLATE_MAP.md` for what's preserved vs customized, then rewrite domain pieces (home narrative, agent tools, Lakebase schema, analytics SQL, theming) to match the story. Typically run as a subagent spawned once 01-lakeflow.B is ready. **Do NOT rebuild in Streamlit / Gradio** — you'd lose streaming, MLflow, the scripted chain, and the OBO/audit pattern. On conflict: `app.md` governs *how*, this spec governs *what*.

## Pitch

AI assistant that **investigates, personalizes the fix using an ML model, and executes it** in one conversation — not just answers questions. Claire watches every step happen live: MAS routes across Genie + KA, traces the returns spike to one production lot, then **looks up the premium-classifier output** (`app.customer_premium`, mirrored from the Delta predictions table the ML notebook in `03-ml-premium.md` writes) to split the 250 affected customers — finding ~18 already-tagged premiums plus ~49 hidden premiums the model surfaces — drafts two apology emails (20% coupon for the ~67 premiums, 5% goodwill for the ~183 standard), bulk-approves refunds. Operations queue updates in real time with the tier each row got. Every action is traced in MLflow.

## Databricks capabilities mapped

| Capability | Where it shows |
|-----------|---------------|
| **SQL Warehouse on Delta** | Analytics charts query live Delta tables |
| **Multi-Agent Supervisor** | `ask_data` tool routes to Genie (data) + KA (docs); sub-agent activity streams into Thinking panel |
| **Lakebase** | OLTP write surface — approve returns, append audit trail, record emails, **read premium predictions (synced from Delta `gold_customer_premium_predictions`)**. Same UC governance as Delta |
| **ML model (UC-registered)** | `customer_premium_classifier` model's batch predictions feed the agent's tiering — `app.customer_premium(customer_id, premium_prob, final_tier, premium_status_labeled, predicted_at)` is one of the mirrored tables |
| **AI Functions (`ai_classify`)** | Anger score (0–1) extracted in SDP from each return's `return_reason_text`, mirrored on the returns row. Operations queue is sortable by anger so operators can triage the most upset customers first. |
| **MLflow tracing** | Per-turn traces with tool spans. Thumbs up/down → human assessments on traces. Header links to experiments |
| **Databricks Apps** | SSO, OBO auth (actions stamped with Claire's email), secrets, auto-scaling |
| **AI/BI Dashboards** | Embedded as iframe with SSO — no chart rebuilding |

## Pages

| Page | Purpose | Key capability |
|------|---------|---------------|
| **Home** | Narrative landing — story, persona, journey diagram, starter chips, featured action card, activity feed | Config-driven (`config/app.json`) |
| **Operations** | Returns queue — status tabs, search, lot filter, KPI cards (Pending/Approved/Escalated), detail drawer with decision buttons + activity timeline | **Lakebase** OLTP |
| **Analytics** | Warehouse-backed charts: daily refund trend, returns by product, worst lots, facility drill-down → links to Operations filtered by lot | **SQL Warehouse** on Delta |
| **Dashboard** | Embedded AI/BI dashboard iframe. Optional — remove page if demo has no dashboard | **AI/BI Dashboards** |

## Assistant

Lives on every page. Two surfaces, one brain:
- **Floating dock** (bottom-right) — persistent conversation per user (`kind='demo_dock'`), survives navigation. Hidden on full-page chat route.
- **Full-page chat** — for longer conversations or reviewing history.

### Thinking panel
Top-right floating panel, streams live during agent turns:
- Reasoning steps as model thinks
- MAS sub-agent activity: "data_analyst querying Genie", "incident_expert searching KA"
- Tool calls with inputs/results (SQL run, lot ID found, etc.)
- Auto-dismisses after completion. Persisted on message as `thinking[]` JSONB → survives reload (collapsed by default, expandable "Reasoning · N tools" toggle).

### Human-in-the-loop
**Read-only queries** — assistant calls MAS, synthesizes answer. No side effects.

**Action chains** — strict 3-phase:
1. **Discover** — find affected returns, **look up the per-customer `final_tier`** in Lakebase (sourced from the premium classifier's predictions, plus the labeled-vs-predicted breakdown), count by tier, calculate totals (read-only)
2. **Draft + confirm** — generate TWO coupons (20% for `final_tier='premium'`, 5% for `'standard'`), draft TWO email templates, show the split + the "X already-tagged + Y model-found hidden premiums" breakdown + sample customers per tier + total refund → **STOP, wait for approval**
3. **Execute** (after "yes") — bulk-process: per-row tier lookup picks the right coupon, fills its template, records `coupon_pct_applied` on the row, appends audit + email entries, flips status to approved — all in one atomic UPDATE

### MLflow tracing
Under every assistant message:
- **"View trace"** → MLflow span tree (agent turn → tool calls → MAS sub-calls)
- **Thumbs up/down** → human-source assessments on the trace (down opens rationale modal)
- Header links to both experiments (agent traces + MAS traces)

### Agent tools (LuxeBeauty)

The agent has five tools, chained in a fixed order so the demo loop is visible: (1) **ask MAS** (which routes to Genie + KA) to investigate, (2) **read Lakebase** for the operational context, (3) **read the ML predictions** in Lakebase to plan the tiering, (4) **draft** the per-tier coupons, (5) **write Lakebase** atomically after approval.

| Tool | What it does | Phase |
|------|-------------|-------|
| `ask_data` | Delegates to MAS — routes to Genie or KA, streams sub-agent progress to Thinking panel | Investigation |
| `find_returns_for_lot` | Queries Lakebase: pending returns for a lot (count, customers, refund subtotal, **each row's `final_tier` + `premium_status_labeled`** joined from `app.customer_premium`, plus the row's `anger_score`) | Discovery |
| `find_lot_premium_breakdown` | Queries Lakebase: for the affected lot, returns `{total, premium_count, standard_count, premium_labeled_count, premium_predicted_hidden_count, premium_refund_usd, standard_refund_usd, top_countries[]}` — joins `app.returns` × `app.customers` × `app.customer_premium`. **This is the demo's "ML in the loop" moment** — the agent calls it after identifying the lot and quotes the labeled-vs-hidden split in the draft. | Discovery |
| `create_coupon` | Generates a coupon code (pure function, fake). Called TWICE in the tiered flow — once per tier with the appropriate `percent_off`. | Draft |
| `process_return_batch` | Bulk: SELECTs pending returns for `lot` joined to `app.customer_premium`, picks the right tier's coupon + template per row, fills personalized emails, records `coupon_pct_applied`, appends audit, approves refunds in Lakebase — **one atomic UPDATE**. Inputs include `tier_offers: {premium: {coupon_code, percent_off, email_subject_template, email_body_template}, standard: {...}}`. | Execution (requires approval) |

> **Write tools must trigger a visible UI refresh.** Every Lakebase-write tool (here, `process_return_batch`) MUST publish a `dataMutated` event on commit. The Operations page subscribes and refetches: KPI counters tick from Pending → Approved, queue rows flip status and gain the per-row 20% / 5% `Offer` badge, the country panel + premium-tier panel re-render, and any open detail drawer re-fetches its activity timeline. The user must **see** the queue change without reloading — that live cascade is the moment the demo lands. If the UI doesn't visibly update when the agent finishes, `dataMutated` is not being emitted (or the page isn't subscribed) — fix that before declaring the app ready.

## Home page

Narrative landing — tells the story in 10s, plays it in 90s.

**Story section:** Persona badge ("Claire Dubois · VP of Operations · LuxeBeauty Co."), headline ("Returns are running 3x normal"), situation (returns jumped $60K→$180K/week, 3 SKUs at 30% return rate, still elevated ~$80K — *team pinged her this morning to take a look*), goal (root cause → blast radius → recall or field fix), preview bullets.

**Journey diagram:** 4-beat horizontal strip (demo remote control): See the spike → Operations | Ask why → starts chat | Trace root cause → Analytics | Fix it → action flow.

**Starter chips:** "Why do I have so many returns?" / "Was there an incident for that lot?" / "Which of the affected customers are premium?" — each starts a fresh conversation.

**Featured action card:** "Handle the bad-lot returns — tier the offer by premium status" — one click triggers the full investigate → tier-split → draft → approve flow.

**Activity feed:** Live tail of agent actions ("Sent 20% apology to 67 premium customers (18 labeled + 49 model-found)", "Sent 5% goodwill to 183 standard customers", "Approved 250 refunds for LOT-2026-0222"). Auto-refreshes.

## Scripted demo flow (~3 min)

Assistant supports a scripted chain via `config.assistantScript`. After each response, a "Suggested next" chip appears if trigger keywords are detected in the previous answer. Chips are convenience — Claire can always type freely.

**Step 1 — "Why do I have so many returns?"**
Always available. MAS delegates to data_analyst (Genie) + incident_expert (KA). Thinking panel shows routing live. Answer: 3x spike, SKU-1001/1002/1003, one lot, "grainy texture", homogenizer incident. Suggests handling the affected customers.

**Step 2 — "Handle these 250 customers. Use the premium classifier to decide who gets the bigger save."**
Unlocks when "lot"/"batch"/"customers" in previous answer. Agent calls `find_lot_premium_breakdown` → quotes the split (e.g. "~67 premium of 250 — only 18 already tagged by CS; the model found ~49 more hidden premiums. FR + IT lead the cohort"). Calls `create_coupon` twice (20% + 5%). Drafts TWO emails (warmer apology for premium, lighter goodwill for standard). Shows both drafts + the labeled-vs-hidden breakdown + total refund. Stops and waits.

**Step 3 — "Yes — send both and approve the refunds."**
Unlocks when "tier"/"premium"/"coupon" mentioned. `process_return_batch` runs one atomic UPDATE on Lakebase: per-row tier lookup picks the right template, personalized email lands on the row, status → approved, `coupon_pct_applied` recorded. Then emits `dataMutated`. On screen: the Pending KPI card visibly drops (250 → 0), the Approved card jumps (… → +250), affected-lot rows in the queue flip status and gain the per-row **20%** or **5%** `Offer` badge, the country panel + premium panel re-render, and any open drawer re-fetches its audit timeline — all without Claire touching anything. **That live cascade is the story beat — confirm it works before demoing.**

**Performance:** Agent prompt steers toward narrow MAS questions (20-40s). Broad questions take 90s+. The premium lookup is a Lakebase JOIN — sub-second, doesn't bloat the turn.

All narrative config lives in `config/app.json` — persona, story, starter questions, assistantScript (with triggerAfter keywords), featuredAction, resource IDs. Read it directly.
