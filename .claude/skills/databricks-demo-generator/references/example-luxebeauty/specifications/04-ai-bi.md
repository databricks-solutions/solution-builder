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

`mv_returns` (canonical revenue / orders / return-rate / refund-rate metric view, over `gold_daily_summary` — defined in `02-uc-governance.md`), `gold_daily_summary` (raw daily — for AI_FORECAST queries that can't go through MV), `silver_returns` (per-return investigation: denormalized country/region/category/facility/lot/customer + `anger_score` + `is_bad_lot` — used for product/lot rollups via GROUP BY, customer feedback, sentiment), `bronze_products` (catalog), `bronze_production_lots` (lot details + production_date), `bronze_customers` (for the `premium_status` CS-tag + `country` joins), `gold_customer_premium_predictions` (per-customer `premium_prob` + `final_tier`, written by the ML notebook in `03-ml-premium.md`).

### Instructions

```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).

BASELINES: Normal weekly returns ~$60K, normal return rate ~8%, anomaly threshold >20%.

HEADLINE NUMBERS — always answer from mv_returns:
- "What's our return rate?" / "Revenue this month?" / "Refund rate by region?" → mv_returns
  (same metric definition the dashboard KPI tiles use — numbers will match exactly)

INVESTIGATION FLOW for "Why so many returns?":
1. mv_returns → MEASURE(total_refunds) by week → spot 3x spike (~$180K peak ~3 weeks ago, decaying but still above baseline)
2. silver_returns → GROUP BY product_id ORDER BY COUNT(*) DESC LIMIT 5 → SKU-1001/1002/1003 dominate by volume
3. silver_returns WHERE product_id IN (those 3) GROUP BY lot_id ORDER BY COUNT(*) DESC → one lot dominates
4. silver_returns → return_reason_text WHERE lot_id = affected → texture complaints ("grainy", "separated", "watery")
5. silver_returns → AVG(anger_score) WHERE lot_id = affected → high anger (~0.8) confirms the upset cohort. Conclude + suggest: "Would you like me to check for production incidents?"

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

### Why this dashboard works (design principles)

A great Databricks dashboard reads in 5 seconds and supports a deep-dive in 30. This one earns its keep on:

- **Two pages, one story**: page 1 is the glance — *"something happened, here's the shape and forecast"*. Page 2 is the deep-dive — *"here's exactly which products, lots, countries, and what people are saying"*. Operators land on page 1 daily; analysts open page 2 once.
- **One metric view + two datasets, no more**: `mv_returns` is the canonical daily metric layer (KPIs, category donut) — same definitions Genie uses, numbers always match. `silver_returns` powers every per-row widget (map, comments, per-product/per-lot rollups via widget GROUP BY). `ds_forecast` is a third dataset only because `AI_FORECAST` is a TVF that can't go through a metric view. Cross-widget click-filtering works inside each dataset — fewer datasets = more interactivity.
- **KPI sparklines carry the story at a glance**: each counter uses the `period` encoding so a tiny weekly trend renders behind the headline number. The Refunds counter shows the spike-then-decay shape even before the eye drops to the forecast.
- **A map is the visual hook**: bubble map on Operations page, full width — instantly readable, beats any table for *"where are the affected customers?"*.
- **One AI/BI showcase per page**: Operations gets `AI_FORECAST` (AI-native analytics inside a dashboard); Investigation gets `ai_classify`-driven sentiment bins (via `anger_score` on `silver_returns`) and grouped-bar affected-vs-everyday splits.
- **Clean theme — no borders, white canvas, blue palette**: `widgetBorderColor` matches `widgetBackgroundColor` so widgets float on the canvas; left-aligned widget headers; one cohesive cool palette. Reads as a modern analytics product.

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
| `ds_metrics` | `mv_returns` (MEASURE() syntax — `total_refunds`, `total_revenue`, `order_count`, `return_count`, `return_rate`, `refund_rate`) | 4 KPI counters + category donut |
| `ds_returns` | `SELECT return_id, return_date, country, city, customer_lat, customer_lng, region, product_name, category, lot_id, facility, is_bad_lot, CASE WHEN is_bad_lot THEN 'Affected lot' ELSE 'Everyday returns' END AS source, return_reason, return_reason_text, anger_score, CASE WHEN anger_score >= 0.9 THEN '3 - Very angry' WHEN anger_score >= 0.5 THEN '2 - Angry' WHEN anger_score >= 0.2 THEN '1 - Neutral' ELSE '0 - Satisfied' END AS sentiment, refund_amount_usd FROM silver_returns WHERE return_date >= DATEADD(day, -90, current_date())` | Map, country split bars, sentiment bin, product/lot rollups (GROUP BY at widget level), reason splits, comments table |
| `ds_forecast` | `WITH original AS (SELECT DATE_TRUNC('WEEK', date) AS week, SUM(returns_usd) AS refunds FROM gold_daily_summary WHERE DATE_TRUNC('WEEK', date) < DATE_TRUNC('WEEK', current_date()) AND date >= DATEADD(day, -180, current_date()) GROUP BY 1), …, forecast AS (SELECT … FROM AI_FORECAST(TABLE(original), horizon => …, time_col => 'week', value_col => 'refunds')) SELECT actuals UNION ALL forecast UNION ALL <bridging row that repeats the last actual as the forecast seam>` | Forecast-line widget (full pattern in dashboard skill's `4-examples.md` — copy verbatim, swap names) |

### Global filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets | Default |
|---|---|---|---|
| Date Range | `date` (ds_metrics) / `return_date` (ds_returns) | ds_metrics, ds_returns | Last 6 months |
| Region | `region` | ds_metrics, ds_returns | All |
| Category | `category` | ds_metrics, ds_returns | All |

`ds_forecast` is **unfiltered** by all three — `AI_FORECAST` needs a stable trailing window.

### Page 1 — Operations (the glance)
**Row 1** — title markdown. *"LuxeBeauty Returns — Operations. Claire Dubois, VP Ops. The bad lot LOT-{date} ships in late {month}, the surge follows weeks later. We've traced it; this dashboard tracks the recovery."*

**Row 2** — KPIs from `ds_metrics`. All `counter` widgets with a `period` encoding (weekly `DATE_TRUNC` bucket from the same dataset) so a sparkline renders behind the headline.

- **Refunds — last 90d** — `MEASURE(total_refunds)`. Format: currency, compact. Sparkline: spike-then-decay — the visual hook.
- **Returns — last 90d** — `MEASURE(return_count)`. Format: number, compact. Sparkline matches refunds.
- **Orders — last 90d** — `MEASURE(order_count)`. Format: number, compact. Sparkline: flat — business is fine overall.
- **Refund Rate (%)** — `MEASURE(return_rate)`. Format: percent. Same metric Genie uses — numbers match exactly.

**Row 3** — *"Weekly refunds — actuals + forecast"* (`forecast-line`). Source: `ds_forecast`.

- Encoding: x = `week` (temporal); y `refunds` = actuals (solid); y `refunds_forecast` / `refunds_upper` / `refunds_lower` = forecast band (dashed). Format y as `number-currency` USD compact.
- Shape: ~6 months weekly actuals → peak ~3 weeks ago → decay → 4-week forecast band continuing the decay back toward baseline. The seam needs a bridging row repeating the last actual as `refunds_forecast`, otherwise the band starts disconnected.
- **Vertical-line annotation on `AFFECTED_LOT_DATE`** (from `01-lakeflow.md` → "Shared Context") — label: `"Production incident PIR-<YYYY-MM-DD> — Lyon HMG-03 calibration drift"`. Cause precedes effect — annotation sits to the LEFT of the bump. The same date appears verbatim in the PIR PDF (Section C); they MUST match. Pick `visualizationColors[3]` (`#1E3A8A` navy) for the marker.
- **Story invariant**: `AFFECTED_LOT_DATE` (NOW-8w) must be BEFORE `SPIKE_PEAK` (NOW-3w). If the synth produces a lot whose `production_date` is at or after the spike peak, regenerate the synth before publishing.
- No category color split — keep the forecast view clean.

**Row 4** — *"Affected customers — bubble map"* (`symbol-map`). Source: `ds_returns` with widget-level filter `is_bad_lot = TRUE` (apply in the widget's `fields` / WHERE, not on the dataset).

- Encoding: `coordinates: { latitude: AVG(customer_lat), longitude: AVG(customer_lng) }` (nested shape — top-level lat/lng won't render). Grouped by `(city, country)`; bubble size = `COUNT(DISTINCT customer_id)`. Tooltip: city + count + `SUM(refund_amount_usd)`. Bubble color: primary, semi-transparent. `colorRamp.scheme: "RdYlBu"` (capitalized — `"redyellowblue"` silently fails).
- Expected: **Paris is the single largest bubble** (~30+ affected customers); London / Milan / Madrid / Berlin visible across Europe; US East/West mid-sized; Tokyo / Seoul / Sydney small.
- Premium/tier-split story is NOT on the map — it lives in the chat (the agent's `find_lot_premium_breakdown` tool surfaces the labeled-vs-hidden split).

**Row 5**

- **Refunds by category** (pie/donut). Source: `ds_metrics`. Slices = `category`, value = `MEASURE(total_refunds)`. Skincare dominates — the affected lot's category.
- **Refunds by country** (bar, horizontal, stacked). Source: `ds_returns`. y = `country`, x = `SUM(refund_amount_usd)`, color = `category` (stacked). France leads, then IT / GB / DE / US — and the Skincare slice dominates every affected-country bar, making the lot's category visible at a glance.

### Page 2 — Investigation (the deep-dive)
**Row 1** — title markdown. *"Investigation — why is this happening? The same data, split by the dimensions that matter: which products, which lots, which countries, and what customers are saying — including their sentiment classified by `ai_classify`."*

**Row 2** — top offenders.

- **Returns by product** (bar, horizontal). Source: `ds_returns`. y = `product_name`, x = `COUNT(return_id)`. Sort x DESC. The three Skincare SKUs (SKU-1001/1002/1003) dominate the top.
- **Worst production lots** (bar, horizontal). Source: `ds_returns`. y = `lot_id`, x = `COUNT(return_id)`. Sort x DESC. The affected `LOT-{date}` is ~10× the next lot — the spike concentrated in one production run. *Metric is count, not rate — the demo computes lot rollups via widget GROUP BY on silver_returns.*

**Row 3** — section heading: *"Affected lot vs everyday returns — same dimensions, different shapes."*

**Row 4** — comparison bars, color by `source` (the affected-vs-everyday CASE column).

- **Refunds by country: affected lot vs everyday** (bar, grouped). Source: `ds_returns`. x = `country`, y = `SUM(refund_amount_usd)`, color = `source` (two-value categorical: `Affected lot` → `visualizationColors[3]` = `#1E3A8A` navy, `Everyday returns` → `visualizationColors[4]` = `#7C3AED` violet — palette is 0-indexed in the JSON). Across every EU country the affected-lot bar dwarfs everyday returns.
- **Return reasons: affected lot vs everyday** (bar, horizontal, grouped). Source: `ds_returns`. y = `return_reason` (enum from 01-lakeflow: `quality` / `didnt_fit` / `wrong_item` / `changed_mind`), x = `COUNT(return_id)`, color = `source`. *"`quality` is ~all bad-lot; `changed_mind` / `wrong_item` / `didnt_fit` are unrelated."*

**Row 5** — section heading: *"Customer voice — sentiment, geography, and what people are telling us."*

**Row 6**

- **Sentiment of return comments (ai_classify)** (bar, horizontal). Source: `ds_returns`. y = `sentiment` (4 ordered bins: `0 - Satisfied` / `1 - Neutral` / `2 - Angry` / `3 - Very angry` — derived from `anger_score` thresholds in the dataset CASE). x = `COUNT(return_id)`. Sort y by sort-key (the leading digit keeps the order). Affected-lot returns concentrate in `2 - Angry` and `3 - Very angry`.
- **Returns by city** (table). Source: `ds_returns`. Columns: `city`, `country`, `COUNT(DISTINCT return_id)` AS `returns`, `SUM(refund_amount_usd)` AS `refunds`. Sort returns DESC. Paris on top.

**Row 7** — *"Customer comments"* (table). Source: `ds_returns`. Columns: `return_date`, `country`, `product_name`, `lot_id`, `anger_score` (numeric, sortable), `return_reason_text` (wide column, wrap). Filter to non-null comments. Sort `anger_score` DESC (then `return_date` DESC). Texture quotes (*"grainy"*, *"separated"*, *"watery"*) cluster on the affected lot with high anger scores.

### Validation

- Operations page renders without horizontal scroll on a 1440px screen; widgets float on a white canvas with no visible borders.
- KPI counters: each shows a weekly sparkline. Refunds and Refund Rate sparklines show the spike-then-decay shape clearly. **Refund Rate value matches Genie's answer to "what's our return rate this month?" exactly** (both read `mv_returns`).
- Forecast-line: actuals through ~last full week, dashed prediction band continuing 4 weeks forward, **vertical annotation line on `AFFECTED_LOT_DATE`** labeled with the lot ID. Peak **not** at the rightmost edge.
- Bubble map: Paris is the single largest bubble (≥ ~30 affected customers), followed by visible London / Milan / Madrid / Berlin clusters; US East/West mid-sized; Tokyo / Seoul / Sydney small.
- Refunds-by-country bar: France first, then IT/GB/DE/US; bars stacked by `category` with Skincare dominating the EU stack.
- Category donut: Skincare is the largest slice.
- Investigation Worst-lots bar: one bar ~10× the next.
- Affected-vs-everyday country bars: every EU country shows a navy `Affected lot` bar taller than its violet `Everyday returns` bar.
- Reasons bar: `quality` is ~all navy; `changed_mind` / `wrong_item` / `didnt_fit` are ~all violet.
- Sentiment bar: `2 - Angry` + `3 - Very angry` dominate the affected-lot subset; `0 - Satisfied` dominates everyday returns.
- Comments table: visible *"grainy"*, *"separated"*, *"watery"* in `return_reason_text` rows, with `anger_score` ≥ 0.7.
- Region filter (select "EU") → every widget updates; the map zooms to the EU bounding box (Paris cluster fills the frame).
- Category filter (select "Skincare") → returns spike pronounced; product bar narrows to skincare SKUs.

Add `dashboard_id` to `resources.json`.

---

