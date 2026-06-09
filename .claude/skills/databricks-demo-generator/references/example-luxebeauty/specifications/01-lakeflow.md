# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Affected products** (deterministic — must exist with these exact values):

| product_id | product_name | category | subcategory | price_usd | cost_usd |
|------------|--------------|----------|-------------|-----------|----------|
| SKU-1001 | Hydrating Serum 30ml | Skincare | Serums | 68.00 | 12.00 |
| SKU-1002 | Vitamin C Cream 50ml | Skincare | Creams | 55.00 | 10.00 |
| SKU-1003 | HA Moisture Boost 15ml | Skincare | Serums | 42.00 | 8.00 |

**Affected lot**: LOT-{YYYY}-{MMDD} based on AFFECTED_LOT_DATE, Lyon facility, ~1,700 units/SKU (~5,000 total), status: released.

**Texture complaints** (subset of the *angry* comment pool — see Section A, comment-tone rule — used predominantly for affected-lot returns): "Cream has grainy texture, not smooth like usual" / "Product separated in the jar, looks curdled" / "Consistency is watery, doesn't feel right" / "Texture feels off compared to my last purchase" / "Serum looks cloudy and thick, not like before" / "Product texture has changed, feels gritty"

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, AFFECTED_LOT_DATE = NOW - 8 weeks, SPIKE_PEAK = NOW - 3 weeks, DECAY_START = NOW - 2 weeks. The spike should be clearly visible in the past with a decay curve back toward normal — NOT ongoing at the rightmost edge of charts.

Important reminder: these are generated guidance for you to generate pyspark databricks connect code, if some numbers don't exactly sum up during the implementation it's ok, keep it simple, and just ensure we respect the demo narrative.

---

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.


## A. Synthetic Data Generation

**Skill to use**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` before implementing.

**Python runtime**: use the pre-provisioned databricks-connect venv (its path is in the system prompt under "Pre-provisioned databricks-connect venv"). Do NOT create a new venv or install databricks-connect — the shared venv already has Python 3.12, databricks-connect, faker, numpy, pandas, holidays, and pyarrow.

**Important note**: when generating this file, ensure the math are correct if you use exact numbers - keep it approximative to avoid incoherences.

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| customers.parquet | ~50K | Region: US 70%, EU 20%, APAC 10%. Loyalty: standard 60%, silver 30%, gold 10% |
| products.parquet | ~80 | Skincare ~40 ($25-120), Makeup ~25 ($15-65), Haircare ~15 ($18-45) |
| production_lots.parquet | ~1.5K | Format: LOT-YYYY-MMDD. Status: released/on_hold/recalled |
| orders.parquet | ~200K | ~3,800/week baseline with seasonality |
| order_items.parquet | ~320K | ~1.6 items/order avg. Assign lot_id using FIFO per product |
| returns.parquet | ~25K | ~8% normal return rate |

### Data Variation

Orders seasonality: Black Friday 3x, Holiday (Dec 15-31) 2.2x, Mother's Day 2x, Valentine's 1.8x, Summer (Jun-Aug) 0.75x, ±15% daily noise.

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

### Comment pool (return_reason_text)

Pick from ~15 short canned strings hand-coded in synth, grouped in 3 tones — keeps the data generation fast and deterministic and lets `ai_classify` (Section B) extract a useful sentiment signal in SDP:
- **Angry** (~5 strings, includes the texture complaints listed in Shared Context): assertive, irritated, threatens to leave — used predominantly for affected-lot returns.
- **Neutral** (~5 strings): "texture wasn't what I expected", "didn't agree with my skin", "product seems different from before" — measured tone, no escalation.
- **Benign** (~5 strings): "wrong shade", "ordered by mistake", "didn't suit me", "bought as gift" — no quality concern at all.

**Distribution rule (matters for the model):**
- Affected-lot returns → 80% angry / 20% neutral
- Other quality returns → 20% angry / 80% neutral
- Benign-reason returns (`didnt_fit`, `wrong_item`, `changed_mind`) → 100% benign

### Premium tagging (label for the ML model)

> **Build agent: this section is your algorithm for setting `bronze_customers.premium_status`.** Implement the tagging rules below directly in the synth code that writes `customers.parquet`. The numbers (50% / 10% / 1%) are concrete targets — meet them within ±20%. The behavioral profile table is the constraint your tags must satisfy: when SDP aggregates this data into `gold_customer_features`, the `premium_status='premium'` rows must show ≥ 2.5× the spend and ≤ 0.5× the return rate of the rest (verified in Section D). If they don't, the model in `03-ml-premium.md` won't train.

The story: Customer Service has manually tagged a subset of customers as `premium` (or explicitly `not_premium`) over time. Everyone else is untagged — that's the unlabeled cohort the model in `03-ml-premium.md` will score.

**The defining behavioral profile** (this is what the model has to learn — features in `gold_customer_features` must reflect it):

| Signal | Premium customer | Standard customer |
|---|---|---|
| `total_spend_lifetime` | ~3× the median customer | around the median |
| `total_orders_lifetime` | 2–3× the median (engaged buyers) | around the median |
| `lifetime_return_rate` | low (~3–5%) | normal (~8–10%) |
| `tenure_months` | ≥ 6mo, skews older | mixed (includes new accounts) |
| `loyalty_tier` | skewed toward Gold/Silver | mixed |

**Tagging rules (apply to bronze_customers.premium_status, in this order):**

1. **Tag ~50% of Gold-tier customers as `'premium'`** (Gold = ~10% of base = ~5K customers → ~2.5K premium tags here).
2. **Tag ~10% of Silver-tier customers as `'premium'`** (Silver = ~30% = ~15K → ~1.5K). **But** restrict to those whose lifetime spend is in the top 40% of Silver — CS doesn't tag mid-spend Silvers.
3. **Tag ~1% of Standard-tier customers as `'premium'`** — the **"surprise tags"** (Standard-tier high-spenders, journalists, friends-of-CEO). ~500 rows. These are the model's hardest learning signal: tier alone isn't enough; spend + tenure matter.
4. Cap the total at ~3,000 premium tags by random subsample if the above overshoots.
5. **Tag ~1,000 customers as `'not_premium'`** by sampling from `loyalty_tier IN ('silver','gold') AND lifetime_return_rate > 15%` — explicit negatives that look superficially eligible (mid-high tier) but behave poorly. These force the model to learn that tier alone doesn't decide premium.
6. **Everyone else → `NULL`** (~46K). Includes all 250 affected-lot customers (they're a random slice of the catalog, not pre-tagged).

The model in `03-ml-premium.md` trains on the ~4K labeled rows, scores the ~46K unlabeled. The "surprise tags" in rule 3 and the high-return negatives in rule 5 are what force the model to combine features rather than memorize `loyalty_tier`.

### The Event

~5,000 order_items reference the affected lot. Orders between AFFECTED_LOT_DATE and +5 weeks (~8 to ~3 weeks ago). ~1,500 returns total (~30% rate). Returns follow a realistic curve: slow build (weeks 6-4 ago), sharp peak at SPIKE_PEAK (~3 weeks ago, ~500 returns that week → ~$180K vs ~$60K baseline), then gradual decay over the last 2 weeks as the affected inventory sells through (back toward ~$90K, then ~$70K). The peak should be clearly in the past, not at the chart edge. Return reason: predominantly "quality".

**Affected-lot region skew (so the dashboard map lights up EU):** affected-lot customers are NOT a random slice of the global catalog. Draw them ~60% EU / ~25% US / ~15% APAC (vs the global 20/70/10) — the affected SKUs are all Skincare, and Skincare buyers concentrate in Europe. Within EU, keep the country distribution (FR 30% / GB 25% / DE 20% / IT 15% / ES 10%), so FR and IT lead the affected count naturally. This single rule produces the map's "Europe lights up" story without forcing it.

### Table Schemas

**customers**: `customer_id` (PK, CUST-NNNNNN), `email`, `first_name`, `last_name`, `region`, `country` (ISO-2, distributed per region above), **`city`** (string, picked from the city-anchor table above), **`customer_lat`** + **`customer_lng`** (DOUBLE PRECISION, city anchor + ±0.05° jitter), `registration_date`, `loyalty_tier`, `premium_status` (`'premium'` / `'not_premium'` / `NULL` per the Premium tagging rule above — drives the model label)

**products**: `product_id` (PK, SKU-NNNN), `product_name`, `category`, `subcategory`, `price_usd`, `cost_usd`, `launch_date`, `is_active`

**production_lots**: `lot_id` (PK), `product_id` (FK), `production_date`, `facility`, `quantity_produced` (200-1000), `status`

**orders**: `order_id` (PK, ORD-YYYYMMDD-NNNNNN), `customer_id` (FK), `order_date`, `order_timestamp`, `region`, `subtotal_usd`, `shipping_usd`, `total_usd`, `status`

**order_items**: `order_item_id` (PK, OI-NNNNNNNNN), `order_id` (FK), `product_id` (FK), `lot_id` (FK), `quantity`, `unit_price_usd`, `line_total_usd`

**returns**: `return_id` (PK, RET-NNNNNNNN), `order_item_id` (FK), `return_date`, `return_timestamp`, `refund_amount_usd`, `return_reason`, `return_reason_text`

---

## B. SDP Pipeline

**Skill to use**: `databricks-spark-declarative-pipelines` — read `SKILLS/databricks-spark-declarative-pipelines/SKILL.md` before implementing.

Create pipeline `luxebeauty_operations` transforming raw parquet → analytics tables.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs + trend + category split | revenue, orders, return_count, returns_usd, return_rate, refund_rate by date/region/category | `mv_returns` metric view (over `gold_daily_summary`, defined in `02-uc-governance.md`) |
| Dashboard forecast | weekly `returns_usd` for `AI_FORECAST` | `gold_daily_summary` directly (TVF can't go through MV) |
| Dashboard map + per-row Investigation widgets (products, lots, country splits, sentiment, comments) | per-return row with denormalized geo + product + lot + anger_score | `silver_returns` (widget-level GROUP BY for product/lot rollups — counts, not rates) |
| Premium-classifier training (`03-ml-premium.md`) | one row per customer with features + premium label (only set on the ~4K labeled subset) | `gold_customer_features` |
| Dashboard/Genie premium-cohort answers | affected customers × predicted tier × country | `gold_customer_premium_predictions` (written by ML notebook in `03-ml-premium.md`) joined with affected-customer list from `silver_returns` |
| App agent (tiered offer) | per-customer `final_tier` (`'premium'` if labeled OR predicted) | `gold_customer_premium_predictions` (mirrored into Lakebase on app boot) |

### Source → Bronze (1:1 ingestion)

customers/products/production_lots/orders/order_items/returns.parquet → bronze_{table_name}

### Bronze → Silver (joins + expectations)

**silver_order_items**: order_items JOIN orders (→ order_date, region) JOIN products (→ product_name, category) JOIN production_lots (→ facility, production_date). Expectations: `order_item_id IS NOT NULL`, `order_id IS NOT NULL`, `product_id IS NOT NULL`. Columns: order_item_id, order_id, order_date, region, product_id, product_name, category, lot_id, facility, production_date, quantity, unit_price_usd, line_total_usd.

**silver_returns**: returns JOIN silver_order_items ON order_item_id JOIN bronze_orders ON order_id JOIN bronze_customers ON customer_id. Expectations: `return_id IS NOT NULL`, `order_item_id IS NOT NULL`. Columns: return_id, customer_id (FK), order_item_id, order_date, region (= `bronze_orders.region` — matches `gold_daily_summary.region`), **country**, **city**, **customer_lat**, **customer_lng** (all four from bronze_customers, denormalized here so the dashboard bubble map + country panel don't need a re-join), product_id, product_name, category, lot_id, facility, return_date, refund_amount_usd, return_reason, return_reason_text, days_to_return, **`anger_score`**, **`is_bad_lot`** (TRUE iff `lot_id = <AFFECTED>` — drives the Investigation page's affected-vs-everyday splits).

> **`anger_score` — the `ai_classify` showcase.** Compute as `CASE ai_classify(return_reason_text, ARRAY('angry','neutral','benign')) WHEN 'angry' THEN 1.0 WHEN 'neutral' THEN 0.5 ELSE 0.0 END`. One built-in SQL function, no UDF, no separate sentiment service. Consumed in two places: (1) as a feature in `gold_customer_features` (`avg_anger_score_last_90d`, an input to the premium classifier in `03-ml-premium.md`), and (2) exposed per-return in the Returns Console app — the Operations queue is sortable by anger score so operators can prioritize the most upset customers first.
>
> **Implementation: run `ai_classify` once, at the bronze→silver step, and not again.** Compute `anger_score` inside `silver_returns` and have every downstream view (`silver_lots`, `gold_*`, `gold_customer_features`) read it from silver — re-calling `ai_classify` on bronze from a second MV silently doubles the pipeline runtime. Keep the input small too: only the bad-lot returns drive the demo's anger narrative, so the rest can default to a low score without going through the model.

### Silver → Gold (aggregations)

**Only two gold MVs.** Per-product and per-lot rollups are computed at widget query time via `GROUP BY` on `silver_returns` (counts, not rates — same trade as the simple demo). `mv_returns` (defined in `02-uc-governance.md`) sits over `gold_daily_summary` and is the canonical metric layer for daily/regional/category aggregates — dashboard KPIs + Genie headline answers + trend chart all read it.

**⚠️ Dashboard-filter contract.** Every aggregate consumed by the dashboard MUST carry `region` and `category` as filter dimensions — `gold_daily_summary` enforces this directly; `silver_returns` carries both for the widget-level rollups; `mv_returns` inherits them from `gold_daily_summary`. If a future gold MV is added, it MUST follow the same rule or the global filters silently stop applying to it.

**gold_daily_summary** — dims: date, region, category. Metrics: order_count (COUNT DISTINCT order_id), items_sold (SUM quantity), revenue_usd (SUM line_total_usd), return_count (COUNT returns), returns_usd (SUM refund_amount_usd). **Returns leg pulls `region` from `bronze_orders` via the return's `order_id`** so it joins cleanly with the orders leg.

**gold_customer_features** — one row per customer, training/scoring input for the premium classifier in `03-ml-premium.md`. Pass-through dims from `bronze_customers`: `customer_id`, `region`, `country`, `loyalty_tier`, `tenure_months` (DATEDIFF / 30 from `registration_date`), **`premium_status`** (the LABEL — `'premium'` / `'not_premium'` / `NULL`; only the non-null rows train). Features (~6 aggregations, all derivable from silver):
- `total_orders_lifetime` — `COUNT(DISTINCT order_id)` from silver_order_items
- `total_spend_lifetime` — `SUM(line_total_usd)` from silver_order_items (high signal for premium)
- `returns_lifetime` — `COUNT(return_id)` from silver_returns
- `lifetime_return_rate` — `returns_lifetime / total_orders_lifetime` (premium customers tend to return less)
- `avg_anger_score_last_90d` — `AVG(anger_score)` over silver_returns where `return_date >= STORY_END_DATE - 90` (`NULL` → coalesce to 0)
- `days_since_last_order` — `DATEDIFF(STORY_END_DATE, MAX(order_date))`

Affected-lot customers are unlabeled (`premium_status IS NULL` for ~all 250) but have informative features (recent orders, recent returns) — the model predicts their `is_premium_predicted` and the agent uses it to tier the offer.

### Column Reference (contract for 03-ml-premium.md and 04-ai-bi.md)

| Table / View | Filter Columns | Metric Columns |
|---|---|---|
| `mv_returns` (over `gold_daily_summary`) | date, region, category | `total_revenue`, `total_refunds`, `order_count`, `return_count`, `return_rate`, `refund_rate` (see `02-uc-governance.md`) |
| `gold_daily_summary` | date, region, category | revenue_usd, order_count, items_sold, return_count, returns_usd |
| `silver_returns` | return_date, region, country, category, lot_id, product_id, is_bad_lot | refund_amount_usd, anger_score, return_reason, return_reason_text, customer_lat/lng |
| `gold_customer_features` | region, country, loyalty_tier, premium_status | customer_id, total_orders_lifetime, total_spend_lifetime, returns_lifetime, lifetime_return_rate, avg_anger_score_last_90d, days_since_last_order, tenure_months |

> `mv_returns` is the canonical daily/regional/category aggregate — dashboard + Genie headline answers go through it. The dashboard's forecast widget bypasses the MV (AI_FORECAST needs a raw subquery) and reads `gold_daily_summary` directly. Investigation widgets (products, lots, country splits, sentiment, comments, map) read `silver_returns` and roll up via widget-level `GROUP BY` — no per-product / per-lot gold tables. `gold_customer_features` is consumed by the premium classifier in `03-ml-premium.md` only — not by Genie or the dashboard (those read the model's *output*, `gold_customer_premium_predictions`).

---

## C. PDF Generation

**Skill to use**: `databricks-unstructured-pdf-generation` — read `SKILLS/databricks-unstructured-pdf-generation/SKILL.md` before implementing.

Generate ~10 PDFs in `{raw_data_volume}/incident_pdf/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Routine Lyon facility docs (resolved incidents, QC summaries, maintenance logs, supplier audits, safety inspections). NO mention of affected lot or texture issues.

**Key document**: Production Incident Report PIR-{YYYY}-{MMDD} matching AFFECTED_LOT_DATE. Facility: Lyon. Reporter: Marc Dupont, Production Supervisor. Equipment: Homogenizer Unit HMG-03. Issue: pressure gauge fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar). Cause: calibration drift in pressure regulation valve. Affected: SKU-1001/1002/1003 (~5,000 units). QC assessment: "Some units may exhibit minor texture variations due to the pressure fluctuations during emulsification. This is a cosmetic variation only and does not affect product safety or efficacy." Disposition: RELEASED for distribution.

---

## D. Validation

Run before proceeding to 03-ml-premium.md.

| Check | Query | Expected |
|-------|-------|----------|
| Returns spike | `SELECT DATE_TRUNC('week', date) as week, SUM(returns_usd) FROM gold_daily_summary GROUP BY 1 ORDER BY 1 DESC LIMIT 10` | Peak week ~$180K, recent weeks decaying (~$90K→$70K), baseline ~$60K |
| Problem products | `SELECT product_id, product_name, COUNT(*) AS n FROM silver_returns GROUP BY 1,2 ORDER BY n DESC LIMIT 5` | SKU-1001/1002/1003 dominate the top |
| Common lot | `SELECT lot_id, COUNT(*) AS n FROM silver_returns WHERE product_id IN ('SKU-1001','SKU-1002','SKU-1003') GROUP BY 1 ORDER BY n DESC LIMIT 5` | One lot, ~1,500 returns; next is an order of magnitude smaller |
| Texture feedback | `SELECT return_reason_text FROM silver_returns WHERE is_bad_lot LIMIT 20` | Contains "grainy", "separated", "watery" |
| Filter dims | `SELECT DISTINCT region FROM gold_daily_summary` | US, EU, APAC |
| Countries seeded | `SELECT country, COUNT(*) FROM bronze_customers GROUP BY 1` | 9 countries with proportions per the country distribution above |
| Affected lot leans EU | `SELECT region, COUNT(*) FROM silver_returns WHERE lot_id = '<AFFECTED_LOT>' GROUP BY 1` | EU dominant (~60%), then US (~25%), APAC (~15%) — drives the map narrative |
| Affected lot top countries | `SELECT country, COUNT(*) FROM silver_returns WHERE lot_id = '<AFFECTED_LOT>' GROUP BY 1 ORDER BY 2 DESC LIMIT 3` | FR leads, then either IT or GB, then US — confirms the map will light up EU |
| Affected lot top cities | `SELECT city, COUNT(DISTINCT customer_id) AS n FROM silver_returns WHERE lot_id = '<AFFECTED_LOT>' GROUP BY 1 ORDER BY n DESC LIMIT 5` | Paris in top spot (≥ ~30 affected customers), followed by London / Milan / Madrid / Berlin in some order — confirms the bubble map will have one clearly-largest dot over Europe |
| GPS coords populated | `SELECT COUNT(*) FROM bronze_customers WHERE customer_lat IS NULL OR customer_lng IS NULL` | 0 |
| GPS coords inside Earth | `SELECT MIN(customer_lat), MAX(customer_lat), MIN(customer_lng), MAX(customer_lng) FROM bronze_customers` | lat in [-90, 90], lng in [-180, 180] — guards against off-by-one bugs in the city table |
| Anger score on affected lot | `SELECT AVG(anger_score) FROM silver_returns WHERE lot_id = '<AFFECTED_LOT>'` | ≥ 0.6 (skewed angry) |
| Anger score baseline | `SELECT AVG(anger_score) FROM silver_returns WHERE return_reason <> 'quality'` | ≤ 0.2 (skewed benign) |
| Premium tags seeded | `SELECT premium_status, COUNT(*) FROM bronze_customers GROUP BY 1` | ~3K `'premium'`, ~1K `'not_premium'`, ~46K NULL |
| Premium labels reach gold | `SELECT premium_status, COUNT(*) FROM gold_customer_features GROUP BY 1` | matches the bronze counts (pass-through) |
| Premium behavior separates from standard | `SELECT premium_status, AVG(total_spend_lifetime), AVG(lifetime_return_rate) FROM gold_customer_features GROUP BY 1` | premium avg spend ≥ 2.5× the NULL/not_premium avg; premium return rate ≤ 0.5× the standard rate — if not, the tagging rules above weren't followed and the model will fail |
| Features non-null | `SELECT COUNT(*) FROM gold_customer_features WHERE avg_anger_score_last_90d IS NULL OR total_spend_lifetime IS NULL` | 0 |
| Column names | `DESCRIBE gold_daily_summary` / `DESCRIBE silver_returns` / `DESCRIBE gold_customer_features` | Match specs above |

Add pipeline_id to `resources.json`.
