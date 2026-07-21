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

mv_returns (canonical revenue / orders / return-rate definition — defined in `02-uc-governance.md`), gold_daily_summary (trends), gold_returns_by_product (product-level rates), gold_returns_by_lot (lot tracing + feedback_samples), silver_returns (raw return_reason_text + anger_score), bronze_products (catalog), bronze_production_lots (lot details), bronze_customers (for the `premium_status` CS-tag + `country` joins), **gold_customer_premium_predictions** (per-customer `premium_prob` + `final_tier`, written by the ML notebook in `03-ml-premium.md`).

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

PREMIUM-COHORT FOLLOW-UP (after root cause is established):
- "How many of the affected customers are premium?" → join silver_returns (lot = affected) → distinct customer_id → join gold_customer_premium_predictions → COUNT by final_tier → expected: ~67 premium / ~183 standard out of 250.
- "How many of those premiums did CS already tag vs. the model found?" → same join, GROUP BY premium_status_labeled — expected ~18 already-tagged, ~49 model-found hidden premiums.
- "Which countries have the most affected premiums?" → same join, GROUP BY country → FR + IT lead.

CUSTOMER FEEDBACK (from affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

### Sample Questions

"What's our return rate this month?" (→ mv_returns) / "Why do I have so many returns?" / "Which products have the highest return rate?" / "What are customers saying about returns?" / "Show me returns trend for the last 8 weeks" / "Which lot has the most returns?" / "Tell me about lot [LOT-ID]" / **"How many of the affected customers are premium (tagged or predicted)?"** / **"How many hidden premiums did the model find in the affected cohort?"** / **"Which countries have the most affected premiums?"**

### Validation

"What's our return rate this month?" → answered from mv_returns, matches the dashboard's Monthly Return Rate KPI tile exactly. "Why so many returns?" → 3x spike, SKU-1001/1002/1003, common lot, texture feedback. "What are customers saying?" → surfaces "grainy", "separated", "watery". "How many of the affected customers are premium?" → ~67 of 250 (final_tier='premium'), answered from `gold_customer_premium_predictions`. "How many hidden premiums?" → ~49 (`premium_status_labeled IS NULL AND is_premium_predicted = true`).

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

**Row 5 — "Affected Customers — City Map" (bubble map, full width 12 cols). Source: `silver_returns` filtered by `lot_id = affected lot`; `city`, `customer_lat`, `customer_lng` come directly off the row (denormalized in silver — see `01-lakeflow.md`).**
- Encoding: **one bubble per (city, country)**, positioned by `AVG(customer_lat), AVG(customer_lng)`, sized by `COUNT(DISTINCT customer_id)`. Tooltip: city name + that count + `SUM(refund_amount_usd)`. Bubble color = primary, semi-transparent (so overlapping markers near Paris/London stay readable).
- Date filter does **not** apply (the affected-customer set is a fixed cohort). Region filter does apply (zooms the map to one region's bounding box). Category filter does not apply.
- Expected pattern: **Paris is the single largest bubble** (~30+ affected customers), then London, Milan, Madrid, Berlin clearly visible as a cluster across Europe. **New York / LA / Chicago** are mid-sized dots. **Tokyo / Seoul / Sydney** are small. The eye lands on Paris instantly.
- Story beat in Act 3: Claire glances at the map → *"That biggest dot is Paris — exactly where Skincare is 50% of sales. Lyon's manufacturing problem walked right into our biggest market."*
- The premium / tier-split story is **NOT on the map** — it lives in the chat (the agent's `find_lot_premium_breakdown` tool surfaces the 18/49 labeled-vs-hidden split). Keep the map about geography, the chat about the model.

### Validation

- Return Rate KPI shows ~24% (vs ~8% baseline).
- Returns bar chart: clear spike ~3 weeks ago (~$180K peak, Skincare dominates), decay toward baseline in recent weeks, peak NOT at the rightmost edge.
- Revenue line: steady/growing trend with three regional color bands.
- Products table: SKU-1001/1002/1003 top, ~30% return rate, contrast with ~8% rest.
- Bubble map: Paris is the single largest bubble (≥ ~30 affected customers), followed by visible London / Milan / Madrid / Berlin clusters; US East/West coast cities mid-sized; Tokyo / Seoul / Sydney small. Tooltip shows city + count + refund total.
- Region filter (select "EU") → every widget updates, map zooms to EU bounding box (Paris cluster fills the frame).
- Category filter (select "Skincare") → returns spike pronounced; products table narrows to skincare SKUs. (Map is unaffected — affected cohort is fixed.)

Add dashboard_id to `resources.json`.

---

