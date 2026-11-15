# 02 — Post-event analysis + plan forecast (src/gold/build_gold.py)

## gold_event_roi (one row per completed event) — PEA-2027 decomposition
1. gross incremental = Σ event weeks (actual − ML baseline)
2. post-event dip = Σ 4 post weeks (baseline − actual) — pantry loading
3. cannibalization = Σ event weeks (baseline − actual) over sister SKUs (same brand family, same retailer)
4. forward buy = units on deal in the deal window (week before + event weeks) − event POS units (off-invoice only)
5. trade spend = allowance/unit × (scanned units | units bought on deal) + fixed fees; `subsidised_baseline_usd`
   = allowance paid on baseline units
6. incremental gross profit = (gross − dip) × unit margin − cannibalized sister margin
7. net profit = incremental GP − trade spend; ROI = net profit ÷ trade spend; verdict Lost money / Marginal (< +15%) / Pays back

## gold_event_weekly
4 weeks before → event → 4 weeks after: actual vs baseline (promoted SKU and sisters), shipments, units on deal.

## gold_tactic_response
Retailer × tactic × funding: lift multiplier, dip ratio, cannibalization ratio, forward-buy ratio, ROI (ratio of sums).

## gold_plan_scenarios / gold_plan_forecast
For every planned event: as-planned + each alternative tactic (standard depth; scan-based settlement where the
account accepts it — ValuMax / BulkWise for non-BOGO). Forecast = ML baseline for the planned weeks × the
account's historical response (fallback: tactic average). Policy check (TPG-2027): depth ≤ 30% without an
exception, forecast ROI ≥ 0%. `recommended` = compliant scenario with the highest net profit.
`gold_plan_forecast.forecast_flag`: Money-losing (net < 0) / Below target (ROI < +15%) / On track.

## trade_promo_metrics (UC metric view)
Measures: Events, Trade Spend, Incremental Gross Profit, Net Profit, ROI, Volume Lift, Gross/Net Incremental
Units, Pantry Loading Share, Cannibalization Share, Forward Buy Units, Money Losing Events. Dimensions: Retailer,
Channel, Tactic, Funding Method, Brand, Product, Quarter, Event Start Week, Last 52 Weeks.
