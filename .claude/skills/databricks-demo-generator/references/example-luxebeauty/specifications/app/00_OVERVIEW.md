# App Specification — Overview, Home & Assistant

> **Build-time note.** Read `SKILL_DIR/app/app.md` FIRST and follow it end-to-end — that's the playbook (rsync template → customize → Lakebase → env → smoke test → deploy). This is **not** a from-scratch build: the template at `SKILL_DIR/app/app_template/` is a Node.js + React + FastAPI app with Lakebase, MAS streaming, MLflow tracing, OBO auth, chat dock, and scripted demo chain already wired. You rsync it into `PROJECT/app/`, read `TEMPLATE_MAP.md` for what's preserved vs customized, then rewrite domain pieces (home narrative, agent tools, Lakebase schema, analytics SQL, theming) to match the story. Typically run as a subagent spawned once 01-lakeflow.B is ready. **Do NOT rebuild in Streamlit / Gradio** — you'd lose streaming, MLflow, the scripted chain, and the OBO/audit pattern. On conflict: `app.md` governs *how*, this spec governs *what*.

## Pitch

AI assistant that **investigates, drafts the fix, and executes it** in one conversation — not just answers questions. Claire watches every step happen live: MAS routes across Genie + KA, traces the returns spike to one production lot, drafts apology emails with coupons, bulk-approves refunds. Operations queue updates in real time. Every action is traced in MLflow.

## Databricks capabilities mapped

| Capability | Where it shows |
|-----------|---------------|
| **SQL Warehouse on Delta** | Analytics charts query live Delta tables |
| **Multi-Agent Supervisor** | `ask_data` tool routes to Genie (data) + KA (docs); sub-agent activity streams into Thinking panel |
| **Lakebase** | OLTP write surface — approve returns, append audit trail, record emails. Same UC governance as Delta |
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
1. **Discover** — find affected returns, count, calculate totals (read-only)
2. **Draft + confirm** — generate coupon, draft email, show who receives it + total refund → **STOP, wait for approval**
3. **Execute** (after "yes") — bulk-process: personalized emails, audit trail, approve refunds atomically

### MLflow tracing
Under every assistant message:
- **"View trace"** → MLflow span tree (agent turn → tool calls → MAS sub-calls)
- **Thumbs up/down** → human-source assessments on the trace (down opens rationale modal)
- Header links to both experiments (agent traces + MAS traces)

### Agent tools (LuxeBeauty)

| Tool | What it does | Phase |
|------|-------------|-------|
| `ask_data` | Delegates to MAS — routes to Genie or KA, streams sub-agent progress to Thinking panel | Investigation |
| `find_returns_for_lot` | Queries Lakebase: pending returns for a lot (count, customers, total refund) | Discovery |
| `create_coupon` | Generates coupon code (pure function, fake) | Draft |
| `process_return_batch` | Bulk: personalized emails (fake), audit trail, approve refunds in Lakebase — one atomic op | Execution (requires approval) |

## Home page

Narrative landing — tells the story in 10s, plays it in 90s.

**Story section:** Persona badge ("Claire Dubois · VP of Operations · LuxeBeauty Co."), headline ("Returns are running 3x normal"), situation (returns jumped $60K→$180K/week, 3 SKUs at 30% return rate, still elevated ~$80K — *team pinged her this morning to take a look*), goal (root cause → blast radius → recall or field fix), preview bullets.

**Journey diagram:** 4-beat horizontal strip (demo remote control): See the spike → Operations | Ask why → starts chat | Trace root cause → Analytics | Fix it → action flow.

**Starter chips:** "Why do I have so many returns?" / "Was there an incident for that lot?" / "Which customers are most affected?" — each starts a fresh conversation.

**Featured action card:** "Handle the bad-lot returns" — one click triggers full investigate→draft→approve flow.

**Activity feed:** Live tail of agent actions ("Approved 47 returns for LOT-2026-0222", "Sent apology email to..."). Auto-refreshes.

## Scripted demo flow (~3 min)

Assistant supports a scripted chain via `config.assistantScript`. After each response, a "Suggested next" chip appears if trigger keywords are detected in the previous answer. Chips are convenience — Claire can always type freely.

**Step 1 — "Why do I have so many returns?"**
Always available. MAS delegates to data_analyst (Genie) + incident_expert (KA). Thinking panel shows routing live. Answer: 3x spike, SKU-1001/1002/1003, one lot, "grainy texture". Suggests handling returns.

**Step 2 — "Accept all returns for that lot. Draft an apology email with a 20% coupon — show me first."**
Unlocks when "lot"/"batch" in previous answer. Finds pending returns, generates coupon, drafts email. Shows draft + affected customers. Stops and waits.

**Step 3 — "Yes — send the emails and approve the refunds."**
Unlocks when "template"/"coupon" mentioned. Bulk-processes every return: personalized emails, audit trail, status → approved. Operations KPI counters move. Each return row shows email + audit.

**Performance:** Agent prompt steers toward narrow MAS questions (20-40s). Broad questions take 90s+.

All narrative config lives in `config/app.json` — persona, story, starter questions, assistantScript (with triggerAfter keywords), featuredAction, resource IDs. Read it directly.
