# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Affected products** (deterministic — must exist with these exact values):

| product_id | product_name | category | subcategory | price_usd | cost_usd |
|------------|--------------|----------|-------------|-----------|----------|
| SKU-1001 | Hydrating Serum 30ml | Skincare | Serums | 68.00 | 12.00 |
| SKU-1002 | Vitamin C Cream 50ml | Skincare | Creams | 55.00 | 10.00 |
| SKU-1003 | HA Moisture Boost 15ml | Skincare | Serums | 42.00 | 8.00 |

**Affected lot**: LOT-{YYYY}-{MMDD} based on AFFECTED_LOT_DATE, Lyon facility, ~1,700 units/SKU (~5,000 total), status: released.

**Texture complaints** (return_reason_text for affected lot): "Cream has grainy texture, not smooth like usual" / "Product separated in the jar, looks curdled" / "Consistency is watery, doesn't feel right" / "Texture feels off compared to my last purchase" / "Serum looks cloudy and thick, not like before" / "Product texture has changed, feels gritty"

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, AFFECTED_LOT_DATE = NOW - 8 weeks, SPIKE_PEAK = NOW - 3 weeks, DECAY_START = NOW - 2 weeks. The spike should be clearly visible in the past with a decay curve back toward normal — NOT ongoing at the rightmost edge of charts.

Important reminder: these are generated guidance for you to generate pyspark databricks connect code, if some numbers don't exactly sum up during the implementation it's ok, keep it simple, and just ensure we respect the demo narrative.

---

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.


## A. Synthetic Data Generation

**Skill to use**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` before implementing.

**Python runtime**: use **Python 3.12** for data-gen (matches Databricks serverless). Running 3.11 locally against serverless causes pickle/UDF mismatches.

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

Product popularity (Pareto): top 20% = 60% of sales, 5-8 hero products per category at 3x volume. Natural return rates: complex skincare ~12%, simple haircare ~5%.

Customer behavior: Gold tier 2.5x frequency / 1.8x basket / 5% returns, Silver 1.5x/1.3x, Standard baseline/10% returns, ~30% one-time buyers.

Return timing: 60% within 7 days, 30% within 8-21 days, 10% within 22-30 days.

Production facilities: Lyon 50% (Skincare), Milan 30% (Makeup), Singapore 20% (Haircare).

### The Event

~5,000 order_items reference the affected lot. Orders between AFFECTED_LOT_DATE and +5 weeks (~8 to ~3 weeks ago). ~1,500 returns total (~30% rate). Returns follow a realistic curve: slow build (weeks 6-4 ago), sharp peak at SPIKE_PEAK (~3 weeks ago, ~500 returns that week → ~$180K vs ~$60K baseline), then gradual decay over the last 2 weeks as the affected inventory sells through (back toward ~$90K, then ~$70K). The peak should be clearly in the past, not at the chart edge. Return reason: predominantly "quality".

### Table Schemas

**customers**: `customer_id` (PK, CUST-NNNNNN), `email`, `first_name`, `last_name`, `region`, `registration_date`, `loyalty_tier`

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
| Dashboard KPIs | revenue, orders, items, return_count, returns_usd by date/region/category | gold_daily_summary |
| Dashboard products | SKU-level return rates with region/category filtering | gold_returns_by_product |
| Genie investigation | Trace returns → products → lot → feedback | gold_returns_by_lot + silver_returns |

### Source → Bronze (1:1 ingestion)

customers/products/production_lots/orders/order_items/returns.parquet → bronze_{table_name}

### Bronze → Silver (joins + expectations)

**silver_order_items**: order_items JOIN orders (→ order_date, region) JOIN products (→ product_name, category) JOIN production_lots (→ facility, production_date). Expectations: `order_item_id IS NOT NULL`, `order_id IS NOT NULL`, `product_id IS NOT NULL`. Columns: order_item_id, order_id, order_date, region, product_id, product_name, category, lot_id, facility, production_date, quantity, unit_price_usd, line_total_usd.

**silver_returns**: returns JOIN silver_order_items ON order_item_id. Expectations: `return_id IS NOT NULL`, `order_item_id IS NOT NULL`. Columns: return_id, order_item_id, order_date, region, product_id, product_name, category, lot_id, facility, return_date, refund_amount_usd, return_reason, return_reason_text, days_to_return.

### Silver → Gold (aggregations)

**⚠️ ALL gold tables MUST include `region` and `category` as dimensions for dashboard filtering.**

**gold_daily_summary** — dims: date, region, category. Metrics: order_count (COUNT DISTINCT order_id), items_sold (SUM quantity), revenue_usd (SUM line_total_usd), return_count (COUNT returns), returns_usd (SUM refund_amount_usd).

**gold_returns_by_product** — dims: product_id, product_name, category, region. Metrics: units_sold, return_count, total_refund_usd, return_rate (return_count/units_sold).

**gold_returns_by_lot** — dims: lot_id, product_id, product_name, category, region, facility, production_date. Metrics: units_sold, return_count, total_refund_usd, return_rate, feedback_samples (COLLECT_LIST return_reason_text).

### Filter Coherence Matrix

| Filter | gold_daily_summary | gold_returns_by_product | gold_returns_by_lot |
|--------|-------------------|------------------------|---------------------|
| date | ✅ | — (cumulative) | — (cumulative) |
| region | ✅ | ✅ | ✅ |
| category | ✅ | ✅ | ✅ |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_daily_summary | date, region, category | revenue_usd, order_count, items_sold, return_count, returns_usd |
| gold_returns_by_product | region, category | product_id, product_name, units_sold, total_refund_usd, return_rate |
| gold_returns_by_lot | region, category | lot_id, product_id, product_name, facility, feedback_samples, return_rate |

---

## C. PDF Generation

**Skill to use**: `databricks-unstructured-pdf-generation` — read `SKILLS/databricks-unstructured-pdf-generation/SKILL.md` before implementing.

Generate ~10 PDFs in `{raw_data_volume}/incident_pdf/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Routine Lyon facility docs (resolved incidents, QC summaries, maintenance logs, supplier audits, safety inspections). NO mention of affected lot or texture issues.

**Key document**: Production Incident Report PIR-{YYYY}-{MMDD} matching AFFECTED_LOT_DATE. Facility: Lyon. Reporter: Marc Dupont, Production Supervisor. Equipment: Homogenizer Unit HMG-03. Issue: pressure gauge fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar). Cause: calibration drift in pressure regulation valve. Affected: SKU-1001/1002/1003 (~5,000 units). QC assessment: "Some units may exhibit minor texture variations due to the pressure fluctuations during emulsification. This is a cosmetic variation only and does not affect product safety or efficacy." Disposition: RELEASED for distribution.

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Returns spike | `SELECT DATE_TRUNC('week', date) as week, SUM(returns_usd) FROM gold_daily_summary GROUP BY 1 ORDER BY 1 DESC LIMIT 10` | Peak week ~$180K, recent weeks decaying (~$90K→$70K), baseline ~$60K |
| Problem products | `SELECT product_id, product_name, return_rate FROM gold_returns_by_product WHERE return_rate > 0.2` | SKU-1001/1002/1003 at ~30% |
| Common lot | `SELECT lot_id, SUM(return_count), AVG(return_rate) FROM gold_returns_by_lot WHERE return_rate > 0.2 GROUP BY lot_id` | One lot, ~1,500 returns |
| Texture feedback | `SELECT feedback_samples FROM gold_returns_by_lot WHERE return_rate > 0.25 LIMIT 1` | Contains "grainy", "separated" |
| Filter dims | `SELECT DISTINCT region FROM gold_daily_summary` | US, EU, APAC |
| Column names | `DESCRIBE gold_daily_summary` / `DESCRIBE gold_returns_by_product` | Match specs above |

Add pipeline_id to `resources.json`.
