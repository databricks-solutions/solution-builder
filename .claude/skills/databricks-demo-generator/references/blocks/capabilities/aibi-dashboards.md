---
name: AI/BI Dashboards
category: ai-bi
disabled: false
buildable: true
skill: databricks-aibi-dashboards
---

# AI/BI Dashboards

## MANDATORY Build Gate — Do Not Skip

**A dashboard must NEVER be created before every table it references exists and contains rows.** Dashboards deployed against missing or empty tables produce silent `TABLE_OR_VIEW_NOT_FOUND` errors on every widget — the demo looks built but is broken, and the only recovery is delete-and-recreate.

Before calling any dashboard create API, satisfy ALL of the following. If any check fails, STOP and fix the upstream pipeline — do not proceed to dashboard creation:

1. **Pipeline has run to completion.** `resources.json.created_resources.pipeline_id` is set, and the most recent pipeline update is in a terminal success state (`COMPLETED` / `IDLE` after a successful update — not `FAILED`, `RUNNING`, or never-started).
2. **Every referenced table exists.** For every table named in any dataset SQL, run `execute_sql`:
   ```sql
   SELECT COUNT(*) AS n FROM {CATALOG}.{SCHEMA}.{table_name}
   ```
   Every query must succeed (no `TABLE_OR_VIEW_NOT_FOUND`) and return `n > 0`. Zero rows is a failure — an empty dashboard is a broken dashboard.
3. **Every referenced column exists.** For each dataset, run the dataset's actual SQL (with a `LIMIT 1`) and confirm it returns without `COLUMN_NOT_FOUND`. This catches spec drift between `03-pipelines.md` and `05-dashboard.md`.

Only after all three checks pass may the dashboard create call proceed. Log each validation result so the user can see which tables were verified.

## What It Does

AI/BI Dashboards provide interactive, SQL-backed visualizations — counters, charts, tables, and cross-filters. They are the primary "first impression" artifact in most demos: they allow key stakeholders to view trends, problems, and interesting factors in their data that require additional analysis.

## When to Use in a Demo

The dashboard is the narrative entry point. It follows a three-beat arc: **what changed → why it matters → what to do next.**

- **Setup (what changed):** The counters and trend lines show the audience something is different — a spike, a drop, an anomaly. This is the "wow" moment; data made visual and immediate.
- **Tension (why it matters):** The breakdown charts and detail table add dimension — which categories, regions, or entities are driving the change. This surfaces "the problem" the hero persona needs to act on.
- **Handoff (what to do next):** The dashboard raises the question "why?" that it can't answer alone, driving the audience into Genie for natural-language interrogation, or into an app or agent system for action.

## Standard Layout (6-Column Grid)

Dashboards use a 6-column grid. Each row must fill exactly 6 columns with no gaps. Users scan in a Z-pattern (top-left to top-right, then down-left to down-right), so place the highest-priority information along that path. Organize widgets into four tiers, top to bottom:

```
TIER 1 — FILTERS (orient the viewer)
┌──────────────┬──────────────┬──────────────┐
│ Date Range   │ Dimension 1  │ Dimension 2  │  w=2 each, h=2
└──────────────┴──────────────┴──────────────┘

TIER 2 — COUNTERS (the headline numbers)
┌──────────────┬──────────────┬──────────────┐
│  Revenue     │  Fraud Rate  │  Cases       │  w=2 each, h=3
│  $14.2M      │  0.24%       │  2,847       │
│  ▲ 12% YoY   │  ▲ 3x base   │  ▲ 340%      │
└──────────────┴──────────────┴──────────────┘

TIER 3 — VISUALIZATIONS (the shape of the problem)
┌─────────────────────┬─────────────────────┐
│ Trend (line)        │ Breakdown (bar)     │  w=3 each, h=5
│ ═══════╗            │ ████████████  CNP   │
│        ╚════● spike │ █████         POS   │
│     baseline ───    │ ██            ATM   │
└─────────────────────┴─────────────────────┘

TIER 4 — DETAIL TABLE (drill-down into interesting data that a stakeholder may care about)
┌───────────────────────────────────────────┐
│ entity │ metric │ trend │ status          │  w=6, h=5
└───────────────────────────────────────────┘
```

**Widget sizing guide:**

| Widget | Width | Height | Notes |
|--------|-------|--------|-------|
| Filter | 2 | 2 | 3 filters across = 6 columns |
| Counter (KPI) | 2 | 3 | Never shorter than 3; always include comparison value |
| Line / bar / area chart | 3 or 6 | 5-6 | Use w=3 for side-by-side pairs, w=6 for a single focal chart |
| Detail table | 6 | 5-8 | Always full width at the bottom |

## Making Anomalies Visible

The anomaly is the whole point of the dashboard. Every design choice should make it impossible to miss:

- **5-second test**: If a stakeholder cannot identify the problem within 5 seconds of seeing the dashboard, redesign it.
- **Counters**: Always show a comparison — "vs. baseline" or "vs. prior period." The delta catches the eye, not the absolute value. Use currency (`$1.8M`) or percentage (`0.24%`) formats, etc. as needed, not raw numbers.
- **Default filters**: Must show the anomalous period. If a date range filter hides the spike by default, the demo fails before it starts.
- **Trend line**: Place the spike or drop in the rightmost 20% of the time axis. The eye reads left-to-right and should land on the anomaly. Include enough historical baseline (6-12 months) so the spike has contrast.
- **Breakdown bar**: Sort descending so the dominant category sits at the top. Horizontal bars read more easily than vertical when labels are long.

## Visual Design Principles

**Color as signal, not decoration.** Use a restrained palette — brand neutrals for chrome, one highlight hue for "pay attention," and a reserved color for risk or alerts. If a dimension (e.g., a channel or region) appears on multiple charts, keep its color consistent across all of them. Limit to 8-12 distinct hues maximum; rainbow palettes obscure meaning.

**Trim non-data ink.** Remove gridlines, excessive tick marks, and decorative elements. The fewer visual elements competing for attention, the faster the anomaly registers. If something isn't communicating data, it's diluting the message.

**Title widgets as answers, not topics.** "Fraud Rate 3x Above Baseline" outperforms "Fraud Rate" as a widget title — the viewer grasps the insight before reading the number. When the title carries the message, the chart becomes confirmation rather than the sole carrier of meaning.

**Scope every metric.** Beyond comparison values on counters (see above), include units in labels (`$`, `%`, `req/min`), display the active date range, and show a "Last updated" timestamp if data freshness matters to the story. A number without scope is a number without meaning.

## Chart Selection

Match chart type to the question being answered — not for visual variety:

| Question | Chart Type | Notes |
|----------|-----------|-------|
| How is it changing over time? | Line chart | Add a baseline or target band for contrast |
| Which category dominates? | Horizontal bar | Sort descending; easier to read with long labels |
| What are the exact values? | Table | Use for the detail tier; add conditional formatting for emphasis |
| How does it break down? | Stacked bar | Limit to 4-5 segments; more becomes unreadable |
| What's the single headline number? | Counter | Always pair with a comparison delta |

Avoid pie charts (slices are hard to compare), dual-axis lines (imply false correlations and confuse scales), and 3D effects (distort actual values). When in doubt, a sorted horizontal bar chart is almost always the right default.

## Dataset Design

Dashboards typically have 3-5 datasets (SQL queries) shared across widgets. Design datasets by purpose: summary (KPI counters), trend (line/area charts), breakdown (bar charts), and detail (drill-down table). Keep filter columns consistent across datasets so cross-filtering works.

The `databricks-aibi-dashboards` ai-dev-kit skill offers instructions for *how* to create dashboards.

## Table References — MANDATORY Rules

Dashboards fail with `[TABLE_OR_VIEW_NOT_FOUND]` when SQL references tables that either don't exist or aren't reachable from the warehouse's default catalog. Prevent this with three non-negotiable rules:

1. **Only reference tables defined in the pipeline spec.** The dashboard instruction file's dataset SQL must use the exact table names listed in the pipeline instruction file's Gold layer section. No renames, no pluralizations, no hallucinated helper tables. If the dashboard needs a table the pipeline doesn't produce, **update the pipeline spec first** — don't invent a table in the dashboard spec.
2. **Always fully qualify every table reference** as `{CATALOG}.{SCHEMA}.table_name`. Never write bare `FROM gold_daily_summary` in dataset SQL — it depends on the warehouse's current catalog/schema and breaks silently when those defaults differ. The dataset spec should show the full three-part name.
3. **Validate every dataset query before creating the dashboard** (see Pre-Deploy Validation below).

## Pre-Deploy Validation — MANDATORY

Before calling the dashboard create API, execute every dataset's SQL against the target warehouse and confirm it returns rows. Use `execute_sql` (or the `databricks-aibi-dashboards` skill's validation step). If any query fails:

- `TABLE_OR_VIEW_NOT_FOUND` → the pipeline either didn't run, didn't materialize that table, or the table name in the dashboard spec doesn't match what the pipeline created. Fix the spec mismatch, re-run the pipeline, then retry — do not deploy a dashboard with broken datasets.
- `COLUMN_NOT_FOUND` → the pipeline spec and dashboard spec disagree on columns. Align them.
- Zero rows → the pipeline ran but produced no data for the filter range. Check data generation and pipeline logic.

This validation is NOT optional. Deploying a dashboard that references missing tables produces a broken demo — every widget shows an error state, and there is no recovery except to delete and recreate.

## Common Pitfalls

- **"Everything is fine" dashboards** — always ensure the data represents anomalies from the data — unless there genuinely are no anomalies.
- **Too many widgets** — keep it to 6-8 per page maximum. Clutter kills a demo. If a widget can't map to one of the dashboard's core questions, it doesn't ship.
- **Rows that don't fill 6** — a row with w=4 leaves a gap; the grid breaks. Every row must sum to exactly 6.
- **Counters without comparison** — a number alone ("$1.8M") means nothing. Always show vs. baseline or vs. prior period.
- **Inconsistent color across widgets** — if a category is blue on one chart, it must be blue on every chart. Re-learning color meanings per widget slows comprehension.
- **Pie charts with many slices** — more than 2-3 slices makes comparison impossible. Use a sorted bar chart instead.
- **Generic widget titles** — "Revenue" tells the viewer nothing. "Revenue Up 12% YoY" tells them everything. Titles should carry the insight.
- **Queries referencing tables before the pipeline runs** — validate that Gold tables are materialized with data before deploying.

## How It Connects to Other Components

- **Upstream:** Reads from Gold-layer tables produced by the spark declarative pipeline or from plain SQL + Unity Catalog tables.
- **Downstream:** Raises questions that drive users to the Genie space, a Databricks app, or agent system.

## Example Specification Snippet

```yaml
dashboard:
  title: "Pacific Coast Bank Fraud Command Center"
  filters:
    - date_range: { default: "Last 7 days" }
    - channel: { options: [All, CNP, POS, ATM], default: All }
    - merchant: { default: All }
  counters:
    - label: "Fraud Rate"
      value: "0.24%"
      comparison: "3x vs baseline (0.08%)"
      format: percent
      dataset: summary
    - label: "Fraud Losses"
      value: "$1.8M"
      comparison: "+$1.4M vs prior week"
      format: currency
      dataset: summary
    - label: "Compromised Cards"
      value: "2,847"
      comparison: "+2,100 vs prior week"
      format: number
      dataset: summary
  charts:
    - type: line
      title: "Fraud Rate Trend (6 months)"
      dataset: trend
      x: txn_date
      y: fraud_rate
      note: "Spike should appear in rightmost 20% of axis"
    - type: bar
      title: "Fraud by Channel"
      dataset: breakdown
      x: fraud_amount
      y: channel
      note: "Horizontal bars, sorted descending — CNP dominates"
  detail_table:
    title: "Top Fraud Merchants"
    dataset: detail
    columns: [merchant_name, fraud_count, fraud_amount, fraud_rate, alert_level]
    sort: fraud_amount DESC
  five_second_test:
    persona: "Jennifer Walsh, VP of Fraud Operations"
    sees_immediately:
      - "Fraud rate counter shows 0.24% — 3x baseline"
      - "CNP channel dominates the breakdown bar"
      - "TechDealz tops the detail table"
```

## URLs

- [Dashboards and visualizations](https://docs.databricks.com/dashboards/) - Learn how to share insights with your team using AI/BI dashboards.
- [Alerts](https://docs.databricks.com/sql/user/alerts/) - Learn about using DBSQL alerts to periodically run queries, evaluate defined conditions, and send notifications if a condition is met.
- [AI/BI](https://docs.databricks.com/ai-bi/) - Databricks AI/BI provides self-service data analysis with AI-powered dashboards, conversational Genie spaces, and seamless platform integration.