# Analytics & Dashboard Pages

The app has **two distinct pages** in the sidebar — both surface analytics, but for different reasons. Keep both unless the build skipped the AI/BI dashboard entirely.

## Analytics page (`/analytics`)

Warehouse-backed charts at lakehouse scale, rendered natively in the app via `@databricks/appkit-ui/react` (`BarChart`, `LineChart`, `DataTable`). Header shows the warehouse name + state — visibly not static mocks. Queries live in `config/queries/*.sql` and are typed at build time by AppKit.

**Why it exists alongside the AI/BI Dashboard:** this is the *in-app* analytics surface — designed for the operator who's already in the Returns Console and wants to spot patterns without context-switching to a separate tool. Same SQL warehouse underneath; different UX.

### LuxeBeauty layout

**Top row:** Daily refund trend (line chart, full width) — `total_refund_usd` by day, 30 days. Baseline ~$8–10K/day, peak ~$25K/day 3 weeks ago, decaying. The spike that started everything.

**Second row:** Returns by product (bar chart, left) — top 10 by return count + refund $. SKU-1001 / 1002 / 1003 dominate 3–4x. | Worst lots (table, right) — lot ID, facility, return count, return rate %. Lyon lot at ~30% vs ~8% baseline.

**Third row:** Facility drill-down (full width) — dropdown picks facility (Lyon, Milan, Singapore) → lots ranked by return rate as horizontal bars. Click a lot → Operations pre-filtered by that lot.

### LuxeBeauty queries

- `daily_refund_trend` — returns by date, total_refund_usd, 30 days, from `gold_returns`.
- `returns_by_product` — top 10 products by return_count + total_refund_usd, from `gold_returns`.
- `worst_lots` — `lot_id`, `product_name`, `facility`, `return_count`, `return_rate`, `incident_summary`. Reads `gold_product_lot_quality` directly — that's the small drill-down table the synth script produces (see `01-lakeflow.md`). Clicking a row → Operations pre-filtered by that lot.

> The Simple demo keeps a tiny `gold_product_lot_quality` table (one row per affected (product, lot)) **specifically** so the Analytics page and Genie can hop from "this lot is bad" to "and here's why" in a single SELECT. Without that table the drill-down would need a 3-way join at query time. The full demo's SDP pipeline produces a larger version; we keep ours minimal.

The template ships a working version of this page — tune the SQL and labels to your demo's data, don't rebuild from scratch.

## Dashboard page (`/dashboard`)

Embed the AI/BI dashboard already built in `04-ai-bi.md` (Section B) as a full-page iframe with SSO. Look up `dashboard_id` in `resources.json` and wire it into `config.dashboardId` — do **not** rebuild the dashboard, just point at the existing one. Filters and drill-downs work natively. Remove this page entirely if the build skipped the dashboard.

**Why it exists alongside the in-app Analytics page:** this proves a published AI/BI dashboard can live inside a custom app — same SSO, same data, no chart rebuilding in React. The "build vs. buy" answer for richer visuals.
