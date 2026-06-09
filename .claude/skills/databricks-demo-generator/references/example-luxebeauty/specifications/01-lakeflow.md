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

**Time references**: `STORY_END_DATE = NOW`, `STORY_START_DATE = NOW − 13 months`, `AFFECTED_LOT_DATE = NOW − 8 weeks`, `SPIKE_PEAK = NOW − 3 weeks`, `DECAY_START = NOW − 2 weeks`. **Causal chain**: lot produced at −8w → ships + sells weeks −7 to −4 → customers receive, return → returns build weeks −6 to −4 → peak at −3w → decay −2w to now. The 5-week gap between cause and effect leaves room for the forecast-line annotation to land clearly to the LEFT of the bump. Peak in the past, never at the rightmost edge of charts.

> Numbers in this file are demo targets, not invariants — match the narrative shape, don't sweat ±10%. Parallelization rules live in `SKILL.md` → **Parallelization with Subagents**.

---

## A. Synthetic Data Generation

**Skill**: `databricks-synthetic-data-gen` (read `SKILLS/databricks-synthetic-data-gen/SKILL.md`). Use the pre-provisioned databricks-connect venv (Python 3.12 + faker + numpy + pandas + holidays + pyarrow) — system prompt has the path; do NOT create a new venv.

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

### Comment pool (`return_reason_text`)

~15 hand-coded strings in 3 tones — keeps synth deterministic and gives `ai_classify` a clear signal. **Angry**: assertive / irritated / threatens to leave (must include the Shared-Context texture phrases verbatim). **Neutral**: measured ("didn't agree with my skin", "seems different from before"). **Benign**: no quality concern ("wrong shade", "ordered by mistake", "bought as gift").

**Distribution** (the model's training signal): affected-lot → 80% angry / 20% neutral · other quality returns → 20% angry / 80% neutral · `didnt_fit` / `wrong_item` / `changed_mind` → 100% benign.

### Premium tagging (label for the ML model)

CS has hand-tagged some customers `premium` / `not_premium` over time; everyone else is `NULL` — that's the unlabeled cohort the model in `03-ml-premium.md` scores. **Target counts**: ~3K `'premium'`, ~1K `'not_premium'`, ~46K `NULL` (±20% OK).

**Premium target profile** (the features the model must learn, derived from behavior — verified in Section D): ~3× median spend, 2–3× median order count, 3–5% return rate (vs 8–10% normal), tenure ≥ 6mo, skewed Gold/Silver.

**Tagging recipe** — set `bronze_customers.premium_status` in the synth before writing `customers.parquet`. Mix three sources so tier alone won't predict it:
- **Tier-correlated** (~80% of premium tags): mostly Gold (~50% of Gold customers), some top-spending Silver (~top 40% of Silver).
- **"Surprise tags"** (~10% of premium tags, ~500 rows): Standard-tier high-spenders. Forces the model to learn that spend + tenure matter, not just tier.
- **Explicit negatives** (~1K `not_premium`): Silver/Gold customers with `return_rate > 15%` — superficially eligible, behave poorly. Forces the model to combine features.

Affected-lot customers stay `NULL` (random slice of the catalog, not pre-tagged) — they're the predict-time cohort the agent uses to find "hidden premiums" CS missed.

### The Event

~5,000 order_items reference the affected lot. Orders between AFFECTED_LOT_DATE and +5 weeks (~8 to ~3 weeks ago). ~1,500 returns total (~30% rate). Returns follow a realistic curve: slow build (weeks 6-4 ago), sharp peak at SPIKE_PEAK (~3 weeks ago, ~500 returns that week → ~$180K vs ~$60K baseline), then gradual decay over the last 2 weeks as the affected inventory sells through (back toward ~$90K, then ~$70K). The peak should be clearly in the past, not at the chart edge. Return reason: predominantly "quality".

**Affected-lot region skew (so the dashboard map lights up EU):** affected-lot customers are NOT a random slice of the global catalog. Draw them ~60% EU / ~25% US / ~15% APAC (vs the global 20/70/10) — the affected SKUs are all Skincare, and Skincare buyers concentrate in Europe. Within EU, keep the country distribution (FR 30% / GB 25% / DE 20% / IT 15% / ES 10%), so FR and IT lead the affected count naturally. This single rule produces the map's "Europe lights up" story without forcing it.

### Table Schemas

ID formats: `CUST-NNNNNN` / `SKU-NNNN` / `LOT-YYYY-MMDD` / `ORD-YYYYMMDD-NNNNNN` / `OI-NNNNNNNNN` / `RET-NNNNNNNN`. PKs in **bold**, FKs marked.

- **`customers`** — **customer_id**, email, first_name, last_name, region (`US/EU/APAC`), country (ISO-2), city, `customer_lat`/`customer_lng` (DOUBLE, city anchor + ±0.05° jitter), registration_date, loyalty_tier (`standard/silver/gold`), `premium_status` (`'premium'`/`'not_premium'`/`NULL` per Premium-tagging rule).
- **`products`** — **product_id**, product_name, category, subcategory, price_usd, cost_usd, launch_date, is_active.
- **`production_lots`** — **lot_id**, product_id (FK), production_date, facility, quantity_produced (200–1000 normal; affected lot ~5K), status (`released/on_hold/recalled`).
- **`orders`** — **order_id**, customer_id (FK), order_date, order_timestamp, region, subtotal_usd, shipping_usd, total_usd, status.
- **`order_items`** — **order_item_id**, order_id (FK), product_id (FK), lot_id (FK), quantity, unit_price_usd, line_total_usd.
- **`returns`** — **return_id**, order_item_id (FK), return_date, return_timestamp, refund_amount_usd, return_reason (`quality/didnt_fit/wrong_item/changed_mind`), return_reason_text.

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

### Consumer routing

- `mv_returns` (over `gold_daily_summary`) → dashboard KPIs + category donut, Genie headline answers. Same definitions on both surfaces (`02-uc-governance.md`).
- `gold_daily_summary` → dashboard forecast widget (AI_FORECAST needs a raw subquery, can't go through MV).
- `silver_returns` → dashboard map + Investigation widgets (products, lots, country splits, sentiment, comments) via widget-level `GROUP BY`. No per-product / per-lot gold tables.
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
- **Affected lot is the common thread** — top `lot_id` by `COUNT(*)` for `product_id IN (SKU-1001/1002/1003)` has ~1,500 returns; the next lot is an order of magnitude smaller.
- **EU skew on the affected lot** — `silver_returns WHERE lot_id = <AFFECTED>` GROUP BY region → EU ≥55%, US ~25%, APAC ~15%. GROUP BY country → FR first, then IT or GB. GROUP BY city → Paris first (≥30 distinct customers), then London / Milan / Madrid / Berlin.
- **`anger_score` separates** — `AVG(anger_score)` on affected-lot rows ≥ 0.6; on non-quality returns ≤ 0.2.
- **Premium tags separate** — `gold_customer_features` GROUP BY premium_status: `'premium'` rows show ≥ 2.5× the spend and ≤ 0.5× the return rate of `NULL`/`not_premium`. If this fails, the model won't train (`03-ml-premium.md` breaks).
- **Texture vocabulary present** — `silver_returns WHERE is_bad_lot` `return_reason_text` includes *"grainy"*, *"separated"*, *"watery"*.

**Smoke checks** (the LLM derives these — verify upstream invariants didn't break): tag counts roughly hit targets (~3K premium / ~1K not_premium / ~46K NULL, pass-through to `gold_customer_features`); `region` enum is `{US, EU, APAC}`; GPS columns non-null and in earth-bounds (lat in [-90,90], lng in [-180,180]); `gold_customer_features` features non-null.

Add `pipeline_id` to `resources.json`.
