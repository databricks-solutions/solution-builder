---
name: AI/BI Dashboards
category: ai-bi
disabled: false
---

# AI/BI Dashboards

## What It Does

AI/BI Dashboards provide interactive, SQL-backed visualizations — counters, charts, tables, and cross-filters — with no per-seat BI licensing. They are the primary "first impression" artifact in every demo: the thing stakeholders see before asking deeper questions.

## When to Use in a Demo

- Every demo should have exactly one dashboard as the narrative entry point.
- The dashboard surfaces "the event" — the anomaly or trend the hero persona notices.
- It answers "what happened?" and raises the question "why?" that drives the audience into Genie or the supervisor agent.

## Standard Layout (6-Column Grid)

Dashboards use a 6-column grid. Each row must fill exactly 6 columns with no gaps. Organize widgets into four tiers, top to bottom:

```
TIER 1 — FILTERS (orient the viewer)
┌──────────────┬──────────────┬──────────────┐
│ Date Range   │ Dimension 1  │ Dimension 2  │  w=2 each, h=2
└──────────────┴──────────────┴──────────────┘

TIER 2 — COUNTERS (the headline numbers)
┌──────────────┬──────────────┬──────────────┐
│  Revenue     │  Fraud Rate  │  Cases       │  w=2 each, h=3
│  $14.2M      │  0.24%       │  2,847       │
│  ▲ 12% YoY  │  ▲ 3x base   │  ▲ 340%      │
└──────────────┴──────────────┴──────────────┘

TIER 3 — VISUALIZATIONS (the shape of the problem)
┌─────────────────────┬─────────────────────┐
│ Trend (line)        │ Breakdown (bar)     │  w=3 each, h=5
│ ═══════╗            │ ████████████  CNP   │
│        ╚════● spike │ █████         POS   │
│     baseline ───    │ ██            ATM   │
└─────────────────────┴─────────────────────┘

TIER 4 — DETAIL TABLE (the drill-down)
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

- **Counters**: Always show a comparison — "vs. baseline" or "vs. prior period." The delta catches the eye, not the absolute value. Use currency (`$1.8M`) or percentage (`0.24%`) formats, not raw counts.
- **Trend line**: Place the spike or drop in the rightmost 20% of the time axis. The eye reads left-to-right and should land on the anomaly. Include enough historical baseline (6-12 months) so the spike has contrast.
- **Breakdown bar**: Sort descending so the dominant category sits at the top. Horizontal bars read more easily than vertical when labels are long.
- **Default filters**: Must show the anomalous period. If a date range filter hides the spike by default, the demo fails before it starts.
- **5-second test**: If a stakeholder cannot identify the problem within 5 seconds of seeing the dashboard, redesign it.

## Dataset Design

A dashboard typically has 3-5 datasets (SQL queries) shared across widgets. Filters cross-cut all datasets containing the filter column — this is how drill-down works across the entire dashboard. Design datasets by purpose:

- **Summary**: Single-row aggregation feeding KPI counters — `current_value`, `baseline_value`, `pct_change`.
- **Trend**: Date-grouped aggregation feeding line/area charts — `GROUP BY date_col ORDER BY date_col`.
- **Breakdown**: Categorical aggregation feeding bar charts — `GROUP BY dimension ORDER BY metric DESC`.
- **Detail**: Row-level data feeding the bottom table — includes all filter columns so cross-filtering works.

Keep filter columns consistent across datasets. If a "channel" filter exists, every dataset that should respond to it must include a `channel` column.

## Common Pitfalls

- **"Everything is fine" dashboards** — always ensure the data has a visible anomaly or spike that the hero persona reacts to.
- **Too many widgets** — keep it to 6-8 per page maximum. Clutter kills the story.
- **Rows that don't fill 6** — a row with w=4 leaves a gap; the grid breaks. Every row must sum to exactly 6.
- **Counters without comparison** — a number alone ("$1.8M") means nothing. Always show vs. baseline or vs. prior period.
- **Filters that hide the event** — default filter values must show the anomalous period, not filter it out.
- **Queries referencing tables before the pipeline runs** — validate that Gold tables are materialized with data before deploying.

## How It Connects to Other Components

- **Upstream:** Reads from Gold-layer tables produced by the declarative pipeline.
- **Downstream:** Raises questions that drive users to the Genie space or multi-agent supervisor.
- **Data generation:** KPI values on the dashboard must match the synthetic data distributions (e.g., if fraud rate is 0.24%, the data must produce that number).

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

## URL

https://www.databricks.com/product/business-intelligence
