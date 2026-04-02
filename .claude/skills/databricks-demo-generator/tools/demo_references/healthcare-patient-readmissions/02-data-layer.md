# Data Layer - Healthcare Readmissions

## Schema Overview

```
patients ←──┬──→ admissions ←──→ readmissions
             │         │
             │         └──→ procedures
             │         │
             │         └──→ discharge_details
             │
             └──→ care_team_assignments
```

## Tables

### patients
Patient master data (Simulated: Epic via Lakeflow Connect)

| Column | Type | Description |
|--------|------|-------------|
| patient_id | STRING | Unique patient MRN |
| date_of_birth | DATE | DOB for age calculation |
| gender | STRING | M/F/Other |
| zip_code | STRING | For geographic analysis |
| insurance_type | STRING | Medicare, Medicaid, Commercial, Self-pay |
| primary_diagnosis_code | STRING | ICD-10 code |
| risk_score | DOUBLE | Calculated comorbidity score |

**Distribution:**
- 12 months of patients (~8,000 unique)
- 65% Medicare (elderly population)
- Risk scores: 0-10 scale, higher = more comorbidities

### admissions
Hospital admission records (Simulated: Epic via Lakeflow Connect)

| Column | Type | Description |
|--------|------|-------------|
| admission_id | STRING | Unique admission ID |
| patient_id | STRING | FK to patients |
| admit_date | DATE | Admission date |
| discharge_date | DATE | Discharge date |
| service_line | STRING | Cardiology, Orthopedics, General Medicine, etc. |
| discharge_disposition | STRING | Home, SNF, Rehab, Expired |
| length_of_stay | INT | Days in hospital |
| attending_physician_id | STRING | Primary physician |
| discharge_coordinator_id | STRING | Staff who coordinated discharge |

**Distribution:**
- ~2,500 admissions over 12 months
- Service lines: 35% Cardiology, 25% Orthopedics, 40% Other
- **THE EVENT:** Feb 15 - Mar 15: discharge_coordinator_id = NULL for 40% of cardiology discharges

### procedures
Procedures performed during admission

| Column | Type | Description |
|--------|------|-------------|
| procedure_id | STRING | Unique procedure ID |
| admission_id | STRING | FK to admissions |
| procedure_code | STRING | CPT code |
| procedure_name | STRING | Human-readable name |
| procedure_date | DATE | When performed |
| performing_physician_id | STRING | Surgeon/specialist |

**Key procedures:**
- TAVR (33361): Transcatheter aortic valve replacement
- CABG: Coronary bypass
- PCI: Percutaneous coronary intervention

### readmissions
30-day readmission events

| Column | Type | Description |
|--------|------|-------------|
| readmission_id | STRING | Unique readmission ID |
| original_admission_id | STRING | FK to index admission |
| readmit_admission_id | STRING | FK to readmit admission |
| days_to_readmit | INT | Days between discharge and readmit |
| readmit_reason | STRING | Primary diagnosis on readmit |
| preventable_flag | STRING | Yes/No/Unknown |

**Distribution:**
- Normal: 11% 30-day readmission rate
- **THE EVENT:** TAVR patients discharged Feb 15 - Mar 15: 24% readmission rate
- Readmit reasons for TAVR: 70% heart_failure, 20% arrhythmia, 10% other

### discharge_details
Discharge planning information

| Column | Type | Description |
|--------|------|-------------|
| discharge_id | STRING | Unique ID |
| admission_id | STRING | FK to admissions |
| discharge_coordinator_id | STRING | Coordinator assigned (NULL if none) |
| education_completed | BOOLEAN | Patient education done? |
| follow_up_scheduled | BOOLEAN | Follow-up appointment made? |
| medication_reconciliation | BOOLEAN | Meds reviewed with patient? |
| home_health_ordered | BOOLEAN | Home health services arranged? |
| discharge_time | TIMESTAMP | When patient left |

**Distribution:**
- Normal: 95% have all checkboxes complete
- **THE EVENT:** TAVR patients Feb 15 - Mar 15: only 60% education_completed, 70% follow_up_scheduled

### care_team_assignments
Staff assignments to service lines

| Column | Type | Description |
|--------|------|-------------|
| assignment_id | STRING | Unique ID |
| staff_id | STRING | Employee ID |
| role | STRING | Discharge Coordinator, Case Manager, etc. |
| service_line | STRING | Cardiology, Orthopedics, etc. |
| start_date | DATE | Assignment start |
| end_date | DATE | Assignment end (NULL if current) |

**Key data:**
- Staff ID DC-401 (Maria Santos): Cardiology discharge coordinator
- end_date = 2024-02-14 (went on leave)
- No replacement assigned until present

## The Event Encoding

The readmission spike is caused by:
1. **Discharge coordinator vacancy** in Cardiology starting Feb 15
2. **Reduced patient education** completion (95% → 60%)
3. **Fewer scheduled follow-ups** (98% → 70%)
4. **TAVR patients most affected** - complex procedure requiring careful discharge planning
5. **Heart failure readmissions** - patients didn't recognize warning signs

## Relationships for Tracing

```
High readmission rate (dashboard)
    → Filter by service_line = "Cardiology"
    → Filter by procedure = "TAVR"
    → Join to discharge_details → education_completed = FALSE
    → Check care_team_assignments → No coordinator assigned Feb 15+
    → Readmit reason = heart_failure (patients didn't know warning signs)
```
