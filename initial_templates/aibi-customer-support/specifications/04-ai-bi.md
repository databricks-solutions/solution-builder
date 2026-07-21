# AI/BI — Metric View + Dashboard + Genie

## Shared Context

All three artifacts read the same governed data built in `01-lakeflow.md`: the gold
table `{{CATALOG}}.{{SCHEMA}}.support_cases_enriched` (row-level) and the metric view
`{{CATALOG}}.{{SCHEMA}}.support_metrics` (aggregated KPIs). The story they must all
make obvious: **support got dramatically more efficient after the AI Support Copilot
GA on 2025-06-02.**

---

## A. Metric View — `support_metrics`

Governed metric view (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML`) over
`support_cases_enriched`. It is the single source of truth for every KPI so the
dashboard tiles and Genie report identical numbers under any grouping.

**Dimensions:** Opened Date, Opened Month, **AI Era** (`'After AI Copilot'` /
`'Before AI Copilot'`), Category, Channel, Priority Level, Support Tier, Region,
Destination Country / City / Latitude / Longitude, Product, Customer Segment, AI Handled.

**Measures:** Total Cases, Avg Resolution Hours, Avg Satisfaction, Total Support Cost,
Avg Cost per Case, Reopen Rate, AI Resolved Rate.

**Contract:** consumers query measures with `MEASURE(\`Avg Resolution Hours\`)` etc.
and group by dimensions (e.g. `AI Era`, `Region`). The before/after gap on
`Avg Resolution Hours` and `Avg Cost per Case` is the demo's headline.

---

## B. Dashboard (`dashboard/dashboard.lvdash.json`)

A Lakeview dashboard, **3 pages**. Datasets bind to `{{CATALOG}}.{{SCHEMA}}` (the DAB
rewrites `dataset_catalog`/`dataset_schema` per target; the shipped file targets the
default schema).

### Datasets (5)
- `ds_metrics` — the `support_metrics` metric view (KPI counters via `MEASURE(...)`).
- `ds_forecast` — weekly human-handled case volume + an `AI_FORECAST` band (the
  bend-down after GA is the visual hook).
- `ds_usage` — daily AI assistant usage (deflections / queries).
- `ds_usage_total` — AI usage rollups for the counters.
- `ds_releases` — the Copilot release log (the "why" table).

### Global filters (Filters page → apply across pages)
Date-range (opened date), Region (multi-select), Category (single), one more single-select.

### Page 1 — "Customer Support" (the glance)
- **4 KPI counters:** Total Support Cases, Avg Resolution Time (hrs), Avg Satisfaction
  (2–5), Reopen Rate.
- **Forecast line** — weekly human-handled cases + forecast band (bends down mid-2025).
- **Pie** — cases by category.
- **Bar** — volume by channel & priority.
- **Symbol map** — support volume by destination (uses `destination_lat/lon`).

### Page 2 — "AI Copilot Impact" (the proof)
- **4 KPI counters:** Cases Auto-Resolved by AI, Avg Cost per Case, Total AI Queries,
  AI-resolved rate.
- **Area** — cases auto-resolved by AI per month (zero before GA, ramps after).
- **Line** — avg resolution time by month (the drop).
- **Bar** — resolution hours by category, before vs after AI.
- **Table** — the AI Support Copilot release log (`release_notes` visible — this is
  what a viewer reads to understand *why*).

### Theme
Follows the standard demo palette — light canvas, navy→orange 5-stop categorical
palette, literal-hex pins per category so colors are stable across widgets. Keep the
frame titles above verbatim; they are the reading order of the story.

### Validation
1. Dashboard opens with no query errors against the target schema.
2. Page 1 KPIs populate; the forecast line bends down mid-2025.
3. Page 2's AI area chart is flat-zero before 2025-06-02 and ramps after; the release
   table shows the v1.0 GA row.
4. A Region filter to APAC visibly raises Avg Resolution Time.

---

## C. Genie Space (`genie/genie_space.json`)

**Tables:** `support_cases_enriched`, `support_metrics`, `ai_assistant_releases`,
`ai_assistant_usage`.

**Room persona / instructions:** Genie is told the story explicitly — the Copilot
reached GA on 2025-06-02 and auto-resolves How-To/Access/Billing; when asked *why*
resolution time / cost / reopen rate dropped, it must explain using the release notes
and show `ai_deflections` jumping at that date; use `ai_era` for before/after; prefer
the `support_metrics` metric view for clean aggregated KPIs (`MEASURE(...)` + group by
its dimensions).

**Curated (load-bearing) SQL instructions:**
1. Avg resolution time + % AI-resolved by month.
2. Cost + satisfaction before vs after the Copilot (`ai_era`).
3. When did the Copilot launch and what does it do (`ai_assistant_releases`).

**Sample questions (the story-arc walk):**
- "Why did our average support resolution time drop in 2025?" → traces to GA release.
- "How much did support cost per case fall after the AI Copilot launched?"
- "What percentage of cases does the AI assistant auto-resolve, and for which categories?"
- "Show average resolution time and customer satisfaction by month."
- "Which region has the slowest resolution time?" → APAC.

### Validation
Ask each sample question; confirm Genie (a) attributes the 2025 improvement to the
Copilot GA release using the release notes, (b) returns the before/after gap, and
(c) names APAC as the slowest region.
