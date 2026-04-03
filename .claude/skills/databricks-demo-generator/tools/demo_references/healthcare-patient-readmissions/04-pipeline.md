# Pipeline - Healthcare Readmissions

## Architecture

```
Bronze (raw) → Silver (cleaned/joined) → Gold (aggregated metrics)
```

## Bronze Layer

### bronze_patients
- Source: Epic EHR (simulated Lakeflow Connect)
- Schema: As-is from source

### bronze_admissions
- Source: Epic EHR
- Schema: As-is from source

### bronze_procedures
- Source: Epic EHR
- Schema: As-is from source

### bronze_readmissions
- Source: Calculated from admissions (same patient, <30 days)
- Schema: As-is

### bronze_discharge_details
- Source: Epic EHR / discharge planning system
- Schema: As-is

### bronze_care_team
- Source: HR/Scheduling system
- Schema: As-is

## Silver Layer

### silver_admission_details
Complete admission record with patient and procedure info.

```sql
SELECT
  a.admission_id,
  a.patient_id,
  p.date_of_birth,
  p.insurance_type,
  p.risk_score,
  a.admit_date,
  a.discharge_date,
  a.service_line,
  a.discharge_disposition,
  a.length_of_stay,
  pr.procedure_code,
  pr.procedure_name,
  d.discharge_coordinator_id,
  d.education_completed,
  d.follow_up_scheduled,
  d.medication_reconciliation
FROM bronze_admissions a
JOIN bronze_patients p ON a.patient_id = p.patient_id
LEFT JOIN bronze_procedures pr ON a.admission_id = pr.admission_id
LEFT JOIN bronze_discharge_details d ON a.admission_id = d.admission_id
```

### silver_readmission_events
Readmissions with full context.

```sql
SELECT
  r.readmission_id,
  r.original_admission_id,
  r.days_to_readmit,
  r.readmit_reason,
  r.preventable_flag,
  orig.patient_id,
  orig.service_line,
  orig.procedure_name,
  orig.discharge_date as original_discharge,
  orig.education_completed,
  orig.follow_up_scheduled,
  orig.discharge_coordinator_id
FROM bronze_readmissions r
JOIN silver_admission_details orig ON r.original_admission_id = orig.admission_id
```

### silver_discharge_quality
Discharge process quality by admission.

```sql
SELECT
  admission_id,
  service_line,
  procedure_name,
  discharge_date,
  discharge_coordinator_id,
  CASE WHEN discharge_coordinator_id IS NOT NULL THEN 1 ELSE 0 END as has_coordinator,
  CASE WHEN education_completed THEN 1 ELSE 0 END as education_done,
  CASE WHEN follow_up_scheduled THEN 1 ELSE 0 END as followup_done,
  (CASE WHEN education_completed THEN 1 ELSE 0 END +
   CASE WHEN follow_up_scheduled THEN 1 ELSE 0 END +
   CASE WHEN medication_reconciliation THEN 1 ELSE 0 END) / 3.0 as discharge_quality_score
FROM silver_admission_details
WHERE discharge_date IS NOT NULL
```

## Gold Layer

### gold_readmission_metrics
Daily/weekly readmission KPIs.

```sql
SELECT
  DATE_TRUNC('week', discharge_date) as discharge_week,
  service_line,
  procedure_name,
  COUNT(DISTINCT admission_id) as total_discharges,
  COUNT(DISTINCT CASE WHEN readmission_id IS NOT NULL THEN admission_id END) as readmissions,
  COUNT(DISTINCT CASE WHEN readmission_id IS NOT NULL THEN admission_id END) /
    COUNT(DISTINCT admission_id) as readmission_rate,
  AVG(discharge_quality_score) as avg_discharge_quality
FROM silver_admission_details a
LEFT JOIN silver_readmission_events r ON a.admission_id = r.original_admission_id
GROUP BY DATE_TRUNC('week', discharge_date), service_line, procedure_name
```

### gold_procedure_readmission_analysis
Readmission analysis by procedure type.

```sql
SELECT
  procedure_name,
  discharge_month,
  total_procedures,
  readmissions,
  readmission_rate,
  pct_with_coordinator,
  pct_education_complete,
  pct_followup_scheduled,
  avg_days_to_readmit,
  top_readmit_reason
FROM (
  -- aggregation logic
)
```

### gold_staffing_impact
Correlation between staffing and outcomes.

```sql
SELECT
  service_line,
  discharge_week,
  has_coordinator,
  COUNT(*) as discharges,
  SUM(CASE WHEN readmitted THEN 1 ELSE 0 END) as readmissions,
  readmission_rate,
  avg_discharge_quality_score
FROM silver_discharge_quality
GROUP BY service_line, discharge_week, has_coordinator
```

## Data Quality Checks

- [ ] All admissions have valid patient records
- [ ] Readmission window is exactly 30 days
- [ ] Procedure codes are valid CPT codes
- [ ] Discharge dates are after admit dates
- [ ] No future dates in historical data
