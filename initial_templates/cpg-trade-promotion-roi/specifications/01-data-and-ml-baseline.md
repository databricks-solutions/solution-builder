# 01 — Data + ML baseline

## Silver (data_generation/generate_data.py, seeded, relative to "now")
| Table | Grain | Notes |
|---|---|---|
| `retailers` | 5 accounts | channel, stores, `default_funding_method` (ValuMax + BulkWise off-invoice), JBP minimum events/quarter, feature/display fees |
| `products` | 10 SKUs | brand, `brand_family` (Kettle / Classic / Ridgeline = cannibalization groups), SRP, list price (64% of SRP), COGS (20%), unit contribution margin |
| `calendar_weeks` | 117 weeks | 104 history weeks (ending last week) + 13 plan weeks; snack holidays (Big Game, Memorial Day, July 4th, Labor Day, Thanksgiving, New Year) |
| `promo_events` | ~160 completed events | tactic (BOGO / Feature + Display / TPR / Multi-buy), depth, feature/display, funding method, funding share, allowance per unit, fixed fees |
| `pos_weekly_sales` | retailer × SKU × week (~4.6K rows) | retailer POS sell-out: units, dollars, shelf price, promo flag, event id |
| `retailer_shipments` | retailer × SKU × week | Crestwood sell-in; `units_on_deal` = units invoiced at deal price (forward buying shows up here) |
| `promo_plan` | 26 planned events | next quarter's draft calendar (tactic, depth, funding, fees, planner note) |

Generation model: baseline = SKU base × retailer scale × seasonality × holiday × trend × lognormal(3%) noise.
Events add a tactic × retailer lift, then remove a pantry-loading dip over the 4 post weeks, cannibalize
sister SKUs of the same brand family during the event, and (off-invoice only) add a forward buy to the
retailer's deal-window shipments.

**Planted signal** — ValuMax Stores' deep BOGO events (50% effective, off-invoice): lift ~3.4× (+240%), pantry
loading ~36% of the lift, cannibalization ~24%, forward buy ~31% of event volume → ROI ≈ −63% (11 events,
≈ $818K trade spend, ≈ −$514K net). Feature + Display at a 22% TPR settled scan-based pays back everywhere
(ValuMax ≈ +35%). The draft plan repeats four ValuMax BOGOs (PL-001..PL-004).

## ML baseline (src/ml/train_baseline_model.py)
- Training rows: CLEAN weeks only (no promotion on the SKU, not in a 4-week post-event window, not a sister
  SKU during another event).
- Features: retailer, SKU, holiday (one-hot), week-of-year sin/cos (1st + 2nd harmonic), trend.
- Model: `TransformedTargetRegressor(log1p)` over `GradientBoostingRegressor(600 trees, depth 4, lr 0.05)`.
- Holdout = last 16 clean weeks: MAPE ≈ 3.9% vs ≈ 15.8% WAPE for a naive retailer×SKU mean (logged to MLflow).
- Registered: `<catalog>.<schema>.baseline_demand_model`, alias `@champion`; scores every retailer × SKU × week
  (history + plan) into `baseline_forecast`.
