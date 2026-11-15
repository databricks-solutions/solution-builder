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

### Make the page self-sufficient

A user opening the dashboard cold should grasp the story without needing a guide. Three devices, use them where they earn their place — don't paste them everywhere:

- **Page-header text widget** (top of every page, full-width markdown). Names the event and points the reader at what to look at on this page. A few sentences — lifted from the README in spirit, not duplicated verbatim.
- **Widget titles** are the card's *name* — set `frame.title` (the title-as-answer) AND `frame.showTitle: true` on every widget whose name should show. **`showTitle` is OFF by default**, so a counter/KPI authored with just a `title` (or with only an `encodings.value.displayName`) renders as a bare number with **no name on the card** — a common silent-failure, especially on aggregation counters. Every counter in the example dashboards sets both.
- **Frame descriptions** on the chart that needs a caption to read correctly — a forecast where the vertical-line marker would otherwise be opaque, a counter-argument chart whose meaning depends on context, a sankey whose punchline is the convergence pattern. One short sentence. Set `frame.description` AND `frame.showDescription: true` (the flag is OFF by default — descriptions don't render without it; the same silent-failure as `showTitle`). Skip captions on widgets that read themselves (a sorted bar chart with clear labels doesn't need words).
- **Section dividers**: thin markdown `text` widgets (1-row tall, full-width) with `## Heading`. Use to separate logical beats when a page has more than one act.

## What Dashboards Can Do

Dashboards are SQL-backed: each widget draws from a dataset (a SQL query on Gold tables). The dashboard engine handles aggregation and filtering automatically — you don't write aggregation logic, you design the data shape.

### Widget Types

Every chart needs **two axes** — a dimension (what you group by) and a measure (the aggregated number). Specifying only one axis is invalid; the widget won't render. Vertical vs horizontal bar is just which axis carries the quantitative measure.

> **Blank-widget gotcha (verify after building).** A widget can return rows and still render empty when an `encodings.*.fieldName` doesn't exactly match a `query.fields[].name` (the aliased output, e.g. `sum(spend)`, not the raw `spend`). After deploying, confirm every widget shows data. The exact field-binding contract + the final checklist for this live in the `databricks-aibi-dashboards` DAS — follow them there.

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
| **Symbol map (point map)** | latitude + longitude; size = quantitative (optional); color = quantitative with a color ramp or categorical with `mappings` | **A bubble map is one of the strongest demo moments — use it whenever the data has any geographic dimension** (customers, stores, facilities, sites, sensors, vehicles, claims, transactions). It answers *"where is this happening?"* before anyone reads a number, makes the affected region pop instantly, and turns an abstract anomaly into a concrete place. Costs you nothing — if you have customer / store / site rows with lat/lng (or you can geocode a city / region / postal code in the synth), put a map on Page 1. |
| **Pie** | `angle` = quantitative (REQUIRED — slice size); `color` = categorical (REQUIRED — slice grouping) | composition snapshot, 3-8 slices; usually a horizontal bar is clearer |
| **Heatmap** | x = categorical; y = categorical; color = quantitative with `colorRamp` | "X by Y" intensity matrix — useful for cohort or category × dimension density |
| **Histogram** | x = `BIN_FLOOR(col, N)`; y = `COUNT(*)` | frequency distribution; bin width is set in the widget's field expression, not the dataset SQL |
| **Pivot** | rows = list of categorical fields; columns = list of categorical fields; cell = measure(s) with optional `style.rules` or `cellType: "color-scale"` | cross-tab (X × Y × measure); heat-map-style cell coloring; cohort retention tables |
| **Sankey** | `value` = quantitative; `stages` = ordered list of categorical fields (2-4 stages) | flow between stages — funnel, attribution chain, category → product → batch. **Top-N bucket the tails in the dataset SQL** (`CASE WHEN field IN top_N THEN field ELSE 'Other'`) before sending to the widget — without it a long-tail dimension produces dozens of pencil-thin flows that drown the dominant path. Top 10 for the middle stage + top 15 for the last is a good default. |
| **Funnel** | x = stage (ordered); y = `count` quantitative | stage-by-stage conversion (signups → activations → paid) |
| **Box** | x = categorical; y = quantitative | distribution summary across categories — median, quartiles, outliers |
| **Waterfall** | x = period; y = signed quantitative deltas | cumulative effect (P&L bridge, MoM revenue walk) |
| **Table** | columns; sort (optional); per-column `format` / `style.rules` / `link` / `tooltip` | high-cardinality detail view; conditional cell coloring with thresholds |
| **Text** | markdown | page-header narrative, section dividers (`## Heading`), title-as-answer ("Fraud Rate 3x Above Baseline") |
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
- **Trend line — shape, not just a spike.** A time series must read **build-up → peak → decay with the peak in the PAST** (roughly the middle-to-right 60-80% of the window, with 6-12 months of baseline before it for contrast). The failure mode to avoid is a line that is **flat for the whole window then cliffs only on the max date** — that happens when the data generator anchors the event at `date.today()` (the latest timestamp), so there is no "after." Fix it at the source (move the event back in the generator; see the synthetic-data block's rolling-date pitfall). Only tighten the window to show a bare step when the step genuinely IS the intended incident-timeline — and then say so in the frame description.
- **Breakdown bar — watch BOTH ends of the cardinality.** Sort descending, dominant category at top, horizontal bars for long labels. Too many categories (50 bars) is unreadable → top-N + "Other". But the **inverse is just as broken**: a `GROUP BY` where **one category dominates and the rest are ~0** renders as one tall bar beside a row of empty bars — visually blank. Instead: (a) a **stacked** affected-vs-healthy / down-vs-up bar so the one-sided split is the point, (b) a top-N **table**, or (c) a single **callout counter**. Don't plot a dozen zero bars.

## Visual Design

- **Color = signal, not decoration.** Restrained palette — neutrals for chrome, one highlight hue, one for risk. Consistent color per dimension across all charts. Max 8 hues.
- **Title widgets as answers.** "Fraud Rate 3x Above Baseline" not "Fraud Rate."
- **Scope every metric.** Units in labels ($, %), active date range, freshness.

### Theme + color guidelines

Define a small palette (~5 stops, cool → warm or low → high) at the dashboard level and let one anchor color carry the story — the affected category, the dominant region, the KPI sparkline trend. Pair it with a light blue-tinted canvas, white widget backgrounds, no visible widget borders, left-aligned widget headers — widgets float on the canvas, the data is the focus.

**Color is signal, not decoration.** Decide which categories deserve their own hex and which can ride the palette default. Pin the load-bearing ones explicitly so the same category reads the same color across every chart that shows it. For affected-vs-everyday or success-vs-failure splits, pin both sides — a warm hue for the anomaly, a cool neutral for the baseline.

The dashboard skill owns the exact JSON shape for theme + per-widget color mappings (it has the gotchas — bare-string form, sparkline `value`+`period` pairing, etc.). At spec time, list the categories and the hex pins; the build step wires them.

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
5. **Table names only in dataset queries**: Use bare table names (e.g., `SELECT * FROM gold_daily_summary`), not fully qualified `catalog.schema.table`. The dashboard is deployed with `--dataset-catalog` and `--dataset-schema` flags (on BOTH `lakeview create` AND `lakeview update` — update strips them otherwise) which resolve the catalog/schema at deploy time.

## Spec-Writing Guide

When writing dashboard specifications, include:

1. **Theme block**: the 5-stop `visualizationColors` palette + canvas/widget/font/selection hex codes. State the position-0 anchor color explicitly (used for sparklines + the affected category).
2. **Category color pins table**: every category → literal hex. Same pins reused on every chart that colors by that category. Same for any semantic pair (affected vs everyday, success vs failure).
3. **Filters table**: Filter name → Column → Datasets it filters → Default value.
4. **Layout** — a small table per page with `(y, x, width, height, widget_name)` rows, derived from the 12-column grid. Walks top-to-bottom; rows with two side-by-side widgets share a `y`. Lets the build agent emit `position` blocks 1:1 without re-deriving the layout.
5. **Per widget**: name (used as title-as-answer), source dataset, widget type, encodings (`x = …; y = …; color = …` with the literal hex pins for color), frame description if the chart benefits from a caption, and what the user should see (numbers, sort order, anomaly visibility).
6. **Self-sufficient page header**: spec out the Row-1 markdown text widget — what the persona, the event, the headline number, and the "what to look at on this page" hint should be.
7. **Validation criteria**: KPI values, chart shape (spike position, decay), filter behavior (select X → all widgets update), and color-pin sanity checks (same category = same color across widgets).

The spec describes WHAT to show. The `databricks-aibi-dashboards` Databricks Agent Skill (DAS) handles HOW to build the JSON. Don't put full JSON in the spec.

## MANDATORY Final Review — don't declare the dashboard done before this

The DAS documents every rule below; the failure is **skipping the final pass**. A dashboard can pass a `check_dash` field-binding check yet still ship a run-on title, a sparkline-less counter, a `version:1` table, or a near-empty one-dominant bar — all invisible to that check. After deploying (and after every `update`+`publish`), re-read the live serialized JSON widget by widget and confirm:

1. **Counters**: each has a `period` sparkline over a one-row-per-period dataset (`GROUP BY DATE_TRUNC`), OR is a justified point-in-time snapshot. A single-scalar-row dataset can't spark — fix the dataset, don't ship a bare number.
2. **Correct `version` per widget** (wrong → "Invalid widget definition is imported"). Matrix is NOT uniform — DAS Widget Index is source of truth: counter/table/symbol-map/filters=**2**; bar/line/pie/area/scatter/histogram/pivot/heatmap=**3**; combo/choropleth/forecast-line/sankey/funnel/box/waterfall=**1**. (Not "all charts are v3".)
3. **No `color` on a counter `value`** → "unsupported widget definition". Counter color comes only from theme `fontColor`.
4. **Text `lines[]` splits heading from body**: `["## Heading\n", "\n", "body"]`, not one `"## Title body…"` string (concatenated verbatim → run-on wall of text).
5. **No degenerate chart** — one dominant value + many ~0 rows renders near-blank. Reframe per the breakdown-bar rule above.
6. **Time-series = build-up → peak → decay, peak in the past**, not flat-then-cliff on the max date (Trend-line rule). Flat line → check the generator's event date.
7. **Every widget renders data** (`fieldName` ↔ `query.fields[].name`, the DAS blank-widget gotcha) and **every headline number is truthful** vs a direct SQL query.
8. **`frame.showTitle: true` on every title, `frame.showDescription: true` on every caption** (both OFF by default).

## Pitfalls

- **Don't put catalog/schema in the queries and always set the --dataset-catalog and --dataset-schema flag when running `databricks lakeview create` AND `databricks lakeview update`** (update strips catalog/schema otherwise) 
- **"Everything is fine" dashboards** — ensure data shows the anomaly.
- **Rows that don't fill 12** — gaps break the grid. Every row's widget widths must sum to 12.
- **Counters without comparison** — "$1.8M" alone means nothing. Show vs. baseline or MRR or ARR.
- **Inconsistent color** — same category = same color across all charts.
- **Titleless cards** — a card's name renders only with `frame.showTitle: true` (OFF by default) set alongside `frame.title`; without it a counter shows a bare number with no label. (Details + checklist in the `databricks-aibi-dashboards` DAS.)
- **Generic titles** — "Revenue" tells nothing. "Revenue Up 12% YoY" tells everything.
- **Missing filter columns** — if a dataset lacks the filter column, that widget won't respond to the filter.
- **Too-fine cardinality in charts** — 50 categories in a bar chart is unreadable, instead get the top ~6 then aggregate as "other" using a window function.
- **`queryLines` joined without whitespace** — array elements are concatenated verbatim. Each element except the last must end with a space or `\n`, e.g. `["SELECT * ", "FROM items ", "WHERE x = 1"]` (or use a single-element array).

### Fleet-recurring pitfalls (check EVERY one, on EVERY page)

The defects that most often made a generated dashboard look "average":

- **Run-on page headers (#1 recurring).** One `lines` element `["## Heading … story …"]` renders heading jammed into body (concatenated verbatim). Use three: `["## Heading\n", "\n", "story"]`. Fix on every page, not just page 1.
- **Empty theme + no color pins (near-universal).** `theme: {}` → charts fall back to default colors, the anomaly isn't privileged, colors reshuffle chart-to-chart. Populate the theme and pin the hero semantically — the one county/supplier/region/failure-mode that IS the story gets a warm/red hex, baseline a muted grey, same pins on every chart showing that category.
- **"Buried hero" chart** — anomaly lost in a many-category chart (worst: palest color). Highest-impact fix: **sort DESC + horizontal bar + 2-color highlight** (hero in anchor hue, rest grey).
  - **DESC sort**: simplest is `ORDER BY <metric> DESC` in the dataset SQL (what most of the fleet does). Widget-level: DAS-canonical `scale.sort: {"by": "value"}`; fleet also uses `{"by": "x-reversed"}`/`{"by": "y-reversed"}` (with 'd'). Prefer `ORDER BY DESC` or `"value"` (documented + verified).
- **Sparkline counter headline** = whatever `value.fieldName` aggregates across ALL period rows — normally the window TOTAL (`SUM(x)`), sparkline = per-period. Fine on a cumulative total. RATIO is the trap: `SUM(rate)` is meaningless — divide exposed numerator/denominator, or drop the sparkline. For a **latest-period** headline, point `value.fieldName` at `MAX_BY(x, period)` and keep the period rows. (Confirm total vs latest vs ratio — easy to confuse.)
- **Headline must match the README hero stat.** Most frequent "undersold" bug: KPI scoped to a different window than the story (headline on 52 weeks while narrative + charts are 104 → number halved). Headline window = story's headline-stat window = main chart window, unless the title says otherwise. Verify every headline vs direct SQL and vs the README.
- **Flat-then-cliff from a current snapshot across history.** A source with only today's snapshot repeated flat then dropping at the max date is a fake cliff — back-calculate the trajectory from the flow (snapshot ± consumption per past period). More generally, noisy/partial-trailing series read badly: a **trailing moving average** (7-day daily, 3-month monthly) smooths noise AND absorbs the partial last period — default for any drift-over-time chart. (See "Trend line — shape".)
- **Percent counter as a bare number.** `ROUND(100*x,1)` + no `format` → "28.2" not "28.2%". Output the fraction (0–1) + `format: number-percent` (0.282 → "28.2%"). `number-plain` for true /100 scores and counts; for an already-/100 value append the unit via `format.suffix` or `formatTemplate`.
- **Over-abbreviation.** `abbreviation:"compact"` → "1K"/"9K" is useless for 3–5-digit operational counts (1,348 / 9,267). Compact is for currency (`$1.5M`); use full integers with grouping otherwise.
- **Multi-field date filter needs `frame.title`** (e.g. "Date range"), else the UI shows the raw field list ("date,return_date,week").
- **Default date range must span the full baseline** — last-12-months hides the pre-event baseline the "something changed at date X" story needs. Default to full history.
- **Title convention**: `AI-BI - <Thing>: <Subtitle>` — no `[AIBI]`/`[AI-BI]` prefixes, no 📶/✈ emoji. `display_name` isn't in the serialized JSON — set it on the `lakeview create`/`update` call AND in `databricks.yml`.

### Deploy/CLI gotchas (verified on CLI v1.10.0)

- **`lakeview update --serialized-dashboard @file` doesn't read the file** — the flag takes a literal string, so `@file` passes verbatim → "failed to parse serialized dashboard". Use `--serialized-dashboard "$(cat file.json)"`, or `--json @body.json` with body `{"serialized_dashboard": "<stringified JSON>", "warehouse_id": "..."}`.
- **`--dataset-catalog`/`--dataset-schema` are CLI flags, NOT body fields** (silently ignored in `--json` → datasets unbound → every widget "Unable to render visualization" even when a field-checker passes). Pass on BOTH create and update.
- **`publish` MUST pass `--embed-credentials`** (+ `--warehouse-id`), else credentials are dropped and viewers are locked out. A plain `update`+`publish` silently de-embeds — easy to ship broken.
- `associative_filter_predicate_group` flagged "column not in dataset" is a **false positive** — a Lakeview-internal virtual column in auto-generated filter queries (not a dataset column); the filter works. Whitelist it. (Different from hand-writing it in a dataset query, which the DAS correctly forbids.)

## Connections

- **Upstream**: Gold-layer tables from SDP + Unity Catalog. Design Gold tables with dashboard filters and grain in mind.
- **Downstream**: Raises questions → Genie (the WHAT, and the WHY when policy documents are attached to it), apps, agents.

## URLs

- [Dashboards](https://docs.databricks.com/dashboards/)
- [AI/BI](https://docs.databricks.com/ai-bi/)
