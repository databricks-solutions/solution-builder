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

**A dashboard must NEVER be created before every table it references exists and contains rows.** Dashboards deployed against missing or empty tables produce silent `TABLE_OR_VIEW_NOT_FOUND` errors on every widget — the demo looks built but is broken, and the only recovery is delete-and-recreate.

Before calling any dashboard create API, satisfy ALL of the following. If any check fails, STOP and fix the upstream pipeline — do not proceed to dashboard creation:

1. **Pipeline has run to completion.** `resources.json.created_resources.pipeline_id` is set, and the most recent pipeline update is in a terminal success state.
2. **Every referenced table exists and has rows.** For every table named in any dataset SQL, run:
   ```sql
   SELECT COUNT(*) AS n FROM {CATALOG}.{SCHEMA}.{table_name}
   ```
   Every query must succeed (no `TABLE_OR_VIEW_NOT_FOUND`) and return `n > 0`.
3. **Every referenced column exists.** Run each dataset's SQL with `LIMIT 1` and confirm no `COLUMN_NOT_FOUND`.

## Narrative Arc

Three-beat: **what changed** (counters + trend) → **why it matters** (breakdown + detail table) → **what to do next** (handoff to Genie/agent).
- **Setup**: Counters and trend lines show something is different — a spike, drop, anomaly. The "wow" moment.
- **Tension**: Breakdown charts and detail table show which categories/regions/entities drive the change. Surfaces "the problem."
- **Handoff**: Dashboard raises the "why?" it can't answer alone → Genie, app, or agent.

## 6-Column Grid Layout

Every row must fill exactly 6 columns. Z-pattern scanning. Four tiers top to bottom:

| Tier | Widget | w × h | Notes |
|------|--------|-------|-------|
| 1. Filters | Date range + 2 dimensions | 2×2 each | 3 filters = 6 cols |
| 2. Counters | 3 KPIs with comparison deltas | 2×3 each | Never shorter than h=3. Always include "vs baseline" or "vs prior period" |
| 3. Visualizations | Trend line + breakdown bar | 3×5 each | w=3 for side-by-side pairs, w=6 for single focal chart |
| 4. Detail table | Entity drill-down | 6×5-8 | Full width at bottom, sorted by key metric DESC |

## Making Anomalies Visible

The anomaly is the whole point. Every design choice must make it impossible to miss.
- **5-second test**: If the stakeholder can't identify the problem in 5 seconds, redesign it.
- **Counters**: Delta catches the eye, not the absolute value. Show "vs. baseline" or "vs. prior period." Use currency/percentage formats, not raw numbers.
- **Default filters**: Must show the anomalous period. If the date range hides the spike, the demo fails.
- **Trend line**: Spike in the rightmost 20% of the time axis. Include 6-12 months baseline for contrast.
- **Breakdown bar**: Sort descending, dominant category at top. Horizontal bars for long labels.

## Visual Design

- **Color = signal, not decoration.** Restrained palette — neutrals for chrome, one highlight hue for "pay attention," one for risk/alerts. Consistent color per dimension across all charts. Max 8-12 hues.
- **Trim non-data ink.** Remove gridlines, excessive ticks, decorative elements. Fewer visual elements = faster anomaly detection.
- **Title widgets as answers.** "Fraud Rate 3x Above Baseline" not "Fraud Rate." Title carries the insight, chart confirms it.
- **Scope every metric.** Units in labels (`$`, `%`, `req/min`), active date range, "Last updated" if freshness matters. A number without scope is meaningless.

## Chart Selection

| Question | Chart | Notes |
|----------|-------|-------|
| Change over time? | Line | Add baseline/target band for contrast |
| Which category dominates? | Horizontal bar | Sort descending; easier to read with long labels |
| Exact values? | Table | Detail tier; add conditional formatting |
| Composition? | Stacked bar | Max 4-5 segments; more becomes unreadable |
| Single headline number? | Counter | Always pair with comparison delta |

Avoid pie charts (hard to compare slices), dual-axis lines (false correlations, confusing scales), 3D effects (distort values). Default: sorted horizontal bar.

## Dataset Design

3-5 SQL datasets shared across widgets. Design by purpose: summary (counters), trend (line/area), breakdown (bar), detail (table). Filter columns must be consistent across datasets for cross-filtering. The `databricks-aibi-dashboards` ai-dev-kit skill covers *how* to create dashboards.

## Table References

1. **Only reference tables defined in the pipeline spec.** Use exact table names from the Gold layer. If the dashboard needs a table the pipeline doesn't produce, update the pipeline spec first.
2. **Always fully qualify** as `{CATALOG}.{SCHEMA}.table_name`. Never use bare table names.
3. **Validate every dataset query before creating the dashboard.**

## Pitfalls

- **"Everything is fine" dashboards** — always ensure the data shows anomalies, unless there genuinely are none.
- **Too many widgets** — 6-8 per page max. If a widget can't map to a core question, cut it.
- **Rows that don't fill 6** — w=4 leaves a gap; the grid breaks. Every row must sum to 6.
- **Counters without comparison** — "$1.8M" alone means nothing. Always show vs. baseline or prior period.
- **Inconsistent color** — if a category is blue on one chart, it must be blue on every chart.
- **Pie charts with many slices** — more than 2-3 makes comparison impossible. Use sorted bar.
- **Generic widget titles** — "Revenue" tells nothing. "Revenue Up 12% YoY" tells everything.
- **Queries referencing unmaterialized tables** — validate Gold tables have data before deploying.

## Connections

- **Upstream**: Gold-layer tables from SDP or plain SQL + Unity Catalog tables.
- **Downstream**: Raises questions that drive users to Genie, apps, or agents.

## URLs

- [Dashboards](https://docs.databricks.com/dashboards/)
- [Alerts](https://docs.databricks.com/sql/user/alerts/)
- [AI/BI](https://docs.databricks.com/ai-bi/)
