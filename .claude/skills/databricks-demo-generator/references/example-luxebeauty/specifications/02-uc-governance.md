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

- Dashboard Operations page (KPI counters + category donut) → `mv_returns`.
- Genie headline answers ("return rate this month?", "revenue by region?") → `mv_returns`.
- Dashboard forecast widget → bypasses `mv_returns` (AI_FORECAST needs raw subquery), reads `gold_daily_summary` directly.
- Dashboard Investigation page + map + comments → reads `silver_returns` directly; per-product / per-lot rollups via widget `GROUP BY` (counts, not rates — no per-product/per-lot gold tables in this demo).

> The premium classifier (`03-ml-premium.md`) does **not** consume `mv_returns`. It trains directly on `gold_customer_features` — a *per-customer* view of lifetime spend, tenure, return history, anger score, plus the `premium_status` label CS hand-set on a ~4K subset. `mv_returns` is *daily operational metrics*; the model is *per-customer behavior*. Two different things; do not try to unify them.

### Validation

- `MEASURE(return_rate)` weekly slice: peak ~0.24, baseline ~0.08.
- Dashboard Monthly Return Rate KPI = Genie answer to "return rate this month" (same definition).
- `DESCRIBE EXTENDED` shows the `(date, region, category)` aggregated materialization.

Add `metric_view_name` to `resources.json`.
