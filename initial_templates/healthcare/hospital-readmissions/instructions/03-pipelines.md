# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `lakeside_quality_analytics` |
| **Catalog** | `lakeside_health` |
| **Target Schema** | `quality_analytics` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_patients | patients.parquet | Raw patient records |
| bronze_encounters | encounters.parquet | Raw encounter data |
| bronze_diagnoses | diagnoses.parquet | Raw diagnosis records |
| bronze_discharge_protocols | discharge_protocols.parquet | Raw protocol data |
| bronze_readmissions | readmissions.parquet | Raw readmission records |
| bronze_quality_metrics | quality_metrics.parquet | Raw metrics |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_encounters | Encounters with patient demographics, diagnoses, protocol info |
| silver_readmissions | Readmissions with original encounter, protocol, diagnosis context |
| silver_protocol_outcomes | Protocol-level aggregated outcomes |

**Key relationships**:
- silver_encounters: encounter + patient + primary diagnosis + DRG + protocol
- silver_readmissions: readmission + original discharge + protocol used

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_readmission_rates | date, drg, protocol_id | discharges, readmissions, readmission_rate, target_rate |
| gold_protocol_performance | protocol_id, drg | patient_count, readmission_rate, avg_los, penalty_exposure |
| gold_monthly_quality | month, drg | readmission_rate, target, variance, penalty_usd |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| Readmission rate for DISCH-HF-2025-03 | ~24% |
| Normal HF readmission rate | ~9% |
| Penalty exposure | ~$3.2M |
