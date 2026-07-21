# Lakeflow — Data Generation + Medallion Build

## Shared Context

**Demo:** AI/BI Supply Chain Optimization — an e-bike manufacturer is about to run
out of the shared **Battery Cell**. A new EMEA market launch on **2026-04-20** drove
a City E-Bike demand surge that, rolled through the bill of materials, is draining
the Battery Cell faster than its supplier's **8-week lead time** can replenish it.
Every downstream consumer (dashboard, Genie) reads the gold tables `demand_enriched`
and `component_status` and the governed metric view `metrics_demand`.

**Target:** `{{CATALOG}}.{{SCHEMA}}` (defaults `dbdemos_templates.aibi_supply_chain`).

**Build shape (no SDP pipeline).** A single self-contained Spark script
(`data_generation/generate_data.py`) generates raw data *and* builds the full
medallion in four phases: RAW → SILVER (typed + constrained) → GOLD (enriched +
supply-risk) → METRICS (metric view). It runs unchanged in a Databricks notebook
(ambient Spark, catalog/schema from CLI args) or locally via Databricks Connect
serverless (catalog/schema from args or env). No parquet round-trip, no Faker — pure
Spark expressions plus one `pandas_udf` for the weekly demand grid, so it runs on
serverless.

**Temporal anchors (load-bearing — every consumer depends on them):**
- Data window: **2024-06-03 → 2026-06-01** (weekly, Mondays; ends on a clean week boundary).
- **City E-Bike EMEA market launch: 2026-04-20** — the surge start the whole story turns on.
- The demand surge ramps over ~6 weeks after the launch, EMEA only.

---

## A. Data Generation Script

### Raw tables (dimensions + operational + fact)

**Dimensions** (curated, realistic values):

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `products` | finished product | `product_id`, `product_name`, `category` | 5 e-bikes: City / Cargo / Folding E-Bike, E-Scooter, E-Moped |
| `distribution_centers` | DC | `dc_id`, `dc_name`, `region`, `country`, `country_code`, `latitude`, `longitude` | 8 DCs across EMEA / AMER / APAC, real-ish lat/long for the map |
| `market_launches` | launch event | `launch_id`, `product_name`, `region`, `launch_date`, `launch_name`, `description` | The **City E-Bike EMEA launch (2026-04-20)** — the root cause Genie points to |
| `suppliers` | supplier | `supplier_id`, `supplier_name`, `region`, `lead_time_weeks`, `reliability_pct` | PowerCell Industries (Battery Cell) has the **8-week lead time** — the constraint |
| `components` | component | `component_id`, `component_name`, `component_type`, `supplier_id`, `unit_cost` | 6 components; Battery Cell is used by every product |
| `plants` | assembly plant | `plant_id`, `plant_name`, `region` | Rotterdam (serves EMEA+APAC), Detroit (serves AMER) |

**Operational tables:**

| Table | Grain | Purpose |
|---|---|---|
| `inventory` | component × plant | `on_hand_units`, `safety_stock_units`, `weekly_supply_units`. Battery Cell is sized so cover ≈ 2-3 weeks at Rotterdam, ~4 at Detroit; every other component 9-17+ weeks. |
| `bom` | product × component | `qty_per_unit`. Every product uses the Battery Cell (4-12 cells/unit), so a surge in any e-bike drains it. |
| `purchase_orders` | PO | Steady weekly inbound per component×plant, arriving `lead_time_weeks` after order. Recent battery POs are still `In Transit`; the next reorder would take 8 weeks. |

**Fact:**

| Table | Grain | Key columns |
|---|---|---|
| `product_demand` | product × DC × week | `demand_id`, `week`, `product_id`, `dc_id`, `demand_units` |

**Fact generation rules (the mechanics that make the story true):**
- Weekly demand per product×DC with a gentle trend + seasonality.
- **The surge:** the City E-Bike (`product_id=1`) ramps hard from the launch week
  (2026-04-20) over ~6 weeks, **EMEA DCs only** (Amsterdam / Berlin / Paris). Other
  regions stay flat — so a regional breakdown shows a real, defensible EMEA jump.
- **~4,200 demand rows** (5 products × 8 DCs × ~105 weeks).

### Data-shaping rules (must hold end-to-end)
- **The surge must be visible without a filter** — total EMEA weekly demand roughly
  doubles from ~8k to ~16k across the surge window.
- **Weeks of cover derives from demand × BOM** — `component_status` rolls demand
  through the BOM per plant, so the Battery Cell risk is a consequence of the surge,
  never hard-coded.
- **Every FK resolves** — `product_id`, `dc_id`, `component_id`, `plant_id`,
  `supplier_id` all drawn from valid dimension ranges.

---

## B. Medallion Build (folded into the same script)

### Silver — typed + constrained
Each raw DataFrame is written with `saveAsTable` (overwrite) with all id columns cast
to BIGINT (qty/lead-time to INT) so every FK child column matches its parent PK type.
Then PK/FK **constraints (NOT ENFORCED, RELY)** are added so Catalog Explorer draws
the ER diagram and Genie understands the joins: PKs on every dimension + fact; FKs
from components→suppliers, inventory→components/plants, bom→products/components,
purchase_orders→components/plants/suppliers, product_demand→products/DCs. Constraint
creation is idempotent (each statement wrapped in try/except).

### Gold — `demand_enriched` + `component_status`
- **`demand_enriched`** — one wide join of the demand fact to products + DCs (region,
  country, geo). The single table the demand widgets, the map, the forecast and the
  metric view read.
- **`component_status`** — per component×plant supply risk: on-hand, safety stock,
  supplier lead time, average weekly demand (rolled up from `demand_enriched` × `bom`
  over the last 4 weeks), **weeks of cover** (`on_hand / avg_weekly_demand`), and a
  `status` (`At risk` when weeks_of_cover ≤ lead_time_weeks). Only the Battery Cell
  is At risk — worst at Rotterdam.

### Metrics — `metrics_demand` (see also `04-ai-bi.md`)
A governed metric view (`WITH METRICS LANGUAGE YAML`) over `demand_enriched`.
Its measure (`Demand Units`) and dimensions are the contract the dashboard demand
tiles and Genie both consume. Full definition in `04-ai-bi.md` §Metric View.

---

## C. Validation

After the script runs, confirm:
1. **Row counts** — 9 base tables (~4,200 `product_demand`, 1,260 `purchase_orders`)
   + `demand_enriched` + `component_status` + `metrics_demand`.
2. **The story is real** — in `component_status`, the Battery Cell at Rotterdam has
   `weeks_of_cover` ≈ 2-3 with `status='At risk'` vs `lead_time_weeks=8`; every other
   component is `Healthy`.
3. **The surge is real** — weekly EMEA demand roughly doubles across 2026-04-20 →
   2026-06-01 while AMER stays flat.
4. **Constraints present** — Catalog Explorer shows the PK/FK relationships.
5. **Metric view queryable** — `SELECT MEASURE(\`Demand Units\`) ... GROUP BY \`Region\``
   returns per-region demand.
