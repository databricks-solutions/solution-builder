# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `precision_operations_analytics` |
| **Catalog** | `precision_motors` |
| **Target Schema** | `operations` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_machines | machines.parquet | Raw machine data |
| bronze_parts | parts.parquet | Raw part catalog |
| bronze_production_runs | production_runs.parquet | Raw production data |
| bronze_sensor_readings | sensor_readings.parquet | Raw sensor data |
| bronze_quality_inspections | quality_inspections.parquet | Raw inspection data |
| bronze_maintenance_logs | maintenance_logs.parquet | Raw maintenance records |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_production | Production runs with machine info, part details |
| silver_quality | Quality inspections with production and machine context |
| silver_sensor_trends | Aggregated sensor readings by machine and time window |

**Key relationships**:
- silver_production: run + machine + plant + part info
- silver_quality: inspection + run + machine + defect details

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_defect_rates | date, machine_id, plant | units_produced, units_failed, defect_rate |
| gold_machine_health | machine_id, date | avg_vibration, avg_temp, defect_rate, maintenance_status |
| gold_daily_quality | date, plant | production_count, defect_count, defect_rate, scrap_cost |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| Defect rate for CNC-DTR-007 | ~8.5-12% |
| Normal defect rate | ~2.8% |
| Vibration trend for CNC-DTR-007 | Increasing from 1.8 to 4.5 mm/s |
