---
name: AI/BI Dashboards
category: ai-bi
disabled: false
buildable: true
skill: databricks-aibi-dashboards
---

# AI/BI Dashboards

Interactive SQL-backed visualizations — counters, charts, tables, cross-filters. Primary "first impression" artifact in most demos.

## MANDATORY Build Gate — Do Not Skip

**Never create a dashboard before every table it references exists and has rows.** Dashboards against missing/empty tables produce silent errors on every widget — the demo looks built but is broken. Before creating: pipeline succeeded, every referenced table returns `COUNT(*) > 0`, every referenced column exists.

## Narrative Arc

Three-beat: **what changed** (counters + trend) → **why it matters** (breakdown + detail) → **what to do next** (handoff to Genie/agent).
- **Setup**: Counters and trend lines show something is different — a spike, drop, anomaly. The "wow" moment.
- **Tension**: Breakdown charts and detail table show which categories/regions/entities drive the change.
- **Handoff**: Dashboard raises the "why?" it can't answer alone → Genie, app, or agent.

## What Dashboards Can Do

Dashboards are SQL-backed: each widget draws from a dataset (a SQL query on Gold tables). The dashboard engine handles aggregation and filtering automatically — you don't write aggregation logic, you design the data shape.

### Widget Types

Every chart needs **two axes** — a dimension (what you group by) and a measure (the aggregated number). Specifying only one axis is invalid; the widget won't render. Vertical vs horizontal bar is just which axis carries the quantitative measure.

| Widget | Encodings | Use when |
|--------|-----------|----------|
| **Counter (KPI)** | one quantitative measure; comparison delta (optional) | single headline number; prefer comparative ("MoM growth %") over absolute ("sum of revenue") |
| **Line** | x = temporal; y = quantitative; color = categorical (optional, multi-series) | trend over time |
| **Bar (vertical)** | x = categorical/temporal; y = quantitative; color = categorical (optional, stacked or grouped) | category comparison; weekly trend with category split |
| **Bar (horizontal)** | y = categorical; x = quantitative; color = categorical (optional) | long category labels; ranked breakdown |
| **Area / Stacked bar** | x = temporal; y = quantitative; color = categorical (optional, composition) | composition over time, max 4-5 segments |
| **Scatter / Bubble** | x = quantitative; y = quantitative; color = categorical (optional); size = quantitative (optional, bubble) | correlation between two measures |
| **Combo (bar+line)** | x = dimension; y with two fields, one bar + one line | dual metrics on shared x-axis |
| **Choropleth map** | geo dimension; measure; color scale with `scheme`/`mappings` (optional) | geographic distribution |
| **Pie** | angle = quantitative; color = categorical | composition snapshot, ≤ 6 slices; usually a horizontal bar is clearer |
| **Table** | columns; sort (optional) | high-cardinality detail view |
| **Text** | markdown lines | section headers/answers ("Fraud Rate 3x Above Baseline") |
| **Filter** | one column on each dataset to filter; default value (optional) | cross-applies to every widget whose dataset has the filter column |

### Built-in Aggregation

The dashboard engine can aggregate at render time — you don't need pre-aggregated tables for every view. If the Gold table has daily rows, the dashboard can show weekly/monthly trends by truncating the date. If it has per-product rows, counters can SUM across all products.

This means: **Gold tables should store data at the finest useful grain** (typically daily, per-entity). The dashboard aggregates up from there. Examples:
- Daily revenue per category → dashboard can show weekly trend, monthly rollup, or total KPI
- Per-product return rates → dashboard can show top-N products, category breakdown, or overall rate
- Per-region daily metrics → dashboard can filter by region or aggregate across all regions

### Filters and Cross-Filtering

Filters are widgets that control what data other widgets display. A "Region" filter affects every widget whose dataset includes a `region` column. This drives a critical upstream requirement:

**Every column you want to filter on must exist in every dataset that should respond to that filter.** If 3 widgets should all react to a Region filter, all 3 datasets need a `region` column in their query.

Common filter patterns:
- **Date range** — nearly every dashboard needs one. Default must show the anomalous period.
- **2-3 categorical dimensions** — region, category, segment, etc. Keep to 4-15 distinct values.
- **Global filter page** — a dedicated filter bar that affects all pages.

### Genie Integration

Dashboards can embed a "Ask Genie" button that links to a Genie Space — the natural handoff from structured visualization to natural-language investigation. Configured at the dashboard level, not as a widget.

## Layout

Talk in **columns out of 12** . Z-pattern scanning, standard structure top to bottom on the canvas page:

| Tier | What | Columns × rows | Notes |
|------|------|----------------|-------|
| 1. Counters | 3 KPIs with comparison | 4 cols × 3 each | Top of page, never shorter than 3 rows tall |
| 2. Visualizations | Trend + breakdown | 6 cols × 5 each (two side-by-side) — or 12 cols for a focal chart | |
| 3. Detail table | Entity drill-down | 12 cols × 5-8 | Full width, sorted by key metric DESC |

**Filters live on a separate page** with `pageType: PAGE_TYPE_GLOBAL_FILTERS` (the dashboard renders it as a left-side filter panel, not a row on the canvas). Typical: 1 date-range picker + 2 single/multi-select filters. They cross-apply to every widget whose dataset contains the filter column.

6-8 widgets per page max. If a widget can't map to a core question, cut it.

## Making Anomalies Visible

The anomaly is the whole point. Every design choice must make it impossible to miss.
- **5-second test**: If the stakeholder can't identify the problem in 5 seconds, redesign.
- **Counters**: Delta catches the eye — show "vs. baseline" or "vs. prior period."
- **Default filters**: Must show the anomalous period. If the date range hides the spike, the demo fails.
- **Trend line**: Spike in the rightmost 20% of the time axis with 6-12 months baseline for contrast - avoid stories anomalies just on the last few days, it's not visible enough.
- **Breakdown bar**: Sort descending, dominant category at top. Horizontal bars for long labels.

## Visual Design

- **Color = signal, not decoration.** Restrained palette — neutrals for chrome, one highlight hue, one for risk. Consistent color per dimension across all charts. Max 8 hues.
- **Title widgets as answers.** "Fraud Rate 3x Above Baseline" not "Fraud Rate."
- **Scope every metric.** Units in labels ($, %), active date range, freshness.

## Chart Design Rules

- **Color by dimension when possible**: charts can group by a second dimension (e.g., returns by week colored by category) to reveal what drives the metric — 3-6 color groups max (ideal in barchart).
- **Weekly aggregation**: For time series spanning >2 months, aggregate daily data to weekly by default to reduce noise and make trends readable.

## Chart Selection Guide

| Question | Best Chart | Notes |
|----------|-----------|-------|
| Change over time? | Line | Add baseline/target band |
| Which category dominates? | Horizontal bar | Sort DESC; best for long labels |
| Exact values? | Table | Detail tier at bottom |
| Composition over time? | Stacked bar | Max 4-5 segments |
| Single headline number? | Counter | Always pair with comparison delta |
| Geographic distribution? | Choropleth map | Needs region column |

Prefer sorted horizontal bar over pie when in doubt — slices are hard to compare. Avoid dual-axis lines (false correlations).

## Upstream Data Requirements

Dashboard design decisions flow backward into the pipeline spec. When specifying the dashboard, ensure the Gold tables support it:

1. **Grain**: Store at daily (or finest useful) granularity — the dashboard aggregates up to week/month/total.
2. **Filter columns**: Every dimension you want to filter on must be present in every dataset that should respond to that filter. Plan filter columns before writing the pipeline spec.
3. **Categorical cardinality**: Chart color/groups work with 3-8 distinct values. If a dimension has 50+ values, aggregate to a higher level (e.g., sub-category → category) or use a table instead.
4. **Metric columns**: Keep raw numeric columns (revenue, count, rate) — the dashboard can SUM, AVG, MIN, MAX at render time.
5. **Table names only in dataset queries**: Use bare table names (e.g., `SELECT * FROM gold_daily_summary`), not fully qualified `catalog.schema.table`. The dashboard is deployed with `--dataset-catalog` and `--dataset-schema` flags which resolve the catalog/schema at deploy time.

## Spec-Writing Guide

When writing dashboard specifications, include:

1. **Filters table**: Filter name → Column → Datasets it filters → Default value
2. **Layout, top-to-bottom on the canvas page** — describe each row in one line as `Row N — <widget(s)>: <span> — <intent>`, e.g. `Row 1 — 3 KPIs side by side (4 cols each): Revenue, Orders, Return Rate ⚠️`. Use **column counts out of 12** ("4 cols", "6 cols each", "full width"). No ASCII grid; the skill assigns the actual `x`/`y`/`width`/`height`.
3. **Per widget**: name (used as title-as-answer), source table, encodings (`x = …; y = …; color = …` for charts; `columns` for tables), and what the user should see (numbers, sort order, anomaly visibility).
4. **Validation criteria**: KPI values, chart shape (spike position, decay), filter behavior (select X → all widgets update).

The spec describes WHAT to show. The ai-dev-kit skill handles HOW to build the JSON. Don't put JSON or technical API details in the spec.

## Pitfalls

- **Don't put catalog/schema in the queries and always set the --dataset-catalog and --dataset-schema flag creating a lakeview dashboard** 
- **"Everything is fine" dashboards** — ensure data shows the anomaly.
- **Rows that don't fill 12** — gaps break the grid. Every row's widget widths must sum to 12.
- **Counters without comparison** — "$1.8M" alone means nothing. Show vs. baseline or MRR or ARR.
- **Inconsistent color** — same category = same color across all charts.
- **Generic titles** — "Revenue" tells nothing. "Revenue Up 12% YoY" tells everything.
- **Missing filter columns** — if a dataset lacks the filter column, that widget won't respond to the filter.
- **Too-fine cardinality in charts** — 50 categories in a bar chart is unreadable, instead get the top ~6 then aggregate as "other" using a window function.
- **`queryLines` joined without whitespace** — array elements are concatenated verbatim. Each element except the last must end with a space or `\n`, e.g. `["SELECT * ", "FROM items ", "WHERE x = 1"]` (or use a single-element array).

## Connections

- **Upstream**: Gold-layer tables from SDP + Unity Catalog. Design Gold tables with dashboard filters and grain in mind.
- **Downstream**: Raises questions → Genie (the WHAT), Knowledge Assistant (the WHY), apps, agents.

## URLs

- [Dashboards](https://docs.databricks.com/dashboards/)
- [AI/BI](https://docs.databricks.com/ai-bi/)
