# Analytics & Dashboard Pages

## Analytics page

Warehouse-backed charts at lakehouse scale. Header shows warehouse indicator (name + state) — visibly not static mocks. Queries live in `config/queries/*.sql`.

**Top row:** Daily refund trend (line chart, full width) — total_refund_usd by day, 30 days. Baseline ~$8-10K/day, peak ~$25K/day 3 weeks ago, decaying. The spike that started everything.

**Second row:** Returns by product (bar chart, left) — top 10 by return count + refund $. SKU-1001/1002/1003 dominate 3-4x. | Worst lots (table, right) — lot ID, facility, return count, return rate %. Lyon lot at ~30% vs ~8% baseline.

**Third row:** Facility drill-down (full width) — dropdown picks facility (Lyon, Milan, Singapore) → lots ranked by return rate as horizontal bars. Click lot → Operations pre-filtered by that lot.

### LuxeBeauty queries

- `daily_refund_trend` — returns by date, total_refund_usd, 30 days
- `returns_by_product` — top 10 products by return_count + total_refund_usd
- `worst_lots` — lot_id, facility, return_count, return_rate %. From gold_returns_by_lot

## Dashboard page

Embedded AI/BI dashboard as full-page iframe with SSO. References `config.dashboardId`. Fully interactive — filters, drill-downs work. No extra login, no chart rebuilding in React. Remove page if demo has no dashboard.
