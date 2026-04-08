# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| BATCH_INSTALL_DATE | NOW - 5 months | When batch TRF-2024-Q3-887 installed |
| Failure spike | NOW - 3 to 4 weeks | When outages peak |

---

## Output Location

```
{raw_data_volume}/
├── substations.parquet        (~200 rows)
├── transformers.parquet       (~3,000 rows)
├── sensor_telemetry.parquet   (~10,000,000 rows)
├── outages.parquet            (~5,000 rows)
├── maintenance_records.parquet (~15,000 rows)
└── equipment_batches.parquet  (~500 rows)
```

---

## Table Schemas

### 1. substations (~200 rows)

| Column | Type | Description |
|--------|------|-------------|
| substation_id | STRING | Primary key (format: SUB-NNNN) |
| name | STRING | |
| region | STRING | "North", "South", "Central", "East", "West" |
| voltage_class | STRING | "Distribution", "Transmission" |
| customers_served | INT | |

---

### 2. transformers (~3,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| transformer_id | STRING | Primary key (format: TRF-NNNNNN) |
| substation_id | STRING | FK to substations |
| batch_id | STRING | Manufacturing batch |
| manufacturer | STRING | |
| install_date | DATE | |
| capacity_kva | INT | |
| age_years | INT | |
| last_inspection | DATE | |

**The affected batch**:
- Batch ID: TRF-2024-Q3-887
- Manufacturer: "GridTech Industries"
- 234 transformers in batch
- Installed: BATCH_INSTALL_DATE (5 months ago)

---

### 3. sensor_telemetry (~10,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| telemetry_id | STRING | Primary key |
| transformer_id | STRING | FK to transformers |
| reading_timestamp | TIMESTAMP | |
| sensor_type | STRING | "temperature", "oil_level", "load_percent" |
| value | DECIMAL(10,2) | |

**Normal ranges**:
- Temperature: 45-75°C normal, >85°C warning, >95°C critical
- Oil level: 85-100% normal
- Load: 0-100%

**Anomaly for affected batch**:
- Temperature trending 10-15°C higher than similar units
- Elevated readings visible 2-3 weeks before failure

---

### 4. outages (~5,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| outage_id | STRING | Primary key |
| transformer_id | STRING | FK to transformers |
| outage_start | TIMESTAMP | |
| outage_end | TIMESTAMP | |
| duration_hours | DECIMAL(6,2) | |
| customers_affected | INT | |
| cause_code | STRING | "equipment", "weather", "vegetation", "animal", "unknown" |
| root_cause | STRING | More specific cause |

**Normal outage rate**: ~15/month

**Affected batch outages**:
- 47 outages this month from batch TRF-2024-Q3-887
- cause_code: "equipment"
- root_cause: "transformer_overheating"
- ~180,000 customer-hours affected

---

### 5. maintenance_records (~15,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| record_id | STRING | Primary key |
| transformer_id | STRING | FK to transformers |
| maintenance_date | DATE | |
| maintenance_type | STRING | "inspection", "repair", "replacement" |
| technician | STRING | |
| findings | STRING | |
| action_taken | STRING | |

---

### 6. equipment_batches (~500 rows)

| Column | Type | Description |
|--------|------|-------------|
| batch_id | STRING | Primary key |
| manufacturer | STRING | |
| manufacture_date | DATE | |
| units_in_batch | INT | |
| quality_certification | STRING | |
| inspection_notes | STRING | |

**Key entry for affected batch**:
- Batch ID: TRF-2024-Q3-887
- inspection_notes: "Passed standard QC. Note: thermal compound application process modified per engineering change order ECO-2024-156."

---

## Validation

| What to Check | Expected |
|---------------|----------|
| Transformers in batch TRF-2024-Q3-887 | 234 units |
| Outages from affected batch | 47 this month |
| Normal monthly outages | ~15 |
| Customer-hours affected | ~180,000 |
| Temperature anomaly visible | Affected batch 10-15°C higher |
