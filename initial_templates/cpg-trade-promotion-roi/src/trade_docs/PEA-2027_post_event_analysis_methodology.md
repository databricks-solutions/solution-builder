# Crestwood Snacks Co. — Post-Event Analysis Methodology (PEA-2027)

Owner: Revenue Growth Management analytics · Companion to TPG-2027 · Data: retailer POS sell-out (weekly, by SKU), Crestwood shipments (sell-in), TPM event records.

## 1. Why a post-event analysis
A promotion's volume spike is not its value. The shopper who buys four bags during a BOGO does not buy any in the following weeks (pantry loading); the bag of Kettle Sea Salt bought on deal is often one fewer bag of Kettle Jalapeno (cannibalization); and an off-invoice deal lets the retailer buy cases at deal price that it will sell later at full price (forward buying). PEA-2027 nets these out.

## 2. Baseline
- The **baseline** is what would have sold without the promotion. It is produced by the **ML baseline demand model** `baseline_demand_model@champion` (Unity Catalog), a gradient-boosted model trained only on *clean* weeks: no promotion on the SKU, outside any 4-week post-event window, and not a sister SKU during another SKU's event.
- Features: retailer, SKU, seasonality (week of year), snack holidays (Big Game, Memorial Day, July 4th, Labor Day, Thanksgiving, New Year) and trend.
- Accuracy on the 16-week holdout: about 4% MAPE, versus about 16% for a simple average baseline. The model is retrained each quarter.
- Do not use "average of the 4 weeks before the event" as a baseline: it is biased by holidays and by the previous event's hangover.

## 3. The decomposition
For each completed event:
1. **Gross incremental units** = actual units during the event − baseline units during the event.
2. **Post-event dip (pantry loading)** = Σ over the 4 weeks after the event of (baseline − actual) for the promoted SKU.
3. **Cannibalization** = Σ over the event weeks of (baseline − actual) for the sister SKUs of the same brand family at the same retailer (Crestwood Kettle; Crestwood Classic; Ridgeline Tortilla).
4. **Forward buy** (off-invoice accounts only) = units the retailer bought on deal during the deal window (the week before + the event weeks) − units the shopper bought during the event.
5. **Net incremental units** = gross incremental − post-event dip − cannibalization.
6. **Trade spend** = allowance per unit × units paid (scanned units for scan-based settlement; all units bought on deal for off-invoice) + fixed fees. The part of the allowance paid on baseline units is reported as the **subsidised baseline**.
7. **Incremental gross profit** = (gross incremental − dip) × unit contribution margin − cannibalized units × the sister SKUs' margin.
8. **Net profit** = incremental gross profit − trade spend; **ROI** = net profit ÷ trade spend.

## 4. Verdicts
- **Lost money**: net profit < 0.
- **Marginal**: ROI between 0% and +15%.
- **Pays back**: ROI ≥ +15%.

## 5. Forecasting a planned event
A planned event is forecast with the same decomposition: the ML baseline for the planned weeks × the account's historical response to that tactic (lift multiplier, dip ratio, cannibalization ratio, forward-buy ratio for off-invoice settlement), at the planned depth, funding share and fees. The forecast is only as good as the history: tactics with fewer than 3 historical events at the account fall back to the channel average and are marked as low-confidence.

## 6. Interpreting the numbers
- A high volume lift with a negative ROI is the classic signature of a deep discount at a stock-up account: the lift is borrowed from future weeks and from sister SKUs, and the allowance is paid on the baseline.
- Compare tactics at the same account, not across accounts: channel mix drives lift.
