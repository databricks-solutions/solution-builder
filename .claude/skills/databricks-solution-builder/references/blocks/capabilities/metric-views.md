---
name: Metric Views
category: ai-bi
disabled: false
buildable: true
skill: databricks-metric-views
---

# Metric Views

**Centralized semantic layer** for defining metrics once and using them consistently across dashboards, Genie, alerts, and external BI. Lives in Unity Catalog — governed, lineage-aware — but exposes dimensions + measures instead of raw columns.

## Pain

"Revenue" means different things to different teams. Marketing calculates one way, Finance another, the CEO dashboard shows a third number. Complex metrics (ratios, distinct counts, YoY) break when re-aggregated downstream. Teams create dozens of pre-aggregated views for every slice, yet still can't answer ad-hoc questions.

## Key Features

- **Define once, use everywhere** — one YAML, consumed by Dashboards, Genie, alerts, SQL editor, external BI.
- **Dimensions vs measures at runtime** — pick them independently; any slice is a query, not a new view.
- **Correct complex aggregation** — ratios, distinct counts, and windowed metrics aggregate correctly at any grain.
- **Auto-materialization** — pre-compute aggregated and/or unaggregated snapshots; optimizer rewrites queries to the cheapest one.
- **UC governed** — permissions, lineage, audit.

## Position

"Genie answers and the dashboard draw from the same metric definition — no spreadsheet reconciliation." FSI: regulatory metrics match across reports. Retail: consistent revenue/margin across regions. Any "one number, many places" story.

## How It Works

A metric view is YAML, created with `CREATE VIEW ... WITH METRICS LANGUAGE YAML`. Four concepts:

- **`source`** — table, view, or SQL query for the base rows. Can bring in dimension tables via `joins` (star/snowflake; nested joins addressed with dot notation like `customer.nation.n_name`).
- **`dimensions`** — named GROUP BY attributes (`name` + SQL `expr`).
- **`measures`** — named aggregates (`name` + SQL `expr`): `SUM`, `COUNT`, `COUNT DISTINCT`, `FILTER`-clause aggregates, etc. A measure can reference another via `MEASURE(other)` to derive ratios.
- **`materialization`** *(optional)* — schedule pre-computed snapshots. **Aggregated** precomputes specific `(dimensions, measures)` combinations for the slices the dashboard actually draws; **unaggregated** materializes the full joined source. The optimizer picks the cheapest match automatically. Manual refresh: `REFRESH MATERIALIZED VIEW ...`.

**Querying:** measures must be wrapped in `MEASURE(...)`. No `SELECT *`. Dashboards and Genie apply `MEASURE(...)` automatically — you only write it for ad-hoc SQL.

```
silver (or gold) tables (facts + dims from SDP)  →  [Metric View]  →  Dashboard + Genie
```

## Example

Orders metric view with a snowflake join to customer → nation, a filtered aggregate, and a derived ratio:

```sql
CREATE OR REPLACE VIEW main.sales.orders_metrics
WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: SELECT * FROM main.sales.gold_orders
joins:
  - name: customer
    source: main.sales.gold_customers
    'on': o_custkey = c_custkey
    joins:
      - name: nation
        source: main.geo.dim_nation
        'on': c_nationkey = n_nationkey
filter: o_orderdate >= '2024-01-01'
dimensions:
  - {name: order_month,  expr: DATE_TRUNC('MONTH', o_orderdate)}
  - {name: order_status, expr: o_orderstatus, synonyms: [state]}
  - {name: customer_nation, expr: customer.nation.n_name, synonyms: [country]}
measures:
  - {name: order_count,       expr: COUNT(DISTINCT o_orderkey)}
  - {name: total_revenue,     expr: SUM(o_totalprice)}
  - {name: fulfilled_revenue, expr: SUM(o_totalprice) FILTER (WHERE o_orderstatus = 'F')}
  - {name: avg_order_value,   expr: MEASURE(total_revenue) / MEASURE(order_count)}
materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - {name: baseline, type: unaggregated}
    - name: monthly_by_country
      type: aggregated
      dimensions: [order_month, customer_nation]
      measures:   [order_count, total_revenue, avg_order_value]
$$;
```

Query (ad-hoc SQL — dashboards and Genie wrap `MEASURE()` for you):

```sql
SELECT order_month, customer_nation,
       MEASURE(total_revenue), MEASURE(avg_order_value)
FROM main.sales.orders_metrics
GROUP BY ALL;
```

## Demo Tips

- Create metric views from a **SQL query over silver/gold**, then point the dashboard at the view — that's the demo flow.
- **Sits between gold and consumers** — not a replacement for gold tables, a semantic wrapper.
- **One view, many widgets.** 5 dashboard tiles referencing different measures from the same view is the money shot.
- **Consistency story**: "Genie and Finance dashboard report the same number — both query this view."
- **Complex metrics story**: "This ratio aggregates correctly whether you slice by region, month, or segment."
- **Not always needed.** Simple `SUM(revenue)`? Gold table is fine. Metric Views earn their keep with ratios/filters/YoY or when multiple consumers must stay in sync.

## Implementation

`databricks-metric-views` Databricks Agent Skill (DAS) covers the build flow. Specs should state WHAT (metric names, dimensions, materialization targets) and WHY (demo story), not HOW.

## When to Include

- Multiple metrics with complex calculations (ratios, distinct counts, YoY).
- Consistency required across dashboards, Genie, external BI.
- Interactive dashboards on large facts (materialization wins here).
- Regulatory/compliance: auditable metric definitions.

## URL

https://docs.databricks.com/aws/en/business-semantics/metric-views/
