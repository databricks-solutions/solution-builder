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

- Dashboard Row 1 (KPI tiles) + Row 2 returns trend + Row 3 revenue charts → `mv_returns`.
- Genie headline answers ("return rate this month?", "revenue by region?") → `mv_returns`.
- Lot / SKU investigation → unchanged, reads `gold_returns_by_lot` / `gold_returns_by_product` / `silver_returns` directly.

### Validation

- `MEASURE(return_rate)` weekly slice: peak ~0.24, baseline ~0.08.
- Dashboard Monthly Return Rate KPI = Genie answer to "return rate this month" (same definition).
- `DESCRIBE EXTENDED` shows the `(date, region, category)` aggregated materialization.

Add `metric_view_name` to `resources.json`.
