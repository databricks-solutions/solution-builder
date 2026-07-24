# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in `01-lakeflow.md` (Section C).
Goal: a Genie space and AI/BI Dashboard for Maya's loyalty cockpit.

> **Talking-track-only products mentioned in the README** — do **not** build resources for these:
> - **Databricks One** is a workspace-level surface, not a buildable artifact.
> - **Genie Code** is the AI authoring assist *inside* the Genie/SQL editor — referenced in the README narrative, not a separate resource.
> - **Unity Catalog** is the global governance layer — already in place at the workspace level; just ensure the catalog/schema/grants from `01-lakeflow.md` are applied.

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.

## A. Genie Space

**Skill to use**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `Harvestly Loyalty Analytics` Genie Space.

### Tables

`gold_customer_segments` (per-customer segmentation), `gold_segment_summary` (segment-level aggregates), `gold_campaign_performance` (Q1 ROI by segment), `silver_customer_rfm` (raw RFM features for ad-hoc slicing), `bronze_campaigns` (campaign metadata).

### Instructions

```
You analyze Harvestly Co.'s loyalty program for Maya (VP Customer Marketing & Loyalty, non-technical).

BASELINES:
- ~800K loyalty members across Bronze/Silver/Gold tiers.
- Healthy Q1 incremental ROI is >100%. Q1 mass-blast came in at 43% — that's the problem.
- Healthy redemption rate is segment-aware: Champions should NOT be the highest redeemers (they'd buy anyway).

THE FOUR SEGMENTS (canonical names — always use these labels):
- Champions: recency ≤ 14d AND frequency_12m ≥ 12. ~10% of base, ~38% of revenue.
- New Loyalists: tenure < 180d AND frequency_12m BETWEEN 3 AND 5. ~25%, ~18%.
- Cooling Off: recency 30–90d AND frequency declining QoQ. ~35%, ~28%.
- Win-Back: recency > 90d. ~30%, ~16%.

INVESTIGATION FLOW for "Who are my loyalty customers, really?":
1. gold_segment_summary → show 4 segments with size, revenue share, avg AOV.
2. Surface concentration: Champions are 10% of base but 38% of revenue.
3. If Maya asks "what about Q1 campaign?": gold_campaign_performance → redemption_rate by segment + true_roi_pct.
4. Highlight that Champions' redemption rate (~4.2%) was highest, Win-Back (~0.4%) lowest — exactly the wrong shape for incremental ROI.
5. Conclude + suggest: "Would you like me to find segment-specific tactics in the Customer Marketing Playbook?"

DO NOT prescribe tactics yourself — that's the Knowledge Assistant's job. Stop at "the data says X, the playbook should tell us what to do about it."
```

### Sample Questions

- "Who are my loyalty customers, really?"
- "Show me my segment mix."
- "Which segment drives the most revenue?"
- "How did the Q1 campaign perform by segment?"
- "What was the true ROI on the Q1 mass blast?"
- "Which segment over-redeemed the coupon?"
- "Which region has the most Champions?"

### Validation

- "Who are my loyalty customers, really?" → 4 segments named correctly with size + revenue share.
- "How did Q1 perform?" → segment-level redemption with Champions highest, Win-Back lowest; aggregate true ROI ~43%.
- Region filter → segments recompute (not pre-cached aggregates).

Add `genie_space_id` to `resources.json`.

---

## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns JSON shape, encoding rules, and grid math; this spec is story-level.

Create `Harvestly Loyalty Cockpit` dashboard. Save locally as `PROJECT/dashboard.json`. Link the Genie space from Section A.

### Filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets it filters | Default |
|--------|--------|---------------------|---------|
| Region | region | gold_segment_summary, gold_customer_segments, gold_campaign_performance | All |
| Segment | segment | gold_segment_summary, gold_customer_segments, gold_campaign_performance | All |

Region + Segment cross-apply to every widget. There is no date filter — this dashboard is about the current state of the base, not a time series.

### Layout (12-column grid, top to bottom)

**Row 1 — KPIs (4 counters side by side, 3 cols each):**
- **Loyalty Members** = SUM(member_count) → ~800K. Format: number, compact.
- **12-mo Revenue** = SUM(revenue_12m_usd) → ~$42M. Format: currency, compact.
- **Q1 Margin Spend** = SUM(total_discount_given_usd) → ~$4.2M. Format: currency, compact.
- **Q1 True ROI ⚠️** = SUM(incremental_revenue_usd - total_discount_given_usd) / SUM(total_discount_given_usd) → ~-57% (or 43% if shown as gross ROI; pick one and label clearly). Format: percent. **The attention-grabber.**

**Row 2 — "Where the revenue lives" (donut, 6 cols) + "Where the base lives" (donut, 6 cols):**
- Left donut: revenue_share_pct by segment. Champions slice is the largest (~38%).
- Right donut: member_count share by segment. Champions slice is small (~10%).
- The contrast between the two donuts is the visual story: 10% of members → 38% of revenue.

**Row 3 — "Q1 redemption was the wrong shape" (full-width 12 cols, grouped bar):**
- y = segment (categorical, ordered Champions / New Loyalists / Cooling Off / Win-Back).
- x = redemption_rate (quantitative, percent).
- Source: gold_campaign_performance.
- Champions bar is tallest (~4.2%), Win-Back is shortest (~0.4%) — this is the picture of paying your most loyal customers a discount they didn't need.

**Row 4 — "Q1 incremental ROI by segment" (full-width 12 cols, horizontal bar):**
- y = segment, x = true_roi_pct, color: green if positive, red if negative.
- Most segments are deep red. Maybe Win-Back is barely positive. The aggregate is red.

**Row 5 — Segment table (full width 12 cols):**
- Source: gold_segment_summary. Columns: segment, member_count, revenue_12m_usd, avg_aov_usd, avg_recency_days, revenue_share_pct.
- Sorted by revenue_share_pct DESC.

### Validation

- KPIs visible: ~800K members, ~$42M revenue, ~$4.2M Q1 margin spend, ~-57% true ROI (or 43% gross — be explicit in the label).
- Two donuts in Row 2 visibly disagree on Champions: large in revenue, small in membership.
- Row 3 bar chart: Champions tallest redemption, Win-Back shortest — the "wrong shape" headline reads at a glance.
- Row 4 bars are predominantly red.
- Region filter (select "EU") → every widget updates.
- Segment filter (select "Champions") → KPIs and table narrow to that single segment.

Add `dashboard_id` to `resources.json`.
