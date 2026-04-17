# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Affected machine** (deterministic — must exist with these exact values):

| machine_id | machine_type | plant | install_date | last_maintenance |
|------------|-------------|-------|-------------|-----------------|
| CNC-DTR-007 | CNC | Detroit | (historical) | NOW - 90 days |

**Sensor thresholds (CNC machines)**:

| Sensor | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Vibration | 0.5-2.0 mm/s | >3.0 mm/s | >5.0 mm/s |
| Temperature | 35-55 C | — | — |

**The anomaly**: CNC-DTR-007 vibration creeping 1.8 → 4.5 mm/s over 10 days. Defect rate 8.5% → 12% vs 2.8% plant average. ~12,400 defective parts (dimensional tolerance failures). Spindle speed showing minor fluctuations.

**The ignored alert**: BEARING_WEAR_START - 2 days, technician Mike Rodriguez assessed vibration at 3.2 mm/s as "within acceptable range", deferred to next PM window (6 weeks out). Reviewed/acknowledged by Tom Chen (Maintenance Supervisor).

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, BEARING_WEAR_START = NOW - 10 days, Defect spike = NOW - 5 to 7 days.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| machines.parquet | ~50 | Types: CNC, Press, Assembly. Plants: Detroit, Chicago, Louisville |
| parts.parquet | ~200 | Categories: Gears, Shafts, Housings. Has tolerance_mm, target_cycle_time_sec |
| production_runs.parquet | ~50,000 | Shifts: day, evening, night |
| sensor_readings.parquet | ~5,000,000 | Types: vibration, temperature, spindle_speed. Units: mm/s, celsius, rpm |
| quality_inspections.parquet | ~150,000 | Defect types: dimensional, surface, material |
| maintenance_logs.parquet | ~2,000 | Types: scheduled, predictive, corrective |

### Table Schemas

**machines**: `machine_id` (PK, CNC-XXX-NNN), `machine_type`, `plant`, `install_date`, `last_maintenance`, `manufacturer`

**parts**: `part_id` (PK, PRT-NNNN), `part_name`, `part_category`, `tolerance_mm` (DECIMAL 6,4), `target_cycle_time_sec`

**production_runs**: `run_id` (PK), `machine_id` (FK), `part_id` (FK), `run_date`, `shift`, `units_produced`, `cycle_time_avg_sec` (DECIMAL 6,2)

**sensor_readings**: `reading_id` (PK), `machine_id` (FK), `reading_timestamp`, `sensor_type`, `value` (DECIMAL 10,4), `unit`

**quality_inspections**: `inspection_id` (PK), `run_id` (FK), `machine_id` (FK), `inspection_date`, `units_inspected`, `units_passed`, `units_failed`, `defect_type`, `defect_code`

**maintenance_logs**: `log_id` (PK), `machine_id` (FK), `log_date`, `maintenance_type`, `description`, `technician`, `parts_replaced`, `downtime_hours` (DECIMAL 6,2)

### The Event

CNC-DTR-007 anomaly embedded in data: vibration 1.8 → 4.5 mm/s over 10 days, defect rate 8.5-12% (vs 2.8% baseline), ~12,400 dimensional tolerance failures. One maintenance log entry with the dismissed predictive alert (see Shared Context).

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/maintenance_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Routine docs (monthly maintenance summaries, equipment calibration reports, safety inspections, training certs, preventive maintenance schedules, quality audit findings). NO mention of CNC-DTR-007 anomaly.

**Key document**: Predictive Maintenance Alert PMA-2025-0847, date BEARING_WEAR_START - 2 days.

| Field | Value |
|-------|-------|
| Machine | CNC-DTR-007 (Detroit Plant, Line 3) |
| Sensor | Vibration monitor (spindle assembly) |
| Current Reading | 3.2 mm/s (Warning >3.0, Critical >5.0) |
| Trend | Increasing from 1.8 mm/s over 5 days |
| Pattern | Consistent with spindle bearing wear, characteristic defect at 847 Hz |
| Remaining life | 2-4 weeks at current degradation rate |
| Technician | Mike Rodriguez |
| Assessment | "Reading within acceptable operating range. Bearing shows early wear but is functional. Recommend monitoring and scheduling replacement during next planned maintenance window (PM-DTR-Q2-2025, scheduled in 6 weeks)." |
| Reviewer | Tom Chen, Maintenance Supervisor |
| Disposition | Acknowledged, deferred to scheduled PM — no immediate action |

**Alert escalation timeline** (include in doc body):
- BEARING_WEAR_START - 2d: WARNING generated
- BEARING_WEAR_START: Alert acknowledged, scheduled for PM window
- BEARING_WEAR_START + 6d: Elevated to CRITICAL (5.2 mm/s)
- BEARING_WEAR_START + 8d: Quality issues reported (8.5% defect rate)
- Note: PM window not advanced despite CRITICAL elevation

---

## C. SDP Pipeline

Create pipeline `precision_operations_analytics` targeting catalog `precision_motors`, schema `operations`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | defect rate, scrap cost, OEE by date/plant/machine_type | gold_defect_rates, gold_machine_health, gold_daily_quality |
| Dashboard drill-down | machine-level defect rates, sensor trends, defect type distribution | gold_defect_rates, gold_machine_health |
| Genie investigation | Trace defects → machines → sensors → maintenance history | gold_defect_rates, gold_machine_health, silver_quality, silver_sensor_trends, bronze_machines |

### Source → Bronze (1:1 ingestion)

machines/parts/production_runs/sensor_readings/quality_inspections/maintenance_logs.parquet → bronze_{table_name}

### Bronze → Silver (joins)

**silver_production**: production_runs JOIN machines (→ machine_type, plant) JOIN parts (→ part_name, part_category, tolerance_mm). Columns: run_id, machine_id, machine_type, plant, part_id, part_name, part_category, run_date, shift, units_produced, cycle_time_avg_sec.

**silver_quality**: quality_inspections JOIN production_runs (→ run_date, shift, part_id) JOIN machines (→ machine_type, plant). Columns: inspection_id, run_id, machine_id, machine_type, plant, inspection_date, units_inspected, units_passed, units_failed, defect_type, defect_code.

**silver_sensor_trends**: sensor_readings aggregated by machine_id + DATE(reading_timestamp) + sensor_type. Columns: machine_id, reading_date, sensor_type, avg_value, min_value, max_value, reading_count.

### Silver → Gold (aggregations)

**ALL gold tables MUST include `plant` and `machine_type` as dimensions for dashboard filtering.**

**gold_defect_rates** — dims: date, machine_id, plant, machine_type. Metrics: units_produced (SUM), units_failed (SUM), defect_rate (units_failed/units_produced).

**gold_machine_health** — dims: machine_id, date, plant, machine_type. Metrics: avg_vibration, avg_temp, defect_rate, maintenance_status (latest maintenance_type from logs).

**gold_daily_quality** — dims: date, plant, machine_type. Metrics: production_count (SUM units_produced), defect_count (SUM units_failed), defect_rate, scrap_cost (defect_count * estimated unit cost).

### Filter Coherence Matrix

| Filter | gold_defect_rates | gold_machine_health | gold_daily_quality |
|--------|------------------|--------------------|--------------------|
| date | yes | yes | yes |
| plant | yes | yes | yes |
| machine_type | yes | yes | yes |
| machine_id | yes | yes | — (aggregate) |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_defect_rates | date, machine_id, plant, machine_type | units_produced, units_failed, defect_rate |
| gold_machine_health | machine_id, date, plant, machine_type | avg_vibration, avg_temp, defect_rate, maintenance_status |
| gold_daily_quality | date, plant, machine_type | production_count, defect_count, defect_rate, scrap_cost |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Defect spike | `SELECT machine_id, AVG(defect_rate) FROM gold_defect_rates WHERE date >= BEARING_WEAR_START GROUP BY 1 ORDER BY 2 DESC LIMIT 5` | CNC-DTR-007 at ~8.5-12%, others ~2.8% |
| Vibration trend | `SELECT reading_date, avg_value FROM silver_sensor_trends WHERE machine_id='CNC-DTR-007' AND sensor_type='vibration' ORDER BY 1` | 1.8 → 4.5 mm/s over 10 days |
| Defective parts | `SELECT SUM(units_failed) FROM gold_defect_rates WHERE machine_id='CNC-DTR-007' AND date >= BEARING_WEAR_START` | ~12,400 |
| Scrap cost | `SELECT SUM(scrap_cost) FROM gold_daily_quality WHERE date >= BEARING_WEAR_START` | Elevated vs baseline |
| Filter dims | `SELECT DISTINCT plant FROM gold_daily_quality` | Detroit, Chicago, Louisville |
| Column names | `DESCRIBE gold_defect_rates` / `DESCRIBE gold_machine_health` | Match specs above |

Add pipeline_id to `resources.json`.
