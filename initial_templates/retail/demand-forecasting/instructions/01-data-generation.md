# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| EVENT_DATE | NOW - 1 week | Concert event weekend |
| Stockout spike | NOW - 4 to 7 days | When stockouts peak |

---

## Output Location

```
{raw_data_volume}/
├── stores.parquet             (~85 rows)
├── products.parquet           (~5,000 rows)
├── inventory.parquet          (~500,000 rows)
├── sales.parquet              (~10,000,000 rows)
├── stockouts.parquet          (~50,000 rows)
└── demand_forecasts.parquet   (~1,000,000 rows)
```

---

## Table Schemas

### 1. stores (~85 rows)

| Column | Type | Description |
|--------|------|-------------|
| store_id | STRING | Primary key (format: STR-NNN) |
| store_name | STRING | |
| region | STRING | "Metro East", "Metro West", "Suburban", "Rural" |
| format | STRING | "Supermarket", "Express", "Warehouse" |
| square_feet | INT | |
| open_date | DATE | |

**Affected stores**:
- 23 stores in "Metro East" region
- Within 10-mile radius of Metro East Stadium

---

### 2. products (~5,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| product_id | STRING | Primary key (format: PRD-NNNNN) |
| product_name | STRING | |
| category | STRING | "Dairy", "Produce", "Bakery", "Beverages", etc. |
| subcategory | STRING | |
| unit_cost | DECIMAL(8,2) | |
| unit_price | DECIMAL(8,2) | |
| shelf_life_days | INT | |

---

### 3. inventory (~500,000 rows - daily snapshots)

| Column | Type | Description |
|--------|------|-------------|
| inventory_id | STRING | Primary key |
| store_id | STRING | FK to stores |
| product_id | STRING | FK to products |
| inventory_date | DATE | |
| units_on_hand | INT | |
| units_on_order | INT | |
| reorder_point | INT | |

---

### 4. sales (~10,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| sale_id | STRING | Primary key |
| store_id | STRING | FK to stores |
| product_id | STRING | FK to products |
| sale_date | DATE | |
| sale_timestamp | TIMESTAMP | |
| units_sold | INT | |
| revenue_usd | DECIMAL(10,2) | |
| transaction_id | STRING | |

**Normal dairy sales**: ~$15K/day per Metro East store

**Event impact**:
- Dairy sales 4x normal at 23 Metro East stores
- Thu-Sat of event weekend (3 days)

---

### 5. stockouts (~50,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| stockout_id | STRING | Primary key |
| store_id | STRING | FK to stores |
| product_id | STRING | FK to products |
| stockout_date | DATE | |
| hours_out_of_stock | DECIMAL(6,2) | |
| estimated_lost_sales_usd | DECIMAL(10,2) | |
| replenishment_date | DATE | |

**Normal weekly stockout losses**: ~$800K

**Event stockouts**:
- $4.2M lost sales this week
- Concentrated in Dairy at Metro East stores
- 15% stockout rate vs 2% normal

---

### 6. demand_forecasts (~1,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| forecast_id | STRING | Primary key |
| store_id | STRING | FK to stores |
| product_id | STRING | FK to products |
| forecast_date | DATE | |
| forecast_units | INT | |
| actual_units | INT | Filled in after the fact |
| forecast_error_pct | DECIMAL(6,2) | |
| model_version | STRING | |

**Forecast accuracy for event period**:
- Metro East stores: forecast error 75%+ (way underestimated)
- Other stores: forecast error ~10% (normal)

---

## Validation

| What to Check | Expected |
|---------------|----------|
| Stores in Metro East region | 23 stores |
| Sales spike at Metro East (event days) | 4x normal for dairy |
| Stockout losses event week | ~$4.2M |
| Normal weekly stockout losses | ~$800K |
| Forecast error for Metro East | 75%+ during event |
