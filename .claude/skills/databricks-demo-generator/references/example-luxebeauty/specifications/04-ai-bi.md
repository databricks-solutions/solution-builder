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

### Self-sufficient room

Anyone opening the Genie room must understand the story without prior context. Wire all three:

- **Space `description`** (set via `PATCH /api/2.0/genie/spaces/<id>`): 1-3 sentences naming the event (what happened + headline number + cause + blast radius) and pointing to the suggested questions in order. Pulled from the README — don't restate it, lift it.
- **Story-context `text_instruction`** at the TOP of `instructions.text_instructions[]` (before the headline-metric rules): WHAT HAPPENED · WHAT TO HELP THE PERSONA DO · TONE. ~5-8 lines. The LLM honors this on every turn.
- **`sample_questions`** (chips users see) AND the matching `example_question_sqls` walk the story arc end-to-end (7-step pattern below). Each entry has the question phrased naturally + the SQL that answers it. Both lists must be in the same order.

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

### Sample Questions — 7-step story arc

Ship 7 questions, in this order, each as both a chip (`config.sample_questions`) AND a curated SQL (`instructions.example_question_sqls`). The arc walks an unfamiliar user from "what's wrong?" to "what's next?" without them needing to know the story:

1. **Headline** — "What's our return rate this month, and how does it compare to baseline?" → weekly `MEASURE(total_refunds)` + `MEASURE(return_rate)` from `mv_returns`, last 8 weeks.
2. **Drill to products** — "Why do I have so many returns? Trace it to the products and the lot." → top products by `COUNT(*)` from `silver_returns`.
3. **Drill to lot + QC story** — "Which production lot is driving the spike, and what does the QC note say?" → `CTE` finds the top lot for the 3 affected SKUs, JOINs `raw_production_lots` to quote `incident_summary` (the punchline).
4. **Customer voice** — "What are affected customers saying? Show the angriest comments." → `silver_returns WHERE is_bad_lot ORDER BY anger_score DESC` — surfaces "grainy" / "separated" / "watery", ai_classify in action.
5. **Blast radius** — "Where are the affected customers? Group by country." → COUNT DISTINCT + SUM refunds, `WHERE is_bad_lot`.
6. **Premium cohort** — "How many affected customers are premium (tagged or model-predicted)?" → JOIN `gold_customer_returns × gold_customer_premium_predictions`, COUNT by `final_tier`, separate `premium_status_labeled = 'premium'` (CS-tagged) from `IS NULL` (model-found hidden premium).
7. **Recovery** — "Are refunds recovering? Show the trend and what's next." → last 6 weeks of `MEASURE(total_refunds)` showing the decay toward baseline.

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
- **Self-sufficient pages**: Row 1 of every page is a markdown `text` widget that names the event (what / when / cause / blast radius) and tells the reader what to look at on this page (which widget answers which question, what shape they should expect to see, how to drill). A user opening this dashboard cold should know the story in 5 seconds. Lift the situation from the README — don't repeat the full narrative, just the dashboard-relevant tour.

### Theme

```
canvasBackgroundColor: #F5F7FB (light, blue-tinted neutral) / #0F1419 (dark)
widgetBackgroundColor: #FFFFFF (light) / #161B22 (dark)
widgetBorderColor:     same as widgetBackgroundColor (= no visible border)
fontColor:             #1F2530 (light) / #E8ECF0 (dark)
selectionColor:        #4F7CE3 (light) / #8ACAFF (dark)
visualizationColors:   ["#094074","#3C6997","#5ADBFF","#FFDD4A","#FE9000"]
widgetHeaderAlignment: LEFT
```

5-stop palette progresses cool → warm: deep navy → steel blue → sky cyan → soft yellow → vivid orange. Position 0 (`#094074` navy) is the visual anchor — used for the largest category (Skincare in this demo) and the KPI sparklines.

**Semantic colors (literal-hex pinned everywhere they appear, NEVER `themeColorType: position N` — palette swaps would silently break them):**
- **Affected lot / incident annotation** → `#FFDD4A` soft yellow (warm highlight, stands out without screaming).
- **Everyday returns / baseline** → `#3C6997` steel blue (cool, harmonizes with the palette).

**Category color pins (literal-hex on EVERY widget that colors by `category`)** — Lakeview cycles the palette by SQL-result order, which differs across widgets reading different datasets. Pinning is the only way to guarantee Skincare is the same color on the donut AND on the country stack:

| Category | Hex | Rationale |
|---|---|---|
| Skincare | `#094074` deep navy | The affected category — anchor color |
| Bodycare | `#3C6997` steel blue | |
| Makeup | `#5ADBFF` sky cyan | |
| Haircare | `#FFDD4A` soft yellow | |
| Fragrance | `#FE9000` vivid orange | |

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

**Row 2 — 4 × `counter` (sparklines via `period` encoding, weekly bucket)**. Source: `ds_metrics`.

- **Refunds — last 90d** · `MEASURE(total_refunds)` · currency compact · *sparkline shows spike-then-decay — the visual hook.*
- **Returns — last 90d** · `MEASURE(return_count)` · number compact · *sparkline matches refunds.*
- **Orders — last 90d** · `MEASURE(order_count)` · number compact · *sparkline flat — the business is fine.*
- **Refund Rate (%)** · `MEASURE(return_rate)` · percent · *same metric Genie uses; numbers match exactly.*

**Row 3 — `forecast-line` · "Weekly refunds — actuals + forecast"**. Source: `ds_forecast`. x = `week` (temporal); y `refunds` = actuals (solid); y `refunds_forecast` / `refunds_upper` / `refunds_lower` = forecast band (dashed); y format `number-currency` USD compact. Bridging row repeating last actual as `refunds_forecast` so the band doesn't disconnect at the seam.

- **Vertical-line annotation** on `AFFECTED_LOT_DATE` (Shared Context, 01-lakeflow.md), label `"Production incident PIR-<YYYY-MM-DD> — Lyon HMG-03 calibration drift"`, marker literal-hex `#FE9000` (vivid orange — the warm alert pulled from the palette's last stop). Same date as the PIR PDF (Section C) — they MUST match.
- **Story invariant**: `AFFECTED_LOT_DATE` (NOW-8w) BEFORE `SPIKE_PEAK` (NOW-3w) — regenerate synth if violated.
- *Baseline ticks flat for ~5w → orange bar drops in (the incident) → ~5w later the line spikes to ~$180K → decays toward baseline → continues as dashed band 4w ahead. Cause → effect → what's next, in one chart.*

**Row 4 — two side-by-side**

- **`pie` (donut) · "Refunds by category"** · `ds_metrics` · slices = `category`, angle = `MEASURE(total_refunds)`, color via literal-hex category pins (above) · *one slice dwarfs the rest — Skincare in deep navy. Pairs with the map below: affected lot is Skincare, Europe is Skincare-heavy.*
- **`bar` horizontal stacked · "Refunds by country"** · `ds_returns` · y = `country`, x = `SUM(refund_amount_usd)`, color = `category` (same literal-hex pins) · *France leads, then IT / GB / DE / US — and the deep-navy Skincare slice dominates every affected-country stack. Category + geography in one chart.*

**Row 5 — `symbol-map` · "Affected customers — bubble map"** (full width). Source: `ds_returns`, widget-level filter `is_bad_lot = TRUE`. Encoding `coordinates: { latitude: AVG(customer_lat), longitude: AVG(customer_lng) }` (nested; top-level fields won't render), grouped by `(city, country)`, size = `COUNT(DISTINCT customer_id)`, tooltip city + count + `SUM(refund_amount_usd)`, semi-transparent fill, `colorRamp.scheme: "YlOrRd"` (yellow → orange → red; light = low refunds, deep red = highest).

- *Europe lights up: Paris dominates (~30+ affected) deep red, then London / Milan / Madrid / Berlin cluster; US East/West mid-sized; Tokyo / Seoul / Sydney small. Answers "where did the bad lot land?" before anyone reads a number.* Premium tier-split lives in chat, not on the map.

### Page 2 — Investigation (the deep-dive)

**Row 1** — title markdown. *"Investigation — why is this happening? The same data, split by the dimensions that matter: which products, which lots, which countries, and what customers are saying — including their sentiment classified by `ai_classify`."*

**Row 2 — Top offenders**

- **`bar` horizontal · "Returns by product"** · `ds_returns` · y = `product_name`, x = `COUNT(return_id)`, sort x DESC · *three Skincare SKUs (SKU-1001/1002/1003) sit an order of magnitude above the rest — "Skincare is the problem."*
- **`bar` horizontal · "Worst production lots"** · `ds_returns` · y = `lot_id`, x = `COUNT(return_id)`, sort x DESC · *one lot bar towers ~10× over the next — the spike concentrated in a single production run; the same lot the timeline marked.* Count, not rate — rollup via widget GROUP BY on `silver_returns`.

**Row 3** — section heading: *"Affected lot vs everyday returns — same dimensions, different shapes."*

**Row 4 — affected vs everyday, color = `source` literal-hex pinned (`Affected lot` → `#FFDD4A` soft yellow, `Everyday returns` → `#3C6997` steel blue) — same pins on BOTH split widgets so the eye carries the legend across**

- **`bar` grouped · "Refunds by country"** · `ds_returns` · x = `country`, y = `SUM(refund_amount_usd)` · *every EU country: yellow bar towers over steel blue — spike is the one lot in the EU market, not a catalog-wide trend.*
- **`bar` horizontal grouped · "Return reasons"** · `ds_returns` · y = `return_reason` (`quality` / `didnt_fit` / `wrong_item` / `changed_mind`), x = `COUNT(return_id)` · *`quality` is ~all yellow; the other reasons ~all steel blue — a product problem on this lot, not fit / changed-mind.*

**Row 5** — section heading: *"Customer voice — sentiment, geography, and what people are telling us."*

**Row 6**

- **`bar` horizontal · "Sentiment of return comments (ai_classify)"** · `ds_returns` · y = `sentiment` (4 ordered bins `0 - Satisfied` / `1 - Neutral` / `2 - Angry` / `3 - Very angry`, leading digit pins sort order) from `anger_score` thresholds in the dataset CASE, x = `COUNT(return_id)` · *Angry + Very angry dominate the affected-lot subset; everyday returns sit in Satisfied / Neutral — `ai_classify` shows up live, "these customers aren't just returning, they're upset."*
- **`table` · "Returns by city"** · `ds_returns` · columns `city`, `country`, `COUNT(DISTINCT return_id)` AS `returns`, `SUM(refund_amount_usd)` AS `refunds`, sort returns DESC · *Paris on top, then London / Milan / Madrid / Berlin — same cluster as the map, ranked with refund $.*

**Row 7 — `table` · "Customer comments"** (full width) · `ds_returns` · columns `return_date`, `country`, `product_name`, `lot_id`, `anger_score` (sortable), `return_reason_text` (wrap), filter non-null, sort `anger_score` DESC then `return_date` DESC · *high-anger quotes — "grainy", "separated", "watery" — all on the same `lot_id`. The raw voice closes the arc with verbatim evidence.*

### Validation

- Operations page renders without horizontal scroll on a 1440px screen; widgets float on a white canvas with no visible borders.
- KPI counters: each shows a weekly sparkline. Refunds and Refund Rate sparklines show the spike-then-decay shape clearly. **Refund Rate value matches Genie's answer to "what's our return rate this month?" exactly** (both read `mv_returns`).
- Forecast-line: actuals through ~last full week, dashed prediction band continuing 4 weeks forward, **vertical annotation line on `AFFECTED_LOT_DATE`** labeled with the lot ID. Peak **not** at the rightmost edge.
- Bubble map: Paris is the single largest bubble (≥ ~30 affected customers), followed by visible London / Milan / Madrid / Berlin clusters; US East/West mid-sized; Tokyo / Seoul / Sydney small.
- Refunds-by-country bar: France first, then IT/GB/DE/US; bars stacked by `category` with Skincare dominating the EU stack.
- Category donut: Skincare is the largest slice.
- Investigation Worst-lots bar: one bar ~10× the next.
- Affected-vs-everyday country bars: every EU country shows a yellow `Affected lot` bar taller than its steel-blue `Everyday returns` bar.
- Reasons bar: `quality` is ~all yellow; `changed_mind` / `wrong_item` / `didnt_fit` are ~all steel blue.
- Sentiment bar: `2 - Angry` + `3 - Very angry` dominate the affected-lot subset; `0 - Satisfied` dominates everyday returns.
- Comments table: visible *"grainy"*, *"separated"*, *"watery"* in `return_reason_text` rows, with `anger_score` ≥ 0.7.
- Region filter (select "EU") → every widget updates; the map zooms to the EU bounding box (Paris cluster fills the frame).
- Category filter (select "Skincare") → returns spike pronounced; product bar narrows to skincare SKUs.

Add `dashboard_id` to `resources.json`.

---

