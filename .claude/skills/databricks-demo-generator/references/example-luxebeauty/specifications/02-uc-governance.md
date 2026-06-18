# UC Governance — Metric View

Tables defined in `01-lakeflow.md`. Skill: `databricks-metric-views`.

## Metric View — `mv_returns`

Source: `gold_daily_summary`. Single view, aggregated materialization.

**Dimensions**: `date`, `region`, `category`.

**Measures**:

| Name | Expression |
|------|------------|
| `total_revenue` | `SUM(revenue_usd)` |
| `total_refunds` | `SUM(returns_usd)` |
| `order_count` | `SUM(order_count)` |
| `return_count` | `SUM(return_count)` |
| `return_rate` | `MEASURE(return_count) / MEASURE(order_count)` |
| `refund_rate` | `MEASURE(total_refunds) / MEASURE(total_revenue)` |

**Materialization**: aggregated on `(date, region, category) × all measures`, refresh every 6h.

### Consumers

Dashboard KPIs + category donut, and Genie's headline answers. Same definitions on both surfaces — numbers match exactly. Per-widget sourcing lives in `04-ai-bi.md`.

> The premium classifier (`03-ml-premium.md`) does **not** consume `mv_returns`. It trains on `gold_customer_features` (per-customer behavior). `mv_returns` is daily operational metrics — different grain, do not unify.

### Validation

- `MEASURE(return_rate)` weekly slice: peak ~0.24, baseline ~0.08.
- Dashboard Monthly Return Rate KPI = Genie answer to "return rate this month" (same definition).
- `DESCRIBE EXTENDED` shows the `(date, region, category)` aggregated materialization.

Add `metric_view_name` to `resources.json`.
