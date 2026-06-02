# Lakeflow — Data Generation + Small Transformation Chain

> **Simple-demo contract.** One Python script writes 5 `raw_*` tables, then runs 3 `spark.sql("CREATE OR REPLACE TABLE … COMMENT … AS SELECT …")` transforms into 3 `gold_*` tables + a constraint block. Visible lineage in Catalog Explorer. Talking track: *"in production we'd shape this with SDP / Lakeflow Jobs."*

---

## Shared Context

**Affected products** (verbatim):
- `SKU-1001` Hydrating Serum 30ml (Skincare/Serums, $68/$12)
- `SKU-1002` Vitamin C Cream 50ml (Skincare/Creams, $55/$10)
- `SKU-1003` HA Moisture Boost 15ml (Skincare/Serums, $42/$8)

**Affected lot**: `LOT-{YYYY}-{MMDD}` from `AFFECTED_LOT_DATE`, Lyon, ~1,700 units/SKU (~5,000 total), status `released`. **One lot row carries the incident text; every other lot has `NULL`.** This is the drill-down anchor — dashboard shows the symptom, the lot table holds the explanation.

**Incident text** (verbatim string on the affected lot's `incident_summary`):
> *"Production Incident Report PIR-{YYYY}-{MMDD}. Equipment: Homogenizer Unit HMG-03 at Lyon. Issue: pressure fluctuations (2.1–2.8 bar vs normal 2.4–2.6 bar) during emulsification. Cause: calibration drift in the pressure regulation valve. Affected SKUs: SKU-1001, SKU-1002, SKU-1003 (~5,000 units). QC assessment: 'Minor texture variations due to pressure fluctuations during emulsification — cosmetic only; safety and efficacy unaffected.' Disposition: RELEASED."*

**Texture complaints** (canned pool, predominantly used on affected-lot returns):
*"Cream has grainy texture, not smooth like usual"* / *"Product separated in the jar, looks curdled"* / *"Consistency is watery, doesn't feel right"* / *"Texture feels off compared to my last purchase"* / *"Serum looks cloudy and thick"* / *"Product texture has changed, feels gritty"*

**Time anchors**: `STORY_END_DATE = NOW`, `STORY_START_DATE = NOW − 13 months`, `AFFECTED_LOT_DATE = NOW − 8 weeks`, `SPIKE_PEAK = NOW − 3 weeks`, `DECAY_START = NOW − 2 weeks`. Peak sits in the past with a decay tail — never at a chart's rightmost edge.

---

## A. Data Generation Script

**Skill**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` first.

**Runtime**: pre-provisioned databricks-connect venv (path in system prompt) — has Python 3.12, databricks-connect, faker, numpy, pandas, holidays, pyarrow. Do NOT create a new venv.

One `.py` file, ~2 min end-to-end. Three phases, sequential, all idempotent (every write is `mode("overwrite")` / `CREATE OR REPLACE`):

1. **Raw tables** — `spark.createDataFrame(pdf).write.mode("overwrite").saveAsTable("{catalog}.{schema}.raw_<name>")` for the 5 below. Order: customers → products → production_lots → orders → returns. FK integrity must be clean.
2. **Curated tables** — one `spark.sql("CREATE OR REPLACE TABLE {catalog}.{schema}.gold_<name> COMMENT '…' AS SELECT col COMMENT '…', … FROM raw_… JOIN …")` per gold table, in order: `gold_returns` → `gold_daily_summary` → `gold_product_lot_quality`. **Every table AND every column needs a `COMMENT '…'`** — Catalog Explorer + Genie read them as semantics; without them Genie has to guess.
3. **Constraints** — for each gold table: `ALTER TABLE … ALTER COLUMN <pk> SET NOT NULL`, then `… ADD CONSTRAINT <name>_pk PRIMARY KEY(<pk>)`, then `… ADD CONSTRAINT <name>_fk FOREIGN KEY(<col>) REFERENCES raw_… NOT ENFORCED RELY`. Renders the FK arrows in Catalog Explorer's lineage view.

### Raw tables (normalized; the dashboard never reads them directly)

- **`raw_customers`** ~50K — `customer_id` (PK, `CUST-NNNNNN`), `email`, `first_name`, `last_name`, `region`, `country` (ISO-2), **`city`**, **`customer_lat`**, **`customer_lng`** (DOUBLE PRECISION, city anchor + jitter — see "City anchors + GPS" below), `loyalty_tier`, `registration_date`.
- **`raw_products`** ~80 — `product_id` (PK, `SKU-NNNN`), `product_name`, `category`, `subcategory`, `price_usd`, `cost_usd`, `launch_date`, `is_active`.
- **`raw_production_lots`** ~1,500 — `lot_id` (PK), `product_id` (FK), `production_date`, `facility`, `quantity_produced` (200–1000 normal; affected lot ~5,000), `status` (`released`/`on_hold`/`recalled`), **`incident_summary`** (nullable; set ONLY on the affected lot row).
- **`raw_orders`** ~200K — `order_id` (PK, `ORD-YYYYMMDD-NNNNNN`), `customer_id` (FK), `order_date`, `region`, `total_usd`.
- **`raw_returns`** ~25K — `return_id` (PK, `RET-NNNNNNNN`), `order_id` (FK), `customer_id` (FK), `product_id` (FK), `lot_id` (FK), `return_date`, `refund_amount_usd`, `return_reason` (`quality`/`didnt_fit`/`wrong_item`/`changed_mind`), `return_reason_text`.

### Curated tables (what the dashboard + Genie read)

- **`gold_returns`** ~25K — denormalized fact. Join `raw_returns × raw_customers × raw_products × raw_production_lots × raw_orders`. Carries `country / city / customer_lat / customer_lng / region / loyalty_tier / order_date / product_name / category / facility` in-row (the four geo columns let the bubble map in `04-ai-bi.md` plot points without re-joining). **Omits `incident_summary` deliberately** — the dashboard sees the symptom; the explanation lives on the lot table so the drill-down has a destination. COMMENT: *"One row per return, denormalized with customer/product/lot/geo context."*
- **`gold_daily_summary`** ~3,500 — pre-aggregated per `(date, region, category)`. Composite PK on those three. Orders + revenue + items_sold from `raw_orders`, return_count + returns_usd from `raw_returns`, all grouped on the same triple (LEFT JOIN so dates without returns still appear). Powers KPIs + the weekly bar chart. COMMENT: *"Daily summary by region × category for dashboard KPIs and trend."*
- **`gold_product_lot_quality`** ~3,000 — one row per `(product_id, lot_id)` with at least one return. Join `raw_returns × raw_products × raw_production_lots`, GROUP BY product+lot, pre-joins `incident_summary` from the lot row (NULL except on the affected lot's three rows). Fields: product info, lot info, status, **`incident_summary`**, `return_count`, `total_refund_usd`, `avg_refund_usd`, optionally `return_rate`. **This is the bridge** — Genie hops "lot is bad → here's why" in one SELECT; the Analytics worst-lots table reads this directly. COMMENT: *"Per-(product, lot) quality summary with manufacturing incident text pre-joined."*

---

## B. Data Shaping Rules

Follow these and the dataset is dashboard-ready on first pass. Skip any and the story stops popping (spike vanishes into noise, peak lands at chart edge, map doesn't light EU).

- **Baselines**: ~3,800 orders/week → ~$60K/week returns at ~8% return rate. ~$380K/month revenue, ~15K orders/month.
- **Seasonality**: Black Friday 3×, Holiday (Dec 15–31) 2.2×, Mother's Day 2×, Valentine's 1.8×, Summer (Jun–Aug) 0.75×, ±15% daily noise. Makes the revenue line look like a real business; the returns spike must stand out against that.
- **Regions**: sales US 70 / EU 20 / APAC 10. Country mix — US: US 95 / CA 5; EU: FR 30 / GB 25 / DE 20 / IT 15 / ES 10; APAC: JP 40 / AU 30 / KR 20 / SG 10. Category-by-region — US heavier on Makeup, EU heavier on Skincare, APAC heavier on Haircare (matters: affected lot is Skincare, so EU-filtered view amplifies the spike).
- **City anchors + GPS** (drives the bubble map): each customer is pinned to one city per country (weighted by city size) with `customer_lat`/`customer_lng` = city anchor + ±0.05° jitter (~5km). Anchor cities + weights (pick one with `numpy.random.choice(cities, p=weights)` per customer):
  - **US**: NewYork 40.71/-74.01 w=0.30, LosAngeles 34.05/-118.25 w=0.20, Chicago 41.88/-87.63 w=0.15, Houston 29.76/-95.37 w=0.10, Miami 25.76/-80.19 w=0.10, SanFrancisco 37.77/-122.42 w=0.15
  - **CA**: Toronto 43.65/-79.38 w=0.45, Montreal 45.50/-73.57 w=0.30, Vancouver 49.28/-123.12 w=0.25
  - **FR**: Paris 48.86/2.35 w=0.45, Lyon 45.76/4.83 w=0.18, Marseille 43.30/5.37 w=0.15, Toulouse 43.60/1.44 w=0.12, Lille 50.63/3.06 w=0.10
  - **GB**: London 51.51/-0.13 w=0.55, Manchester 53.48/-2.24 w=0.18, Birmingham 52.49/-1.89 w=0.15, Edinburgh 55.95/-3.19 w=0.12
  - **DE**: Berlin 52.52/13.40 w=0.30, Munich 48.14/11.58 w=0.25, Hamburg 53.55/9.99 w=0.20, Frankfurt 50.11/8.68 w=0.15, Cologne 50.94/6.96 w=0.10
  - **IT**: Milan 45.46/9.19 w=0.40, Rome 41.90/12.50 w=0.30, Naples 40.85/14.27 w=0.15, Turin 45.07/7.69 w=0.15
  - **ES**: Madrid 40.42/-3.70 w=0.45, Barcelona 41.39/2.17 w=0.35, Valencia 39.47/-0.38 w=0.20
  - **JP**: Tokyo 35.68/139.69 w=0.55, Osaka 34.69/135.50 w=0.25, Yokohama 35.44/139.64 w=0.10, Fukuoka 33.59/130.40 w=0.10
  - **AU**: Sydney -33.87/151.21 w=0.45, Melbourne -37.81/144.96 w=0.35, Brisbane -27.47/153.03 w=0.20
  - **KR**: Seoul 37.57/126.98 w=0.65, Busan 35.18/129.08 w=0.20, Incheon 37.46/126.71 w=0.15
  - **SG**: Singapore 1.35/103.82 w=1.00
  Affected lot inherits its parents' coords → with the EU skew below, **Paris ends up the single largest bubble** on the map (followed by London / Milan).
- **Loyalty**: Gold 10% (2.5× freq, 0.5× returns), Silver 30%, Standard 60% (carries the noise).
- **Product popularity**: top 20% of SKUs = 60% of sales. Affected SKUs are **mid-tier sellers, not heroes** — otherwise the spike looks like a volume artifact, not a return-rate anomaly.
- **The catalyst** (the load-bearing block):
  - ~5,000 order_items reference the affected lot, placed between `AFFECTED_LOT_DATE` and +5 weeks.
  - ~1,500 returns off the lot → ~30% rate (≥ 3× baseline).
  - Arrival curve: slow build weeks 6–4 ago → sharp peak at `SPIKE_PEAK` (~500 returns / ~$180K that week) → decay over the last 2 weeks (~$90K → $70K). **Peak in the past, never at the right edge.**
  - Reason on affected-lot rows: predominantly `quality`; `return_reason_text` drawn from the texture-complaint pool.
- **Affected-lot region skew** (drives the map): the ~250 affected customers are **60% EU / 25% US / 15% APAC** (vs global 20/70/10). Inside EU keep the country mix above so **FR leads**, then IT or GB, then DE. Coherence: Skincare-heavy SKUs + EU buyers + Lyon manufacturing — one geographic story end-to-end.

### Drill-down loop (must work end-to-end)

Dashboard headline (~24% return rate) → bar chart spike (3 weeks ago, Skincare) → products table (three SKUs at ~30%) → **`gold_product_lot_quality`** reveals one shared lot AND quotes its `incident_summary` (the second-table read = the lineage payoff) → bubble map highlights Paris as the biggest affected-customer cluster, then London / Milan. See `04-ai-bi.md` for widget-by-widget detail.

---

## C. Validation

Run before declaring data ready. If any check fails, fix the synth before `04-ai-bi.md`. (Translate each into a one-line SQL query against the listed table.)

- **Returns spike, peak in past** — weekly `SUM(refund_amount_usd)` from `gold_returns`: peak ~$180K landing ~3 weeks ago, decay ~$90K → $70K, baseline ~$60K. **Peak must NOT be in the most-recent week.**
- **Affected SKUs dominate quality returns** — SKU-1001/1002/1003 at the top of `gold_returns WHERE return_reason='quality'` by a wide margin.
- **Per-product return rate ≥ 3× baseline** — affected three SKUs ~30%, everything else ~8% (read `gold_product_lot_quality` aggregated to product).
- **One bad lot is the common thread** — for the three affected SKUs, one `lot_id` dominates with ~1,500 returns; next is an order of magnitude smaller.
- **Incident text exists only on the affected lot** — exactly 1 row in `raw_production_lots` has non-null `incident_summary`; that string contains *"homogenizer"*, *"pressure"*, *"Lyon"*, *"released"*.
- **Affected-lot region skew** — EU ≥ 55%, US ~25%, APAC ~15% of returns on `lot_id = <AFFECTED>`.
- **FR is the top affected country** — followed by IT or GB second, then DE/US.
- **Texture vocabulary present** — distinct `return_reason_text` on affected-lot returns includes *"grainy"*, *"separated"*, *"watery"*.
- **Lineage integrity** — `COUNT(*) FROM raw_returns` equals `COUNT(*) FROM gold_returns` (joins dropped no rows).
- **Daily summary shape** — `gold_daily_summary` covers the full window with ~3,500 rows (~390 days × 3 regions × 3 categories).
- **GPS populated + valid** — `SELECT COUNT(*) FROM raw_customers WHERE customer_lat IS NULL OR customer_lng IS NULL` returns 0; `MIN/MAX` of lat in [-90, 90] and lng in [-180, 180].
- **Paris is the top affected city** — `SELECT city, COUNT(DISTINCT customer_id) FROM gold_returns WHERE lot_id='<AFFECTED>' GROUP BY 1 ORDER BY 2 DESC LIMIT 5` → Paris first (≥ ~30), then London / Milan / Madrid / Berlin in some order. If a non-EU city tops the list, the EU skew above wasn't honored — fix the synth before declaring data ready.

Surface the resolved `<AFFECTED_LOT>` value (e.g. notebook exit JSON, or written to `resources.json`) so `04-ai-bi.md` and the app can reference it without re-deriving.
