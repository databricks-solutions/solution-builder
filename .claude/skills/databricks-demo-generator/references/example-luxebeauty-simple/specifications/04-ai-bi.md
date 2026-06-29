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

### Self-sufficient room

Anyone opening the Genie room must understand the story without prior context. Wire all three:

- **Space `description`** (set via `PATCH /api/2.0/genie/spaces/<id>`): 1-3 sentences naming the event (what happened + headline number + cause + blast radius) and pointing to the suggested questions in order. Pulled from the README — don't restate it, lift it.
- **Story-context `text_instruction`** at the TOP of `instructions.text_instructions[]`: WHAT HAPPENED · WHAT TO HELP THE PERSONA DO · TONE. ~5-8 lines. The LLM honors this on every turn.
- **`sample_questions`** chips AND matching `example_question_sqls` walk the story arc end-to-end in the same order — see "Sample Questions" below.

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

### Sample Questions — story-arc walk

Ship the **full 6-question arc as chips** (`config.sample_questions`) so the user can pick any beat, but curate **only 3 as `instructions.example_question_sqls`** — the load-bearing ones where the SQL Genie picks matters. The other 3 chip-only questions Genie composes from scratch each time, which is fine (single-table aggregations Genie handles well unaided). Less curated SQL means cleaner room instructions and less drift when the schema evolves.

Chips (all 6, in arc order):
1. **Headline** — "What's our return rate this month, and how does it compare to baseline?"
2. **Drill to products** — "Why do I have so many returns? Trace it to the products and the lot."
3. **Drill to lot + QC story** — "Which production lot is driving the spike, and what does the QC note say?"
4. **Customer voice** — "What are customers saying? Show recent affected-lot comments."
5. **Blast radius** — "Where are the affected customers? Group by country."
6. **Recovery** — "Are refunds recovering? Show the trend and what's next."

Curated SQLs (3 — the ones where Genie shouldn't have to guess):
- **Headline** — weekly SUM(returns_usd) + return_rate from `gold_daily_summary`, last 8 weeks.
- **Drill to lot + QC story** — CTE finds the top lot for the 3 affected SKUs, JOINs `raw_production_lots` to quote `incident_summary` — the punchline. This SQL is load-bearing because it crosses 2 tables for a join Genie would otherwise miss.
- **Recovery** — last 6 weeks of SUM(returns_usd) showing the decay.

### Validation

- "What's our return rate this month?" → answered from `gold_daily_summary`: `SUM(return_count) / SUM(order_count)` for the current month, with a baseline comparison.
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
- **Four datasets, kept lean**: one daily aggregate (`ds_daily` → KPIs + donut + orders area), one row-level fact (`ds_returns` → map, country splits, comments, sentiment), one forecast TVF (`ds_forecast`, separate because `AI_FORECAST` can't share), one pre-bucketized sankey source (`ds_sankey_flow` — top-10 products + top-15 lots, long tails bucketed in-SQL). Cross-widget click-filtering works inside each dataset — keeping `ds_returns` shared across 6 widgets is what makes the Investigation page interactive.
- **KPI sparklines carry the story at a glance**: each counter uses the `period` encoding so a tiny weekly trend renders behind the headline number. The Refunds counter shows the spike-then-decay shape even before the eye drops to the forecast.
- **A map is the visual hook**: bubble map on Operations page, full width — instantly readable, beats any table for *"where are the affected customers?"*.
- **One AI showcase per page**: Operations gets `AI_FORECAST` (showing AI-native analytics inside a dashboard); Investigation gets the `ai_classify`-derived sentiment bar (full demo uses the real LLM call at ingest; simple demo computes the same column heuristically — see `01-lakeflow.md` § Anger score).
- **Clean theme — no borders, white canvas, blue palette**: `widgetBorderColor` matches `widgetBackgroundColor` so widgets float on the canvas; left-aligned widget headers; one cohesive cool palette. The result reads as "modern analytics product", not "default template".
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

5-stop palette progresses cool → warm: deep navy → steel blue → sky cyan → soft yellow → vivid orange. Position 0 (`#094074` navy) is the visual anchor — used for the largest category (Skincare in this demo) and KPI sparklines.

**Semantic colors (literal-hex pinned everywhere, NEVER `themeColorType: position N`):**
- **Affected lot / incident annotation** → `#FFDD4A` soft yellow.
- **Everyday returns / baseline** → `#3C6997` steel blue.

**Category color pins (literal-hex on every widget colored by `category`)** — Lakeview cycles the palette by SQL-result order, which differs across widgets reading different datasets. Pinning each category guarantees the same color across donut + stacked bar:

| Category | Hex |
|---|---|
| Skincare | `#094074` (the affected category — anchor) |
| Bodycare | `#3C6997` |
| Makeup | `#5ADBFF` |
| Haircare | `#FFDD4A` |
| Fragrance | `#FE9000` |

### Datasets (4 total)

| Name | Source | Powers |
|---|---|---|
| `ds_daily` | daily grain from `gold_daily_summary`: date, region, category, order/return counts, revenue + returns $ | 4 KPI counters + category donut + weekly-orders area chart |
| `ds_returns` | row-level from `gold_returns`, plus a derived `source` ("Affected lot" / "Everyday returns" from `is_bad_lot`) and a 4-level `sentiment` bucket from `anger_score` (≥0.9 Very angry, ≥0.5 Angry, ≥0.2 Neutral, else Satisfied) | Bubble map, refunds-by-country bar, affected-vs-everyday split bars (country + reasons), sentiment bar, city table, comments table |
| `ds_forecast` | weekly refund actuals + an `AI_FORECAST` band, over a 180-day trailing window, floored at 0 (no negative refunds) | Forecast-line widget. The 180-day window is forecast **input** shape, not display windowing — so the global Date filter must not touch this dataset. |
| `ds_sankey_flow` | category → product → lot return counts from `gold_returns`, top-10 products + top-15 lots, long tails bucketed as "Other …" | Sankey widget on the Investigation page |

**No date clamps inside `ds_daily` / `ds_returns` / `ds_sankey_flow`** — the global Date Range filter is the single source of windowing; a clamp in the dataset would narrow what the filter can select. `ds_forecast` is the exception: its 180-day window is forecast input, not display filtering.

### Global filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets | Default |
|---|---|---|---|
| Date Range | `date` (ds_daily) / `return_date` (ds_returns) | ds_daily, ds_returns, ds_sankey_flow | All (no clamp) |
| Region | `region` | ds_daily, ds_returns, ds_sankey_flow | All |
| Category | `category` | ds_daily, ds_returns, ds_sankey_flow | All |
| Source | `source` ("Affected lot" / "Everyday returns" — derived column on ds_returns) | ds_returns | All |

`ds_forecast` must stay **unfiltered** by all four filters — `AI_FORECAST` needs its stable trailing window. (Binding the Date filter to it would silently truncate that window whenever the user picks a range — bind the filters only to the datasets listed above.)

### Page 1 — Operations (the glance)

Layout is a 12-column grid; widgets list their `(x, y, width, height)` so the dashboard JSON's `position` blocks are unambiguous.

| Row (y) | x | w | h | Widget |
|---|---|---|---|---|
| 0  | 0 | 12 | 3 | `title` (markdown) |
| 3  | 0 |  3 | 3 | `kpi_refunds` |
| 3  | 3 |  3 | 3 | `kpi_returns` |
| 3  | 6 |  3 | 3 | `kpi_orders` |
| 3  | 9 |  3 | 3 | `kpi_revenue` (name stays `kpi_refund_rate` in JSON for layout-position compat) |
| 6  | 0 | 12 | 5 | `trend_chart` (forecast-line) |
| 11 | 0 |  7 | 6 | `orders_by_region_area` |
| 11 | 7 |  5 | 7 | `country_chart_refunds` |
| 17 | 0 |  7 | 6 | `customer_map` (bubble map) |
| 18 | 7 |  5 | 5 | `category_donut` |

**`title` — markdown widget**. Self-sufficient page header so a cold reader knows what they're looking at. ~5 lines covering: what happened (refunds spiked 3× three weeks ago) · cause (the affected lot ID + Lyon factory + QC note) · blast radius (250 EU-skewed customers) · what to see on this page (KPI sparklines carry the spike-then-decay shape, forecast marks the incident date with a vertical bar, donut shows Skincare dominates, map lights Europe). Lift the substance from the README — don't repeat it verbatim.

**4 × `counter`** — `kpi_refunds`, `kpi_returns`, `kpi_orders`, `kpi_refund_rate` (this last name kept for layout-position stability; the tile renders Revenue). Source: `ds_daily`. **No `period` encoding** — the counter displays the dataset-level sum over whatever the global Date filter has selected. (We tried `period`-based sparklines earlier; the counter then shows only the last-period value, which doesn't match "totals over the filtered window" — the natural mental model with global filters.) Pin `value.color` to the primary literal-hex (`#094074`) for the spike-anchor tiles.

- **Refunds** · `SUM(returns_usd)` · `number-currency` USD compact, `decimalPlaces: max 1` · color `#094074` · *the spike's headline number.*
- **Returns** · `SUM(return_count)` · number compact · color `#094074`.
- **Orders** · `SUM(order_count)` · number compact · color `#094074`.
- **Revenue** · `SUM(revenue_usd)` · `number-currency` USD compact, `decimalPlaces: max 2` · color `#094074` · *paired with Refunds — the "this is a refund-rate problem, not a demand problem" story without needing a separate Refund Rate tile.*

Refund rate as a number isn't shown on the dashboard, but the gen produces refunds + revenue + counts, so Genie can answer "what's our refund rate?" naturally over the same `gold_daily_summary` rows.

**`trend_chart` — `forecast-line` "Weekly refunds — actuals + forecast"** (12-wide). Source: `ds_forecast`. x = `week` (temporal); y `refunds` = actuals (solid); y `refunds_forecast` / `refunds_upper` / `refunds_lower` = forecast band (dashed); y format `number-currency` USD compact. Bridging row repeating last actual as `refunds_forecast` so the band doesn't disconnect at the seam.

- **Vertical-line annotation** on `AFFECTED_LOT_DATE`, label format `"Product issue: lot LOT-<YYYY-MMDD> ships"` (short, executive-readable). No explicit `color` so the marker inherits the theme neutral — label carries the meaning, coloring it warm steals attention from the spike. Same date as the affected lot's `incident_summary` — they MUST match.
- **Frame description** (renders below the title): *"Refunds spiked 3 weeks ago, decaying back toward baseline. Vertical bar = the day the bad lot shipped."* Self-explains the chart so a viewer doesn't need to read the spec.
- *Baseline ticks flat for ~5w → annotation bar drops in (the lot ships) → ~5w later the line spikes to ~$180K → decays toward baseline → continues as dashed band 4w ahead. Cause → effect → what's next, in one chart.*

**`orders_by_region_area` (7-wide) + `country_chart_refunds` (5-wide) — side by side**

- **`area` · "Weekly orders by region"** (left, 7-wide) · `ds_daily` · x = `weekly(date)`, y = `SUM(order_count)`, color = `region`. **Only US is pinned** (`#FE9000`); EU + APAC fall through to default palette positions. The US line is the visual anchor (70% of sales), so a literal pin keeps it warm-orange across re-renders even if Lakeview re-cycles the palette. Frame description: *"Orders stay flat — the business is fine, only refunds spiked."* *Counter-argument widget — proves the revenue line isn't disturbed. Without this an executive wonders "is this a demand problem too?". This kills that question.*
- **`bar` horizontal stacked · "Refunds by country"** (right, 5-wide) · `ds_returns` · y = `country`, x = `SUM(refund_amount_usd)`, **color = `category` with the same 5-stop literal-hex pins as the donut** (Skincare→`#094074`, Bodycare→`#3C6997`, Makeup→`#5ADBFF`, Haircare→`#FFDD4A`, Fragrance→`#FE9000`). *France leads, then IT / GB / DE / US — and the deep-navy Skincare slice dominates every affected-country stack. Pinning matches the donut beside it so the same category reads the same color across both widgets (Lakeview cycles the palette by SQL-result order; pinning is the only way to guarantee agreement).*

**`customer_map` (7-wide) + `category_donut` (5-wide) — side by side**

- **`symbol-map` · "Affected customers — bubble map"** (left, 7-wide). Source: `ds_returns` (no widget-level filter — let the global Date/Region/Category filters scope the cohort). Encoding `coordinates: { latitude: customer_lat, longitude: customer_lng }` (bare field names, NOT `AVG(...)` — Lakeview's `symbol-map` documented pattern wants raw lat/lng; aggregated coords render blank). Group implicit by `(city, country)`, size = `COUNT(DISTINCT customer_id)`, color = `SUM(refund_amount_usd)`, tooltip city + count + refunds. `mark.opacity: 1` (solid — denser bubbles read better than transparent at this scale). `colorRamp.scheme: "YlOrRd"` (the only quantitative scheme `symbol-map` reliably honors; `custom-sequential` and `Blues` render blank). *Europe lights up: Paris dominates (~30+ affected) deep red, then London / Milan / Madrid / Berlin cluster.*
- **`pie` (donut) · "Refunds by category"** (right, 5-wide) · `ds_daily` · slices = `category`, angle = `SUM(returns_usd)`, color via literal-hex category pins (above) · *one slice dwarfs the rest — Skincare in deep navy. Pairs with the map: affected lot is Skincare, Europe is Skincare-heavy.*

### Page 2 — Investigation (the deep-dive)

Same 12-column grid as Page 1. The `sec_*` widgets are thin (`h=1`) markdown section dividers, NOT chart widgets — they just label the next row.

| Row (y) | x | w | h | Widget |
|---|---|---|---|---|
|  0 | 0 | 12 | 4 | `returns_title` (markdown) |
|  4 | 0 | 12 | 8 | `category_product_lot_sankey` |
| 12 | 0 | 12 | 1 | `sec_compare` (markdown: `## Affected lot vs everyday returns`) |
| 13 | 0 |  6 | 6 | `country_split_chart` |
| 13 | 6 |  6 | 6 | `reasons_split_chart` |
| 19 | 0 | 12 | 1 | `sec_sentiment` (markdown: `## Customer sentiment & geography`) |
| 20 | 0 |  6 | 5 | `anger_chart` |
| 20 | 6 |  6 | 5 | `city_table` |
| 25 | 0 | 12 | 6 | `angry_comments_table` |

**`returns_title` — markdown widget (12-wide)**. Same pattern as Page 1's title: self-sufficient, ~5 lines. Frames the deep-dive: same data split by the dimensions that matter · the chain that emerges (3 Skincare SKUs → one lot → EU dominance → quality reason → angry sentiment → texture complaints) · interaction hint: "click any 'Affected lot' bar to filter every other widget on the page".

**`category_product_lot_sankey` — `sankey` "Returns flow — Category → Product → Production lot"** (12-wide). Source: `ds_sankey_flow`. `value = returns`, `stages = [category, product_name, lot_id]`. Frame description: *"Three Skincare SKUs all converge on one lot."*

- *Replaces the older "Returns by product" + "Worst lots" horizontal bars. The sankey shows the chain visually in one widget — Skincare → SKU-1001/1002/1003 → LOT-{YYYY-MMDD} flow lines dominate the diagram. Long tails bucketed as "Other products" / "Other lots" so the dominant flow stays readable.*

**`sec_compare` — section heading (12-wide, h=1)**: markdown `## Affected lot vs everyday returns`.

**`country_split_chart` (6-wide) + `reasons_split_chart` (6-wide) — side by side**. Both color by `source` with literal-hex pins (`Affected lot` → `#FFDD4A` soft yellow, `Everyday returns` → `#3C6997` steel blue) — same pins on BOTH widgets so the affected vs everyday read is consistent across the row.

- **`bar` grouped · "Refunds by country: affected lot vs everyday"** (left) · `ds_returns` · x = `country`, y = `SUM(refund_amount_usd)`, color = `source` · *every EU country: yellow bar towers over steel blue — spike is the one lot in the EU market, not a catalog-wide trend.*
- **`bar` horizontal grouped · "Return reasons: affected lot vs everyday"** (right) · `ds_returns` · y = `return_reason` (`quality` / `didnt_fit` / `wrong_item` / `changed_mind`), x = `COUNT(return_id)`, color = `source` · *`quality` is ~all yellow; the other reasons ~all steel blue — a product problem on this lot, not fit / changed-mind.*

**`sec_sentiment` — section heading (12-wide, h=1)**: markdown `## Customer sentiment & geography`.

**`anger_chart` (6-wide) + `city_table` (6-wide) — side by side**

- **`bar` · "Sentiment of return comments (ai_classify)"** (left) · `ds_returns` · x = `sentiment` (the bucketed label from the dataset SELECT — `3 - Very angry` / `2 - Angry` / `1 - Neutral` / `0 - Satisfied`, sorted natural so the bars line up worst-to-best), y = `COUNT(return_id)`. *Title says `(ai_classify)` because the FULL demo computes sentiment via `ai_classify` over the comment text. In the simple demo `anger_score` is heuristic (see `01-lakeflow.md` § Anger score) — same shape, no LLM. Talking track: "in production this column comes from an LLM at ingest; for the demo we're computing it deterministically."* *Very-angry + Angry bars dwarf the rest because the affected-lot returns carry texture vocabulary.*
- **`table` · "Returns by city"** (right) · `ds_returns` · columns `city`, `country`, `COUNT(DISTINCT return_id)` AS `Returns`, `SUM(refund_amount_usd)` AS `Refund $`, sort `Returns` DESC · *Paris on top, then London / Milan / Madrid / Berlin — same cluster as the map, ranked with refund $.*

**`angry_comments_table` — `table` "Customer comments"** (12-wide, bottom). Source: `ds_returns`. Columns: `return_date` (Date), `product_name` (Product), `country`, `city`, `anger_score` (Anger), `refund_amount_usd` (Refund $), `customer_comment` (Comment, wrap). Frame description: *"Sort by Anger to surface the bad-lot complaints."*

- *Texture complaints — "grainy", "separated", "watery" — cluster at the top when sorted by anger. The raw voice closes the arc with verbatim evidence. Full-width because the Comment column needs the horizontal room to read.*

### Validation

- Operations page renders without horizontal scroll on a 1440px screen; widgets float on a white canvas with no visible borders.
- All 4 KPI tiles display a sensible dataset-level total: Refunds in compact USD (the spike's headline), Returns + Orders as compact integers, Revenue in compact USD (with 2 decimals).
- Changing the global Date Range filter updates all 4 KPI values live (without changing the dataset SQL).
- Forecast-line: actuals through ~last full week, dashed prediction band continuing 4 weeks forward, **vertical annotation line on `AFFECTED_LOT_DATE`** labeled with the lot ID. Peak **not** at the rightmost edge.
- Bubble map: Paris is the single largest bubble (≥ ~30 affected customers), followed by visible London / Milan / Madrid / Berlin clusters; US East/West mid-sized; Tokyo / Seoul / Sydney small. Tooltip shows city + count + refund total.
- Category donut: Skincare is the largest slice (deep navy).
- Refunds-by-country bar: France first, then IT / GB / DE / US.
- Weekly-orders area chart: lines stay flat across the whole window — visibly UNLIKE the refunds spike.
- Investigation sankey: the Skincare → {SKU-1001, SKU-1002, SKU-1003} → LOT-{YYYY-MMDD} flow lines visibly dominate. "Other products" / "Other lots" buckets exist but stay thin.
- Affected-vs-everyday country bars: every EU country shows a yellow `Affected lot` bar taller than its steel-blue `Everyday returns` bar.
- Reasons bar: `quality` is ~all yellow; `changed_mind` / `wrong_item` / `didnt_fit` are ~all steel blue.
- Sentiment bar: `3 - Very angry` + `2 - Angry` together carry ~all of the affected-lot returns; `0 - Satisfied` + `1 - Neutral` carry the baseline.
- Comments table sorted by Anger DESC: top rows contain "grainy" / "separated" / "watery" texture complaints.
- Region filter (select "EU") → every widget updates; the map zooms to the EU bounding box (Paris cluster fills the frame).
- Category filter (select "Skincare") → returns spike pronounced; sankey collapses to a single category.

Add `dashboard_id` to `resources.json`.
