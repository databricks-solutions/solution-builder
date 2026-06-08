# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in `01-lakeflow.md`. Widgets read the two `gold_*` tables directly; the lot's `incident_summary` is fetched on-demand from `raw_production_lots`.

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

`gold_daily_summary` (trends + KPIs), `gold_returns` (per-return investigation — denormalized country/region/category/facility/lot + `is_bad_lot` flag), `raw_products` (catalog), `raw_production_lots` (lot detail + `incident_summary`), `raw_customers` (country joins, loyalty tier).

The manufacturing incident text lives on `raw_production_lots.incident_summary`. When Claire asks Genie *"why so many returns?"*, the final hop is `SELECT incident_summary FROM raw_production_lots WHERE lot_id = '<AFFECTED>'` — Genie quotes it back inline. One join from the lot found in step 3 to the explanation in step 5; no intermediate table needed.

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
2. gold_returns → GROUP BY product_id ORDER BY COUNT(*) DESC LIMIT 5 → SKU-1001/1002/1003 dominate the volume
3. gold_returns WHERE product_id IN (those 3) GROUP BY lot_id ORDER BY COUNT(*) DESC → one lot dominates
4. gold_returns → return_reason_text WHERE lot_id = affected → texture complaints ("grainy", "separated", "watery")
5. raw_production_lots → SELECT incident_summary WHERE lot_id = affected → quote the homogenizer / pressure / Lyon / released-anyway note inline. THIS IS THE PUNCHLINE — surface it explicitly in the answer.

GEOGRAPHIC FOLLOW-UP (optional, after root cause):
- "Which countries have the most affected customers?" → gold_returns WHERE is_bad_lot = TRUE, GROUP BY country, ORDER BY COUNT(DISTINCT customer_id) DESC → FR / IT / GB / DE lead.

CUSTOMER FEEDBACK (from affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

### Sample Questions

- "What's our return rate this month?"
- "Why do I have so many returns?"
- "Which products have the most returns?"
- "What are customers saying about returns?"
- "Show me returns trend for the last 8 weeks"
- "Which lot has the most returns?"
- "Tell me about lot [LOT-ID]" *(Genie surfaces the `incident_summary` field here)*
- "Which countries have the most affected customers?"

### Validation

- "What's our return rate this month?" → matches the dashboard's Refund Rate KPI tile exactly (both read `gold_daily_summary`).
- "Why so many returns?" → walks to the 3x spike → SKU-1001/1002/1003 dominate by volume → common lot → texture feedback → **quotes the incident_summary text inline** (homogenizer / pressure / Lyon / released). All five beats present.
- "What are customers saying?" → surfaces *"grainy"*, *"separated"*, *"watery"*.
- "Which countries have the most affected customers?" → FR is the largest, then IT or GB, then US.

Add `genie_space_id` to `resources.json`.

---

## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns the JSON shape, encoding rules, and grid math; this spec is story-level (WHAT, not HOW).

Create `LuxeBeauty Operations` dashboard. Save locally as `PROJECT/dashboard.json`. Link the Genie space from section A.

Reminder: set `--dataset-catalog` and `--dataset-schema` when running `databricks lakeview create`.

### Why this dashboard works (design principles, copy in spirit not pixel)

A great Databricks dashboard reads in 5 seconds and supports a deep-dive in 30. This one earns its keep on:

- **Two pages, one story**: page 1 is the glance — *"something happened, here's the shape and forecast"*. Page 2 is the deep-dive — *"here's exactly which products, lots, countries, and complaints"*. Operators land on page 1 daily; analysts open page 2 once.
- **Three datasets, no more**: one daily aggregate (`ds_daily` → KPIs + category donut), one row-level fact (`ds_returns` → map, country splits, comments, product/lot rollups via GROUP BY), one forecast TVF (`ds_forecast`, separate because `AI_FORECAST` can't share). Cross-widget click-filtering works inside each dataset — fewer datasets = more interactivity.
- **KPI sparklines carry the story at a glance**: each counter uses the `period` encoding so a tiny weekly trend renders behind the headline number. The Refunds counter shows the spike-then-decay shape even before the eye drops to the forecast.
- **A map is the visual hook**: bubble map on Operations page, full width — instantly readable, beats any table for *"where are the affected customers?"*.
- **One AI/BI showcase per page**: Operations gets `AI_FORECAST` (showing AI-native analytics inside a dashboard); Investigation gets the per-row split charts that demonstrate Lakeview's grouped-bar comparisons.
- **Clean theme — no borders, white canvas, blue palette**: `widgetBorderColor` matches `widgetBackgroundColor` so widgets float on the canvas; left-aligned widget headers; one cohesive cool palette. The result reads as "modern analytics product", not "default template".

### Theme

```
canvasBackgroundColor: #FFFFFF (light) / #0F1419 (dark)
widgetBackgroundColor: #FFFFFF (light) / #161B22 (dark)
widgetBorderColor:     same as widgetBackgroundColor (= no visible border)
fontColor:             #111827 (light) / #E8ECF0 (dark)
visualizationColors:   ["#2563EB","#0EA5E9","#0891B2","#1E3A8A","#7C3AED","#0D9488","#F59E0B"]
widgetHeaderAlignment: LEFT
```

### Datasets (3 total)

| Name | Source | Powers |
|---|---|---|
| `ds_daily` | `SELECT date, region, category, order_count, return_count, revenue_usd, returns_usd FROM gold_daily_summary WHERE date >= DATEADD(day, -90, current_date())` | 4 KPI counters + category donut |
| `ds_returns` | `SELECT return_id, return_date, country, city, customer_lat, customer_lng, region, product_name, category, lot_id, facility, is_bad_lot, CASE WHEN is_bad_lot THEN 'Affected lot' ELSE 'Everyday returns' END AS source, return_reason, return_reason_text, refund_amount_usd FROM gold_returns WHERE return_date >= DATEADD(day, -90, current_date())` | Map, country split bars, product/lot rollups (GROUP BY at widget level), reason splits, comments table |
| `ds_forecast` | `WITH original AS (SELECT DATE_TRUNC('WEEK', date) AS week, SUM(returns_usd) AS refunds FROM gold_daily_summary WHERE DATE_TRUNC('WEEK', date) < DATE_TRUNC('WEEK', current_date()) AND date >= DATEADD(day, -180, current_date()) GROUP BY 1), …, forecast AS (SELECT … FROM AI_FORECAST(TABLE(original), horizon => …, time_col => 'week', value_col => 'refunds')) SELECT actuals UNION ALL forecast UNION ALL <bridging row that repeats the last actual as the forecast seam>` | Forecast-line widget (full pattern in dashboard skill's `4-examples.md` — copy verbatim, swap names) |

### Global filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets | Default |
|---|---|---|---|
| Date Range | `date` (ds_daily) / `return_date` (ds_returns) | ds_daily, ds_returns | Last 6 months |
| Region | `region` | ds_daily, ds_returns | All |
| Category | `category` | ds_daily, ds_returns | All |

`ds_forecast` is **unfiltered** by all three — `AI_FORECAST` needs a stable trailing window.

### Page 1 — Operations (the glance, 12-column grid)

**Row 1 (y=0, h=2, full width)** — title markdown. *"LuxeBeauty Returns — Operations. Claire Dubois, VP Ops. The bad lot LOT-{date} ships in late April, the surge follows weeks later. We've traced it; this dashboard tracks the recovery."*

**Row 2 (y=2, h=3, 4 counters side by side, w=3 each)** — KPIs from `ds_daily`. All `counter` widgets with a `period` encoding (weekly `DATE_TRUNC` bucket from the same dataset) so a sparkline renders behind the headline.

- **Refunds — last 90d** — `SUM(returns_usd)`. Format: currency, compact. Sparkline: the spike-then-decay shape — visual hook.
- **Returns — last 90d** — `SUM(return_count)`. Format: number, compact. Sparkline: matches refunds.
- **Orders — last 90d** — `SUM(order_count)`. Format: number, compact. Sparkline: flat — business is fine overall.
- **Refund Rate (%)** — `SUM(return_count) / SUM(order_count)`. Format: percent. Same definition Genie uses.

**Row 3 (y=5, h=5, full width)** — *"Weekly refunds — actuals + forecast"* (`forecast-line`). Source: `ds_forecast`.

- Encoding: x = `week` (temporal); y `refunds` = actuals (solid line); y `refunds_forecast` / `refunds_upper` / `refunds_lower` = forecast band (dashed). Format y as `number-currency` USD compact.
- Shape: ~6 months weekly actuals → peak ~3 weeks ago → decay → 4-week forecast band continuing the decay back toward baseline. The seam needs a bridging row repeating the last actual as `refunds_forecast`, otherwise the band starts disconnected.
- **Vertical-line annotation on `AFFECTED_LOT_DATE`** — label: `"Production incident PIR-<YYYY-MM-DD> — Lyon HMG-03 calibration drift"`. The cause precedes the effect — annotation sits to the LEFT of the bump. The same date appears verbatim in the `incident_summary` text on the affected lot; they MUST match. Pick `visualizationColors` position 3 or 4 for the marker color.
- No category color split — keep the forecast view clean.

**Row 4 (y=10, h=6, full width)** — *"Affected customers — bubble map"* (`symbol-map`). Source: `ds_returns` with widget-level filter `is_bad_lot = TRUE` (apply in the widget's `fields` / WHERE, not on the dataset — keeps the dataset shared with other widgets).

- Encoding: `coordinates: { latitude: AVG(customer_lat), longitude: AVG(customer_lng) }` (nested shape — top-level lat/lng won't render). Grouped by `(city, country)`; bubble size = `COUNT(DISTINCT customer_id)`. Tooltip: city + count + `SUM(refund_amount_usd)`. Bubble color: primary, semi-transparent. `colorRamp.scheme: "RdYlBu"` (capitalized — `"redyellowblue"` silently fails).
- Expected: Paris is the single largest bubble (~30+ affected customers); London / Milan / Madrid / Berlin visible across Europe; US East/West mid-sized; Tokyo / Seoul / Sydney small.

**Row 5 (y=16, h=5, two side-by-side w=6)**

- **Refunds by category** (pie/donut). Source: `ds_daily`. Slices = `category`, value = `SUM(returns_usd)`. Skincare dominates — the affected lot's category.
- **Refunds by country** (bar, horizontal, stacked). Source: `ds_returns`. y = `country`, x = `SUM(refund_amount_usd)`, color = `category` (stacked). France leads, then IT / GB / DE / US — and the Skincare slice dominates every affected-country bar, making the lot's category visible at a glance.

### Page 2 — Investigation (the deep-dive, 12-column grid)

**Row 1 (y=0, h=2, full width)** — title markdown. *"Investigation — why is this happening? The same data, split by the dimensions that matter: which products, which lots, which countries, and what customers are saying."*

**Row 2 (y=2, h=6, two side-by-side w=6)** — top offenders.

- **Returns by product** (bar, horizontal). Source: `ds_returns`. y = `product_name`, x = `COUNT(return_id)`. Sort x DESC. The three Skincare SKUs (SKU-1001/1002/1003) dominate the top.
- **Worst production lots** (bar, horizontal). Source: `ds_returns`. y = `lot_id`, x = `COUNT(return_id)`. Sort x DESC. The affected `LOT-{date}` is ~10× the next lot — the spike concentrated in one production run. *Metric is count, not rate — the simple demo doesn't carry units_sold per lot.*

**Row 3 (y=8, h=1, full width)** — section heading: *"Affected lot vs everyday returns — same dimensions, different shapes."*

**Row 4 (y=9, h=6, two side-by-side w=6)** — comparison bars, color by `source` (= the affected-vs-everyday CTE column).

- **Refunds by country: affected lot vs everyday** (bar, grouped). Source: `ds_returns`. x = `country`, y = `SUM(refund_amount_usd)`, color = `source` (two-value categorical: `Affected lot` → `visualizationColors[3]` = `#1E3A8A` navy, `Everyday returns` → `visualizationColors[4]` = `#7C3AED` violet — palette is 0-indexed in the JSON). Across every EU country the affected-lot bar dwarfs everyday returns.
- **Return reasons: affected lot vs everyday** (bar, horizontal, grouped). Source: `ds_returns`. y = `return_reason` (enum from 01-lakeflow: `quality` / `didnt_fit` / `wrong_item` / `changed_mind`), x = `COUNT(return_id)`, color = `source`. *"`quality` is ~all bad-lot; `changed_mind` / `wrong_item` / `didnt_fit` are unrelated."*

**Row 5 (y=15, h=1, full width)** — section heading: *"Customer voice — what people are telling us."*

**Row 6 (y=16, h=5, two side-by-side w=6)**

- **Returns by city** (table). Source: `ds_returns`. Columns: `city`, `country`, `COUNT(DISTINCT return_id)` AS `returns`, `SUM(refund_amount_usd)` AS `refunds`. Sort returns DESC. Paris on top.
- **Recent customer comments** (table). Source: `ds_returns`. Columns: `return_date`, `country`, `product_name`, `lot_id`, `return_reason_text` (wider column, wrap). Filter to non-null comments. Sort `return_date` DESC, limit by widget. Texture quotes (*"grainy"*, *"separated"*, *"watery"*) cluster on the affected lot.

### Validation

- Operations page renders without horizontal scroll on a 1440px screen; widgets float on a white canvas with no visible borders.
- Each KPI counter shows a weekly sparkline behind its value. Refunds and Refund Rate sparklines show the spike-then-decay shape clearly.
- Forecast-line: actuals through ~last full week, dashed prediction band continuing 4 weeks forward, **vertical annotation line on `AFFECTED_LOT_DATE`** labeled with the lot ID. Peak **not** at the rightmost edge.
- Bubble map: Paris is the single largest bubble (≥ ~30 affected customers), followed by visible London / Milan / Madrid / Berlin clusters; US East/West mid-sized; Tokyo / Seoul / Sydney small. Tooltip shows city + count + refund total.
- Refunds-by-country bar: France first, then IT/GB/DE/US; bars stacked by `category` with Skincare dominating the EU stack.
- Category donut: Skincare is the largest slice.
- Investigation page: Worst-lots bar has one bar ~10× the next.
- Affected-vs-everyday country bars: every EU country shows a navy `Affected lot` bar taller than its violet `Everyday returns` bar.
- Reasons bar: `quality` is ~all navy; `changed_mind` / `wrong_item` / `didnt_fit` are ~all violet.
- Comments table: visible *"grainy"*, *"separated"*, *"watery"* in `return_reason_text` rows.
- Region filter (select "EU") → every widget updates; the map zooms to the EU bounding box (Paris cluster fills the frame).
- Category filter (select "Skincare") → returns spike pronounced; product bar narrows to skincare SKUs.

Add `dashboard_id` to `resources.json`.
