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

### Self-sufficient pages (do this, not optional)

A user opening the dashboard cold should grasp the story in 5 seconds. Two devices:

- **Page-header text widget** (Row 1 of every page, 12-wide markdown). Names the event (what happened + headline number + cause + blast radius) and tells the reader what to look for on this page (which widget answers which question, what shape they should expect to see). ~5 lines. Lift from the README — don't restate the full narrative, just the dashboard-relevant tour.
- **Frame descriptions** on the load-bearing widgets (1-2 short lines, `frame.description` + `frame.showDescription: true` — the flag is OFF by default so descriptions don't render unless you flip it). Pin them on the chart that needs a caption to read correctly — the forecast (e.g., *"Refunds spiked 3 weeks ago, decaying back toward baseline. Vertical bar = the day the bad lot shipped."*), the counter-argument chart (*"Orders stay flat — the business is fine, only refunds spiked."*), the sankey (*"Three Skincare SKUs all converge on one lot."*), the comments table (*"Sort by Anger to surface the bad-lot complaints."*). Don't paste descriptions on every chart — the visual ones don't need words.
- **Section headings inside a page**: thin `text` widgets (`height: 1`, 12-wide) with `## Heading` markdown. Use to separate logical groups when a page has more than one beat (e.g., `## Affected lot vs everyday returns` then `## Customer sentiment & geography`).

## What Dashboards Can Do

Dashboards are SQL-backed: each widget draws from a dataset (a SQL query on Gold tables). The dashboard engine handles aggregation and filtering automatically — you don't write aggregation logic, you design the data shape.

### Widget Types

Every chart needs **two axes** — a dimension (what you group by) and a measure (the aggregated number). Specifying only one axis is invalid; the widget won't render. Vertical vs horizontal bar is just which axis carries the quantitative measure.

| Widget | Encodings | Use when |
|--------|-----------|----------|
| **Counter (KPI)** | one quantitative measure; comparison delta (optional); `period` (temporal, optional) for the sparkline behind the headline | single headline number; the sparkline turns a context-free number into "rising / falling / flat" at a glance — use it whenever a temporal column is available |
| **Line** | x = temporal; y = quantitative; color = categorical (optional, multi-series); **vertical-line annotations (optional)** | trend over time; mark events with annotations (incident date, launch, holiday) to turn a generic trend into a readable story |
| **Forecast-line** | line + `AI_FORECAST` confidence band — y exposes actuals + prediction + upper/lower; vertical-line annotations supported | time-series with a forward projection — instantly upgrades a flat line to "here's what already happened AND what's next." Pair with a `vertical-line` annotation on the cause-event date (left of the bump) to land the cause→effect story in one glance |
| **Bar (vertical)** | x = categorical/temporal; y = quantitative; color = categorical (optional, stacked or grouped) | category comparison; weekly trend with category split |
| **Bar (horizontal)** | y = categorical; x = quantitative; color = categorical (optional) | long category labels; ranked breakdown |
| **Area / Stacked bar** | x = temporal; y = quantitative; color = categorical (optional, composition); vertical-line annotations supported | composition over time, max 4-5 segments |
| **Combo (bar+line)** | x = dimension; y with two fields, one bar + one line; vertical-line annotations supported | dual metrics on shared x-axis |
| **Scatter / Bubble** | x = quantitative; y = quantitative; color = categorical (optional); size = quantitative (optional, bubble) | correlation between two measures |
| **Choropleth map** | geo dimension (admin0/admin1 by name or ISO); measure; color scale with `scheme`/`mappings` (optional) | geographic distribution by region (countries, states) colored by an aggregate |
| **Symbol map (point map)** | `coordinates: { latitude, longitude }` (nested shape, top-level fields won't render); size = quantitative (optional); color = quantitative with `colorRamp.scheme: "YlOrRd"` (the only quantitative scheme symbol-map reliably honors; `custom-sequential` and `Blues` render blank) or categorical with `mappings` (optional) | per-point geo data — customers, sites, sensors. Pass **bare** lat/lng field names (e.g. `customer_lat`, `customer_lng`), NOT `AVG(...)` — Lakeview groups implicitly; aggregated coords render blank. `mark.opacity: 1` reads better than transparent at this scale. |
| **Pie** | `angle` = quantitative (REQUIRED — slice size); `color` = categorical (REQUIRED — slice grouping) | composition snapshot, 3-8 slices; usually a horizontal bar is clearer |
| **Heatmap** | x = categorical; y = categorical; color = quantitative with `colorRamp` | "X by Y" intensity matrix — useful for cohort or category × dimension density |
| **Histogram** | x = `BIN_FLOOR(col, N)`; y = `COUNT(*)` | frequency distribution; bin width is set in the widget's field expression, not the dataset SQL |
| **Pivot** | rows = list of categorical fields; columns = list of categorical fields; cell = measure(s) with optional `style.rules` or `cellType: "color-scale"` | cross-tab (X × Y × measure); heat-map-style cell coloring; cohort retention tables |
| **Sankey** | `value` = quantitative; `stages` = ordered list of categorical fields (2-4 stages) | flow between stages — funnel, attribution chain, category → product → batch. **Top-N bucket the tails in the dataset SQL** (`CASE WHEN field IN top_N THEN field ELSE 'Other'`) before sending to the widget — without it a long-tail dimension produces dozens of pencil-thin flows that drown the dominant path. Top 10 for the middle stage + top 15 for the last is a good default. |
| **Funnel** | x = stage (ordered); y = `count` quantitative | stage-by-stage conversion (signups → activations → paid) |
| **Box** | x = categorical; y = quantitative | distribution summary across categories — median, quartiles, outliers |
| **Waterfall** | x = period; y = signed quantitative deltas | cumulative effect (P&L bridge, MoM revenue walk) |
| **Table** | columns; sort (optional); per-column `format` / `style.rules` / `link` / `tooltip` | high-cardinality detail view; conditional cell coloring with thresholds |
| **Text** | markdown lines (`multilineTextboxSpec.lines`) | page-header narrative (`height: 3-4`), section dividers (`height: 1`, `## Heading`), title-as-answer ("Fraud Rate 3x Above Baseline"). **Gotcha**: lines in the array concatenate WITHOUT newlines — pass a single string with `\n\n` for paragraphs, or one line per array element with explicit `\n` at the end. |
| **Filter** | one column on each dataset to filter; default value (optional) | cross-applies to every widget whose dataset has the filter column |

> **Vertical-line annotations** are a load-bearing story device on time-series widgets (`line`, `area`, `bar`, `combo`, `forecast-line`). Mark a cause-event date (incident, launch, campaign) — the eye instantly maps cause to effect. Always specify the marker color from the theme palette (`visualizationColors[N]`) so it doesn't clash.

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

### Theme + color pinning

Set a 5-stop `theme.visualizationColors` palette on the dashboard (cool → warm or low → high progression). Position 0 is the anchor — used for the largest/affected category and KPI sparklines. Pair it with `canvasBackgroundColor` (light blue-tinted neutral works well), `widgetBackgroundColor` = white, `widgetBorderColor` = same as widget bg (= no visible border, widgets float on the canvas), `widgetHeaderAlignment: LEFT`.

**Color pins** — for any chart that colors by a category (donut by category, stacked bar by category, affected-vs-everyday by source, etc.):

- Pin **literal hex strings**, never positional refs (`themeColorType: position N` won't survive when Lakeview re-cycles the palette by SQL-result order — different widgets reading different datasets land on different positions for the same category value). The shape is bare-string in `scale.mappings[].color`:

  ```json
  "color": {
    "fieldName": "category",
    "scale": {
      "type": "categorical",
      "mappings": [
        { "value": "Skincare", "color": "#094074" },
        { "value": "Makeup",   "color": "#5ADBFF" }
      ]
    }
  }
  ```

  **Bare hex string only** — the object form (`"color": {"hex": "#094074"}`) is silently ignored on chart widgets. The bare-string form is the load-bearing detail; if you see categories swapping colors between widgets, the form was wrong.
- Pin the SAME category value to the SAME hex across every widget that colors by that dimension on the same page. Mismatched pins = different colors for the same category in two charts = broken story.
- Semantic pins (affected vs everyday, success vs failure) get their own pair — typically a warm hue (e.g. `#FFDD4A`) for the anomaly and a cool steel/navy for the baseline. Pin both on every affected-vs-everyday chart.
- Counter sparklines need BOTH `value.color` AND `period.color` pinned to the same hex — without the `period` pin the sparkline renders in a desaturated default that's nearly invisible against white.

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

1. **Theme block**: the 5-stop `visualizationColors` palette + canvas/widget/font/selection hex codes. State the position-0 anchor color explicitly (used for sparklines + the affected category).
2. **Category color pins table**: every category → literal hex. Same pins reused on every chart that colors by that category. Same for any semantic pair (affected vs everyday, success vs failure).
3. **Filters table**: Filter name → Column → Datasets it filters → Default value.
4. **Layout** — a small table per page with `(y, x, width, height, widget_name)` rows, derived from the 12-column grid. Walks top-to-bottom; rows with two side-by-side widgets share a `y`. Lets the build agent emit `position` blocks 1:1 without re-deriving the layout.
5. **Per widget**: name (used as title-as-answer), source dataset, widget type, encodings (`x = …; y = …; color = …` with the literal hex pins for color), frame description if the chart benefits from a caption, and what the user should see (numbers, sort order, anomaly visibility).
6. **Self-sufficient page header**: spec out the Row-1 markdown text widget — what the persona, the event, the headline number, and the "what to look at on this page" hint should be.
7. **Validation criteria**: KPI values, chart shape (spike position, decay), filter behavior (select X → all widgets update), and color-pin sanity checks (same category = same color across widgets).

The spec describes WHAT to show. The ai-dev-kit `databricks-aibi-dashboards` skill handles HOW to build the JSON. Don't put full JSON in the spec.

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
- **`color` object form is silently ignored** on chart widgets. Use bare-string `"color": "#094074"` in `scale.mappings[].color`, NEVER `"color": {"hex": "#094074"}`. The object form is accepted on theme stops but not on per-widget mappings; mismatched form = palette falls back to defaults with no error in the UI.
- **Frame descriptions don't render unless `frame.showDescription: true`** is set on that widget. The flag is OFF by default. Setting `frame.description` without the flag = your caption never shows up and you'll think the JSON is broken.
- **Symbol map with aggregated lat/lng renders blank.** Use bare `customer_lat`, `customer_lng` field names — Lakeview groups implicitly. `AVG(lat), AVG(lng)` in the dataset SQL → no points on the map.
- **Text widget `lines` concatenate without newlines.** If you pass `["# Title", "Body"]`, you get `# TitleBody`. Either use a single-element array with explicit `\n\n` between paragraphs, OR end every element except the last with `\n`.

## Connections

- **Upstream**: Gold-layer tables from SDP + Unity Catalog. Design Gold tables with dashboard filters and grain in mind.
- **Downstream**: Raises questions → Genie (the WHAT), Knowledge Assistant (the WHY), apps, agents.

## URLs

- [Dashboards](https://docs.databricks.com/dashboards/)
- [AI/BI](https://docs.databricks.com/ai-bi/)
