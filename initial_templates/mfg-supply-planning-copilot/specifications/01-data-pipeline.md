# 01 — Data & planning pipeline

Catalog/schema: `manufacturing.supply_planning_copilot` (variables in `databricks.yml`). All dates are relative to
`AS_OF` = the Monday of the week the generator runs, so every run tells the story "from today".

## Raw tables (`data_generation/generate_data.py`, Spark / Databricks Connect)
| Table | Rows | Content |
|---|---|---|
| `plants` | 3 | Dayton OH (DAY), Monterrey MX (MTY), Wroclaw PL (WRO) |
| `products` | 10 | SG-250/400/600 servo gearmotors, SG-300 (Sunset in May), PG-60/90/120 gearboxes, LA-50/90 actuators, MC-10 controller; list price |
| `components` | 14 | HX-220 gear housing casting, EN-17 encoder, ST-40 stator, … standard cost + ABC class |
| `bom` | 54 | single-level BOM; every SG servo uses 1 × HX-220 |
| `suppliers` / `sourcing` | 12 / 29 | supplier × component × plant lanes: primary/alternate, price, lead time, capacity, MOQ, air-expedite offer, first-order setup cost |
| `transfer_lanes` | 6 | inter-plant lanes (MTY→DAY bonded truck 5 days, $2,900/truck of 800 + $2.40/unit) |
| `demand_history` | 1,248 | 104 weeks × SKU × plant: units ordered / shipped, order lines (fill rate) |
| `customer_orders` | 151 | open firm orders, next 9 weeks, customer tier A/B/C |
| `inventory_on_hand` | 28 | today's component stock per plant, safety stock, last receipt/issue |
| `purchase_orders` | 873 | 52 weeks RECEIVED (supplier OTD) + OPEN / IN_TRANSIT with promised vs revised ETA |
| `logistics_events` | 5 | Yantian berth closure (15 days ago), Kessler allocation, … |
| `supplier_messages` | 12 | raw supplier / forwarder emails |
| `sop_plan_decisions` | 0 | written by the app when a plan is booked |

## Planted signal
1. SG-400 demand at Dayton +46% since June (ramp over 4 weeks).
2. Yantian congestion: the three in-transit Nanhai HX-220 POs to Dayton slip +25 / +18 / +18 days.
3. HX-220 @ Dayton: 1,650 on hand vs ~670/week requirement → projected balance −372 (Oct 12 week) and −1,054 (Oct 19),
   2 weeks short, 6 weeks below the 1,320 safety stock. Peak 1,054 housings ≈ **$2.04M** of servo revenue.
4. Monterrey holds 2,600 HX-220 (+ ST-30, EN-17, GS-12, CB-08) left from the sunset SG-300: **obsolete**, $635K.
5. Kessler EN-17 allocation (70%) → Wroclaw 222 encoders short from Nov 23 ($301K).

## Planning layer (`src/gold/build_gold.py`, SQL warehouse via Statement Execution API)
`demand_forecast` (**AI_FORECAST**, 13 weeks per active SKU × plant) → `gold_demand_weekly` → `component_requirements`
(BOM explosion) → `inventory_projection` (balance at revised ETA and at promised date) → `stockout_exposures`
(first stock-out week, peak units short, revenue at risk, root cause) · `gold_inventory_health` (days of supply, E&O)
· `gold_fill_rate_weekly` · `gold_supplier_performance_monthly` · `gold_open_purchase_orders` · metric view
`mv_supply_performance` (fill rate, units, value).

## AI Functions (`src/ai/extract_signals.py`)
`ai_extract` v2.1 (typed schema + confidence) over `supplier_messages` → `supplier_signals`: event type, supplier,
component, PO numbers, added delay days, new ETA, offered quantity / unit cost, severity, one-line summary.
