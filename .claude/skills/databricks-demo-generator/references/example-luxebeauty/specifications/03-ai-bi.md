# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).
Your goal is to create a Genie space and an AI/BI Dashboard for this story, respecting these specifications.

> **Talking-track-only products mentioned in the README** — do **not** build resources for these:
> - **Databricks One** is a workspace-level surface, not a buildable artifact. Once the dashboard, Genie space, and KA exist, they show up there for users with the right entitlement. Nothing to provision.
> - **Genie Code** is the AI authoring assist *inside* the Genie/SQL editor — referenced in the README narrative, not a separate resource.
> - **Unity Catalog** is the global governance layer — already in place at the workspace level, just ensure the catalog/schema/grants in `01-lakeflow.md` are applied.

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.

## A. Genie Space

**Skill to use**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `LuxeBeauty Operations Analytics` Genie Space.

### Tables

mv_returns (canonical revenue / orders / return-rate definition — defined in `02-uc-governance.md`), gold_daily_summary (trends), gold_returns_by_product (product-level rates), gold_returns_by_lot (lot tracing + feedback_samples), silver_returns (raw return_reason_text), bronze_products (catalog), bronze_production_lots (lot details).

### Instructions

```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).

BASELINES: Normal weekly returns ~$60K, normal return rate ~8%, anomaly threshold >20%.

HEADLINE NUMBERS — always answer from mv_returns:
- "What's our return rate?" / "Revenue this month?" / "Refund rate by region?" → mv_returns
  (same metric definition the dashboard KPI tiles use — numbers will match exactly)

INVESTIGATION FLOW for "Why so many returns?":
1. mv_returns → MEASURE(total_refunds) by week → spot 3x spike (~$180K peak ~3 weeks ago, decaying but still above baseline)
2. gold_returns_by_product → WHERE return_rate > 0.2 → SKU-1001, SKU-1002, SKU-1003
3. gold_returns_by_lot → GROUP BY lot_id → one lot dominates
4. silver_returns → return_reason_text WHERE lot_id = affected → texture complaints
5. Conclude + suggest: "Would you like me to check for production incidents?"

CUSTOMER FEEDBACK (from affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

### Sample Questions

"What's our return rate this month?" (→ mv_returns) / "Why do I have so many returns?" / "Which products have the highest return rate?" / "What are customers saying about returns?" / "Show me returns trend for the last 8 weeks" / "Which lot has the most returns?" / "Tell me about lot [LOT-ID]"

### Validation

"What's our return rate this month?" → answered from mv_returns, matches the dashboard's Monthly Return Rate KPI tile exactly. "Why so many returns?" → 3x spike, SKU-1001/1002/1003, common lot, texture feedback. "What are customers saying?" → surfaces "grainy", "separated", "watery".

Add genie_space_id to `resources.json`.


## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns the JSON shape, encoding rules, and grid math; this spec is story-level.

Create `LuxeBeauty Operations` dashboard. Save locally as `PROJECT/dashboard.json`. Link the Genie space from section A.
Reminder: You must set `--dataset-catalog` and  `--dataset-schema` when running databricks lakeview create

### Filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets it filters | Default |
|--------|--------|--------------------|---------|
| Date Range | date | mv_returns (KPIs, returns chart, revenue line) | Last 6 months |
| Region | region | mv_returns, gold_returns_by_product | All |
| Category | category | mv_returns, gold_returns_by_product | All |

Products table reads `gold_returns_by_product` (no date column → date filter does not apply). Region + Category cross-apply to every widget. **KPI row + trend charts read `mv_returns`** — same metric definition Genie uses.

### Layout (12-column grid, top to bottom)

**Row 1 — KPIs (3 counters side by side, 4 cols each, last 30 days). Source: `mv_returns`. Dashboards auto-wrap `MEASURE(...)` — reference measure names directly:**
- **Monthly Revenue** = `MEASURE(total_revenue)` → ~$380K, healthy. Format: currency, compact.
- **Monthly Orders** = `MEASURE(order_count)` → ~15K, stable. Format: number, compact.
- **Monthly Return Rate ⚠️** = `MEASURE(return_rate)` → ~24% vs ~8% normal. Format: percent (0-1 range). The metric view computes this as `MEASURE(return_count) / MEASURE(order_count)` — the same definition Genie uses, so the number matches when Claire asks Genie "what's our return rate?". The 3x spike is the attention-grabber.

**Row 2 — "Returns 3x Above Baseline" (vertical bar chart, full width 12 cols). Source: `mv_returns`.**
- x = week (temporal, from `date` dim); y = `MEASURE(total_refunds)`; color = `category` (Skincare/Makeup/Haircare, stacked).
- Shape: ~12 months flat ~$60K/week baseline → build-up → peak ~$180K about 3 weeks ago → decay toward ~$70-90K in recent weeks. The spike must sit clearly **in the past** with a visible decay, **NOT at the rightmost edge**. Skincare color dominates the spike.

**Row 3 — Two charts side by side (6 cols each). Source: `mv_returns`.**
- **"Weekly Revenue (Steady)"** (line): x = week; y = `MEASURE(total_revenue)`; color = `region` (US/EU/APAC). Steady or growing — contrasts with the returns spike, signals the business is fine overall.
- **"Revenue by Category"** (horizontal bar): y = `category`; x = `MEASURE(total_revenue)`; color = `region`. Skincare is the largest bar — matters because every affected SKU is Skincare.

**Row 4 — Products table (full width 12 cols). Source: `gold_returns_by_product` (per-SKU dimension not exposed by `mv_returns` — investigation drill-down stays on the gold table).**
- Columns: product_name, category, units_sold, total_refund_usd, return_rate. Sorted by return_rate DESC.
- Top 3 rows must be SKU-1001 / SKU-1002 / SKU-1003 at ~30% return rate. Everything else at ~8%. The 4x contrast is the signal.

### Validation

- Return Rate KPI shows ~24% (vs ~8% baseline).
- Returns bar chart: clear spike ~3 weeks ago (~$180K peak, Skincare dominates), decay toward baseline in recent weeks, peak NOT at the rightmost edge.
- Revenue line: steady/growing trend with three regional color bands.
- Products table: SKU-1001/1002/1003 top, ~30% return rate, contrast with ~8% rest.
- Region filter (select "EU") → every widget updates.
- Category filter (select "Skincare") → returns spike pronounced; products table narrows to skincare SKUs.

Add dashboard_id to `resources.json`.

---

