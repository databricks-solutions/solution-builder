# AI/BI — Metric View + Dashboard + Genie

## Shared Context

All three artifacts read the same governed data built in `01-lakeflow.md`: the gold
tables `{{CATALOG}}.{{SCHEMA}}.demand_enriched` (weekly demand) and
`{{CATALOG}}.{{SCHEMA}}.component_status` (per component×plant supply risk), plus the
metric view `{{CATALOG}}.{{SCHEMA}}.metrics_demand` (aggregated demand). The story
they must all make obvious: **the shared Battery Cell is about to stock out because
the City E-Bike EMEA market launch (2026-04-20) surged demand, and the supplier's
8-week lead time means the planner must act now.**

---

## A. Metric View — `metrics_demand`

Governed metric view (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML`) over
`demand_enriched`. Single source of truth for demand so the dashboard tiles and Genie
report identical numbers under any grouping.

**Dimensions:** Week, Product, Category, Distribution Center, Region, Country,
Country Code, Latitude, Longitude.

**Measures:** Demand Units (`SUM(demand_units)`).

**Contract:** consumers query the measure with `MEASURE(\`Demand Units\`)` and group
by dimensions (e.g. `Region`, `Product`, `Week`). The EMEA-vs-AMER split on
`Demand Units` after 2026-04-20 is the demand-side headline.

---

## B. Dashboard (`dashboard/dashboard.lvdash.json`)

A Lakeview dashboard, **3 pages** (2 content + Filters). Datasets bind to
`{{CATALOG}}.{{SCHEMA}}` (the DAB rewrites `dataset_catalog`/`dataset_schema` per
target; the shipped file targets the default schema).

### Datasets (8)
- `ds_metrics` — the `metrics_demand` metric view (asset-backed).
- `ds_component_status` — per component×plant risk table (weeks of cover, status).
- `ds_kpi` — Battery Cell risk KPIs by plant (cover, lead time, projected stockout).
- `ds_onhand` — Battery Cell on-hand depletion projection (actual → forecast to zero).
- `ds_demand_forecast` — total weekly demand + an **`AI_FORECAST`** band.
- `ds_product_trend` — weekly demand by product.
- `ds_region_demand` — weekly demand by region (the EMEA surge).
- `ds_bom_risk` — products using the Battery Cell + qty per unit.

### Parameters
`ds_kpi` / `ds_onhand` take single-value STRING params `:plant` (default
"Rotterdam Plant") and `:component` (default "Battery Cell"), driven by the Plant /
component filter widgets.

### Global filters (Filters page → apply across pages)
Week (date-range), Product (multi-select), Region (multi-select), Plant
(single-select). Every filter widget has a `frame.title`.

### Page 1 — "Component supply risk" (the glance)
- **4 KPI counters:** Battery Cell weeks of cover, projected stockout week, supplier
  lead time (weeks), total weekly demand trend.
- **Hero line** — Battery Cell on-hand at Rotterdam, projected to run out.
- **Bar** — weeks of cover by component & plant (Battery Cell is short at both).
- **Table** — component supply status (inventory, supplier & lead time).
- **Stacked bar** — weekly demand by product (City E-Bike jumps after the launch).
- **Symbol map** — demand by distribution center (uses `latitude`/`longitude`).
- **Heatmap** — weeks of cover heatmap (red = at risk).

### Page 2 — "Why — demand driver" (the proof)
- **Forecast line** — total weekly demand + `AI_FORECAST` band.
- **Table** — products using the Battery Cell (BOM) — all affected.
- **Area** — weekly demand by region (EMEA surges after the market opens).
- **Pie** — demand share by region.

### Theme
Follows the standard demo palette — light canvas, navy→orange categorical palette,
literal-hex pins per category so colors are stable across widgets. Keep the frame
titles verbatim; they are the reading order of the story.

### Validation
1. Dashboard opens with no query errors against the target schema.
2. Page 1 KPIs populate; the Battery Cell on-hand line depletes toward zero.
3. `AI_FORECAST` returns a forecast band (runs on a SQL warehouse, not connect serverless).
4. Page 2's region area chart shows EMEA surging after 2026-04-20.

---

## C. Genie Space (`genie/genie_space.json`)

**Tables (sorted by identifier):** `bom`, `component_status`, `demand_enriched`,
`inventory`, `market_launches`, `metrics_demand`, `suppliers`.

**Room persona / instructions:** Genie is told the story explicitly — the City E-Bike
EMEA launch on 2026-04-20 surged EMEA demand; because every product uses the shared
Battery Cell, that surge (rolled through the BOM) drains it faster than the 8-week
supplier lead time can replenish it, worst at Rotterdam. Use `component_status` for
weeks of cover / which component is at risk; use `AI_FORECAST` for stockout/forecast;
point to `market_launches` for *why* demand surged and the supplier lead time for
*why we can't just reorder*; prefer the `metrics_demand` metric view for clean
aggregated demand (`MEASURE(...)` + group by its dimensions).

**Curated (load-bearing) SQL instructions:**
1. Which components are at risk (weeks of cover vs supplier lead time).
2. Weekly demand by region (the EMEA surge after the launch).
3. What launched recently + which products use the Battery Cell.

**Sample questions (the story-arc walk):**
- "Which component is about to run out?" → Battery Cell.
- "When does the Battery Cell stock out, and why can't we reorder in time?" → ~late
  July, blocked by the 8-week lead time.
- "Why is Battery Cell demand surging?" → the City E-Bike EMEA market launch.
- "Show weekly demand by region since March 2026." → EMEA surge.
- "Which products use the Battery Cell, and how many per unit?"

### Validation
Ask each sample question; confirm Genie (a) names the Battery Cell as the at-risk
component, (b) attributes the surge to the EMEA market launch, and (c) explains the
8-week lead time as why a reorder can't close the gap.
