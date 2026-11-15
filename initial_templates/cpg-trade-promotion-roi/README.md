# Crestwood Snacks Co. — Trade Promo Copilot (post-event ROI + promo re-planning)

> **The BOGO that tripled volume lost 63 cents on every trade dollar. The copilot shows why, re-plans next quarter and writes the plan back.**

Crestwood Snacks Co. (fictional) is a salty-snacks CPG: Crestwood Kettle, Crestwood Classic, Ridgeline Tortilla,
Twistwell Pretzels and a Variety pack, sold through five retail accounts: **ValuMax Stores** (Mass, 1,850 stores,
off-invoice trade funding, a Joint Business Plan), **Greenleaf Market** and **Harbor Fresh Grocers** (Grocery,
scan-based), **QuickPantry** (Convenience) and **BulkWise Club** (Club). Trade spend is its second-largest cost after COGS.

This demo is the Revenue Growth Management (RGM) workbench, built on Databricks:

- **ML baseline** — a gradient-boosted `baseline_demand_model@champion` in Unity Catalog, trained only on clean
  (non-promoted, non-hangover) weeks, predicts what every SKU sells at every retailer *without* a promotion
  (≈ 3.9% holdout MAPE vs ≈ 15.8% for a naive average).
- **Post-event analysis** — every completed promotion of the last two years is measured against that baseline and
  netted for **pantry loading** (the dip in the 4 weeks after), **cannibalization** of sister SKUs and **forward
  buying** on off-invoice deals → true ROI = (incremental gross profit − trade spend) ÷ trade spend.
- **Plan forecast** — next quarter's 26-event draft calendar is forecast event by event (ML baseline × the
  retailer's historical response) with re-plan scenarios checked against the trade promotion guidelines.
- **Trade Promo Copilot** (Databricks App on Lakebase) — an agent flags the money-losing events with evidence,
  checks the policy and the ValuMax JBP through the **Genie agent** (it searches the policy documents), proposes a compliant re-plan, and after
  approval **writes the approved plan back to Lakebase**. Finance follows trade spend vs ROI in an **AI/BI
  dashboard** and asks ad-hoc questions in the same **Genie agent**.

**How this differs from the other demos in this set**: demand-forecasting, ReStock
Radar, Supply-Chain Control Tower and Store Intelligence are about *supply and stores*; this one is about
**trade spend on the manufacturer side** — margin vs volume — and goes past a report to a governed re-plan written
back into the planning system.

## The story (planted in the data)

- **ValuMax BOGOs look like the best events of the year.** 11 deep BOGO events (50% effective) over two years
  lifted volume **+240%** vs the ML baseline. The KAM's recap memo calls them "our biggest volume driver".
- **They lost money — ROI −62.9%, −$514K net on $818K of trade spend.** The lift was:
  - **borrowed from the future**: a pantry-loading dip of **35.6%** of the lift in the 4 weeks after;
  - **stolen from sister SKUs**: Kettle Jalapeño / Honey BBQ / Family size and Classic lose **24.5%** of the lift;
  - **bought ahead by the retailer**: off-invoice funding let ValuMax buy **186.6K units** on deal beyond what
    shoppers bought (31% of event volume) and sell them later at full price;
  - and the 50% allowance is paid on every **baseline unit** that would have sold anyway.
- **What pays back at the same retailer:** Feature + Display at a 22% TPR, settled **scan-based**: ROI **+35.4%**.
- **Next quarter's draft still has 4 ValuMax BOGOs** (PL-001 Kettle Sea Salt 8 oz, PL-002 Classic Original,
  PL-003 Kettle Family 13 oz, PL-004 Ridgeline Tortilla): forecast **−$176.7K** combined.
- **The re-plan** keeps all 7 ValuMax events (JBP minimum 6/quarter), switches the 4 BOGOs to Feature + Display
  22% TPR scan-based (JBP §3 allows scan-down for display events; 2 → 6 endcaps, up to 8 slots) →
  **+$91.5K forecast net profit (a ≈ $268K swing), ≈ $183K less trade spend, and ≈ 12% MORE net volume after the dip**.

## Personas

| Persona | Role | Surface |
|---|---|---|
| **Elena Marsh**, Director of Revenue Growth Management | owns the promo calendar and trade ROI | Trade Promo Copilot app |
| **Tom Becker**, Key Account Manager ValuMax | negotiates the calendar with the buyer | app (Approved re-plans → retailer notices) |
| Finance / VP Sales | trade spend vs ROI | AI/BI dashboard + Genie |

## Demo script (≈ 8 minutes) — exact clicks

**Before you start:** click **Reset the demo with Lakebase Branching** in the app header (clears conversations and
decisions, re-syncs the calendar from Delta).

1. **Open the app → Promo calendar.** The page is the calendar itself (retailer × week, cream + tomato-red shelf look); the headline reads *"4 planned promotions will lose $176.7K — and they're the ones with the
   biggest volume."* Scoreboard strip: planned trade spend, forecast net profit, **4 money-losing events**, re-plan upside $0.
   The 13-week × retailer calendar shows four red **BOGO** chips on the ValuMax row.
2. **Click the red PL-001 chip** (Kettle Sea Salt 8 oz BOGO). The drawer shows the forecast: ML baseline vs
   forecast units, trade spend ≈ $81.2K, net profit ≈ **−$52.5K**, ROI ≈ −64.6%; "where the lift goes" (net vs
   pantry loading vs cannibalization) and the forward-buy warning; the re-plan options table with the
   **Recommended** Feature + Display 22% TPR scan-based (≈ +$24.7K, ROI ≈ +81%). Click **Past BOGO events at
   ValuMax Stores**.
3. **Post-event analysis** opens filtered on ValuMax × BOGO: 11 events, lift +240%, pantry loading 36%,
   cannibalization 25%, net profit ≈ −$514K. Click the worst event → its weekly curve: the spike, then actual
   falls under the dashed ML baseline for 4 weeks (red dip area).
4. **Back on the calendar, click the "Ask the copilot" button "Which events will lose money?"** The copilot calls
   `get_promo_calendar` and `get_post_event_analysis` (visible in the Thinking panel) and answers: 4 money-losing
   events (PL-001..PL-004, ≈ −$176.7K forecast), all ValuMax BOGOs, with the evidence (lift +240%, pantry loading
   ≈ 36%, cannibalization ≈ 25%, forward buy ≈ 187K units, ROI −62.9%) vs Feature + Display scan-based ≈ +35%.
5. **Chip "Re-plan them"** ("Propose a re-plan for the money-losing events that keeps our ValuMax JBP commitments…").
   The copilot calls `get_replan_options` and `ask_data` (the Genie agent, citing JBP-VALUMAX-FY27 §2 = 6
   events + 2 displays per quarter, §3 scan-down for display events, 4-week notice) and returns a table: each BOGO →
   Feature + Display 22% TPR scan-based, net profit before → after, ROI, volume kept; totals ≈ **+$268K swing**,
   trade spend down ≈ $183K, net volume up ≈ 12%. It **stops and asks for approval**.
6. **Chip "Approve the re-plan"** ("Approved — apply the re-plan."). The copilot calls `approve_replan`: four
   Lakebase transactions → decisions **RP-3001..RP-3004** with the retailer notices. The calendar chips turn green
   with a check; headline reads *"Re-plan approved: +$268.2K of forecast profit recovered."*
7. **Approved re-plans** in the sidebar: the four decisions with before/after net profit, ROI, trade spend, volume and
   the buyer notice text. (A planner can also re-plan or **Revert** any event from its calendar drawer.)
8. **Trade ROI dashboard** (embedded AI/BI): page 1 — KPIs for the last 2 years, the *volume lift vs ROI* scatter
   (BOGO dots top-right in volume, bottom in ROI), ROI by tactic × retailer, where the lift goes; page 2 — next
   quarter's plan with as-planned vs recommended for the 4 money-losing events.
9. **Genie** ("Crestwood - Trade Promotion ROI"). Ask:
   - "Which promotions lost money in the last 52 weeks?" → ValuMax BOGO: 4 events, −$155.1K (ROI −59.5%) first.
   - "How big were the pantry-loading dip and cannibalization after ValuMax BOGO events?" → 35.6% / 24.5% of the lift.
   - "Which planned events next quarter are forecast to lose money?" → PL-001..PL-004.

**Talk track:** *one governed platform from retailer POS to an approved plan: Unity Catalog → a UC-registered ML
baseline → post-event ROI in gold + a metric view → a Genie agent over the gold tables and the trade policy documents → an agent that writes
the re-plan back into Lakebase, traced in MLflow — with the same numbers in the dashboard and Genie.*

## Files

```
manifest.json · README.md · resources.json · architecture.md · databricks.yml · dab_instructions.md
data_generation/generate_data.py          synthetic POS / shipments / events / plan (seeded, relative to "now")
src/ml/train_baseline_model.py            clean-week GBR baseline → UC @champion → baseline_forecast
src/gold/build_gold.py                    post-event ROI, weekly curves, tactic response, plan scenarios, metric view
src/trade_docs/*.md                       TPG-2027, PEA-2027, ValuMax JBP, trade terms, BOGO recap memo
src/deploy/*.py
genie/genie_space.json                    serialized-v2 Genie space (tables sorted)
dashboard/trade_promotion_roi.lvdash.json (+ build_dashboard.py)   schema-less datasets
app/                                      Trade Promo Copilot (fork of the Solution Builder app template)
specifications/01..03-*.md
```
