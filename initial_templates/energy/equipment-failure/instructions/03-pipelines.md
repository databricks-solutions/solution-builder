# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `pacific_grid_analytics` |
| **Catalog** | `pacific_grid` |
| **Target Schema** | `grid_ops` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_substations | substations.parquet | Raw substation data |
| bronze_transformers | transformers.parquet | Raw transformer data |
| bronze_sensor_telemetry | sensor_telemetry.parquet | Raw sensor readings |
| bronze_outages | outages.parquet | Raw outage records |
| bronze_maintenance_records | maintenance_records.parquet | Raw maintenance data |
| bronze_equipment_batches | equipment_batches.parquet | Raw batch data |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_transformers | Transformers with substation, batch, manufacturer context |
| silver_outages | Outages with transformer, batch, cause details |
| silver_equipment_health | Aggregated sensor data by transformer |

**Key relationships**:
- silver_transformers: transformer + substation + batch info
- silver_outages: outage + transformer + batch_id

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_outage_summary | date, region, cause_code | outage_count, duration_hours, customers_affected |
| gold_batch_reliability | batch_id, manufacturer | transformer_count, failure_count, failure_rate, avg_temp |
| gold_monthly_reliability | month, region | outages, customer_hours_affected, restoration_cost |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| Outages from batch TRF-2024-Q3-887 | 47 this month |
| Normal monthly outages | ~15 |
| Failure rate for affected batch | Much higher than others |
