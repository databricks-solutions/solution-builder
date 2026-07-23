# Harvestly Co. — Loyalty Segmentation Demo

## First Run (Client)

This project ships with synthetic data so you can experience the demo immediately on your own workspace.

**Prerequisite:** serverless compute enabled (default for workspaces created after early 2025). All commands run in a Databricks **web terminal** — no laptop setup required.

1. **Add this repo as a Databricks git folder** (UI: Workspace → "+ Create" → Git folder → paste this repo's URL).
2. **Open a web terminal** in the imported folder (Compute panel → terminal icon, or ⌘+Shift+T).
3. **Install the Genie Code helper** (one-time, ~10 seconds — paste these three lines verbatim, no edits):
   ```bash
   USER_EMAIL=$(databricks current-user me | python3 -c 'import sys,json;print(json.load(sys.stdin)["userName"])')
   databricks workspace mkdirs "/Workspace/Users/$USER_EMAIL/.assistant/skills"
   databricks workspace import-dir .assistant/skills "/Workspace/Users/$USER_EMAIL/.assistant/skills" --overwrite
   ```
   Copies the adaptation skill from this repo to `/Workspace/Users/<your-username>/.assistant/skills/loyalty-segmentation-adaptation/`. Genie Code auto-loads skills from that path in any new chat.
4. **Configure and deploy.** Two paths:

   **(a) Guided — recommended**: Open Genie Code (top nav → Genie Code → New chat). Type exactly: `run in my workspace`. The adaptation skill auto-detects your catalog/schema/warehouse, edits `databricks.yml`, and outputs the deploy commands to run.

   **(b) Manual**: Edit `targets.client.variables` in `databricks.yml`: set `client_catalog`, `client_schema`, `warehouse_id` to values that exist in your workspace; keep `run_with_synthetic_data: "yes"`.

5. **Deploy and run** (paste into the same web terminal):
   ```bash
   databricks bundle validate --target client
   databricks bundle deploy   --target client
   databricks bundle run loyalty-segmentation-job --target client
   ```
   Defaults to `run_with_synthetic_data=yes` — no real data required for the first pass.

6. **Adapt to your data later.** Set `run_with_synthetic_data: "no"` and point `client_catalog` / `client_schema` at your tables. See [`ADAPTATION_GUIDE.md`](ADAPTATION_GUIDE.md) — or ask Genie Code, since the skill is loaded.

For deploy details, see [`dab_instructions.md`](dab_instructions.md).

---

```glance
Data Ingestion: Lakeflow Connect, Spark Declarative Pipelines
AI: Knowledge Assistant, Multi-Agent Supervisor
Data Analysis: Dashboard, Genie
Foundation: Unity Catalog
```

## The Story

| | |
|---|---|
| **Company** | Harvestly Co. — D2C consumer packaged goods (specialty foods + coffee subscriptions) |
| **Hero** | Maya Patel, VP of Customer Marketing & Loyalty (non-technical) |
| **Problem** | Q1 mass-blast loyalty campaign cost $4.2M in margin; controlled holdout shows only $1.8M was incremental — 57% of the discount went to people who would have bought anyway |
| **Investigation** | Maya asks *"Who are my loyalty customers, really?"* — Genie segments the 800K-member base into 4 behavior cohorts; KA returns the Customer Marketing Playbook tactics per cohort |
| **Root cause** | One-size-fits-all promo strategy. Champions don't need a discount, Cooling-Off needs a personal nudge, New Loyalists need cross-category cues, Win-Back needs reactivation — same offer to all four destroys margin |
| **Outcome** | Maya leaves with a segment-specific campaign plan instead of another mass blast |

---

## Overview

Maya runs Harvestly Rewards — 800K loyalty members across coffee, snacks, and pantry staples. Last quarter she did what she always does: blast every active member a 15% off coupon. The CFO is now asking why the campaign cost $4.2M in margin to generate only $1.8M in incremental revenue.

She opens the loyalty dashboard and asks one question: *"Who are my loyalty customers, really?"*

The platform segments the base by Recency-Frequency-Monetary behavior into four cohorts, then surfaces the internal Customer Marketing Playbook that prescribes a different tactic for each. Two questions, a complete plan.

**Duration:** 5–7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Loyalty members | ~800K |
| Q1 campaign margin spend | ~$4.2M |
| Q1 incremental revenue (holdout-adjusted) | ~$1.8M |
| Margin given to non-incremental buyers | ~57% |
| **Champions** (top 10% RFM) | ~80K members → 38% of revenue, 4.2% campaign redemption |
| **New Loyalists** (joined < 6 months, ≥3 orders) | ~200K members → 18% of revenue |
| **Cooling Off** (last order 30–90 days, declining frequency) | ~280K members → 28% of revenue, 1.1% redemption |
| **Win-Back** (dormant > 90 days) | ~240K members → 16% of revenue, 0.4% redemption |

---

## Products Showcased

"Build" = a resource we provision in the workspace. "Talk track" = a platform capability we mention live but don't build per-demo.

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Lakeflow Connect** | Talk track | Pulls Shopify orders, Klaviyo email events, and the loyalty platform into the lakehouse — same morning, no custom plumbing |
| **SDP Pipeline** | Build | Turns raw transactions / customers / redemptions into the Gold tables (segments, segment summary, campaign performance) the dashboard and Genie read from |
| **AI/BI Dashboard** | Build | Maya's loyalty cockpit — segment mix, revenue concentration, last campaign's true incremental ROI |
| **AI/BI Genie** | Build | Cracks *"who are my loyalty customers, really?"* by sliding the base across RFM and tier behavior, naming the 4 cohorts |
| **Knowledge Assistant** | Build | Surfaces the Customer Marketing Playbook PDF — segment-by-segment tactics + the Q1 post-mortem that flagged the overspend |
| **Multi-Agent Supervisor** | Build | Routes Maya's questions to Genie (the data) or KA (the playbook) and synthesizes a campaign-per-segment recommendation |
| **Unity Catalog** | Talk track | One permission model from Shopify ingestion through the agent's tool calls — Maya only sees what she's allowed to see, everywhere |
| **Databricks One** | Talk track | Where Maya actually works — same dashboard, same Genie, same KA, no separate tool to stand up |

---

## Demo Walkthrough

**Frame:** Maya was in the CFO's office yesterday. "$4.2M in margin to make $1.8M? Are we just paying our best customers to buy what they were going to buy anyway?" She needs an answer before next quarter's plan is locked.

---

### Act 1 — The dashboard (1 min)

**Open the Harvestly Loyalty dashboard in Databricks One.**

KPI row: 800K members, $42M revenue last 12 months, but the **Q1 incremental ROI** card is the gut-punch — $4.2M spent / $1.8M incremental / **43% true ROI** against the holdout. The "revenue concentration" chart shows 10% of members (Champions) drive 38% of revenue. The "redemption by cohort" bar chart shows Champions redeeming 4× more than Win-Back — exactly the people who didn't need the coupon.

> *"This is what 'spray and pray' looks like in loyalty marketing. The dashboard is **AI/BI Dashboards**, embedded in **Databricks One** — Maya's daily landing page. Same tables that feed the agent in a minute. **Unity Catalog** is the spine: marketing sees marketing data, period."*

---

### Act 2 — Ask "who are my customers, really?" (2 min)

**Open Genie (or the agent in the dashboard). Type:** `Who are my loyalty customers, really?`

Genie investigates: pulls last-12-months order frequency, last-30-day recency, total spend, tier. Returns four named cohorts with size, revenue share, and the headline behavior:

- **Champions** (~80K) — bought ≤14 days ago, 12+ orders/yr, $145 AOV. They're already loyal.
- **New Loyalists** (~200K) — joined <6 months, 3–5 orders. Building the habit.
- **Cooling Off** (~280K) — last order 30–90 days ago, frequency dropping QoQ. Drifting.
- **Win-Back** (~240K) — dormant >90 days. Already gone, mostly.

> *"That's **AI/BI Genie**. Maya didn't write SQL. She asked an English question and Genie wrote the RFM segmentation against the Gold tables. Same data the dashboard reads from — the segmentation is governed and reproducible, not a one-off slide."*

---

### Act 3 — "What should I do for each?" (2 min)

**Type:** `What should I do for each segment?`

The agent routes to **Knowledge Assistant**, which finds the internal **Customer Marketing Playbook** PDF and the **Q1 Campaign Post-Mortem** memo. It synthesizes a segment-by-segment plan:

- **Champions** → VIP early access, no discount. Offering 15% off destroys margin on a guaranteed buyer.
- **New Loyalists** → cross-category bundle (coffee + pantry) at modest discount. Build basket diversity.
- **Cooling Off** → personalized "favorite category" nudge. Email-only, no discount unless 60+ days silent.
- **Win-Back** → time-limited 25% off + free shipping. Higher cost, but the only thing that moves dormant.

> *"That's a **Multi-Agent Supervisor** orchestrating two specialists — **Genie** for the data, **Knowledge Assistant** for the playbook PDFs. Maya never sees the routing. She gets one synthesized answer that ties data to policy."*
>
> *"And **MLflow** auto-traces every step — every Genie SQL query, every KA document retrieval, every MAS routing decision. If Marketing Compliance asks how the recommendation was produced, replay the trace. No wiring."*

---

### Closing

> Maya walked into the CFO meeting yesterday with one number: $4.2M in, $1.8M out. She walks out today with a different conversation: *"Here's the segment plan. Champions don't get a coupon next quarter — they get a perk. Cooling Off gets a personal nudge instead of a blast. The model says we can cut margin spend 40% and grow incremental revenue 25%. Want to A/B it?"*
>
> Same data the dashboard reads. Same governance the lakehouse enforces. Same agents your other teams already use. **One platform. Anyone can ask. Everyone gets answers grounded in the data and the policy.**
