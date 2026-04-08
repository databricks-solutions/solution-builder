# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

Use dynamic dates relative to NOW:

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| PROTOCOL_CHANGE_DATE | NOW - 6 weeks | When new protocol implemented |
| Readmission spike | NOW - 3 to 5 weeks | When readmissions peak |

---

## Output Location

```
{raw_data_volume}/
├── patients.parquet           (~50,000 rows)
├── encounters.parquet         (~150,000 rows)
├── diagnoses.parquet          (~400,000 rows)
├── discharge_protocols.parquet (~200 rows)
├── readmissions.parquet       (~12,000 rows)
└── quality_metrics.parquet    (~1,000 rows)
```

---

## Table Schemas

### 1. patients (~50,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| patient_id | STRING | Primary key (format: PT-NNNNNN) |
| age | INT | Patient age |
| gender | STRING | "M", "F" |
| zip_code | STRING | |
| insurance_type | STRING | "Medicare", "Medicaid", "Commercial", "Self-pay" |
| risk_score | INT | 1-10 clinical risk |

**Distribution**:
- Age: Normal around 55, range 18-95
- Insurance: Medicare ~40%, Commercial ~35%, Medicaid ~20%, Self-pay ~5%

---

### 2. encounters (~150,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| encounter_id | STRING | Primary key (format: ENC-NNNNNNNN) |
| patient_id | STRING | FK to patients |
| admission_date | DATE | |
| discharge_date | DATE | |
| length_of_stay | INT | Days |
| discharge_disposition | STRING | "home", "SNF", "rehab", "expired" |
| discharge_protocol_id | STRING | FK to discharge_protocols |
| attending_physician | STRING | |
| unit | STRING | "ICU", "CCU", "Med-Surg", "Step-down" |

---

### 3. diagnoses (~400,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| diagnosis_id | STRING | Primary key |
| encounter_id | STRING | FK to encounters |
| icd10_code | STRING | ICD-10 diagnosis code |
| description | STRING | |
| drg | STRING | Diagnosis Related Group |
| is_primary | BOOLEAN | Primary diagnosis flag |

**Key DRGs for heart failure**:
- DRG 291: Heart Failure & Shock w MCC
- DRG 292: Heart Failure & Shock w CC
- DRG 293: Heart Failure & Shock w/o CC/MCC

---

### 4. discharge_protocols (~200 rows)

| Column | Type | Description |
|--------|------|-------------|
| protocol_id | STRING | Primary key (format: DISCH-XX-YYYY-MM) |
| drg_category | STRING | Which DRGs this applies to |
| effective_date | DATE | When protocol started |
| version | STRING | Protocol version |
| includes_med_reconciliation | BOOLEAN | Key field for the issue |
| created_by | STRING | Who created it |

**The problematic protocol**:
- Protocol ID: DISCH-HF-2025-03
- DRG category: Heart Failure (291-293)
- Effective date: PROTOCOL_CHANGE_DATE
- **includes_med_reconciliation: FALSE** (this is the bug!)

---

### 5. readmissions (~12,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| readmission_id | STRING | Primary key |
| original_encounter_id | STRING | FK to encounters |
| readmit_encounter_id | STRING | FK to encounters |
| days_to_readmit | INT | Days between discharge and readmit |
| readmit_reason | STRING | Primary reason |
| was_preventable | BOOLEAN | Clinical assessment |

**Normal readmission rate**: ~9% within 30 days

**Affected protocol readmissions**:
- Heart failure patients on DISCH-HF-2025-03 showing ~24% readmission rate
- ~156 excess readmissions above baseline
- Readmit reasons: medication-related complications

---

### 6. quality_metrics (~1,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| metric_id | STRING | Primary key |
| metric_date | DATE | |
| drg | STRING | |
| readmission_rate | DECIMAL(5,2) | % |
| target_rate | DECIMAL(5,2) | CMS target |
| patient_count | INT | |
| penalty_exposure_usd | DECIMAL(12,2) | |

---

## Validation

| What to Check | Expected |
|---------------|----------|
| Encounters on DISCH-HF-2025-03 | ~650 heart failure discharges |
| Readmissions from affected protocol | ~156 (24% rate) |
| Normal HF readmission rate | ~9% |
| Total excess readmissions | ~100 above baseline |
| CMS penalty exposure | ~$3.2M |
