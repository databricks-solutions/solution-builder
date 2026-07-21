# AI/BI — Metric View + Dashboard + Genie

## Shared Context

All three artifacts read the same governed data built in `01-lakeflow.md`: the gold
table `{{CATALOG}}.{{SCHEMA}}.campaign_performance_enriched` (row-level) and the metric
view `{{CATALOG}}.{{SCHEMA}}.metrics_campaign` (aggregated KPIs). The story they must
all make obvious: **marketing revenue and conversions collapsed after 2025-09-01 even
though spend stayed flat, and the root cause is one underperforming creative.**

---

## A. Metric View — `metrics_campaign`

Governed metric view (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML`) over
`campaign_performance_enriched`. It is the single source of truth for every KPI so the
dashboard tiles and Genie report identical numbers under any grouping.

**Dimensions:** Date, Channel, Channel Type, Platform, Campaign, Objective, Audience,
Age Band, Interest, Country, Country Code, Latitude, Longitude, Creative, Message Theme,
Creative Format, **Creative Status**, Target Market.

**Measures:** Revenue, Total Spend, Conversions, Impressions, Clicks, **Revenue per
Dollar** (= revenue / spend, a.k.a. ROAS), Conversion Rate, CTR, Cost per Conversion.

**Contract:** consumers query measures with `MEASURE(\`Revenue per Dollar\`)` etc. and
group by dimensions (e.g. `Campaign`, `Country`, `Creative`, `Platform`). The drop on
`Revenue` / `Conversions` / `Revenue per Dollar` scoped to the failing campaign and the
Germany/France markets is the demo's headline.

---

## B. Dashboard (`dashboard/dashboard.lvdash.json`)

A Lakeview dashboard, **3 pages** (2 content pages + a Filters page). Datasets bind to
`{{CATALOG}}.{{SCHEMA}}` (the DAB rewrites `dataset_catalog`/`dataset_schema` per
target; the shipped file targets the default schema).

### Datasets (6)
- `ds_metrics` — the `metrics_campaign` metric view (KPI counters via `MEASURE(...)`).
- `ds_forecast` — monthly revenue-per-dollar + an `AI_FORECAST` band (the bend-down
  after the event is the visual hook).
- `ds_map` — performance by market over the last 6 months (uses `latitude`/`longitude`).
- `ds_damage` — the wasted spend + lost revenue attributable to the underperforming
  creative (benchmarked against healthy TikTok creatives).
- `ds_campaign` — revenue-per-dollar by campaign since Sept 2025 (Q4 Growth Push flagged
  `Failing`).
- `ds_q4_creatives` — revenue-per-dollar of the creatives inside Q4 Growth Push (the bad
  one flagged `Underperforming`).

### Global filters (Filters page → apply across pages)
Date-range (date), Channel (multi-select), Platform (multi-select), Country (multi-select).
Each filter widget carries a `frame.title`.

### Page 1 — "Marketing Performance" (the glance)
- **KPI counters** — Revenue, Total Spend, Conversions, Revenue per Dollar.
- **Forecast line** — monthly revenue-per-dollar + forecast band (bends down late 2025).
- **Symbol map** — performance by market (Germany & France go red, low revenue/dollar).
- Channel / campaign breakdowns.

### Page 2 — "Root Cause" (the proof)
- **Damage tile** — spend wasted + lost revenue from the underperforming creative.
- **Bar** — revenue-per-dollar by campaign since Sept (Q4 Growth Push at the bottom,
  flagged Failing).
- **Bar** — revenue-per-dollar of creatives within Q4 Growth Push (Fall Sale - v2 (DE/FR)
  flagged Underperforming).

### Theme
Follows the standard demo palette — light canvas, navy→orange 5-stop categorical
palette, literal-hex pins per category so colors are stable across widgets. Keep the
frame titles verbatim; they are the reading order of the story.

### Validation
1. Dashboard opens with no query errors against the target schema.
2. Page 1 KPIs populate; the forecast line bends down late 2025.
3. Page 2's campaign bar puts Q4 Growth Push last; the creative bar puts
   Fall Sale - v2 (DE/FR) last; the damage tile shows real wasted spend / lost revenue.
4. A Country filter to Germany or France visibly drops Revenue per Dollar.

---

## C. Genie Space (`genie/genie_space.json`)

**Tables:** `campaign_performance_enriched`, `campaigns`, `creatives`, `metrics_campaign`
(sorted by identifier).

**Room persona / instructions:** Genie is told the story explicitly — through mid-2025
every channel is healthy; from 2025-09-01 revenue and conversions collapse while spend
stays flat. When asked *why*, it traces it in three steps: (1) the failing campaign
Q4 Growth Push (lowest revenue-per-dollar since Sept); (2) inside it, the
`Fall Sale - v2 (DE/FR)` creative (`creative_status = 'underperforming'`, conv ~0.35%
vs ~3%); (3) the affected markets Germany & France. Prefer the `metrics_campaign` metric
view for clean aggregated KPIs (`MEASURE(...)` + group by its dimensions).

**Curated (load-bearing) SQL instructions:**
1. Monthly revenue, spend and conversions trend.
2. Revenue-per-dollar by campaign since the drop (Sept 2025).
3. Creatives inside the failing Q4 Growth Push campaign.

**Sample questions (the story-arc walk):**
- "Why did our marketing revenue and conversions drop in late 2025?" → traces to the
  campaign → creative → markets chain.
- "Which campaign is underperforming since September 2025?" → Q4 Growth Push.
- "Inside the Q4 Growth Push campaign, which creative is dragging performance down?" →
  Fall Sale - v2 (DE/FR).
- "Which markets have the lowest revenue per dollar?" → Germany & France.
- "Show monthly revenue, spend and conversions over the last year."

### Validation
Ask each sample question; confirm Genie (a) attributes the late-2025 drop to the
Q4 Growth Push campaign and the underperforming creative using `creative_status`,
(b) names Germany & France as the affected markets, and (c) shows spend staying flat
while revenue/conversions fall.
