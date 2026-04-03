# Pipeline - Manufacturing Quality

## Architecture

```
Bronze (raw) → Silver (cleaned/joined) → Gold (aggregated metrics)
```

## Bronze Layer

Raw data as ingested, minimal transformation.

### bronze_production_runs
- Source: MES System (simulated Lakeflow Connect from Salesforce)
- Schema: As-is from source
- Partitioned by: ingestion_date

### bronze_quality_inspections
- Source: QMS System (simulated Lakeflow Connect from NetSuite)
- Schema: As-is from source
- Partitioned by: ingestion_date

### bronze_defect_details
- Source: QMS System
- Schema: As-is from source
- Partitioned by: ingestion_date

### bronze_machine_telemetry
- Source: IoT Platform (streaming)
- Schema: As-is from sensors
- Partitioned by: date

### bronze_maintenance_logs
- Source: CMMS System
- Schema: As-is from source

## Silver Layer

Cleaned, validated, joined data.

### silver_production_quality
Join production runs with inspection results.

```sql
SELECT
  pr.run_id,
  pr.batch_id,
  pr.product_line,
  pr.machine_id,
  pr.start_time,
  pr.end_time,
  pr.units_produced,
  qi.units_inspected,
  qi.units_passed,
  qi.units_failed,
  qi.units_failed / qi.units_inspected AS defect_rate,
  m.building,
  m.machine_type,
  m.last_maintenance,
  m.next_maintenance_due
FROM bronze_production_runs pr
JOIN bronze_quality_inspections qi ON pr.run_id = qi.run_id
JOIN bronze_machines m ON pr.machine_id = m.machine_id
```

### silver_defects_enriched
Defects with full context.

```sql
SELECT
  dd.*,
  qi.run_id,
  pr.batch_id,
  pr.product_line,
  pr.machine_id,
  pr.operator_id
FROM bronze_defect_details dd
JOIN bronze_quality_inspections qi ON dd.inspection_id = qi.inspection_id
JOIN bronze_production_runs pr ON qi.run_id = pr.run_id
```

### silver_machine_health
Aggregated telemetry with health indicators.

```sql
SELECT
  machine_id,
  date(timestamp) as reading_date,
  AVG(spindle_vibration) as avg_vibration,
  MAX(spindle_vibration) as max_vibration,
  AVG(spindle_temperature) as avg_temperature,
  -- Flag anomalies
  CASE WHEN MAX(spindle_vibration) > 2.0 THEN true ELSE false END as vibration_alert
FROM bronze_machine_telemetry
GROUP BY machine_id, date(timestamp)
```

## Gold Layer

Business-ready aggregations for dashboard and Genie.

### gold_daily_quality_metrics
Daily quality KPIs by product line and machine.

```sql
SELECT
  date(start_time) as production_date,
  product_line,
  machine_id,
  building,
  SUM(units_produced) as total_produced,
  SUM(units_inspected) as total_inspected,
  SUM(units_failed) as total_defects,
  SUM(units_failed) / SUM(units_inspected) as defect_rate,
  COUNT(DISTINCT batch_id) as batch_count
FROM silver_production_quality
GROUP BY date(start_time), product_line, machine_id, building
```

### gold_defect_analysis
Defect breakdown for root cause analysis.

```sql
SELECT
  date(inspection_time) as defect_date,
  product_line,
  machine_id,
  defect_type,
  severity,
  COUNT(*) as defect_count,
  AVG(measurement_value - spec_max) as avg_deviation
FROM silver_defects_enriched
WHERE units_failed > 0
GROUP BY date(inspection_time), product_line, machine_id, defect_type, severity
```

### gold_machine_maintenance_status
Current machine health and maintenance status.

```sql
SELECT
  m.machine_id,
  m.machine_type,
  m.building,
  m.last_maintenance,
  m.next_maintenance_due,
  DATEDIFF(current_date(), m.next_maintenance_due) as days_overdue,
  mh.avg_vibration,
  mh.vibration_alert,
  CASE
    WHEN DATEDIFF(current_date(), m.next_maintenance_due) > 0 THEN 'OVERDUE'
    WHEN mh.vibration_alert THEN 'WARNING'
    ELSE 'OK'
  END as health_status
FROM bronze_machines m
LEFT JOIN silver_machine_health mh
  ON m.machine_id = mh.machine_id
  AND mh.reading_date = current_date()
```

## Data Quality Checks

- [ ] All production runs have matching inspection records
- [ ] Defect counts match between inspection and detail tables
- [ ] Machine IDs are valid across all tables
- [ ] Timestamps are within expected ranges
- [ ] No null values in required fields
