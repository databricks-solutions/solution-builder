# AI/BI — Dashboard + Genie (built live via Genie Code)

> **Workshop contract.** After the pipeline is built, the SA creates the AI/BI dashboard and the
> Genie space live with Genie Code (the "Dashboard & Genie" page of `workshop.html`). Everything
> reads the gold tables `gold_returns` + `gold_daily_summary` from `01-lakeflow.md` and, for the
> punchline, `silver_production_lots`.

---

## A. Dashboard

**Datasets** (SQL over the gold layer):

| Dataset | Source | Powers | Filter note |
|---|---|---|---|
| `ds_daily` | `gold_daily_summary` | KPI counters, category donut, orders-by-region area | global Date/Region/Category |
| `ds_returns` | `gold_returns` (+ derived `source` = 'Affected lot' if `is_bad_lot` else 'Everyday') | map, country/reason splits, sentiment, city table, comments | global Date/Region/Category/Source |
| `ds_forecast` | weekly `SUM(refund_amount_usd)` from `gold_returns` + `AI_FORECAST` band | trend-line chart | **stays UNFILTERED** (do NOT bind the global Date filter) |
| `ds_sankey_flow` | `gold_returns` category → product → lot | sankey | global Date/Region/Category |

**Page 1 — Operations (spot the spike):**
- 4 KPI counters (`ds_daily`): refunds $, return count, orders, revenue.
- Forecast-line trend of weekly refunds (`ds_forecast`) — **peak ~3 weeks in the
  PAST with a decay tail, not pinned at the right edge**.
- Orders-by-region area chart (`ds_daily`).
- Stacked country bar of refunds (`ds_returns`).
- Symbol map on `customer_lat`/`customer_lng` (`ds_returns`), bubble size =
  distinct customers, color = refund $ — **Paris among the largest bubbles**
  (close to London; check the actual ranking).
- Category donut of returns $ (`ds_daily`) — **Skincare dominates**.

**Page 2 — Investigation (drill to the lot):**
- Sankey (`ds_sankey_flow`): category → product → lot — **collapses to Skincare →
  3 SKUs → 1 lot**.
- Grouped bars: Affected-lot vs Everyday by country + by reason (`ds_returns`).
- Sentiment bar bucketed from `anger_score` (`ds_returns`) — leans angry.
- City table: city, country, returns, refund $ (`ds_returns`).
- Comments table sorted by `anger_score` (`ds_returns`) — surfaces the texture
  complaints.

Global filters: Date / Region / Category / Source (Source = affected vs everyday).

**Story shape the widgets must show:** refunds peak **in the past** with a decay tail (never
pinned to the right edge); Paris among the biggest map bubbles (close to London — check, don't
assume); Skincare dominating the donut; the sankey collapsing Category → 3 SKUs → 1 lot.

---

## B. Genie space

**Name:** `LuxeBeauty Operations Analytics`

**Attach:** `gold_daily_summary`, `gold_returns`, `silver_production_lots` (for
`incident_summary`); later pages add `mv_returns` (`02-uc-governance.md`) and
`customer_premium_predictions` (`03-ml-premium-classifier.md`).
Do NOT attach `products` / `customers` — they are Volume files, not UC tables;
names and geography already live in `gold_returns`.

**Instruction text:**
```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).
BASELINES: normal weekly returns ~$30K, normal return rate ~8%, anomaly well above that.
INVESTIGATION FLOW for "Why so many returns?":
  1. gold_daily_summary → SUM(returns_usd) by week → spot the ~4-5x spike
  2. gold_returns → GROUP BY product_id ORDER BY COUNT(*) DESC → SKU-1001/1002/1003
  3. gold_returns WHERE product_id IN (those) GROUP BY lot_id → one lot dominates
  4. gold_returns → customer_comment WHERE lot_id = affected → texture complaints
  5. silver_production_lots → incident_summary WHERE lot_id = affected → PUNCHLINE
CUSTOMER FEEDBACK (affected lot): "grainy texture" / "product separated" /
  "consistency is watery" / "texture feels off"
```

**Sample questions (chips, in arc order):**
1. What's our return rate this month, and how does it compare to baseline?
2. Why do I have so many returns? Trace it to the products and the lot.
3. Which production lot is driving the spike, and what does the QC note say?
4. What are customers saying? Show recent affected-lot comments.
5. Where are the affected customers? Group by country.
6. Are refunds recovering? Show the trend.

**Curated SQL for question 3** (the load-bearing cross-table join — the punchline):
```sql
WITH top_lot AS (
  SELECT lot_id, COUNT(*) n FROM gold_returns
  WHERE product_id IN ('SKU-1001','SKU-1002','SKU-1003')
  GROUP BY 1 ORDER BY n DESC LIMIT 1
)
SELECT l.lot_id, l.facility, l.production_date, l.status, l.incident_summary
FROM silver_production_lots l JOIN top_lot t ON t.lot_id = l.lot_id;
```

**The demo lands** when question 3 makes Genie hop to `silver_production_lots`
and quote the homogenizer / pressure / Lyon / released note inline. Certify the space only
after those answers are checked.
