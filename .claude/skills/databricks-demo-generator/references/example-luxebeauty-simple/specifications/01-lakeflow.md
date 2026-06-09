# Lakeflow — Data Generation + Small Transformation Chain

> **Simple-demo contract.** One Python script writes 5 `raw_*` tables, then runs 2 `spark.sql("CREATE OR REPLACE TABLE … COMMENT … AS SELECT …")` transforms into 2 `gold_*` tables + a constraint block. **No SDP, no metric view, no ai_classify** — interactive SQL is enough for the simple story. Visible lineage in Catalog Explorer. Talking track: *"in production we'd shape this with SDP / Lakeflow Jobs."*

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

**Time anchors**: `STORY_END_DATE = NOW`, `STORY_START_DATE = NOW − 13 months`, `AFFECTED_LOT_DATE = NOW − 8 weeks` (lot produced + released), `SPIKE_PEAK = NOW − 3 weeks` (returns peak), `DECAY_START = NOW − 2 weeks`. **Causal chain**: lot produced at −8w → ships + sells over weeks −7 to −4 → customers receive, notice defect, return → returns build weeks −6 to −4 → peak at −3w → decay −2w to now. The 5-week gap between cause (−8w) and effect (−3w) is the breathing room that lets the forecast-chart annotation land clearly to the LEFT of the bump. Peak sits in the past with a decay tail — never at a chart's rightmost edge.

**`is_bad_lot` flag** — denormalized onto `gold_returns` (TRUE iff `lot_id = <AFFECTED>`). Dashboard widgets split everyday vs affected returns on this column.

---

## A. Data Generation Script

**Skill**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` first.

**Runtime**: pre-provisioned databricks-connect venv (path in system prompt) — has Python 3.12, databricks-connect, faker, numpy, pandas, holidays, pyarrow. Do NOT create a new venv.

One `.py` file, ~2 min end-to-end. Three phases, sequential, all idempotent (every write is `mode("overwrite")` / `CREATE OR REPLACE`):

1. **Raw tables** — `spark.createDataFrame(pdf).write.mode("overwrite").saveAsTable("{catalog}.{schema}.raw_<name>")` for the 5 below. Order: customers → products → production_lots → orders → returns. FK integrity must be clean.
2. **Curated tables** — one `spark.sql("CREATE OR REPLACE TABLE {catalog}.{schema}.gold_<name> COMMENT '…' AS SELECT col COMMENT '…', … FROM raw_… JOIN …")` per gold table, in order: `gold_returns` → `gold_daily_summary`. **Every table AND every column needs a `COMMENT '…'`** — Catalog Explorer + Genie read them as semantics; without them Genie has to guess.
3. **Constraints** — for each gold table: `ALTER TABLE … ALTER COLUMN <pk> SET NOT NULL`, then `… ADD CONSTRAINT <name>_pk PRIMARY KEY(<pk>)`, then `… ADD CONSTRAINT <name>_fk FOREIGN KEY(<col>) REFERENCES raw_… NOT ENFORCED RELY`. Renders the FK arrows in Catalog Explorer's lineage view.

### Raw tables (normalized; the dashboard never reads them directly except `raw_production_lots` via Genie for `incident_summary`)

- **`raw_customers`** ~50K — `customer_id` (PK, `CUST-NNNNNN`), `email`, `first_name`, `last_name`, `region` (`US`/`EU`/`APAC`), `country` (ISO-2), **`city`**, **`customer_lat`**, **`customer_lng`** (DOUBLE PRECISION, city anchor + jitter — see "City anchors + GPS" below), `loyalty_tier` (lowercase: `gold`/`silver`/`standard`), `registration_date`.
- **`raw_products`** ~80 — `product_id` (PK, `SKU-NNNN`), `product_name`, `category`, `subcategory`, `price_usd`, `cost_usd`, `launch_date`, `is_active`.
- **`raw_production_lots`** ~1,500 — `lot_id` (PK), `product_id` (FK), `production_date`, `facility`, `quantity_produced` (200–1000 normal; affected lot ~5,000), `status` (`released`/`on_hold`/`recalled`), **`incident_summary`** (nullable; set ONLY on the affected lot row).
- **`raw_orders`** ~200K — `order_id` (PK, `ORD-YYYYMMDD-NNNNNN`), `customer_id` (FK), `product_id` (FK — one row per order/product line), `lot_id` (FK), `order_date`, `region` (order destination — same value as the customer's region), `quantity` (small int, usually 1), `total_usd` (= quantity × product price).
- **`raw_returns`** ~25K — `return_id` (PK, `RET-NNNNNNNN`), `order_id` (FK), `customer_id` (FK), `product_id` (FK), `lot_id` (FK), `return_date`, `refund_amount_usd`, `return_reason` (`quality`/`didnt_fit`/`wrong_item`/`changed_mind`), `return_reason_text` (free text; texture complaints on affected-lot rows).

### Curated tables (what the dashboard + Genie + app read)

Two tables — that's it. Lot rollups (worst-lots, lot-level rates) are computed at query time from `gold_returns` with `GROUP BY lot_id`; the incident text is fetched directly from `raw_production_lots` via a one-hop join. No intermediate `gold_product_lot_quality` — pre-aggregating a few hundred lots adds a table for no measurable win.

- **`gold_returns`** ~25K — **the one denormalized fact** (`raw_returns × raw_customers × raw_products × raw_production_lots × raw_orders`). Pulls `country / city / customer_lat / customer_lng / loyalty_tier` from `raw_customers`, `region` from `raw_orders` (NOT raw_customers — keeps `gold_returns.region` consistent with `gold_daily_summary.region` so dashboard filters agree), `product_name / category` from raw_products, `facility` from raw_production_lots, `order_date` from raw_orders, plus return fact columns. Computes **`is_bad_lot`** = (`lot_id = <AFFECTED>`). Deliberately omits `incident_summary` — symptom on this table, explanation on `raw_production_lots` so the drill-down has a destination. COMMENT it accordingly.
- **`gold_daily_summary`** ~3,500 rows — `(date, region, category)` composite PK. Columns: `order_count`, `revenue_usd`, `return_count`, `returns_usd`. Orders leg = `raw_orders JOIN raw_products GROUP BY 1,2,3`. Returns leg = `raw_returns JOIN raw_orders (for region) JOIN raw_products GROUP BY 1,2,3`, LEFT JOIN on the same triple. Pulling region from `raw_orders` on both legs is the contract — values must join cleanly.

---

## B. Data Shaping Rules

Follow these and the dataset is dashboard-ready on first pass. Skip any and the story stops popping (spike vanishes into noise, peak lands at chart edge, map doesn't light EU).

- **Baselines**: ~3,800 orders/week → ~$60K/week returns at ~8% return rate. ~$380K/month revenue, ~15K orders/month.
- **Seasonality**: Black Friday 3×, Holiday (Dec 15–31) 2.2×, Mother's Day 2×, Valentine's 1.8×, Summer (Jun–Aug) 0.75×, ±15% daily noise. Makes the revenue line look like a real business; the returns spike must stand out against that.
- **Regions**: sales US 70 / EU 20 / APAC 10. Country mix — US: US 95 / CA 5; EU: FR 30 / GB 25 / DE 20 / IT 15 / ES 10; APAC: JP 40 / AU 30 / KR 20 / SG 10. Category-by-region — US heavier on Makeup, EU heavier on Skincare, APAC heavier on Haircare (matters: affected lot is Skincare, so EU-filtered view amplifies the spike).
- **City anchors + GPS** (drives the bubble map): each customer gets `customer_lat`/`customer_lng` = city anchor + ±0.05° jitter (~5km) so points spread inside the city instead of stacking. Pick ~3-5 cities per country with weights skewed to the largest market — `numpy.random.choice(cities, p=weights)` per customer. Lat/lng to 2 decimals is enough. **Required for the story**: FR includes Paris (largest weight, ~0.45); GB/IT/DE/ES include London, Milan, Madrid, Berlin. Affected lot inherits parents' coords → with the EU skew below, **Paris ends up the single largest bubble** on the map, followed by London / Milan.
- **Loyalty**: Gold 10% (2.5× freq, 0.5× returns), Silver 30%, Standard 60% (carries the noise).
- **Product popularity**: top 20% of SKUs = 60% of sales. Affected SKUs are **mid-tier sellers, not heroes** — otherwise the spike looks like a volume artifact, not a return-rate anomaly.
- **The catalyst** (the load-bearing block):
  - ~5,000 orders reference the affected lot, placed between `AFFECTED_LOT_DATE` and +5 weeks.
  - ~1,500 returns off the lot → ~30% rate (≥ 3× baseline).
  - Arrival curve: slow build weeks 6–4 ago → sharp peak at `SPIKE_PEAK` (~500 returns / ~$180K that week) → decay over the last 2 weeks (~$90K → $70K). **Peak in the past, never at the right edge.**
  - Reason on affected-lot rows: predominantly `quality`; `return_reason_text` drawn from the texture-complaint pool.
- **Affected-lot region skew** (drives the map): the ~250 affected customers are **60% EU / 25% US / 15% APAC** (vs global 20/70/10). Inside EU keep the country mix above so **FR leads**, then IT or GB, then DE. Coherence: Skincare-heavy SKUs + EU buyers + Lyon manufacturing — one geographic story end-to-end.

### Drill-down loop (must work end-to-end)

Dashboard Operations headline (~24% return rate, KPI sparkline shows the spike) → forecast-line chart with vertical annotation on `AFFECTED_LOT_DATE` → Investigation page: products bar (three Skincare SKUs) → worst lots bar (one lot dominates) → affected-vs-everyday country/reason splits → comments table quoting texture complaints → Genie hops one join from the lot to `raw_production_lots.incident_summary` and quotes it inline. See `04-ai-bi.md` for widget-by-widget detail.

---

## C. Validation

The LLM writes one-line queries for each check. If any fail, fix the synth before `04-ai-bi.md`.

**Load-bearing (gate the story):**
- **Spike, peak in past** — weekly `SUM(refund_amount_usd)` from `gold_returns`: peak ~$180K ~3w ago, decay ~$90K → $70K, baseline ~$60K. NOT in the current week.
- **Affected lot is the common thread** — top `lot_id` by `COUNT(*)` for `product_id IN (SKU-1001/1002/1003)` has ~1,500 returns; the next lot is an order of magnitude smaller.
- **EU skew** — `gold_returns WHERE lot_id = <AFFECTED>`: GROUP BY region → EU ≥55%, US ~25%, APAC ~15%; GROUP BY country → FR first, then IT or GB; GROUP BY city → Paris first (≥30 distinct customers), then London / Milan / Madrid / Berlin.
- **Incident text** — exactly 1 row in `raw_production_lots` has non-null `incident_summary`, containing *"homogenizer"*, *"pressure"*, *"Lyon"*, *"released"*.
- **Texture vocabulary** — `gold_returns WHERE is_bad_lot` `return_reason_text` includes *"grainy"*, *"separated"*, *"watery"*.

**Smoke checks** (LLM derives): `is_bad_lot` set on ~1,500 rows · `COUNT(*)` matches between `raw_returns` and `gold_returns` (no rows dropped) · `gold_daily_summary` covers the full window (~390 days × 3 regions × 3 categories) · GPS columns non-null + earth-bounded (lat [-90,90], lng [-180,180]).

Surface the resolved `<AFFECTED_LOT>` (notebook exit JSON or `resources.json`) so `04-ai-bi.md` and the app can reference it.
