# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| BEARING_WEAR_START | NOW - 10 days | When vibration anomaly started |
| Defect spike | NOW - 5 to 7 days | When defects peak |

---

## Output Location

```
{raw_data_volume}/
├── machines.parquet           (~50 rows)
├── parts.parquet              (~200 rows)
├── production_runs.parquet    (~50,000 rows)
├── sensor_readings.parquet    (~5,000,000 rows)
├── quality_inspections.parquet (~150,000 rows)
└── maintenance_logs.parquet   (~2,000 rows)
```

---

## Table Schemas

### 1. machines (~50 rows)

| Column | Type | Description |
|--------|------|-------------|
| machine_id | STRING | Primary key (format: CNC-XXX-NNN) |
| machine_type | STRING | "CNC", "Press", "Assembly" |
| plant | STRING | "Detroit", "Chicago", "Louisville" |
| install_date | DATE | |
| last_maintenance | DATE | |
| manufacturer | STRING | |

**The affected machine**:
- Machine ID: CNC-DTR-007
- Plant: Detroit
- Type: CNC (precision machining)
- Last maintenance: NOW - 90 days

---

### 2. parts (~200 rows)

| Column | Type | Description |
|--------|------|-------------|
| part_id | STRING | Primary key (format: PRT-NNNN) |
| part_name | STRING | |
| part_category | STRING | "Gears", "Shafts", "Housings" |
| tolerance_mm | DECIMAL(6,4) | Dimensional tolerance |
| target_cycle_time_sec | INT | |

---

### 3. production_runs (~50,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| run_id | STRING | Primary key |
| machine_id | STRING | FK to machines |
| part_id | STRING | FK to parts |
| run_date | DATE | |
| shift | STRING | "day", "evening", "night" |
| units_produced | INT | |
| cycle_time_avg_sec | DECIMAL(6,2) | |

---

### 4. sensor_readings (~5,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| reading_id | STRING | Primary key |
| machine_id | STRING | FK to machines |
| reading_timestamp | TIMESTAMP | |
| sensor_type | STRING | "vibration", "temperature", "spindle_speed" |
| value | DECIMAL(10,4) | |
| unit | STRING | "mm/s", "celsius", "rpm" |

**Normal ranges for CNC machines**:
- Vibration: 0.5-2.0 mm/s (normal), >3.0 mm/s (warning), >5.0 mm/s (critical)
- Temperature: 35-55°C (normal)

**Anomaly for CNC-DTR-007**:
- Vibration creeping from 1.8 to 4.5 mm/s over 10 days
- Spindle speed showing minor fluctuations

---

### 5. quality_inspections (~150,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| inspection_id | STRING | Primary key |
| run_id | STRING | FK to production_runs |
| machine_id | STRING | FK to machines |
| inspection_date | DATE | |
| units_inspected | INT | |
| units_passed | INT | |
| units_failed | INT | |
| defect_type | STRING | "dimensional", "surface", "material" |
| defect_code | STRING | Specific defect code |

**Normal defect rate**: ~2.8%

**Affected machine defects**:
- CNC-DTR-007 showing 8.5% → 12% defect rate over 7 days
- Defect type: "dimensional" (tolerance failures)
- ~12,400 defective parts this week

---

### 6. maintenance_logs (~2,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| log_id | STRING | Primary key |
| machine_id | STRING | FK to machines |
| log_date | DATE | |
| maintenance_type | STRING | "scheduled", "predictive", "corrective" |
| description | STRING | |
| technician | STRING | |
| parts_replaced | STRING | |
| downtime_hours | DECIMAL(6,2) | |

**Key log entry**:
- Machine: CNC-DTR-007
- Date: BEARING_WEAR_START - 2 days
- Type: "predictive"
- Description: "Vibration alert - spindle bearing wear detected. Reading: 3.2 mm/s. Assessment: Within acceptable range, scheduled for next PM window."

---

## Validation

| What to Check | Expected |
|---------------|----------|
| Sensor readings for CNC-DTR-007 | Vibration trending up from 1.8 to 4.5 mm/s |
| Defect rate for CNC-DTR-007 | ~8.5-12% vs 2.8% plant average |
| Defective parts this week | ~12,400 |
| Maintenance log with ignored alert | Present for CNC-DTR-007 |
