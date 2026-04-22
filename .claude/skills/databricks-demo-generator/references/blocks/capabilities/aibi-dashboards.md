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

**Counters (KPIs)**: Single headline number with comparison delta. Prefer comparative KPIS (ex: X% monthly growth) or period based vs absolute metrics (ex: MARR vs "sum of revenue""

**Charts**: Line (trends over time), bar (category comparison — horizontal for long labels), area (cumulative), stacked bar (composition), scatter/bubble (correlation), combo bar+line (dual metrics), choropleth map (geographic). All support color-by-category for series breakdown.

**Tables**: Sortable, full-width detail view. Best for high-cardinality data (individual products, transactions, entities).

**Text**: Markdown headers and descriptions. Use as section titles — "Fraud Rate 3x Above Baseline" not just "Fraud Rate."

**Filters**: Date range picker, multi-select dropdown, single-select dropdown. Filters cross-apply to all widgets whose datasets contain the filter column.

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

## 6-Column Grid Layout

Every row must fill exactly 6 columns. Z-pattern scanning. Standard structure top to bottom:

| Tier | What | Typical Size | Notes |
|------|------|-------------|-------|
| 1. Filters | Date range + 2 dimensions | 2 wide × 2 tall each (3 = 6 cols) | Always first |
| 2. Counters | 3 KPIs with comparison | 2 wide × 3 tall each | Never shorter than h=3 |
| 3. Visualizations | Trend + breakdown | 3 wide × 5 tall each (pair = 6 cols) | Or 6 wide for focal chart |
| 4. Detail table | Entity drill-down | 6 wide × 5-8 tall | Full width, sorted by key metric DESC |

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

Avoid: pie charts (hard to compare slices), dual-axis lines (false correlations). Default to sorted horizontal bar when unsure.

## Upstream Data Requirements

Dashboard design decisions flow backward into the pipeline spec. When specifying the dashboard, ensure the Gold tables support it:

1. **Grain**: Store at daily (or finest useful) granularity — the dashboard aggregates up to week/month/total.
2. **Filter columns**: Every dimension you want to filter on must be present in every dataset that should respond to that filter. Plan filter columns before writing the pipeline spec.
3. **Categorical cardinality**: Chart color/groups work with 3-8 distinct values. If a dimension has 50+ values, aggregate to a higher level (e.g., sub-category → category) or use a table instead.
4. **Metric columns**: Keep raw numeric columns (revenue, count, rate) — the dashboard can SUM, AVG, MIN, MAX at render time.
5. **Table names only in dataset queries**: Use bare table names (e.g., `SELECT * FROM gold_daily_summary`), not fully qualified `catalog.schema.table`. The dashboard is deployed with `--dataset-catalog` and `--dataset-schema` flags which resolve the catalog/schema at deploy time.

## Spec-Writing Guide

When writing dashboard specifications, include:

1. **Data Sources table**: Widget → Table → Filter Columns → Metric Columns
2. **Layout diagram**: ASCII grid showing widget placement with sizes
3. **Filters table**: Filter name → Column → Source Tables → Default value
4. **Validation criteria**: What the user should see (spike visible, sort order, filters working)

The spec describes WHAT to show. The ai-dev-kit skill handles HOW to build the JSON. Don't put JSON or technical API details in the spec.

## Pitfalls

- **"Everything is fine" dashboards** — ensure data shows the anomaly.
- **Rows that don't fill 6** — w=4 leaves a gap; the grid breaks. Every row must sum to 6.
- **Counters without comparison** — "$1.8M" alone means nothing. Show vs. baseline or MRR or ARR.
- **Inconsistent color** — same category = same color across all charts.
- **Generic titles** — "Revenue" tells nothing. "Revenue Up 12% YoY" tells everything.
- **Missing filter columns** — if a dataset lacks the filter column, that widget won't respond to the filter.
- **Too-fine cardinality in charts** — 50 categories in a bar chart is unreadable, instead get the top ~6 then aggregate as "other" using a window function.

## Connections

- **Upstream**: Gold-layer tables from SDP + Unity Catalog. Design Gold tables with dashboard filters and grain in mind.
- **Downstream**: Raises questions → Genie (the WHAT), Knowledge Assistant (the WHY), apps, agents.

## URLs

- [Dashboards](https://docs.databricks.com/dashboards/)
- [AI/BI](https://docs.databricks.com/ai-bi/)
