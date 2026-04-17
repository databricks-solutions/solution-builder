# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Affected batch** (deterministic — must exist with these exact values):

| batch_id | manufacturer | units_in_batch | install_date | inspection_notes |
|----------|-------------|----------------|--------------|------------------|
| TRF-2024-Q3-887 | GridTech Industries | 234 | BATCH_INSTALL_DATE | "Passed standard QC. Note: thermal compound application process modified per engineering change order ECO-2024-156." |

**Supplier quality notice** (the smoking gun document):
- Supplier: VoltPower Manufacturing
- Reference: SQN-2025-0142, dated January 28, 2025
- Defect: Thermal compound thickness 0.8mm vs 1.2mm spec → 25% reduced heat dissipation
- Failure mode: Accelerated insulation breakdown above 75% rated capacity, 6-8 months to failure
- 156 units shipped (89 Northern, 67 Central), installed August-October 2024
- Recommended: Reduce loading to 60%, prioritize replacement before summer peak

**Regions**: "North", "South", "Central", "East", "West"

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, BATCH_INSTALL_DATE = NOW - 5 months, Failure spike = NOW - 3 to 4 weeks.

**Normal baselines**: ~15 outages/month. Temperature: 45-75°C normal, >85°C warning, >95°C critical. Oil level: 85-100% normal.

**Affected batch anomalies**: 47 outages this month (3x baseline), cause_code "equipment", root_cause "transformer_overheating", ~180,000 customer-hours affected. Temperature trending 10-15°C higher than similar units, elevated 2-3 weeks before failure.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| substations.parquet | ~200 | Regions: North/South/Central/East/West. voltage_class: Distribution/Transmission |
| transformers.parquet | ~3,000 | FK to substations + equipment_batches. 234 units in batch TRF-2024-Q3-887 installed at BATCH_INSTALL_DATE |
| sensor_telemetry.parquet | ~10,000,000 | Types: temperature, oil_level, load_percent. Affected batch 10-15°C higher |
| outages.parquet | ~5,000 | cause_code: equipment/weather/vegetation/animal/unknown. 47 this month from affected batch |
| maintenance_records.parquet | ~15,000 | Types: inspection/repair/replacement |
| equipment_batches.parquet | ~500 | TRF-2024-Q3-887 entry per Shared Context |

### Table Schemas

**substations**: `substation_id` (PK, SUB-NNNN), `name`, `region`, `voltage_class`, `customers_served` (INT)

**transformers**: `transformer_id` (PK, TRF-NNNNNN), `substation_id` (FK), `batch_id` (FK), `manufacturer`, `install_date`, `capacity_kva` (INT), `age_years` (INT), `last_inspection` (DATE)

**sensor_telemetry**: `telemetry_id` (PK), `transformer_id` (FK), `reading_timestamp`, `sensor_type`, `value` (DECIMAL(10,2))

**outages**: `outage_id` (PK), `transformer_id` (FK), `outage_start`, `outage_end`, `duration_hours` (DECIMAL(6,2)), `customers_affected` (INT), `cause_code`, `root_cause`

**maintenance_records**: `record_id` (PK), `transformer_id` (FK), `maintenance_date`, `maintenance_type`, `technician`, `findings`, `action_taken`

**equipment_batches**: `batch_id` (PK), `manufacturer`, `manufacture_date`, `units_in_batch` (INT), `quality_certification`, `inspection_notes`

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/quality_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Supplier qualification reports, equipment inspection summaries, reliability studies, standards compliance certificates, training records, general quality bulletins. NO mention of batch TRF-2024-Q3-887 or thermal compound issues.

**Key document**: Supplier Quality Audit Report — SQA-2024-0887, dated BATCH_INSTALL_DATE - 2 months. Supplier: GridTech Industries. Batch: TRF-2024-Q3-887. 234 distribution transformers. Standard QC/electrical/dielectric: PASSED. Process Change Notice: ECO-2024-156 — "Thermal compound application process modified to improve manufacturing throughput." New automated system reduces application time by 40%. Impact assessment: "within acceptable tolerance range (+/- 5% from baseline)." Note: "Some units may exhibit slightly elevated operating temperatures during high-load conditions. This is within design margins." Disposition: APPROVED FOR SHIPMENT.

---

## C. SDP Pipeline

Create pipeline `pacific_grid_analytics` targeting catalog `pacific_grid`, schema `grid_ops`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | outage count, duration, customers affected by date/region/cause | gold_outage_summary |
| Dashboard batch drill-down | batch-level failure rates, avg temp | gold_batch_reliability |
| Dashboard monthly trends | monthly outages, customer-hours, cost by region | gold_monthly_reliability |
| Genie investigation | Trace outages → batch → sensor data → root cause | gold_batch_reliability + silver_outages + silver_equipment_health |

### Source → Bronze (1:1 ingestion)

substations/transformers/sensor_telemetry/outages/maintenance_records/equipment_batches.parquet → bronze_{table_name}

### Bronze → Silver (joins + enrichment)

**silver_transformers**: transformers JOIN substations (→ region, voltage_class, customers_served) JOIN equipment_batches (→ manufacturer, manufacture_date). Columns: transformer_id, substation_id, name, region, voltage_class, customers_served, batch_id, manufacturer, install_date, capacity_kva, age_years, last_inspection.

**silver_outages**: outages JOIN silver_transformers ON transformer_id (→ region, batch_id, manufacturer). Columns: outage_id, transformer_id, region, batch_id, manufacturer, outage_start, outage_end, duration_hours, customers_affected, cause_code, root_cause.

**silver_equipment_health**: sensor_telemetry aggregated by transformer (latest readings + rolling averages). JOIN silver_transformers (→ batch_id, region). Columns: transformer_id, batch_id, region, avg_temperature, max_temperature, avg_oil_level, avg_load_percent, last_reading_timestamp.

### Silver → Gold (aggregations)

**gold_outage_summary** — dims: date, region, cause_code. Metrics: outage_count, total_duration_hours, customers_affected.

**gold_batch_reliability** — dims: batch_id, manufacturer. Metrics: transformer_count, failure_count, failure_rate, avg_temperature.

**gold_monthly_reliability** — dims: month, region. Metrics: outage_count, customer_hours_affected, restoration_cost.

### Filter Coherence Matrix

| Filter | gold_outage_summary | gold_batch_reliability | gold_monthly_reliability |
|--------|--------------------|-----------------------|-------------------------|
| date | ✅ | — (cumulative) | — (monthly grain) |
| region | ✅ | — | ✅ |
| cause_code | ✅ | — | — |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_outage_summary | date, region, cause_code | outage_count, total_duration_hours, customers_affected |
| gold_batch_reliability | batch_id, manufacturer | transformer_count, failure_count, failure_rate, avg_temperature |
| gold_monthly_reliability | month, region | outage_count, customer_hours_affected, restoration_cost |
| silver_outages | region, batch_id, cause_code | outage_id, transformer_id, duration_hours, customers_affected |
| silver_equipment_health | batch_id, region | transformer_id, avg_temperature, max_temperature, avg_oil_level |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Outage spike | `SELECT DATE_TRUNC('month', date) as m, SUM(outage_count) FROM gold_outage_summary GROUP BY 1 ORDER BY 1 DESC LIMIT 3` | Current month ~47, previous ~15 |
| Batch failure | `SELECT batch_id, failure_count, failure_rate FROM gold_batch_reliability WHERE failure_rate > 0.1` | TRF-2024-Q3-887, 47 failures |
| Equipment cause | `SELECT cause_code, SUM(outage_count) FROM gold_outage_summary WHERE date >= CURRENT_DATE - 30 GROUP BY 1` | "equipment" dominates |
| Temperature anomaly | `SELECT batch_id, avg_temperature FROM gold_batch_reliability ORDER BY avg_temperature DESC LIMIT 5` | TRF-2024-Q3-887 at top, 10-15°C above others |
| Filter dims | `SELECT DISTINCT region FROM gold_outage_summary` | North, South, Central, East, West |
| Column names | `DESCRIBE gold_outage_summary` / `DESCRIBE gold_batch_reliability` | Match specs above |

Add pipeline_id to `resources.json`.
