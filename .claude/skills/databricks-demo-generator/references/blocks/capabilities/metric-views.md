---
name: Metric Views
category: ai-bi
disabled: false
buildable: true
---

# Metric Views

**Centralized semantic layer** for defining metrics once and using them consistently across dashboards, Genie, alerts and external BI tools.

## Pain

"Revenue" means different things to different teams. Marketing calculates it one way, Finance another, and the CEO dashboard shows a third number. Every new report triggers debates about "which number is right." Complex metrics like ratios or distinct counts break when re-aggregated. Teams create dozens of pre-baked views for every possible slice, yet still can't answer ad-hoc questions.

## Key Features

- **Define once, use everywhere** - single source of truth for business metrics
- **Flexible dimensions** - query any metric across any dimension at runtime
- **Complex calculations** - ratios, distinct counts, time-over-time that aggregate correctly
- **Auto-materialization** - pre-compute and incrementally update aggregations for performance
- **UC governed** - metrics inherit permissions, show in lineage, are auditable

## Position

When consistency matters: "Your Genie answers and dashboards all draw from the same metric definitions - no more spreadsheet reconciliation." FSI: regulatory metrics that must match across reports. Retail: consistent revenue/margin definitions across regions.

## Demo Tips

- **Typically sits in the gold layer** - materializes pre-aggregated data for fast queries
- Think of it as creating a "cube" that pre-computes many dimension combinations
- **Perfect for dashboards** - one metric view can power multiple dashboard widgets
- Mention the consistency story: "Everyone sees the same definition of revenue"
- Good for complex metrics: "This ratio aggregates correctly no matter how you slice it"
- In the architecture diagram, Metric Views sit between gold tables and consumers (Dashboard, Genie)
- Not always needed - use when there are complex metrics or consistency requirements

## How It Works

- **Define measures and dimensions**: Measures are aggregations (`SUM(revenue)`, `COUNT(DISTINCT customer_id)`), dimensions are how you slice them (region, time, product)
- **Query any combination**: Ask for `revenue` by `region` or by `month` — same measure definition, flexible dimensions
- **Auto-materialization**: Databricks pre-computes common aggregations and rewrites queries to use them — fast dashboards without manual tuning
- **Complex metrics work correctly**: Ratios, distinct counts, period-over-period — aggregate properly regardless of how you slice
- **Semantic metadata**: Add display names, synonyms, descriptions — helps Genie understand your metrics

## When to Include

Include Metric Views when:
- Multiple metrics with complex calculations (ratios, YoY, running totals)
- Need for consistent definitions across reports
- Performance requirements for interactive dashboards
- Regulatory/compliance need for auditable metric definitions

## URL

https://docs.databricks.com/en/metric-views/
