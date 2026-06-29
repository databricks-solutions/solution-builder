# Lakeflow — Data Generation + Small Transformation Chain

> **Simple-demo contract.** One self-contained data-generation script produces the full **bronze→silver→gold** layering: the 5 `raw_*` source tables, the `silver_*` cleaned/enriched facts, and the 2 `gold_*` tables the dashboard + Genie read. There is **no SDP** in the simple build, so the script does that layering itself. **No metric view, no ai_classify** — the silver `anger_score` is a heuristic (the full demo's `ai_classify` is out of scope here). Lineage is visible in Catalog Explorer. Talking track: *"in production this is where Lakeflow Connect drops files and SDP shapes them — here the data-gen does the equivalent layering inline so the demo lands in minutes."*

---

## Shared Context

**Affected products** (verbatim):
- `SKU-1001` Hydrating Serum 30ml (Skincare/Serums, $68/$12)
- `SKU-1002` Vitamin C Cream 50ml (Skincare/Creams, $55/$10)
- `SKU-1003` HA Moisture Boost 15ml (Skincare/Serums, $42/$8)

**Affected lot**: `LOT-{YYYY}-{MMDD}` from `AFFECTED_LOT_DATE`, Lyon, ~1,700 units/SKU (~5,000 total), status `released`. **One lot row carries the incident text; every other lot has `NULL`.** This is the drill-down anchor — dashboard shows the symptom, the lot table holds the explanation.

**Incident text** (verbatim string on the affected lot's `incident_summary`):
> *"Production Incident Report PIR-{YYYY}-{MMDD}. Equipment: Homogenizer Unit HMG-03 at Lyon. Issue: pressure fluctuations (2.1–2.8 bar vs normal 2.4–2.6 bar) during emulsification. Cause: calibration drift in the pressure regulation valve. Affected SKUs: SKU-1001, SKU-1002, SKU-1003 (~5,000 units). QC assessment: 'Minor texture variations due to pressure fluctuations during emulsification — cosmetic only; safety and efficacy unaffected.' Disposition: RELEASED."*

**Texture complaints** (verbatim phrases for the `return_reason_text` pool, predominantly on affected-lot rows): *"grainy texture"*, *"product separated"*, *"consistency is watery"*, *"texture feels off"*, *"cloudy and thick"*, *"feels gritty"*. These substrings must appear — Genie + the dashboard search for them.

**Time anchors**: `STORY_END_DATE = NOW`, `STORY_START_DATE = NOW − 12 months`, `AFFECTED_LOT_DATE = NOW − 8 weeks` (lot produced + released), `SPIKE_PEAK = NOW − 3 weeks` (returns peak), `DECAY_START = NOW − 2 weeks`. **`NOW = datetime.now()` by default** — rolling time, so the dashboard's right edge is always yesterday-real. Set `LUXE_PIN_TIME=1` to freeze `NOW` to a baseline date for reproducible runs (artefact IDs and dates stay stable across regens — only needed when matching a recorded video / baked-in app config). **Causal chain**: lot produced at −8w → ships + sells over weeks −7 to −4 → customers receive, notice defect, return → returns build weeks −6 to −4 → peak at −3w → decay −2w to now. The 5-week gap between cause (−8w) and effect (−3w) is the breathing room that lets the forecast-chart annotation land clearly to the LEFT of the bump. Peak sits in the past with a decay tail — never at a chart's rightmost edge.

**`is_bad_lot` flag** — denormalized onto `gold_returns` (TRUE iff `lot_id = <AFFECTED>`). Dashboard widgets split everyday vs affected returns on this column.

---

## A. Data Generation Script

**Skill**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` first.

**Runtime**: pre-provisioned databricks-connect venv (path in system prompt). Do NOT create a new venv.

One self-contained, idempotent script produces all three layers (there's no SDP in the simple build):

1. **Raw** — the 5 source tables (customers, products, production_lots, orders, returns) with the story's data: the EU-skewed bad-lot cohort, the 3x return spike, the incident text on the affected lot.
2. **Silver** — cleaned + enriched facts the gold layer reads: `silver_returns` (returns with customer geo, product/category, facility denormalized in-row + the heuristic `anger_score` + `is_bad_lot`) and `silver_orders` (order-level fact with product/category).
3. **Gold** — the two tables the dashboard + Genie read, derived from **silver**: `gold_returns` and `gold_daily_summary`.

Every table and column carries a description so Genie can read them as semantics. The affected lot's `incident_summary` stays on `raw_production_lots` (the drill-down destination), never copied into gold.

### Raw tables (normalized; the dashboard never reads them directly except `raw_production_lots` via Genie for `incident_summary`)

- **`raw_customers`** ~50K — `customer_id` (PK, `CUST-NNNNNN`), `email`, `first_name`, `last_name`, `region` (`US`/`EU`/`APAC`), `country` (ISO-2), **`city`**, **`customer_lat`**, **`customer_lng`** (DOUBLE PRECISION, city anchor + jitter — see "City anchors + GPS" below), `loyalty_tier` (lowercase: `gold`/`silver`/`standard`), `registration_date`.
- **`raw_products`** ~30 — `product_id` (PK, `SKU-NNNN`), `product_name`, `category`, `subcategory`, `price_usd`, `cost_usd`, `launch_date`, `is_active`. Hand-curated list, NOT generated — the affected SKUs (1001/1002/1003) need fixed positions in the catalog so the spec validates them by name.
- **`raw_production_lots`** ~1,500 — `lot_id` (PK), `product_id` (FK), `production_date`, `facility`, `quantity_produced` (200–1000 normal; affected lot ~5,000), `status` (`released`/`on_hold`/`recalled`), **`incident_summary`** (nullable; set ONLY on the 3 affected-lot rows — same `lot_id` across the 3 affected SKUs).
- **`raw_orders`** ~200K — `order_id` (PK, `ORD-YYYYMMDD-NNNNNN`), `customer_id` (FK), `product_id` (FK — one row per order/product line), `lot_id` (FK), `order_date`, `region` (order destination — same value as the customer's region), `quantity` (small int, usually 1), `total_usd` (= quantity × product price).
- **`raw_returns`** ~25K — `return_id` (PK, `RET-NNNNNNNN`), `order_id` (FK), `customer_id` (FK), `product_id` (FK), `lot_id` (FK), `return_date`, `refund_amount_usd`, `return_reason` (`quality`/`didnt_fit`/`wrong_item`/`changed_mind`), `return_reason_text` (free text; texture complaints on affected-lot rows), **`anger_score`** (DOUBLE, 0..1; pre-computed heuristic — see "Anger score" below).

### Silver tables (cleaned + enriched facts — gold reads these, not raw)

Built inline (no SDP). The simple demo's silver mirrors what the full demo's SDP silver produces, minus `ai_classify` (heuristic anger here) and minus the order-items split (the simple demo is order-level only).

- **`silver_returns`** ~25K — cleaned returns fact, every dimension denormalized in-row: `product_name / category` from `raw_products`, `facility` from `raw_production_lots`, `country / city / customer_lat / customer_lng / loyalty_tier` from `raw_customers`, `region` + `order_date` from `raw_orders`, plus the return fact columns, the heuristic `anger_score`, both `return_reason_text` and `customer_comment`, and **`is_bad_lot`** = (`lot_id = <AFFECTED>`).
- **`silver_orders`** ~200K — order-level fact (one row per order/SKU line) with `product_name / category` denormalized from `raw_products`. The daily rollup reads this.

### Curated (gold) tables (what the dashboard + Genie + app read)

Two gold tables. Lot rollups (worst-lots, lot-level rates) are computed at query time from `gold_returns` with `GROUP BY lot_id`; the incident text is fetched directly from `raw_production_lots` via a one-hop join. No intermediate `gold_product_lot_quality` — pre-aggregating a few hundred lots adds a table for no measurable win.

- **`gold_returns`** ~25K — **the one denormalized fact**, projected straight from `silver_returns` (all the joins already happened in silver). `region` traces to `raw_orders` (keeps `gold_returns.region` consistent with `gold_daily_summary.region` so dashboard filters agree). Carries **both** `return_reason_text` and `customer_comment` as columns (same string content — `customer_comment` is what the dashboard's `ds_returns` and Genie's example SQLs read). Carries **`is_bad_lot`**. Deliberately omits `incident_summary` — symptom on this table, explanation on `raw_production_lots` so the drill-down has a destination. COMMENT every column.
- **`gold_daily_summary`** ~3,500 rows — one row per `(date, region, category)`. Columns: `order_count`, `items_sold`, `revenue_usd`, `return_count`, `returns_usd`. An orders rollup (from `silver_orders`) and a returns rollup (from `silver_returns`) aggregated to that grain and combined, returns defaulting to zero where there were none. Both legs carry `region` from the same upstream so the grains align.

### Anger score

Each row in `raw_returns` carries a pre-computed `anger_score` (DOUBLE, 0..1). The dashboard's sentiment widgets read it directly off `gold_returns.anger_score`. In the FULL demo this column comes from `ai_classify` over the comment text; the simple demo skips that to keep the data layer pure-SQL, and uses a heuristic instead:

| Condition | Score |
|---|---|
| `return_reason = 'quality'` AND comment mentions texture vocabulary (`grainy` / `separated` / `watery` / `gritty` / `curdled` / `consistency` / `texture` / `off`) | **0.9** |
| `return_reason = 'quality'` otherwise | **0.7** |
| Comment mentions `fine` or `wrong` | **0.3** |
| Anything else | **0.1** |

Result: affected-lot returns cluster at 0.9 (the dashboard's "very angry" bucket), baseline returns spread across 0.1-0.3. Same shape as the full demo's `ai_classify` output without the LLM call.

---

## B. Data Shaping Rules

Follow these and the dataset is dashboard-ready on first pass. Skip any and the story stops popping (spike vanishes into noise, peak lands at chart edge, map doesn't light EU).

- **Baselines**: ~3,800 orders/week → ~$60K/week returns at ~8% return rate. ~$380K/month revenue, ~15K orders/month. ±5% noise on prices.
- **Time window + seasonality** (purely cosmetic, so the trend line doesn't look uniform-random): orders span **1 year by default** with per-day seasonal multipliers. **Two clearly separated peaks** is the load-bearing shape: a Black Friday tent (Nov 24–30, ramping 2.0 → 3.2 → 2.0 with peak Nov 28) → a deliberate **valley** Dec 1–10 (1.3×) so BF visually decouples → a Christmas ramp (Dec 11–22, 1.5 → 3.2 with peak Dec 21) → post-cutoff lull Dec 23–26 (0.6×) → small rebound Dec 27–31 (1.3×). Off-season bumps: Mother's Day week (May 7–14, 2.0×), Valentine's week (Feb 7–14, 1.8×), summer dip (Jul–Aug, 0.75×). Apply ±15% gaussian noise. January 1–15 carries a 1.3× return-rate bump for the post-Christmas gift-return surge. Bad-lot timing defaults to ~8 weeks ago, but shifts earlier if that would land in a seasonal peak (Black Friday week or Dec 1–26), so the spike isn't swallowed by seasonal volume.
- **Regions**: sales US 70 / EU 20 / APAC 10. Country mix — US: US 95 / CA 5; EU: FR 30 / GB 25 / DE 20 / IT 15 / ES 10; APAC: JP 40 / AU 30 / KR 20 / SG 10. Region = order destination = customer registration region (no cross-border purchases in the synth).
- **City anchors + GPS** (drives the bubble map): each customer gets `customer_lat`/`customer_lng` = a weighted city anchor + ±0.05° jitter (~5km) so points spread inside the city instead of stacking. Each country maps to 3–5 weighted cities. **Required for the story**: FR includes Paris (heaviest weight); GB/IT/DE/ES include London, Milan, Madrid, Berlin; US covers NYC + LA + Chicago + Houston; APAC covers Tokyo + Sydney + Seoul + Singapore. Affected lot inherits parents' coords → with the EU skew below, **Paris ends up the single largest bubble** on the map, followed by London / Milan.
- **Loyalty**: gold 10%, silver 30%, standard 60%. (The simple demo doesn't differentiate frequency or return rate by tier — kept for filtering only.)
- **Product popularity**: top 20% of SKUs = 60% of sales. Affected SKUs are **mid-tier sellers, not heroes** — otherwise the spike looks like a volume artifact, not a return-rate anomaly.
- **The catalyst** (the load-bearing block):
  - ~5,000 orders reference the affected lot, placed between `AFFECTED_LOT_DATE` and +5 weeks.
  - ~1,500 returns off the lot → ~30% rate (≥ 3× baseline).
  - Arrival curve: slow build weeks 6–4 ago → sharp peak at `SPIKE_PEAK` (~500 returns / ~$180K that week) → decay over the last 2 weeks (~$90K → $70K). **Peak in the past, never at the right edge.**
  - Reason on affected-lot rows: predominantly `quality`; `return_reason_text` drawn from the texture-complaint pool.
- **Affected-lot region skew** (drives the map): the ~1,500 affected customers are **60% EU / 25% US / 15% APAC** (vs global 20/70/10). Inside EU keep the country mix above so **FR leads**, then IT or GB, then DE. Coherence: Skincare-heavy SKUs + EU buyers + Lyon manufacturing — one geographic story end-to-end.

### Drill-down loop (must work end-to-end)

Operations page: KPI sparklines show the spike → forecast-line carries the cause → effect → recovery shape with a vertical bar on `AFFECTED_LOT_DATE` → bubble map lights Paris → donut shows Skincare dominates → area chart proves orders are flat (it's a refund problem, not a demand problem). Investigation page: **sankey** collapses the chain Category → Product → Lot in one widget (Skincare → 3 SKUs → 1 lot) → affected-vs-everyday country + reason splits → sentiment bar (`ai_classify`-style derived from `anger_score`) leans angry → comments table sorted by Anger surfaces the texture complaints → Genie hops one join from the lot to `raw_production_lots.incident_summary` and quotes it inline. See `04-ai-bi.md` for widget-by-widget detail.

---

## C. Validation

The LLM writes one-line queries for each check. If any fail, fix the synth before `04-ai-bi.md`.

**Load-bearing (gate the story):**
- **Spike, peak in past** — weekly `SUM(refund_amount_usd)` from `gold_returns`: peak ~$180K ~3w ago, decay ~$90K → $70K, baseline ~$60K. NOT in the current week.
- **Affected lot is the common thread** — top `lot_id` by `COUNT(*)` for `product_id IN (SKU-1001/1002/1003)` has ~1,500 returns; the next lot is an order of magnitude smaller.
- **EU skew** — `gold_returns WHERE lot_id = <AFFECTED>`: GROUP BY region → EU ≥55%, US ~25%, APAC ~15%; GROUP BY country → FR first, then IT or GB; GROUP BY city → Paris first (≥30 distinct customers), then London / Milan / Madrid / Berlin.
- **Incident text** — exactly 3 rows in `raw_production_lots` have non-null `incident_summary` (one per affected SKU, same `lot_id`), all containing *"homogenizer"*, *"pressure"*, *"Lyon"*, *"released"*.
- **Texture vocabulary** — `gold_returns WHERE is_bad_lot` `return_reason_text` includes *"grainy"*, *"separated"*, *"watery"*.
- **Anger column** — `gold_returns WHERE is_bad_lot AND anger_score >= 0.9` returns ~all the affected-lot rows (texture vocab triggers the 0.9 bucket per the heuristic in § Anger score).

**Smoke checks** (LLM derives): `is_bad_lot` set on ~1,500 rows · `COUNT(*)` matches between `raw_returns` and `gold_returns` (no rows dropped) · `gold_daily_summary` covers the full window (~390 days × 3 regions × 5 categories — Skincare, Makeup, Haircare, Bodycare, Fragrance) · GPS columns non-null + earth-bounded (lat [-90,90], lng [-180,180]).

Surface the resolved `<AFFECTED_LOT>` (notebook exit JSON or `resources.json`) so `04-ai-bi.md` and the app can reference it.
