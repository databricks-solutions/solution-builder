# Data Generation

> **Before starting**: Check if you have a relevant skill available and read it for best practices.

## Task

Generate synthetic parquet files and upload them to the raw data volume.

**Approach**: Write a Python data generation script locally, then run it via Spark Connect to generate data directly on Databricks.

---

## Data Volume Principle

Generate enough data so that the anomaly (spike) is clearly visible above the baseline noise.

With too little data, random variations in normal returns can obscure the spike. The baseline must be stable enough that when the spike occurs, it's unmistakably abnormal - not just a random fluctuation.

**Rule of thumb**:
- Baseline period should have consistent daily/weekly patterns with low variance
- The spike should be **at least 3x the baseline** to be visually obvious
- More total volume = smoother baseline = clearer spike

---

## Data Time Range

**IMPORTANT**: The data should always be current so the demo remains relevant. Use dynamic dates relative to NOW:

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | **NOW** (current date) | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| AFFECTED_LOT_DATE | NOW - 7 weeks | Production date of bad lot |
| Spike week | NOW - 5 to 6 weeks | When returns peak (visible in charts) |

This ensures:
- Orders: ~1 year of history ending today
- Returns: follow orders with 7-30 day lag
- The spike is always ~5-6 weeks ago (recent enough to be actionable, old enough for returns to accumulate)

---

## Output Location

Upload to the **raw_data** volume (path defined in 00-demo-overview.md).

**Files to Generate**:
```
{raw_data_volume}/
├── customers.parquet          (~50,000 rows)
├── products.parquet           (~80 rows)
├── production_lots.parquet    (~1,500 rows)
├── orders.parquet             (~200,000 rows)
├── order_items.parquet        (~320,000 rows)
└── returns.parquet            (~25,000 rows)
```

**Why these volumes**: With ~25K total returns and ~480/week baseline, the spike week (~1,500 returns) is clearly 3x+ above normal. Smaller datasets have too much noise to see the signal.

---

## Table Schemas

### 1. customers (~50,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| customer_id | STRING | Primary key (format: CUST-NNNNNN) |
| email | STRING | Customer email |
| first_name | STRING | First name |
| last_name | STRING | Last name |
| region | STRING | "US", "EU", "APAC" |
| registration_date | DATE | Account creation date |
| loyalty_tier | STRING | "standard", "silver", "gold" |

**Distribution**:
- Region: US ~70%, EU ~20%, APAC ~10%
- Loyalty: standard ~60%, silver ~30%, gold ~10%

---

### 2. products (~80 rows)

| Column | Type | Description |
|--------|------|-------------|
| product_id | STRING | Primary key (format: SKU-NNNN) |
| product_name | STRING | Display name |
| category | STRING | "Skincare", "Makeup", "Haircare" |
| subcategory | STRING | Specific type |
| price_usd | DECIMAL(8,2) | Retail price |
| cost_usd | DECIMAL(8,2) | Manufacturing cost |
| launch_date | DATE | Product launch date |
| is_active | BOOLEAN | Currently sold |

**The 3 affected products** (these are the products that will have high returns):
| SKU | Product Name | Category | Subcategory | Price | Cost |
|-----|--------------|----------|-------------|-------|------|
| SKU-1001 | Hydrating Serum 30ml | Skincare | Serums | ~$68 | ~$12 |
| SKU-1002 | Vitamin C Cream 50ml | Skincare | Creams | ~$55 | ~$10 |
| SKU-1003 | HA Moisture Boost 15ml | Skincare | Serums | ~$42 | ~$8 |

**Category Distribution**:
- Skincare: ~40 products ($25-$120)
- Makeup: ~25 products ($15-$65)
- Haircare: ~15 products ($18-$45)

---

### 3. production_lots (~1,500 rows)

| Column | Type | Description |
|--------|------|-------------|
| lot_id | STRING | Primary key (format: LOT-YYYY-MMDD) |
| product_id | STRING | FK to products |
| production_date | DATE | Manufacturing date |
| facility | STRING | Manufacturing location (e.g., "Lyon") |
| quantity_produced | INT | Units in lot (200-1000) |
| status | STRING | "released", "on_hold", "recalled" |

**The affected lot** - this is the lot that causes the returns spike:
- Lot ID: LOT-2025-0212
- Production date: February 12, 2025
- Products: SKU-1001, SKU-1002, SKU-1003
- Quantity: ~1,700 units each (5,000 total)
- Status: released

**Why this matters**: The demo story is that this lot had equipment issues during production, but was released anyway. The lot ID ties the returns back to the incident report.

---

### 4. orders (~200,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| order_id | STRING | Primary key (format: ORD-YYYYMMDD-NNNNNN) |
| customer_id | STRING | FK to customers |
| order_date | DATE | Order placement date |
| order_timestamp | TIMESTAMP | Exact order time |
| region | STRING | Customer region |
| subtotal_usd | DECIMAL(10,2) | Sum of items |
| shipping_usd | DECIMAL(6,2) | Shipping cost |
| total_usd | DECIMAL(10,2) | Total amount |
| status | STRING | "delivered", "shipped", "processing" |

**Seasonality** (baseline ~3,800 orders/week) - this makes the data more realistic:
| Period | Multiplier |
|--------|------------|
| Valentine's (Feb 7-14) | ~1.8x |
| Mother's Day (May 5-11) | ~2.0x |
| Black Friday (Nov 24-30) | ~3.0x |
| Holiday (Dec 8-23) | ~2.2x |
| Summer (Jun-Aug) | ~0.75x |
| Normal periods | 1.0x |

---

### 5. order_items (~320,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| order_item_id | STRING | Primary key (format: OI-NNNNNNNNN) |
| order_id | STRING | FK to orders |
| product_id | STRING | FK to products |
| lot_id | STRING | FK to production_lots |
| quantity | INT | Units ordered (usually 1) |
| unit_price_usd | DECIMAL(8,2) | Price at sale |
| line_total_usd | DECIMAL(10,2) | quantity × unit_price |

**Affected lot assignment**:
- Around 5,000 order_items should reference lot LOT-2025-0212
- These orders happen between Feb 12 - Mar 15, 2025 (as the lot inventory ships out)
- Use FIFO logic: assign to oldest available lot for each product

**Why this matters**: This links orders to the specific production lot, enabling the "trace back to source" analysis in Genie.

---

### 6. returns (~25,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| return_id | STRING | Primary key (format: RET-NNNNNNNN) |
| order_item_id | STRING | FK to order_items |
| return_date | DATE | Return initiated date |
| return_timestamp | TIMESTAMP | Exact return time |
| refund_amount_usd | DECIMAL(10,2) | Refund issued |
| return_reason | STRING | "quality", "wrong_item", "changed_mind", "damaged", "other" |
| return_reason_text | STRING | Free text customer feedback |

**Normal return distribution**: quality ~25%, changed_mind ~40%, wrong_item ~15%, damaged ~10%, other ~10%

**Affected lot returns** - this creates the spike that triggers the investigation:
- Around 1,500 returns from LOT-2025-0212 items (~30% return rate vs ~8% normal)
- Return dates: Feb 20 - Mar 25, 2025 (7-14 days after order)
- Peak week: Mar 17-23 (~500 returns, creating the ~$180K spike vs ~$60K baseline)
- Return reason: predominantly "quality"
- Return reason text: texture complaints like:
  - "Cream has grainy texture, not smooth like usual"
  - "Product separated in the jar, looks curdled"
  - "Consistency is watery, doesn't feel right"
  - "Texture feels off compared to my last purchase"
  - "Serum looks cloudy and thick, not like before"
  - "Product texture has changed, feels gritty"

**Why this matters**: The texture complaints in the return_reason_text will match the "texture variations" mentioned in the incident report, connecting the dots for the user.

---

## Validation

After generating and uploading the data, verify the key demo facts are present.

**Key checks**:

| What to Check | What You Should See |
|---------------|---------------------|
| LOT-2025-0212 in production_lots | 3 rows (one per affected SKU) |
| Order items with lot LOT-2025-0212 | Around 5,000 items |
| Returns from affected lot | Around 1,500 returns (~30% return rate) |
| Returns in week of Mar 17-23 | Significantly higher than other weeks (~$180K vs ~$60K) |
| Return reasons for affected lot | Mostly "quality" with texture complaints |

**Sample validation queries** (run against the parquet files):
- Count of production_lots where lot_id = 'LOT-2025-0212'
- Count of order_items where lot_id = 'LOT-2025-0212'
- Return rate calculation for affected vs normal lots
- Weekly returns aggregation to see the spike
