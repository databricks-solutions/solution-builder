# 02 — Avails forecast (ai_forecast) + gold layer

`src/forecast/forecast_avails.py` runs `AI_FORECAST` on the SQL warehouse (Statement Execution API) over
`inventory_daily` (daily avails per product, full history) with horizon today+75 → `gold_avails_forecast`
(point forecast + prediction interval).

`src/gold/build_gold.py` (serverless Spark):
- `gold_inventory_daily` — sell-through, eCPM, programmatic eCPM per product-day
- `gold_monthly_yield` — month x platform x tier
- `gold_line_pacing` — delivered vs expected-to-date (linear plan), 14-day run-rate, projected = delivered + run-rate x remaining days
- `gold_campaign_pacing` — at_risk = live and projected < 95% of the guarantee; make_good_liability = shortfall x booked CPM
- `gold_spare_avails` — forecast x 0.95 − committed guaranteed run-rate; displaced programmatic eCPM (28 d)
- `gold_yield_opportunities` — group_mismatch, revenue_gap_28d = PMP imps x (open clearing x fill retention − PMP eCPM), fill retention = min(0.9, 1 − 0.5^bids per request)
- `gold_make_goods`, metric view `mv_ad_yield`
