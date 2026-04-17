# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Problematic protocol** (deterministic — must exist with these exact values):

| protocol_id | drg_category | effective_date | includes_med_reconciliation |
|-------------|-------------|----------------|---------------------------|
| DISCH-HF-2025-03 | Heart Failure (DRG 291-293) | PROTOCOL_CHANGE_DATE | FALSE |

**Key DRGs for heart failure**: DRG 291 (HF & Shock w MCC), DRG 292 (HF & Shock w CC), DRG 293 (HF & Shock w/o CC/MCC).

**Readmission baselines**: Normal 30-day rate ~9%, affected protocol rate ~24%, excess readmissions ~156, CMS penalty exposure ~$3.2M.

**Key document author**: Dr. Sarah Chen, Chief Quality Officer. Memo: "Discharge Protocol Update - DISCH-HF-2025-03". Changes: reduced checklist from 12→8 steps, removed separate pharmacy reconciliation step. Update note (March 18): "Quality team has noted increased readmission rates for CHF patients. Medication reconciliation step may need review."

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, PROTOCOL_CHANGE_DATE = NOW - 6 weeks, Readmission spike = NOW - 3 to 5 weeks.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| patients.parquet | ~50K | Age: normal ~55 (18-95). Insurance: Medicare 40%, Commercial 35%, Medicaid 20%, Self-pay 5% |
| encounters.parquet | ~150K | Units: ICU, CCU, Med-Surg, Step-down. Disposition: home, SNF, rehab, expired |
| diagnoses.parquet | ~400K | ICD-10 codes. 1 primary per encounter. Key DRGs: 291/292/293 |
| discharge_protocols.parquet | ~200 | Format: DISCH-XX-YYYY-MM. See problematic protocol above |
| readmissions.parquet | ~12K | Normal rate ~9%. Affected protocol ~24% (~156 excess). Reasons: medication-related |
| quality_metrics.parquet | ~1K | Daily by DRG: readmission_rate, target_rate, penalty_exposure_usd |

### Table Schemas

**patients**: `patient_id` (PK, PT-NNNNNN), `age`, `gender` (M/F), `zip_code`, `insurance_type`, `risk_score` (1-10)

**encounters**: `encounter_id` (PK, ENC-NNNNNNNN), `patient_id` (FK), `admission_date`, `discharge_date`, `length_of_stay`, `discharge_disposition`, `discharge_protocol_id` (FK), `attending_physician`, `unit`

**diagnoses**: `diagnosis_id` (PK), `encounter_id` (FK), `icd10_code`, `description`, `drg`, `is_primary`

**discharge_protocols**: `protocol_id` (PK, DISCH-XX-YYYY-MM), `drg_category`, `effective_date`, `version`, `includes_med_reconciliation`, `created_by`

**readmissions**: `readmission_id` (PK), `original_encounter_id` (FK), `readmit_encounter_id` (FK), `days_to_readmit`, `readmit_reason`, `was_preventable`

**quality_metrics**: `metric_id` (PK), `metric_date`, `drg`, `readmission_rate`, `target_rate`, `patient_count`, `penalty_exposure_usd`

### The Event

~650 heart failure discharges on DISCH-HF-2025-03. ~156 readmissions (24% rate vs 9% baseline). Readmit reasons: medication discrepancies at discharge. Spike begins 3-5 weeks before NOW, correlating with PROTOCOL_CHANGE_DATE.

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/clinical_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Routine clinical docs (pathways for other DRGs, quality committee minutes, nursing protocols, pharmacy bulletins, training docs, compliance reports). NO mention of DISCH-HF-2025-03 or medication reconciliation changes.

**Key document**: Internal Memorandum — Discharge Protocol Update DISCH-HF-2025-03.

| Field | Value |
|-------|-------|
| From | Dr. Sarah Chen, Chief Quality Officer |
| To | Nursing Staff, Cardiology Department |
| Date | PROTOCOL_CHANGE_DATE |
| Subject | Discharge Protocol Update - DISCH-HF-2025-03 |

Content must include:
- Replaces DISCH-HF-2024-11, effective PROTOCOL_CHANGE_DATE
- Streamlined checklist: 12→8 steps
- "Removed redundant pharmacy consultation requirement"
- "Medication reconciliation now combined with discharge summary"
- "Separate pharmacy review step removed (deemed redundant with physician sign-off)"
- Update note (March 18): increased readmission rates noted, medication reconciliation step may need review
- Affected patients: CHF discharges since effective date, protocol DISCH-HF-2025-03

---

## C. SDP Pipeline

Create pipeline `lakeside_quality_analytics`, catalog `lakeside_health`, target schema `quality_analytics`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | readmission rates, penalty exposure by date/DRG | gold_readmission_rates, gold_monthly_quality |
| Dashboard drill-down | protocol-level readmission rates, patient lists | gold_protocol_performance |
| Genie investigation | Trace readmissions → protocols → diagnoses → root cause | gold_readmission_rates + silver_readmissions |

### Source → Bronze (1:1 ingestion)

patients/encounters/diagnoses/discharge_protocols/readmissions/quality_metrics.parquet → bronze_{table_name}

### Bronze → Silver (joins)

**silver_encounters**: encounters JOIN patients (→ age, gender, insurance_type, risk_score) JOIN diagnoses WHERE is_primary (→ icd10_code, drg, description) JOIN discharge_protocols (→ includes_med_reconciliation, effective_date). Columns: encounter_id, patient_id, age, gender, insurance_type, risk_score, admission_date, discharge_date, length_of_stay, discharge_disposition, unit, discharge_protocol_id, drg, icd10_code, diagnosis_description, includes_med_reconciliation.

**silver_readmissions**: readmissions JOIN silver_encounters ON original_encounter_id. Columns: readmission_id, original_encounter_id, readmit_encounter_id, days_to_readmit, readmit_reason, was_preventable, patient_id, drg, discharge_protocol_id, discharge_date, includes_med_reconciliation.

**silver_protocol_outcomes**: encounters GROUP BY discharge_protocol_id with aggregated readmission stats. Columns: discharge_protocol_id, drg_category, total_discharges, readmission_count, readmission_rate, avg_length_of_stay.

### Silver → Gold (aggregations)

**⚠️ ALL gold tables MUST include `drg` as a dimension for dashboard filtering.**

**gold_readmission_rates** — dims: date, drg, protocol_id. Metrics: discharges, readmissions, readmission_rate, target_rate.

**gold_protocol_performance** — dims: protocol_id, drg. Metrics: patient_count, readmission_rate, avg_los, penalty_exposure.

**gold_monthly_quality** — dims: month, drg. Metrics: readmission_rate, target, variance, penalty_usd.

### Filter Coherence Matrix

| Filter | gold_readmission_rates | gold_protocol_performance | gold_monthly_quality |
|--------|----------------------|--------------------------|---------------------|
| date | ✅ | — (cumulative) | ✅ (month) |
| drg | ✅ | ✅ | ✅ |
| protocol_id | ✅ | ✅ | — |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_readmission_rates | date, drg, protocol_id | discharges, readmissions, readmission_rate, target_rate |
| gold_protocol_performance | drg, protocol_id | patient_count, readmission_rate, avg_los, penalty_exposure |
| gold_monthly_quality | month, drg | readmission_rate, target, variance, penalty_usd |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Readmission spike | `SELECT protocol_id, readmission_rate FROM gold_protocol_performance WHERE protocol_id = 'DISCH-HF-2025-03'` | ~24% |
| Normal baseline | `SELECT AVG(readmission_rate) FROM gold_readmission_rates WHERE drg IN ('291','292','293') AND protocol_id != 'DISCH-HF-2025-03'` | ~9% |
| Excess readmissions | `SELECT readmissions FROM gold_protocol_performance WHERE protocol_id = 'DISCH-HF-2025-03'` | ~156 |
| Penalty exposure | `SELECT SUM(penalty_exposure) FROM gold_protocol_performance WHERE protocol_id = 'DISCH-HF-2025-03'` | ~$3.2M |
| Filter dims | `SELECT DISTINCT drg FROM gold_readmission_rates` | 291, 292, 293, others |
| Column names | `DESCRIBE gold_readmission_rates` / `DESCRIBE gold_protocol_performance` | Match specs above |

Add pipeline_id to `resources.json`.
