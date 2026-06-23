# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Affected products** (deterministic — must exist with these exact values):

| product_id | product_name | category | subcategory | price_usd | cost_usd |
|------------|--------------|----------|-------------|-----------|----------|
| SKU-1001 | Hydrating Serum 30ml | Skincare | Serums | 68.00 | 12.00 |
| SKU-1002 | Vitamin C Cream 50ml | Skincare | Creams | 55.00 | 10.00 |
| SKU-1003 | HA Moisture Boost 15ml | Skincare | Serums | 42.00 | 8.00 |

**Affected lot**: LOT-{YYYY}-{MMDD} based on AFFECTED_LOT_DATE, Lyon facility, ~1,700 units/SKU (~5,000 total), status: released.

**Texture complaints** (verbatim phrases, used predominantly on affected-lot returns — drop into the "angry" comment pool in Section A): *"grainy texture"*, *"product separated"*, *"consistency is watery"*, *"texture feels off"*, *"cloudy and thick"*, *"feels gritty"*. These must be exact substrings — Genie + the dashboard search for them.

**Time references**: `STORY_END_DATE = NOW`, `STORY_START_DATE = NOW − 24 months` (rolling, 2-year history), `AFFECTED_LOT_DATE = NOW − 43 days` (~6 weeks back), `SPIKE_PEAK = NOW − 21 days` (~3 weeks back), `DECAY_START = NOW − 14 days`. **`NOW = datetime.now()` by default** — rolling time so the dashboard's right edge is always yesterday-real; set `LUXE_PIN_TIME=1` to freeze `NOW` to a baseline when reproducibility matters (recorded videos, baked-in IDs). **Causal chain**: lot produced at −6w → ships + sells weeks −5 to −2 → customers receive, return → returns build weeks −5 to −3 → peak at −3w → decay last 2 weeks. The 3-week gap between cause and effect leaves room for the forecast-line annotation to land clearly to the LEFT of the bump. Peak in the past, never at the rightmost edge.

> Numbers in this file are demo targets, not invariants — match the narrative shape, don't sweat ±10%. Parallelization rules live in `SKILL.md` → **Parallelization with Subagents**.

---

## A. Synthetic Data Generation

**Skill**: `databricks-synthetic-data-gen` (read `SKILLS/databricks-synthetic-data-gen/SKILL.md`). Use the pre-provisioned databricks-connect venv (Python 3.12 + faker + numpy + pandas + holidays + pyarrow) — system prompt has the path; do NOT create a new venv.

Write 5 Delta tables under `{catalog}.{schema}.raw_*` (no Parquet intermediate, no bronze pass-through — the gen runs Spark `CREATE OR REPLACE TABLE` directly):

| Table | Rows | Notes |
|-------|------|-------|
| `raw_customers` | ~5K | Region: US 70%, EU 20%, APAC 10%. Loyalty: standard 60%, silver 30%, gold 10%. City anchors + ±0.05° GPS jitter on every row. |
| `raw_products` | ~90 | Skincare ~40 ($25-120), Makeup ~25 ($15-65), Haircare ~15 ($18-45), plus Bodycare + Fragrance. Hand-curated — affected SKU-1001/1002/1003 sit at fixed positions. |
| `raw_production_lots` | ~1.6K | 18 lots/SKU × 90 SKUs over 6 months. Format `LOT-YYYY-MMDD-NNNN`. Status `released`/`on_hold`/`recalled`. Affected lot ships ~5K units. |
| `raw_orders` | ~340K | Order-level (one row per order). ~4K orders/week baseline × ~85 weeks retained after Pareto trimming. Carries `customer_id`, `order_date`, `region`, `total_usd` (gross). |
| `raw_order_items` | ~550K | Per-line: `order_id`, `product_id`, `lot_id`, `quantity`, `unit_price_usd`, `line_total_usd`. ~1.6 items/order avg. Lot assignment is FIFO per product. |
| `raw_returns` | ~32K | ~8% baseline return rate, plus the ~1,500-row bad-lot bump (~30% rate on the ~5K affected order-items). Carries `customer_comment` (the texture-complaint pool feeds this). |

### Data Variation

Orders seasonality — **two clearly separated peaks** is the load-bearing shape (so the dashboard's annual trend visibly shows BF + Christmas as distinct spikes, not one merged Q4 lump):

- **Black Friday tent** Nov 24–30 — ramps 2.0 → 3.2 (Nov 28) → 2.0.
- **Valley** Dec 1–10 — deliberately drops back to 1.3× so BF and Christmas separate visually.
- **Christmas ramp** Dec 11–22 — climbs 1.5 → 3.2 (Dec 21), then 3.0 on Dec 22.
- **Post-cutoff lull** Dec 23–26 — 0.6×.
- **Post-Christmas self-buying** Dec 27–31 — 1.3×.
- **Mother's Day** May 7–14 — 2.0×.
- **Valentine's** Feb 7–14 — 1.8×.
- **Summer dip** Jul–Aug — 0.75×.

Apply ±15% daily gaussian noise; clip to a minimum of 0.05 so no day disappears. January 1–15 carries a 1.3× return-rate bump for post-Christmas gift returns. **Bad-lot timing** defaults to `NOW − 43 days`; if that lands on (or its return-peak ~5w later lands on) Black Friday week or the Dec holiday ramp, slide the lot back week-by-week until both anchors clear the peaks — so the spike never dissolves into seasonal volume.

Regional patterns: US → higher Makeup (40% vs 30%), EU → higher Skincare (50% vs 40%), APAC → higher Haircare (25% vs 15%).

Country distribution (inside region, ISO-2 codes — used by the bubble map in `04-ai-bi.md`):
- US region: US 95%, CA 5%
- EU region: FR 30%, GB 25%, DE 20%, IT 15%, ES 10%
- APAC region: JP 40%, AU 30%, KR 20%, SG 10%

**City anchors + GPS coordinates.** Each customer gets `customer_lat` + `customer_lng` (DOUBLE PRECISION) = city anchor + ±0.05° jitter (~5km) so points spread inside the city instead of stacking. Pick ~3-5 cities per country (top metro areas) with weights skewed to the capital/largest market — `numpy.random.choice(cities, p=weights)` per customer. Lat/lng to 2 decimals is enough. **Required for the story**: FR includes Paris (largest weight, ~0.45) so Paris ends up the single largest bubble on the map; GB/IT/DE/ES include their largest cities (London, Milan, Madrid, Berlin) so the EU cluster reads. US/APAC just need their major metros — exact split doesn't matter, the affected-lot region skew below carries the geo story.

Product popularity (Pareto): top 20% = 60% of sales, 5-8 hero products per category at 3x volume. Natural return rates: complex skincare ~12%, simple haircare ~5%.

Customer behavior: Gold tier 2.5x frequency / 1.8x basket / 5% returns, Silver 1.5x/1.3x, Standard baseline/10% returns, ~30% one-time buyers.

Return timing: 60% within 7 days, 30% within 8-21 days, 10% within 22-30 days.

Production facilities: Lyon 50% (Skincare), Milan 30% (Makeup), Singapore 20% (Haircare).

### Comment pool (`return_reason_text`)

~15 hand-coded strings in 3 tones — keeps synth deterministic and gives `ai_classify` a clear signal. **Angry**: assertive / irritated / threatens to leave (must include the Shared-Context texture phrases verbatim). **Neutral**: measured ("didn't agree with my skin", "seems different from before"). **Benign**: no quality concern ("wrong shade", "ordered by mistake", "bought as gift").

**Distribution** (the model's training signal): affected-lot → 80% angry / 20% neutral · other quality returns → 20% angry / 80% neutral · `didnt_fit` / `wrong_item` / `changed_mind` → 100% benign.

### Premium tagging (label for the ML model)

CS has hand-tagged some customers `premium` / `not_premium` over time; everyone else is `NULL` — that's the unlabeled cohort the model in `03-ml-premium.md` scores. **Target counts**: ~3K `'premium'`, ~1K `'not_premium'`, ~46K `NULL` (±20% OK).

**Premium target profile** (the features the model must learn, derived from behavior — verified in Section D): ~3× median spend, 2–3× median order count, 3–5% return rate (vs 8–10% normal), tenure ≥ 6mo, skewed Gold/Silver.

**Implementation order**: write `raw_customers` once with `loyalty_tier` (and `premium_status = NULL` everywhere). After ALL other tables exist, run a final pass that computes per-customer lifetime spend + order count from `raw_orders` and sets `premium_status` according to the rule below — then `INSERT OVERWRITE` the customers table. Trying to tag at customer-write time before orders exist makes the "Standard-tier high-spender" surprise tag impossible (you don't know who the high-spenders are yet).

**Tagging recipe** — mix three sources so tier alone won't predict it:
- **Tier-correlated** (~80% of premium tags): mostly Gold (~50% of Gold customers), some top-spending Silver (~top 40% of Silver).
- **"Surprise tags"** (~10% of premium tags, ~500 rows): Standard-tier high-spenders. Forces the model to learn that spend + tenure matter, not just tier.
- **Explicit negatives** (~1K `not_premium`): Silver/Gold customers with `return_rate > 15%` — superficially eligible, behave poorly. Forces the model to combine features.

Affected-lot customers stay `NULL` (random slice of the catalog, not pre-tagged) — they're the predict-time cohort the agent uses to find "hidden premiums" CS missed.

### The Event

~5,000 order_items reference the affected lot. Orders between AFFECTED_LOT_DATE and +5 weeks (~8 to ~3 weeks ago). ~1,500 returns total (~30% rate). Returns follow a realistic curve: slow build (weeks 6-4 ago), sharp peak at SPIKE_PEAK (~3 weeks ago, ~500 returns that week → ~$180K vs ~$60K baseline), then gradual decay over the last 2 weeks as the affected inventory sells through (back toward ~$90K, then ~$70K). The peak should be clearly in the past, not at the chart edge. Return reason: predominantly "quality".

**Affected-lot region skew (so the dashboard map lights up EU):** affected-lot customers are NOT a random slice of the global catalog. Draw them ~60% EU / ~25% US / ~15% APAC (vs the global 20/70/10) — the affected SKUs are all Skincare, and Skincare buyers concentrate in Europe. Within EU, keep the country distribution (FR 30% / GB 25% / DE 20% / IT 15% / ES 10%), so FR and IT lead the affected count naturally. This single rule produces the map's "Europe lights up" story without forcing it.

### Raw table schemas (gen output)

ID formats: `CUST-NNNNNN` / `SKU-NNNN` / `LOT-YYYY-MMDD` / `ORD-YYYYMMDD-NNNNNN` / `RET-NNNNNNNN`. PKs in **bold**, FKs marked. Tables prefix with `raw_` (no bronze).

- **`raw_customers`** — **customer_id**, email, first_name, last_name, region (`US/EU/APAC`), country (ISO-2), city, `customer_lat`/`customer_lng` (DOUBLE, city anchor + ±0.05° jitter), registration_date, loyalty_tier (`standard/silver/gold`), `premium_status` (`'premium'`/`'not_premium'`/`NULL` per Premium-tagging rule).
- **`raw_products`** — **product_id**, product_name, category, subcategory, price_usd, cost_usd, launch_date, is_active.
- **`raw_production_lots`** — **lot_id**, product_id (FK), production_date, facility, quantity_produced (200–1000 normal; affected lot ~5K), status (`released/on_hold/recalled`).
- **`raw_orders`** — **order_id**, customer_id (FK), order_date, order_timestamp, region, subtotal_usd, shipping_usd, total_usd, status. **Order-level only** (one row per order). Per-line product/SKU info lives on `raw_order_items`.
- **`raw_order_items`** — order_id (FK), product_id (FK), lot_id (FK), quantity, unit_price_usd, line_total_usd. **No synthetic `order_item_id` here** — silver_order_items synthesizes `CONCAT(order_id, '-', product_id)` if needed.
- **`raw_returns`** — **return_id**, order_id (FK), customer_id (FK), product_id (FK), lot_id (FK), return_date, refund_amount_usd, return_reason (`quality/didnt_fit/wrong_item/changed_mind`), customer_comment, region, country, status (`pending`/`approved`/`rejected`).

---

## B. SDP Pipeline

**Skill to use**: `databricks-spark-declarative-pipelines` — read `SKILLS/databricks-spark-declarative-pipelines/SKILL.md` before implementing.

Create pipeline `luxebeauty_operations` transforming raw parquet → analytics tables.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs + trend + category split + forecast | revenue, orders, return_count, returns_usd, return_rate, refund_rate by date/region/category | `mv_returns` metric view (over `gold_daily_summary`, defined in `02-uc-governance.md`). AI_FORECAST reads through `MEASURE(total_refunds)` over the MV — same source as the KPI tiles. |
| Dashboard map + per-row Investigation widgets (products, lots, country splits, sentiment, comments) | per-return row with denormalized geo + product + lot + anger_score | `silver_returns` (widget-level GROUP BY for product/lot rollups — counts, not rates) |
| App's Operations queue (pending affected-lot returns) | bad-lot pending returns with customer name + email + GPS | `gold_customer_returns` |
| App's order-history drawer (Lakebase mirror) | order_id, customer_id, order_date, region, total_usd | `silver_orders` |
| Premium-classifier training (`03-ml-premium.md`) | one row per customer with features + premium label (only set on the ~4K labeled subset) | `gold_customer_features` |
| Dashboard/Genie premium-cohort answers | affected customers × predicted tier × country | `gold_customer_premium_predictions` (written by ML notebook in `03-ml-premium.md`) joined with affected-customer list from `silver_returns` |
| App agent (tiered offer) | per-customer `final_tier` (`'premium'` if labeled OR predicted) | `gold_customer_premium_predictions` (mirrored into Lakebase on app boot) |

### Raw layer (no bronze pass-through)

The data-gen step in Section A writes 5 Delta tables directly: `raw_customers`, `raw_products`, `raw_production_lots`, `raw_orders`, `raw_order_items`, `raw_returns`. SDP reads from these — there is no bronze layer (saves a redundant copy; the gen's output is already typed and clean).

### Raw → Silver (joins + expectations + `ai_classify` dedup MV)

Four silver materialized views — three facts (`silver_order_items`, `silver_returns`, `silver_orders`) plus one small dedup helper (`comment_anger_scores`).

**`comment_anger_scores`** — *the ai_classify showcase, sized down*. The synth uses a canned pool of ~20 distinct `customer_comment` strings across ~13K return rows. Running `ai_classify` per-row would issue 13K LLM calls; instead, build a small MV over `SELECT DISTINCT customer_comment FROM raw_returns` and call `ai_classify` once per distinct string:

```sql
SELECT customer_comment,
  CASE ai_classify(customer_comment,
        ARRAY('very_angry','angry','neutral','satisfied'))
    WHEN 'very_angry' THEN 1.0
    WHEN 'angry'      THEN 0.7
    WHEN 'neutral'    THEN 0.3
    ELSE 0.1
  END AS anger_score
FROM (SELECT DISTINCT customer_comment FROM raw_returns
      WHERE customer_comment IS NOT NULL)
```

Four classes (not three): `very_angry` (1.0) anchors the affected-lot cluster on the dashboard's sentiment bin; `angry` (0.7) covers other quality complaints; `neutral` (0.3) and `satisfied` (0.1) cover everyday returns. `silver_returns` joins back on `customer_comment` so every return inherits the score without a second LLM call. Talking-track: *"one built-in SQL function, no UDF, no separate sentiment service — and it scales because we dedup."*

**`silver_order_items`** — per-line denormalized. `raw_order_items` JOIN `raw_orders` (→ order_date, region) JOIN `raw_products` (→ product_name, category) LEFT JOIN `raw_production_lots` (→ facility, production_date). Synthetic `order_item_id = CONCAT(order_id, '-', product_id)`. Columns: `order_item_id`, `order_id`, `order_date` (DATE), `region`, `product_id`, `product_name`, `category`, `lot_id`, `facility`, `production_date`, `quantity`, `unit_price_usd`, `line_total_usd`. Cluster by `order_date`.

**`silver_returns`** — per-return denormalized fact. `raw_returns` JOIN `raw_products` JOIN `raw_customers` (→ city, customer_lat, customer_lng) JOIN `raw_orders` (→ order_date) JOIN `comment_anger_scores` (→ anger_score). Columns: `return_id`, `order_id`, `customer_id`, `product_id`, `product_name`, `category`, `lot_id`, `facility`, `return_date` (TIMESTAMP), `order_date` (DATE), `refund_amount_usd`, `return_reason`, `customer_comment` (also aliased `return_reason_text`), **`anger_score`** (COALESCE → 0.1 on no match), `country`, `city`, `customer_lat`, `customer_lng`, `region`, `status`, **`is_bad_lot`** (TRUE iff `lot_id = <AFFECTED>`). Cluster by `return_date`.

> All four geo columns (`country`, `city`, `customer_lat`, `customer_lng`) denormalize here so the dashboard bubble map + country panel don't need a re-join.

**`silver_orders`** — order-level passthrough for the Lakebase mirror in the app. Straight column projection from `raw_orders`: `order_id`, `customer_id`, `order_date` (DATE cast), `region`, `total_usd`, plus a `CAST(NULL AS STRING) AS status` (raw_orders has no order-level status in this synth; the app's drawer treats it as optional). 1 row per order. Powers the app's order-history drawer when an operator opens a customer's record.

### Silver → Gold (aggregations)

**Three gold MVs.** Per-product and per-lot rollups are computed at widget query time via `GROUP BY` on `silver_returns` (counts, not rates — same trade as the simple demo). `mv_returns` (defined in `02-uc-governance.md`) sits over `gold_daily_summary` and is the canonical metric layer for daily/regional/category aggregates — dashboard KPIs + Genie headline answers all read it.

**⚠️ Dashboard-filter contract.** Every aggregate consumed by the dashboard MUST carry `region` and `category` as filter dimensions — `gold_daily_summary` enforces this directly; `silver_returns` carries both for the widget-level rollups; `mv_returns` inherits them from `gold_daily_summary`. If a future gold MV is added, it MUST follow the same rule or the global filters silently stop applying to it.

**`gold_daily_summary`** — dims: `date`, `region`, `category`. Metrics: `order_count` (`COUNT(DISTINCT order_id)`), `items_sold` (`SUM(quantity)`), `revenue_usd` (`SUM(line_total_usd)`), `return_count`, `returns_usd` (`SUM(refund_amount_usd)`). **Orders leg** = `silver_order_items` rollup (carries `order_date`, `region`, `category` already denormalized — single `GROUP BY 1,2,3`, no join). **Returns leg** = `silver_returns` rollup. LEFT JOIN orders + returns on `(date, region, category)` so days with zero returns still appear.

**`gold_customer_returns`** — pending bad-lot returns for the Operations queue in the app. `silver_returns r` JOIN `raw_customers c` (→ first_name, last_name, email). `WHERE r.is_bad_lot = TRUE AND r.status = 'pending'`. Columns: `return_id`, `customer_id`, `first_name`, `last_name`, `email`, `country`, `city`, `customer_lat`, `customer_lng`, `region`, `product_id`, `product_name`, `lot_id`, `refund_amount_usd`, `return_date`, `anger_score`, `return_reason`, `customer_comment`, `status`. Powers the app's affected-customers map + tiered offer flow.

**`gold_customer_features`** — one row per customer, training/scoring input for the premium classifier in `03-ml-premium.md`. Pass-through dims from `raw_customers`: `customer_id`, `region`, `country`, `loyalty_tier`, `tenure_months` (DATEDIFF / 30 from `registration_date`), **`premium_status`** (the LABEL — `'premium'` / `'not_premium'` / `NULL`; only the non-null rows train). Features (~7 aggregations, all derivable from silver):
- `total_orders_lifetime` — `COUNT(DISTINCT order_id)` from `raw_orders` (order-grain; equivalent to silver_order_items since `total_usd = SUM(line_total)`)
- `total_spend_lifetime` — `SUM(total_usd)` from `raw_orders`
- `returns_lifetime` — `COUNT(return_id)` from `silver_returns`
- `lifetime_return_rate` — `returns_lifetime / total_orders_lifetime` (premium customers tend to return less)
- `avg_anger_score_lifetime` — `AVG(anger_score)` over `silver_returns`
- `avg_anger_score_last_90d` — `AVG(anger_score)` over `silver_returns WHERE return_date >= current_date() − 90` (`NULL` → coalesce to 0)
- `days_since_last_order` — `DATEDIFF(current_date(), MAX(order_date))`

Affected-lot customers are unlabeled (`premium_status IS NULL` for ~all 250) but have informative features (recent orders, recent returns) — the model predicts their `is_premium_predicted` and the agent uses it to tier the offer.

### Consumer routing

- `mv_returns` (over `gold_daily_summary`) → dashboard KPIs + category donut + AI_FORECAST input subquery, plus Genie headline answers. Same definitions on every surface (`02-uc-governance.md`).
- `silver_returns` → dashboard map + Investigation widgets (products, lots, country splits, sentiment, comments) via widget-level `GROUP BY`. No per-product / per-lot gold tables.
- `silver_orders` → Lakebase mirror feeder for the app's order-history drawer.
- `gold_customer_returns` → app's Operations queue (pending bad-lot returns + tiered-offer flow).
- `gold_customer_features` → premium classifier training only (`03-ml-premium.md`). Dashboard + Genie read the model's **output** (`gold_customer_premium_predictions`), not the features.

---

## C. PDF Generation

**Skill to use**: `databricks-unstructured-pdf-generation` — read `SKILLS/databricks-unstructured-pdf-generation/SKILL.md` before implementing.

Generate ~10 PDFs in `{raw_data_volume}/incident_pdf/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Routine Lyon facility docs (resolved incidents, QC summaries, maintenance logs, supplier audits, safety inspections). NO mention of affected lot or texture issues.

**Key document**: Production Incident Report PIR-{YYYY}-{MMDD} matching AFFECTED_LOT_DATE. Facility: Lyon. Reporter: Marc Dupont, Production Supervisor. Equipment: Homogenizer Unit HMG-03. Issue: pressure gauge fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar). Cause: calibration drift in pressure regulation valve. Affected: SKU-1001/1002/1003 (~5,000 units). QC assessment: "Some units may exhibit minor texture variations due to the pressure fluctuations during emulsification. This is a cosmetic variation only and does not affect product safety or efficacy." Disposition: RELEASED for distribution.

---

## D. Validation

Run before `03-ml-premium.md`. Each row = a one-line query the LLM writes against the table; if it fails, fix the synth before publishing downstream resources.

**Load-bearing (must pass — these gate the story):**
- **Returns spike, peak in past** — weekly `SUM(returns_usd)` from `gold_daily_summary`: peak ~$180K ~3w ago, decay ~$90K → $70K, baseline ~$60K. Peak NOT in the current week.
- **Two clearly separated seasonal peaks** — weekly orders from `gold_daily_summary` show Black Friday week (~Nov 28) and Christmas (~Dec 21) as distinct spikes, with a visible Dec 1–10 dip between them. If they merge into one Q4 lump, regenerate.
- **Affected lot is the common thread** — top `lot_id` by `COUNT(*)` for `product_id IN (SKU-1001/1002/1003)` has ~1,500 returns; the next lot is an order of magnitude smaller.
- **EU skew on the affected lot** — `silver_returns WHERE lot_id = <AFFECTED>` GROUP BY region → EU ≥55%, US ~25%, APAC ~15%. GROUP BY country → FR first, then IT or GB. GROUP BY city → Paris first (≥30 distinct customers), then London / Milan / Madrid / Berlin.
- **`anger_score` separates** — `AVG(anger_score)` on affected-lot rows ≥ 0.6 (texture comments classified `very_angry`/`angry`); on non-quality returns ≤ 0.3.
- **`comment_anger_scores` dedup is doing its job** — `COUNT(DISTINCT customer_comment) << COUNT(*)` on `raw_returns`. The MV row count should match the distinct count.
- **Premium tags separate** — `gold_customer_features` GROUP BY premium_status: `'premium'` rows show ≥ 2.5× the spend and ≤ 0.5× the return rate of `NULL`/`not_premium`. If this fails, the model won't train (`03-ml-premium.md` breaks).
- **`gold_customer_returns` populated** — should have a few hundred rows (the pending bad-lot returns) so the app's Operations queue has something to render.
- **Texture vocabulary present** — `silver_returns WHERE is_bad_lot` `customer_comment` includes *"grainy"*, *"separated"*, *"watery"*.

**Smoke checks** (the LLM derives these — verify upstream invariants didn't break): tag counts roughly hit targets (~3K premium / ~1K not_premium / ~46K NULL, pass-through to `gold_customer_features`); `region` enum is `{US, EU, APAC}`; GPS columns non-null and in earth-bounds (lat in [-90,90], lng in [-180,180]); `gold_customer_features` features non-null.

Add `pipeline_id` to `resources.json`.
