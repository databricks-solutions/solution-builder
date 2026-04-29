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

gold_daily_summary (trends), gold_returns_by_product (product-level rates), gold_returns_by_lot (lot tracing + feedback_samples), silver_returns (raw return_reason_text), bronze_products (catalog), bronze_production_lots (lot details).

### Instructions

```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).

BASELINES: Normal weekly returns ~$60K, normal return rate ~8%, anomaly threshold >20%.

INVESTIGATION FLOW for "Why so many returns?":
1. gold_daily_summary → SUM(returns_usd) by week → spot 3x spike (~$180K peak ~3 weeks ago, decaying but still above baseline)
2. gold_returns_by_product → WHERE return_rate > 0.2 → SKU-1001, SKU-1002, SKU-1003
3. gold_returns_by_lot → GROUP BY lot_id → one lot dominates
4. silver_returns → return_reason_text WHERE lot_id = affected → texture complaints
5. Conclude + suggest: "Would you like me to check for production incidents?"

CUSTOMER FEEDBACK (from affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

### Sample Questions

"Why do I have so many returns?" / "Which products have the highest return rate?" / "What are customers saying about returns?" / "Show me returns trend for the last 8 weeks" / "Which lot has the most returns?" / "Tell me about lot [LOT-ID]"

### Validation

"Why so many returns?" → 3x spike, SKU-1001/1002/1003, common lot, texture feedback. "What are customers saying?" → surfaces "grainy", "separated", "watery".

Add genie_space_id to `resources.json`.


## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing.

Create `LuxeBeauty Operations` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Layout

Filters: Date Range (default: last 6 months) | Region | Category

Rows (each sums to width 6) - should be filtered (see below) so keep the filtered field in the dataset:

1. **KPIs** (3 counters, each 1/3 width)
   - Monthly Revenue (last 30 days): SUM(revenue_usd). Should show ~$380K — healthy, nothing alarming.
   - Monthly Orders (last 30 days): COUNT DISTINCT order_id. Should show ~15K — stable.
   - Monthly Return Rate ⚠️ (last 30 days): return_count / order_count as %. Should show ~24% vs ~8% normal — the 3x spike grabs attention.

2. **"Returns 3x Above Baseline"** (bar chart grouped by category, full width)
   - X: week. Y: SUM(returns_usd). **Group/color by: category** — so each bar is stacked or grouped by Skincare/Makeup/Haircare. This makes the Skincare spike visually pop with color.
   - Should show ~12 months of flat ~$60K/week baseline, then a build-up, a clear peak at ~$180K about 3 weeks ago, and a decay back toward normal in the most recent weeks. The spike must NOT be at the rightmost edge — it should be clearly in the past with a visible decay, showing the problem is being resolved.

3. **"Weekly Revenue (Steady)"** (line chart grouped by region, half width) | **"Revenue by Category"** (horizontal bar grouped by region, half width)
   - Revenue line — X: week, Y: SUM(revenue_usd), **color by: region** (US/EU/APAC). Should look steady/growing — contrast with the returns spike. Shows the business is fine overall.
   - Category bar — Y: category, X: SUM(revenue_usd), **color by: region**. Skincare, Makeup, Haircare broken out by region. Shows revenue mix and regional patterns — Skincare is the largest, which matters because affected products are all Skincare.

4. **Products table** (full width)
   - Columns: product_name, category, units_sold, total_refund_usd, return_rate. Sorted by return_rate DESC.
   - Top 3 rows should be SKU-1001/1002/1003 at ~30% return rate. Everything else at ~8%. The contrast is the signal — three products are 4x worse than normal.

Link the Genie Space created in section B to this dashboard.

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_daily_summary | Last 6 months |
| Region | region | gold_daily_summary, gold_returns_by_product | All |
| Category | category | gold_daily_summary, gold_returns_by_product | All |

Date Range affects KPIs and trend charts (gold_daily_summary). Region and Category affect all widgets including products table.

### Validation

Return rate KPI shows ~24% (vs ~8% normal). Returns bar chart shows colored category breakdown with a clear spike ~3 weeks ago (~$180K peak, Skincare dominates the spike), then decay toward baseline in recent weeks. Revenue line shows steady trend with regional color breakdown. Products sorted (SKU-1001/1002/1003 at top ~30%). Region filter works (select "EU" → all widgets update). Category filter works (select "Skincare" → spike more pronounced).

### SQL Formatting (Critical)

When the AI Dev Kit's `databricks-aibi-dashboards` skill writes dataset SQL into `queryLines`, every array element except the last MUST end with a trailing space or `\n`. The Lakeview renderer concatenates `queryLines` verbatim — no separator is inserted. Without trailing whitespace, SQL tokens collide (`SELECT *` + `FROM x` → `SELECT *FROM x`) and every widget fails with a SQL parse error.

Acceptable forms:
- Trailing space inside each element: `["SELECT col ", "FROM tbl ", "WHERE x = 1"]`
- Explicit newlines: `["SELECT col\n", "FROM tbl\n", "WHERE x = 1"]`
- Single element with the whole query: `["SELECT col FROM tbl WHERE x = 1"]`

Add dashboard_id to `resources.json`.

---

