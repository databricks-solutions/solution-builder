# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in `01-lakeflow.md`. Widgets read the `gold_*` tables directly.

> **Talking-track-only products mentioned in the README** — do **not** build resources for these:
> - **Databricks One** is a workspace-level surface, not a buildable artifact. Once the dashboard and Genie space exist, they show up there for users with the right entitlement. Nothing to provision.
> - **Genie Code** is the AI authoring assist *inside* the Genie/SQL editor — referenced in the README narrative, not a separate resource.
> - **Unity Catalog** is the global governance layer — already in place at the workspace level. Just ensure the catalog/schema/grants applied in `01-lakeflow.md` are in effect.
> - **Lakeflow Connect** is the ingest narrative — talk track only.

---

## A. Genie Space

**Skill to use**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `LuxeBeauty Operations Analytics` Genie Space.

### Tables

`gold_daily_summary` (trends + KPIs), `gold_returns` (per-return investigation, denormalized country/region/category/facility), `gold_product_lot_quality` (the drill-down bridge — one row per affected (product, lot) with its `incident_summary`, return count, refund total), `raw_products` (catalog), `raw_production_lots` (lot detail + `incident_summary`), `raw_customers` (country joins, loyalty tier).

The manufacturing incident text lives on `raw_production_lots.incident_summary` and is pre-joined onto `gold_product_lot_quality` for one-hop drill-down. When Claire asks Genie *"why so many returns?"*, the chain ends with `SELECT incident_summary FROM gold_product_lot_quality WHERE return_count > 100 ORDER BY return_count DESC LIMIT 1` — Genie quotes it back inline.

### Instructions

```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).

BASELINES: Normal weekly returns ~$60K, normal return rate ~8%, anomaly threshold > 20%.

HEADLINE NUMBERS — answer from gold_daily_summary:
- "What's our return rate?" → SUM(return_count) / SUM(order_count) — current month
- "Revenue this month?"     → SUM(revenue_usd) — current month
- "Refund rate by region?"  → SUM(returns_usd) / SUM(revenue_usd) — group by region

INVESTIGATION FLOW for "Why so many returns?":
1. gold_daily_summary → SUM(returns_usd) by week → spot the 3x spike (~$180K peak ~3 weeks ago, decaying but still above baseline)
2. gold_returns → per product_id, return_rate vs baseline → SKU-1001, SKU-1002, SKU-1003
3. gold_product_lot_quality WHERE product_id IN (those 3) ORDER BY return_count DESC → one lot dominates
4. gold_returns → return_reason_text WHERE lot_id = affected → texture complaints ("grainy", "separated", "watery")
5. gold_product_lot_quality (or raw_production_lots) → SELECT incident_summary WHERE lot_id = affected → quote the homogenizer / pressure / Lyon / released-anyway note inline. THIS IS THE PUNCHLINE — surface it explicitly in the answer.

GEOGRAPHIC FOLLOW-UP (optional, after root cause):
- "Which countries have the most affected customers?" → gold_returns WHERE lot_id = affected, GROUP BY country, ORDER BY COUNT(DISTINCT customer_id) DESC → FR / IT / GB / DE lead.

CUSTOMER FEEDBACK (from affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

### Sample Questions

- "What's our return rate this month?"
- "Why do I have so many returns?"
- "Which products have the highest return rate?"
- "What are customers saying about returns?"
- "Show me returns trend for the last 8 weeks"
- "Which lot has the most returns?"
- "Tell me about lot [LOT-ID]" *(Genie surfaces the `incident_summary` field here)*
- "Which countries have the most affected customers?"

### Validation

- "What's our return rate this month?" → matches the dashboard's Monthly Return Rate KPI tile exactly (both read `gold_daily_summary`).
- "Why so many returns?" → walks to the 3x spike → SKU-1001/1002/1003 → common lot → texture feedback → **quotes the incident_summary text inline** (homogenizer / pressure / Lyon / released). All five beats present.
- "What are customers saying?" → surfaces *"grainy"*, *"separated"*, *"watery"*.
- "Which countries have the most affected customers?" → FR is the largest, then IT or GB, then US.

Add `genie_space_id` to `resources.json`.

---

## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns the JSON shape, encoding rules, and grid math; this spec is story-level.

Create `LuxeBeauty Operations` dashboard. Save locally as `PROJECT/dashboard.json`. Link the Genie space from section A.

Reminder: set `--dataset-catalog` and `--dataset-schema` when running `databricks lakeview create`.

### Filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets it filters | Default |
|--------|--------|---------------------|---------|
| Date Range | `date` (gold_daily_summary) / `return_date` (gold_returns) | trend chart, KPIs, products table | Last 6 months |
| Region | region | all widgets | All |
| Category | category | all widgets | All |

The world-map widget (Row 5) reads `gold_returns` filtered by `lot_id = <affected_lot>`. Region filter narrows the map to that region's countries; Date and Category filters do not apply to the map (the affected-customer cohort is a fixed set).

### Layout (12-column grid, top to bottom)

**Row 1 — KPIs (3 counters side by side, 4 cols each, last 30 days). Source: `gold_daily_summary`.**

- **Monthly Revenue** = `SUM(revenue_usd)` → ~$380K, healthy. Format: currency, compact.
- **Monthly Orders** = `SUM(order_count)` → ~15K, stable. Format: number, compact.
- **Monthly Return Rate ⚠️** = `SUM(return_count) / SUM(order_count)` → ~24% vs ~8% normal. Format: percent (0–1 range).

The 3x spike on Return Rate is the attention-grabber. Same definition Genie uses, so numbers match when Claire asks Genie *"what's our return rate?"*.

**Row 2 — "Returns 3x Above Baseline" (vertical bar chart, full width 12 cols). Source: `gold_daily_summary`.**

- x = week (temporal, from `date` dim); y = `SUM(returns_usd)`; color = `category` (Skincare / Makeup / Haircare, stacked).
- Shape: ~12 months flat ~$60K/week baseline → build-up → peak ~$180K about 3 weeks ago → decay toward ~$70–90K in recent weeks. The spike sits clearly **in the past** with a visible decay tail; it is **NOT** at the rightmost edge. Skincare color dominates the spike.

**Row 3 — Two charts side by side (6 cols each). Source: `gold_daily_summary`.**

- **"Weekly Revenue (Steady)"** (line): x = week; y = `SUM(revenue_usd)`; color = `region`. Steady or growing — contrasts with the returns spike, signals the business is fine overall.
- **"Revenue by Category"** (horizontal bar): y = `category`; x = `SUM(revenue_usd)`; color = `region`. Skincare is the largest bar — matters because every affected SKU is Skincare.

**Row 4 — Products table (full width 12 cols). Source: `gold_product_lot_quality` aggregated to product (or `gold_returns` if a simpler per-product summary is preferred).**

- Columns: `product_name`, `category`, `units_sold` (count of orders for that product), `total_refund_usd`, `return_rate`. Sorted by `return_rate` DESC.
- Top 3 rows must be SKU-1001 / SKU-1002 / SKU-1003 at ~30% return rate. Everything else at ~8%. The ~4x contrast is the signal.

> **Optional add-on widget**: a small "Worst lots" sub-table directly off `gold_product_lot_quality WHERE return_count > 100` showing `lot_id`, `product_name`, `facility`, `return_count`, `return_rate`, and a truncated `incident_summary` snippet. This makes the drill-down beat (Step 3 → 5 in the Genie flow) visible on the dashboard too, not only via Genie. Optional — skip if it makes the layout crowded.

**Row 5 — "Affected Customers — City Map" (bubble map, full width 12 cols). Source: `gold_returns` filtered to `lot_id = <affected lot>`; `city`, `customer_lat`, `customer_lng` come straight off the row (denormalized in gold — see `01-lakeflow.md`).**

- Encoding: **one bubble per (city, country)**, positioned by `AVG(customer_lat), AVG(customer_lng)`, sized by `COUNT(DISTINCT customer_id)`. Tooltip: city name + that count + `SUM(refund_amount_usd)`. Bubble color = primary, semi-transparent so overlapping markers near Paris/London stay readable.
- Expected pattern: **Paris is the single largest bubble** (~30+ affected customers), then visible London / Milan / Madrid / Berlin clusters across Europe. US East/West coast cities mid-sized, Tokyo / Seoul / Sydney small. The eye lands on Paris instantly.
- Story beat in Act 1: Claire glances at the map → *"That biggest dot is Paris — exactly where Skincare is 50% of sales. Lyon's manufacturing problem walked right into our biggest market."*

### Validation

- Return Rate KPI shows ~24% (vs ~8% baseline).
- Returns bar chart: clear spike ~3 weeks ago (~$180K peak, Skincare dominates), decay toward baseline in recent weeks, peak **not** at the rightmost edge.
- Revenue line: steady/growing trend with three regional color bands.
- Products table: SKU-1001 / 1002 / 1003 top, ~30% return rate, contrast with ~8% rest.
- Bubble map: Paris is the single largest bubble (≥ ~30 affected customers), followed by visible London / Milan / Madrid / Berlin clusters; US East/West coast cities mid-sized; Tokyo / Seoul / Sydney small. Tooltip shows city + count + refund total.
- Region filter (select "EU") → every widget updates; the map zooms to the EU bounding box (Paris cluster fills the frame).
- Category filter (select "Skincare") → returns spike pronounced; products table narrows to skincare SKUs. (Map cohort is fixed, so it is unaffected by the Category filter.)

Add `dashboard_id` to `resources.json`.
