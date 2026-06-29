# UC Governance — Metric View

Tables defined in `01-lakeflow.md`. Skill: `databricks-metric-views`.

## Metric View — `mv_returns`

Source: `gold_daily_summary`. Single view, aggregated materialization.

**Dimensions**: `date`, `region`, `category`.

**Measures** (full list — referenced verbatim by dashboard datasets + Genie example SQLs, so any rename here is a breaking change downstream):

| Name | Expression |
|------|------------|
| `total_revenue` | `SUM(revenue_usd)` |
| `total_refunds` | `SUM(returns_usd)` |
| `order_count` | `SUM(order_count)` |
| `return_count` | `SUM(return_count)` |
| `return_rate` | `SUM(return_count) / NULLIF(SUM(order_count), 0)` |
| `refund_rate` | `SUM(returns_usd) / NULLIF(SUM(revenue_usd), 0)` |

Ratio measures use `SUM(...) / NULLIF(SUM(...), 0)` directly — NOT `MEASURE(x) / MEASURE(y)` — so the engine computes the ratio at the filtered-slice level (correct under any global dashboard filter) and avoids div-by-zero on empty slices.

**Materialization**: aggregated on `(date, region, category) × all measures`, refresh every 6h.

### Consumers

Dashboard KPI tiles + category donut + forecast read from `mv_returns` via `MEASURE(...)`. Genie's headline answers (`return_rate`, `refund_rate`, revenue, returns) come from the same view. Per-widget bindings live in `04-ai-bi.md`.

The dashboard currently renders Refunds / Returns / Orders / **Revenue** as the four KPI tiles. `return_rate` and `refund_rate` are defined here but not pinned to a tile — they're still available to Genie as proper measures (and any future widget that wants to read them).

> The premium classifier (`03-ml-premium.md`) does **not** consume `mv_returns`. It trains on `gold_customer_features` (per-customer behavior). `mv_returns` is daily operational metrics — different grain, do not unify.

### Validation

- `MEASURE(return_rate)` weekly slice: peak ~0.24, baseline ~0.08.
- `MEASURE(refund_rate)` over full window: ~0.06 (≈6% — total refunds / total revenue).
- Genie's answer to "what's our return rate this month?" matches `MEASURE(return_rate)` exactly.
- `DESCRIBE EXTENDED` shows the `(date, region, category)` aggregated materialization.

Add `metric_view_name` to `resources.json`.
