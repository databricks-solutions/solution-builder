# Analytics & Dashboard Pages

The app has **two distinct pages** in the sidebar — both surface analytics, but for different reasons. Keep both unless the demo explicitly skips dashboards.

## Analytics page (`/analytics`)

Warehouse-backed charts at lakehouse scale, rendered natively in the app via `@databricks/appkit-ui/react` (`BarChart`, `LineChart`, `DataTable`). Header shows the warehouse name + state — visibly not static mocks. Queries live in `config/queries/*.sql` and are typed at build time by AppKit.

**Why it exists alongside the AI/BI Dashboard:** this is the *in-app* analytics surface — designed for the operator who's already in the Returns Console and wants to spot patterns without context-switching to a separate tool. Same SQL warehouse underneath; different UX.

### LuxeBeauty layout

**Top row:** Daily refund trend (line chart, full width) — `total_refund_usd` by day, 30 days. Baseline ~$8-10K/day, peak ~$25K/day 3 weeks ago, decaying. The spike that started everything.

**Second row:** Returns by product (bar chart, left) — top 10 by return count + refund $. SKU-1001/1002/1003 dominate 3-4×. | Worst lots (table, right) — lot ID, product, facility, return count, total refund $. The Lyon affected lot tops the list by an order of magnitude.

**Third row:** Facility drill-down (full width) — dropdown picks facility (Lyon, Milan, Singapore) → lots ranked by return count as horizontal bars. Click lot → Operations pre-filtered by that lot.

### LuxeBeauty queries

- `daily_refund_trend` — `SUM(refund_amount_usd)` by `return_date`, 30 days, from `silver_returns`.
- `returns_by_product` — top 10 by `COUNT(return_id)` + `SUM(refund_amount_usd)`, GROUP BY `product_name`, from `silver_returns`.
- `worst_lots` — `lot_id`, `product_name`, `facility`, `COUNT(*)` AS `return_count`, `SUM(refund_amount_usd)` AS `total_refund_usd` from `silver_returns`, GROUP BY 1,2,3, ORDER BY `return_count` DESC LIMIT 20. The Lyon affected lot tops the list by an order of magnitude. Click a row → Operations pre-filtered by that lot.

> No per-product / per-lot gold tables in this demo — rollups computed at widget query time via `GROUP BY` on `silver_returns` (small + fast for ~25K rows). The same trade as the dashboard's Investigation page: count, not rate.

The template ships a working version of this page — tune the SQL and labels to your demo's data, don't rebuild from scratch.

## Dashboard page (`/dashboard`)

Embed the AI/BI dashboard already built in `04-ai-bi.md` (Section B) as a full-page iframe with SSO. Look up `dashboard_id` in `resources.json` and wire it into `config.dashboardId` — do **not** rebuild the dashboard, just point at the existing one. Filters and drill-downs work natively. Remove the page entirely if the demo has no dashboard.

**Why it exists alongside the in-app Analytics page:** this proves a published AI/BI dashboard can live inside a custom app — same SSO, same data, no chart rebuilding in React. The "build vs buy" answer for richer visuals.
