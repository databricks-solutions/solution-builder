# Data Generation

Generate synthetic parquet files and upload to the raw data volume.

## Time References (Dynamic)

| Reference | Calculation |
|-----------|-------------|
| STORY_END_DATE | NOW |
| STORY_START_DATE | NOW - 13 months |
| AFFECTED_LOT_DATE | NOW - 7 weeks |
| Spike week | NOW - 5 to 6 weeks |

## Output: `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| customers.parquet | ~50K | Region: US 70%, EU 20%, APAC 10%. Loyalty: standard 60%, silver 30%, gold 10% |
| products.parquet | ~80 | Skincare ~40 ($25-120), Makeup ~25 ($15-65), Haircare ~15 ($18-45) |
| production_lots.parquet | ~1.5K | Format: LOT-YYYY-MMDD. Status: released/on_hold/recalled |
| orders.parquet | ~200K | ~3,800/week baseline with seasonality |
| order_items.parquet | ~320K | ~1.6 items/order avg. Assign lot_id using FIFO per product |
| returns.parquet | ~25K | ~8% normal return rate |

## Data Variation (Non-Uniform Patterns)

### Orders seasonality
- Black Friday week: 3x baseline
- Holiday (Dec 15-31): 2.2x
- Mother's Day week: 2x
- Valentine's week: 1.8x
- Summer (Jun-Aug): 0.75x
- Add ±15% daily noise

### Regional patterns
- US: higher Makeup sales (40% vs 30% baseline)
- EU: higher Skincare sales (50% vs 40% baseline)
- APAC: higher Haircare sales (25% vs 15% baseline)

### Product popularity (Pareto)
- Top 20% of products = 60% of sales
- Create 5-8 "hero products" per category with 3x sales volume
- Some products have higher return rates naturally (complex skincare ~12%, simple haircare ~5%)

### Customer behavior
- Gold tier: 2.5x order frequency, 1.8x basket size, lower return rate (5%)
- Silver tier: 1.5x order frequency, 1.3x basket size
- Standard tier: baseline, higher return rate (10%)
- ~30% of customers are one-time buyers

### Return timing
- 60% of returns within 7 days
- 30% within 8-21 days
- 10% within 22-30 days

### Production facilities
- Lyon: 50% of lots (Skincare focus)
- Milan: 30% of lots (Makeup focus)
- Singapore: 20% of lots (Haircare focus)

## Table Schemas

### customers
`customer_id` (PK, CUST-NNNNNN), `email`, `first_name`, `last_name`, `region`, `registration_date`, `loyalty_tier`

### products
`product_id` (PK, SKU-NNNN), `product_name`, `category`, `subcategory`, `price_usd`, `cost_usd`, `launch_date`, `is_active`

### production_lots
`lot_id` (PK), `product_id` (FK), `production_date`, `facility`, `quantity_produced` (200-1000), `status`

### orders
`order_id` (PK, ORD-YYYYMMDD-NNNNNN), `customer_id` (FK), `order_date`, `order_timestamp`, `region`, `subtotal_usd`, `shipping_usd`, `total_usd`, `status`

### order_items
`order_item_id` (PK, OI-NNNNNNNNN), `order_id` (FK), `product_id` (FK), `lot_id` (FK), `quantity`, `unit_price_usd`, `line_total_usd`

### returns
`return_id` (PK, RET-NNNNNNNN), `order_item_id` (FK), `return_date`, `return_timestamp`, `refund_amount_usd`, `return_reason`, `return_reason_text`

## The Event (Deterministic Values)

**Affected products** (must exist with these exact values):

| product_id | product_name | category | subcategory | price_usd | cost_usd |
|------------|--------------|----------|-------------|-----------|----------|
| SKU-1001 | Hydrating Serum 30ml | Skincare | Serums | 68.00 | 12.00 |
| SKU-1002 | Vitamin C Cream 50ml | Skincare | Creams | 55.00 | 10.00 |
| SKU-1003 | HA Moisture Boost 15ml | Skincare | Serums | 42.00 | 8.00 |

**Affected lot** (must exist):
- `lot_id`: LOT-{YYYY}-{MMDD} based on AFFECTED_LOT_DATE
- `production_date`: AFFECTED_LOT_DATE
- `facility`: Lyon
- `quantity_produced`: ~1,700 per SKU (~5,000 total)
- `status`: released
- Creates 3 rows (one per affected SKU)

**Affected lot distribution**:
- ~5,000 order_items reference the affected lot
- Orders occur between AFFECTED_LOT_DATE and AFFECTED_LOT_DATE + 5 weeks
- ~1,500 returns from affected lot (~30% return rate)
- Return dates: AFFECTED_LOT_DATE + 1 week to + 6 weeks
- Peak week (NOW - 5 to 6 weeks): ~500 returns → ~$180K vs ~$60K baseline

**Texture complaints** (return_reason_text for affected lot returns):
- "Cream has grainy texture, not smooth like usual"
- "Product separated in the jar, looks curdled"
- "Consistency is watery, doesn't feel right"
- "Texture feels off compared to my last purchase"
- "Serum looks cloudy and thick, not like before"
- "Product texture has changed, feels gritty"

Return reason for affected lot: predominantly "quality"
