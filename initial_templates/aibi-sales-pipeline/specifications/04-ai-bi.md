# AI/BI — Metric View + Dashboard + Genie

## Shared Context

All three artifacts read the same governed data built in `01-lakeflow.md`: the gold
table `{{CATALOG}}.{{SCHEMA}}.orders_enriched` (row-level) and the metric view
`{{CATALOG}}.{{SCHEMA}}.metrics_sales` (aggregated KPIs). The story they must all make
obvious: **the new Fragrance line launched in EMEA on 2026-05-04, driving an EMEA
surge that pushes the quarter forecast above target.**

---

## A. Metric View — `metrics_sales`

Governed metric view (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML`) over
`orders_enriched`. It is the single source of truth for every KPI so the dashboard
tiles and Genie report identical numbers under any grouping.

**Dimensions:** Order Date, Product Line, Category, Region, Segment, Account, Country,
Country Code, Latitude, Longitude, Sales Rep.

**Measures:** Revenue (`SUM(revenue)`), Units (`SUM(units)`), Orders (`COUNT(1)`),
Avg Order Value (`SUM(revenue)/NULLIF(COUNT(1),0)`), Avg Unit Price
(`SUM(revenue)/NULLIF(SUM(units),0)`).

**Contract:** consumers query measures with `MEASURE(\`Revenue\`)` etc. and group by
dimensions (e.g. `Region`, `Product Line`). The EMEA Fragrance surge on `Revenue`
grouped by `Region` + `Product Line` is the demo's headline.

---

## B. Dashboard (`dashboard/dashboard.lvdash.json`)

A Lakeview dashboard, **3 pages**. Datasets bind to `{{CATALOG}}.{{SCHEMA}}` (the DAB
rewrites `dataset_catalog`/`dataset_schema` per target; the shipped file targets the
default `dbdemos_templates.aibi_sales_pipeline`).

### Datasets (6)
- `ds_metrics` — the `metrics_sales` metric view (KPI counters via `MEASURE(...)`).
- `ds_target` — Q2 attainment: quarter-to-date actual + `AI_FORECAST` of the remaining
  days vs the $21.5M target → projected attainment %.
- `ds_forecast` — weekly revenue + an `AI_FORECAST` band (the surge is the visual hook).
- `ds_region_trend` — daily revenue by region (EMEA grows after the launch).
- `ds_emea_line` — EMEA weekly revenue by product line (Fragrance surges after May 4).
- `ds_launch` — the product-launch catalog (the "why" table; EMEA + Global rows).

> **`AI_FORECAST` runs on a SQL warehouse, not serverless-connect.** `ds_target` and
> `ds_forecast` call `AI_FORECAST`; validate them via the CLI against a warehouse.

### Global filters (Filters page → apply across pages)
Date-range (order date), Region (multi-select), Product Line (multi-select), Retailer
Segment (multi-select). Each filter widget carries a `frame.title`.

### Page 1 — "Are we hitting the number?" (the glance)
- **4 KPI counters:** Forecasted quarter-end revenue vs target, Total revenue (monthly
  trend), Quarter target, Projected attainment of target.
- **Forecast line** — weekly revenue + `AI_FORECAST` band (bends up late in the quarter).
- **Bar** — revenue by product line.
- **Symbol map** — revenue by market (bubble size = revenue; uses account lat/lon).
- **Pie** — revenue share by region.

### Page 2 — "Why are we beating?" (the proof)
- **Bar (stacked)** — daily revenue by region; EMEA grows after the launch.
- **Area** — EMEA weekly revenue by product line; Fragrance surges after May 4.
- **Table** — the product-launch catalog; the EMEA Fragrance launch is the trigger.

### Theme
Follows the standard demo palette — light canvas, navy→orange 5-stop categorical
palette, literal-hex pins per category so colors are stable across widgets. Keep the
frame titles above verbatim; they are the reading order of the story.

### Validation
1. Dashboard opens with no query errors against the target schema.
2. Page 1 KPIs populate; projected attainment > 100% (~155%); the forecast line bends up.
3. Page 2's EMEA area chart shows Fragrance near-zero before 2026-05-04 and surging
   after; the launch table shows the EMEA Fragrance row.
4. A Region filter to EMEA + Product Line to Fragrance isolates the spike.

---

## C. Genie Space (`genie/genie_space.json`)

**Tables (sorted by identifier):** `metrics_sales`, `orders_enriched`,
`product_launches`, `sales_targets`.

**Room persona / instructions:** Genie is told the story explicitly — the current
quarter is Q2 2026 with a target in `sales_targets`; the new Fragrance line launched in
EMEA on 2026-05-04 (`product_launches`) and EMEA Fragrance revenue surged afterwards.
When asked whether we'll hit target, compare QTD revenue (and, if asked, `ai_forecast`)
against the Q2 target; when asked *why* we're beating, drill region (EMEA) → product_line
(Fragrance) → join `product_launches` for the date. Prefer `metrics_sales` for clean
aggregated KPIs (`MEASURE(...)` + group by its dimensions).

**Curated (load-bearing) SQL instructions:**
1. Quarter-to-date revenue vs target (Q2 2026).
2. Weekly revenue by region since the spike.
3. EMEA revenue by product line + when each launched there.

**Sample questions (the story-arc walk):**
- "Are we going to hit our revenue target this quarter?" → QTD vs target, projecting a beat.
- "What is driving the recent revenue spike?" → EMEA Fragrance launch.
- "Why is EMEA revenue surging?" → the 2026-05-04 Fragrance launch.
- "Show weekly revenue by region since March 2026."
- "Which product line grew the most in EMEA, and when did it launch there?" → Fragrance, 2026-05-04.

### Validation
Ask each sample question; confirm Genie (a) compares QTD revenue to the Q2 target and
projects a beat, (b) attributes the surge to the EMEA Fragrance launch using
`product_launches`, and (c) names Fragrance as the EMEA growth driver with its
2026-05-04 launch date.
