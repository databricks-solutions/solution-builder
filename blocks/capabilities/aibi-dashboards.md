---
name: AI/BI Lakeview Dashboards
slug: aibi-dashboards
category: capability
tags: [visualization, kpi, lakeview, analytics, ai-bi]
description: >
  Context for generating AI/BI Lakeview dashboard specifications, including KPI card design,
  chart selection, filter configuration, and the 5-second test pattern that ensures dashboards
  tell a clear story at a glance.
related: [genie-space, declarative-pipeline, notebooks]
---

# AI/BI Lakeview Dashboards

## What It Does

AI/BI Lakeview dashboards provide interactive, SQL-backed visualizations with KPI cards, charts, tables, and cross-filters. They are the primary "first impression" artifact in every demo — the thing stakeholders see before asking questions.

## When to Use in a Demo

- Every demo should have exactly one dashboard as the narrative entry point.
- The dashboard surfaces "the event" — the anomaly or trend the hero persona notices.
- It answers "what happened?" and raises the question "why?" that drives the audience into Genie or the supervisor agent.

## Key Configuration Decisions

1. **KPI cards (top row):** 3-5 cards. Each needs a value, comparison/trend indicator, and source Gold table. The leftmost card should be the primary metric tied to the event.
2. **Chart types:** Line charts for trends over time, bar charts for categorical breakdowns, tables for detail/drill-down. Avoid pie charts — they are hard to read in demos.
3. **Filters:** 3-6 filters across the top. Always include a date range filter. Additional filters should map to the dimensions the audience will want to slice by.
4. **SQL queries:** Every widget is backed by a SQL query against Gold tables. Queries must be tested via `execute_sql` before deployment.
5. **Layout:** Single page, top-to-bottom narrative flow. KPIs → trend → breakdown → detail table.

## Common Pitfalls

- Dashboards that show "everything is fine" — always ensure the data has a visible anomaly or spike that the hero persona reacts to.
- Too many widgets — keep it to 6-8 per page maximum. Clutter kills the demo story.
- Filters that hide the event — default filter values must show the anomalous period, not filter it out.
- Queries that reference tables before the pipeline has materialized them.
- Forgetting the 5-second test: if a stakeholder cannot identify the problem in 5 seconds of looking at the dashboard, it needs redesigning.

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
  kpi_cards:
    - label: "Fraud Rate"
      value_query: "SELECT fraud_rate FROM gold_daily_fraud_metrics WHERE ..."
      comparison: "3x vs baseline"
    - label: "Fraud Losses"
      value_query: "SELECT SUM(fraud_amount) FROM gold_daily_fraud_metrics WHERE ..."
  charts:
    - type: line
      title: "Fraud Rate Trend (6 months)"
      query: "SELECT txn_date, fraud_rate FROM gold_daily_fraud_metrics ..."
    - type: bar
      title: "Fraud by Channel"
      query: "SELECT channel, SUM(fraud_amount) FROM gold_daily_fraud_metrics ..."
  five_second_test:
    persona: "Jennifer Walsh, VP of Fraud Operations"
    sees_immediately:
      - "Fraud rate is RED at 0.24% — 3x normal"
      - "CNP channel dominates fraud breakdown"
      - "TechDealz is the top fraud merchant"
```
