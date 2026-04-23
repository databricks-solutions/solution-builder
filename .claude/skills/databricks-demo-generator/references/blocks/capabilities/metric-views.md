---
name: Metric Views
category: ai-bi
disabled: true
buildable: true
skill: databricks-metric-views
---

# Metric Views

**Centralized semantic layer** for defining metrics once and using them consistently across dashboards, Genie, alerts and external BI tools.

## Pain

"Revenue" means different things to different teams. Marketing calculates one way, Finance another, CEO dashboard shows a third number. Every report triggers "which number is right?" debates. Complex metrics (ratios, distinct counts) break when re-aggregated. Teams create dozens of views for every slice, yet can't answer ad-hoc questions.

## Key Features

- **Define once, use everywhere** — single source of truth for business metrics
- **Flexible dimensions** — query any metric across any dimension at runtime
- **Complex calculations** — ratios, distinct counts, time-over-time that aggregate correctly
- **Auto-materialization** — pre-compute and incrementally update aggregations for performance
- **UC governed** — metrics inherit permissions, show in lineage, auditable

## Position

When consistency matters: "Genie answers and dashboards draw from the same metric definitions — no spreadsheet reconciliation." FSI: regulatory metrics must match across reports. Retail: consistent revenue/margin across regions.

## Demo Tips

- **Sits in the gold layer** — materializes pre-aggregated data for fast queries
- Think "cube" that pre-computes many dimension combinations
- **Perfect for dashboards** — one metric view powers multiple widgets
- Consistency: "Everyone sees the same definition of revenue"
- Complex metrics: "This ratio aggregates correctly no matter how you slice it"
- Architecture: Metric Views sit between gold tables and consumers (Dashboard, Genie)
- Not always needed — use when complex metrics or consistency requirements exist

## Implementation

The `databricks-metric-views` ai-dev-kit skill covers implementation details. Specs should specify WHAT to build and WHY (demo story), not HOW.

## When to Include

- Multiple metrics with complex calculations (ratios, YoY, running totals)
- Consistent definitions needed across reports
- Performance requirements for interactive dashboards
- Regulatory/compliance need for auditable metric definitions

## URL

https://docs.databricks.com/en/metric-views/
