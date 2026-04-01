# Data Schema

Generate the following tables as synthetic data in the `luxebeauty.analytics` catalog/schema. Create tables in the order listed below to preserve referential integrity. Upload all parquet files to `/Volumes/luxebeauty/analytics/raw_data/`. Then generate incident PDFs and upload to `/Volumes/luxebeauty/analytics/raw_data/incident_pdf/`.

## Data Time Range

- Orders: ~1 year of history (Mar 2024 – Mar 2025)
- Returns: follow orders with 7–30 day lag
- The "current" date: **March 24, 2025** (when Claire sees the spike)
- The spike week: **March 17–23, 2025**

## Output Files

```
/Volumes/luxebeauty/analytics/raw_data/
├── customers.parquet          (~12,000 rows)
├── products.parquet           (~80 rows)
├── production_lots.parquet    (~500 rows)
├── orders.parquet             (~52,000 rows)
├── order_items.parquet        (~80,000 rows)
└── returns.parquet            (~5,000 rows)
```

---

## Table Schemas

### 1. customers (~12,000 rows) — Generate first

| Column | Type | Description |
|--------|------|-------------|
| customer_id | STRING | Primary key (format: CUST-NNNNNN) |
| email | STRING | Customer email |
| first_name | STRING | First name |
| last_name | STRING | Last name |
| region | STRING | "US" (~70%), "EU" (~20%), "APAC" (~10%) |
| registration_date | DATE | Account creation date |
| loyalty_tier | STRING | "standard" (~60%), "silver" (~30%), "gold" (~10%) |

### 2. products (~80 rows) — Generate second

| Column | Type | Description |
|--------|------|-------------|
| product_id | STRING | Primary key (format: SKU-NNNN) |
| product_name | STRING | Display name |
| category | STRING | "Skincare" (~40), "Makeup" (~25), "Haircare" (~15) |
| subcategory | STRING | Specific type (Serums, Creams, Foundations, etc.) |
| price_usd | DECIMAL(8,2) | Retail price |
| cost_usd | DECIMAL(8,2) | Manufacturing cost |
| launch_date | DATE | Product launch date |
| is_active | BOOLEAN | Currently sold |

**The 3 affected products** (must be generated with these exact values):

| SKU | Product Name | Category | Subcategory | Price | Cost |
|-----|--------------|----------|-------------|-------|------|
| SKU-1001 | Hydrating Serum 30ml | Skincare | Serums | $68 | $12 |
| SKU-1002 | Vitamin C Cream 50ml | Skincare | Creams | $55 | $10 |
| SKU-1003 | HA Moisture Boost 15ml | Skincare | Serums | $42 | $8 |

**Category distribution**: Skincare $25–$120, Makeup $15–$65, Haircare $18–$45.

### 3. production_lots (~500 rows) — Generate third

| Column | Type | Description |
|--------|------|-------------|
| lot_id | STRING | Primary key (format: LOT-YYYY-MMDD) |
| product_id | STRING | FK → products |
| production_date | DATE | Manufacturing date |
| facility | STRING | Manufacturing location ("Lyon") |
| quantity_produced | INT | Units in lot (200–1000) |
| status | STRING | "released", "on_hold", "recalled" |

**The affected lot** — must exist with these exact values:

| lot_id | product_id | production_date | facility | quantity_produced | status |
|--------|-----------|-----------------|----------|-------------------|--------|
| LOT-2025-0212 | SKU-1001 | 2025-02-12 | Lyon | ~800 | released |
| LOT-2025-0212 | SKU-1002 | 2025-02-12 | Lyon | ~800 | released |
| LOT-2025-0212 | SKU-1003 | 2025-02-12 | Lyon | ~800 | released |

**Why this matters**: The lot_id ties the returns back to the incident report. It must be traceable from order_items → production_lots → incident PDF.

### 4. orders (~52,000 rows) — Generate fourth (references customers)

| Column | Type | Description |
|--------|------|-------------|
| order_id | STRING | Primary key (format: ORD-YYYYMMDD-NNNNNN) |
| customer_id | STRING | FK → customers |
| order_date | DATE | Order placement date |
| order_timestamp | TIMESTAMP | Exact order time |
| region | STRING | Customer region |
| subtotal_usd | DECIMAL(10,2) | Sum of items |
| shipping_usd | DECIMAL(6,2) | Shipping cost |
| total_usd | DECIMAL(10,2) | Total amount |
| status | STRING | "delivered", "shipped", "processing" |

**Seasonality** (baseline ~900 orders/week):

| Period | Multiplier |
|--------|------------|
| Valentine's (Feb 7–14) | ~1.8x |
| Mother's Day (May 5–11) | ~2.0x |
| Black Friday (Nov 24–30) | ~3.0x |
| Holiday (Dec 8–23) | ~2.2x |
| Summer (Jun–Aug) | ~0.75x |
| Normal periods | 1.0x |

### 5. order_items (~80,000 rows) — Generate fifth (references orders, products, production_lots)

| Column | Type | Description |
|--------|------|-------------|
| order_item_id | STRING | Primary key (format: OI-NNNNNNNNN) |
| order_id | STRING | FK → orders |
| product_id | STRING | FK → products |
| lot_id | STRING | FK → production_lots |
| quantity | INT | Units ordered (usually 1) |
| unit_price_usd | DECIMAL(8,2) | Price at sale |
| line_total_usd | DECIMAL(10,2) | quantity × unit_price |

**Affected lot assignment**:
- ~2,400 order_items must reference lot LOT-2025-0212
- These orders occur between Feb 12 – Mar 15, 2025 (as the lot inventory ships out)
- Use FIFO logic: assign to oldest available lot for each product

### 6. returns (~5,000 rows) — Generate last (references order_items)

| Column | Type | Description |
|--------|------|-------------|
| return_id | STRING | Primary key (format: RET-NNNNNNNN) |
| order_item_id | STRING | FK → order_items |
| return_date | DATE | Return initiated date |
| return_timestamp | TIMESTAMP | Exact return time |
| refund_amount_usd | DECIMAL(10,2) | Refund issued |
| return_reason | STRING | "quality", "wrong_item", "changed_mind", "damaged", "other" |
| return_reason_text | STRING | Free-text customer feedback |

**Normal return distribution**: quality ~25%, changed_mind ~40%, wrong_item ~15%, damaged ~10%, other ~10%. Normal return rate: ~8%.

**Affected lot returns** — this creates the spike:
- ~720 returns from LOT-2025-0212 items (~30% return rate)
- Return dates: Feb 20 – Mar 25, 2025 (7–14 days after order)
- Peak week: **Mar 17–23** (~250 returns, creating the ~$180K spike)
- Return reason: predominantly "quality"
- Return reason text examples (use variations of these):
  - "Cream has grainy texture, not smooth like usual"
  - "Product separated in the jar, looks curdled"
  - "Consistency is watery, doesn't feel right"
  - "Texture feels off compared to my last purchase"
  - "Serum looks cloudy and thick, not like before"
  - "Product texture has changed, feels gritty"

**Why the texture complaints matter**: They must match the "texture variations" mentioned in the incident report, connecting structured data to the unstructured document.

---

## Referential Integrity

Generate tables in this order to preserve foreign keys:

1. **customers** (12,000 rows) — no dependencies
2. **products** (80 rows) — no dependencies; must include SKU-1001, SKU-1002, SKU-1003
3. **production_lots** (500 rows) — references products.product_id; must include LOT-2025-0212 × 3
4. **orders** (52,000 rows) — references customers.customer_id; ~10–50 orders per customer over 1 year
5. **order_items** (80,000 rows) — references orders.order_id, products.product_id, production_lots.lot_id; ~1–3 items per order; ~2,400 items assigned to LOT-2025-0212
6. **returns** (5,000 rows) — references order_items.order_item_id; ~8% of normal items, ~30% of LOT-2025-0212 items

---

## Data Correlations

### The Event Encoding

The returns spike is not random — it's caused by a specific production lot:

- **LOT-2025-0212 items**: ~30% return rate (quality-driven, texture complaints)
- **All other items**: ~8% return rate (normal distribution across reasons)
- **Spike timing**: Returns from affected lot peak in week of Mar 17–23 because:
  - Lot produced Feb 12 → ships Feb 12 – Mar 15 → returns start 7–14 days after receipt
  - The wave crests in mid-March as the bulk of shipments have been received

### Seasonal Revenue Patterns

Revenue follows seasonality multipliers but has no anomaly — it provides the "everything else is normal" contrast against the returns spike. Weekly revenue for the spike week should be ~$3.8M (normal range).

---

## Incident Report PDFs

### Background Documents (9 PDFs)

Generate ~9 background PDFs about production and quality operations. These are "noise" — realistic documents that do NOT contain information about LOT-2025-0212 or texture issues.

**Document types**: Routine incident reports (different lots, different equipment, resolved), monthly QC summaries, equipment maintenance logs, supplier audit reports, safety inspection records.

**Filenames**: Use descriptive names (e.g., `incident_lot_2025_0115.pdf`, `qc_report_january_2025.pdf`, `equipment_maintenance_q1.pdf`).

**Content scope**: LuxeBeauty Co. Lyon facility, January–March 2025, routine operations only.

### The Key Document (1 PDF)

This is the "smoking gun" — the document that answers "Why are we having so many returns?"

| Field | Value |
|-------|-------|
| **Title** | Production Incident Report — LOT-2025-0212 |
| **Report Number** | PIR-2025-0212 |
| **Date** | February 12, 2025 |
| **Facility** | Lyon Manufacturing Center |
| **Reported By** | Marc Dupont, Production Supervisor |

**Content requirements**:

**Incident Details**:
- Equipment: Homogenizer Unit HMG-03
- Issue: Pressure gauge showed irregular fluctuations (~2.1–2.8 bar vs normal 2.4–2.6 bar)
- Cause: Calibration drift in pressure regulation valve
- Resolution: Valve recalibrated, production resumed

**Affected Production**:
- Lot Number: LOT-2025-0212
- Products: SKU-1001 Hydrating Serum 30ml (~800 units), SKU-1002 Vitamin C Cream 50ml (~800 units), SKU-1003 HA Moisture Boost 15ml (~800 units)
- Total: ~2,400 units

**QC Assessment** (the smoking gun):
- Visual inspection passed (color, odor, container, labels all normal)
- Note: "Some units may exhibit minor texture variations due to the pressure fluctuations during emulsification. This is a cosmetic variation only and does not affect product safety or efficacy."

**Disposition**: RELEASE FOR DISTRIBUTION
**Rationale**: QC visual inspection passed, texture variation deemed minor

**Follow-up Actions**: Schedule preventive maintenance for HMG-03, review calibration frequency

**Critical**: The SKUs in this document (SKU-1001, SKU-1002, SKU-1003) MUST match the products table and the returns data. The lot_id (LOT-2025-0212) MUST match production_lots and order_items. This cross-reference is what makes the demo story work.

### PDF Output Location

Upload all PDFs to: `/Volumes/luxebeauty/analytics/raw_data/incident_pdf/`

---

## Validation Queries

After generating and uploading data, verify these facts. **All must pass before proceeding to pipeline creation.**

| Check | Expected Result |
|-------|-----------------|
| LOT-2025-0212 in production_lots | 3 rows (one per affected SKU) |
| Order items with lot LOT-2025-0212 | ~2,400 items |
| Returns from affected lot (join order_items on lot_id) | ~720 returns (~30% return rate) |
| Week of Mar 17–23 total returns | ~$180K (vs ~$60K normal weeks) |
| Return reasons for affected lot | Mostly "quality" with texture complaints |
| Products with return rate > 20% | Exactly 3: SKU-1001, SKU-1002, SKU-1003 |
| Total products in catalog | ~80 |
| Total customers | ~12,000 |
| Total orders (full year) | ~52,000 |

### If Validation Fails

1. **Wrong row counts**: Check data generation script parameters (date ranges, frequencies)
2. **Missing lot data**: Ensure LOT-2025-0212 is hardcoded, not randomly generated
3. **Wrong return rates**: Check the affected vs normal return rate logic
4. **Missing texture complaints**: Ensure return_reason_text is populated for affected lot returns
5. **Spike not visible**: Check that peak returns concentrate in Mar 17–23 week
