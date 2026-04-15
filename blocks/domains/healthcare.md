---
name: Healthcare & Life Sciences
slug: healthcare
category: domain
tags: [healthcare, pharma, clinical-trials, claims, readmissions, ehr, life-sciences]
description: >
  Industry context for healthcare and life sciences demos covering hospital operations,
  payer analytics, clinical trials, and pharmaceutical use cases. Includes clinical
  terminology, quality metrics with CMS benchmarks, and regulatory frameworks that
  produce realistic, compliant demo narratives.
related: [financial-services, manufacturing]
suggested_patterns: [anomaly-detection, predictive-maintenance, compliance-audit, customer-segmentation]
suggested_capabilities: [aibi-dashboards, genie-space, knowledge-assistant, multi-agent-supervisor, declarative-pipeline, model-serving, notebooks]
---

## Terminology

- **EHR / EMR** — Electronic Health Record / Electronic Medical Record; primary clinical data system (Epic, Cerner, MEDITECH)
- **ICD-10** — International Classification of Diseases, 10th revision; standardized diagnosis codes (e.g., I50.9 = heart failure, unspecified)
- **CPT** — Current Procedural Terminology; codes for medical procedures and services billed to payers
- **DRG** — Diagnosis Related Group; classification system grouping hospital cases for fixed reimbursement
- **TAVR** — Transcatheter Aortic Valve Replacement; minimally invasive cardiac procedure
- **ADT** — Admit, Discharge, Transfer; core hospital event feed tracking patient movement
- **SDOH** — Social Determinants of Health; non-clinical factors (housing, food access, transportation) affecting outcomes
- **Prior authorization** — Payer requirement for pre-approval before covering a procedure or medication
- **Formulary** — List of medications covered by an insurance plan, organized by tier and co-pay level
- **NNT** — Number Needed to Treat; how many patients must receive a treatment for one to benefit
- **CRO** — Contract Research Organization; third party conducting clinical trial operations
- **Phase I/II/III/IV** — Clinical trial phases from safety (I) through post-market surveillance (IV)

## KPIs and Baseline Metrics

| KPI | Healthy Baseline | Red Flag |
|-----|-----------------|----------|
| 30-day readmission rate (all-cause) | 10-13% | >15% (CMS penalty threshold) |
| Average length of stay (ALOS) | 4.5-5.5 days (medical) | >7 days |
| Hospital-acquired infection rate | 0.5-1.0 per 1,000 patient-days | >2.0 |
| ED boarding time | <4 hours | >8 hours |
| Claims denial rate | 5-10% | >15% |
| Clinical trial enrollment rate | 70-85% of target | <50% of target |
| Drug adverse event reporting (ICSR) | Processed within 15 days | Backlog >30 days |
| Patient satisfaction (HCAHPS top-box) | 70-75% | <65% |
| Bed occupancy rate | 75-85% | >92% (strain) or <60% (underutilized) |
| Time to first dose (ED) | <60 minutes | >90 minutes |

## Personas

- **Dr. Sarah Patel, Chief Medical Officer** — Accountable for clinical quality metrics, readmission penalties, and physician practice variation. Reports to the board on patient safety and outcomes.
- **Karen Whitfield, VP of Revenue Cycle** — Owns claims submissions, denial management, and payer contract negotiations. Focused on reducing days in A/R and clean claim rates.
- **Michael Torres, Director of Clinical Informatics** — Bridges IT and clinical operations. Manages EHR data extraction, clinical decision support rules, and interoperability initiatives (HL7 FHIR).
- **Dr. Anika Rao, VP of Clinical Development (Pharma)** — Leads clinical trial design, site selection, and regulatory submissions. Cares about enrollment velocity, protocol deviations, and time-to-market.

## Data Entities and Relationships

- **Patients** (patient_id, mrn, dob, gender, zip_code, insurance_id, pcp_id, risk_score)
- **Encounters** (encounter_id, patient_id, facility_id, admit_date, discharge_date, encounter_type, drg_code, attending_provider_id)
- **Diagnoses** (encounter_id, icd10_code, diagnosis_rank, present_on_admission_flag)
- **Procedures** (encounter_id, cpt_code, procedure_date, performing_provider_id)
- **Medications** (order_id, patient_id, ndc_code, drug_name, dose, route, start_date, end_date)
- **Lab Results** (result_id, patient_id, loinc_code, test_name, value, unit, reference_range, result_date)
- **Claims** (claim_id, encounter_id, payer_id, billed_amount, allowed_amount, paid_amount, denial_code, status)
- **Clinical Trials** (trial_id, nct_number, phase, therapeutic_area, enrollment_target, site_ids)
- **Trial Subjects** (subject_id, trial_id, site_id, consent_date, randomization_arm, status, adverse_events)

Key relationships: Patients -> Encounters -> (Diagnoses, Procedures, Medications, Lab Results); Encounters -> Claims; Trial Subjects reference Patients at participating sites.

## Regulatory and Compliance

- **HIPAA** — Protected Health Information (PHI) requires encryption at rest and in transit, minimum necessary access, and Business Associate Agreements for all data processors
- **CMS Quality Programs** — Hospital Readmissions Reduction Program penalizes up to 3% of Medicare reimbursement; Hospital-Acquired Condition Reduction Program penalizes bottom quartile
- **21st Century Cures Act** — Mandates patient data access via standardized APIs (FHIR); prohibits information blocking
- **FDA 21 CFR Part 11** — Electronic records in clinical trials must have audit trails, electronic signatures, and validated systems
- **GDPR (EU clinical trials)** — Cross-border trial data requires Data Protection Impact Assessments and lawful basis for processing
- **GxP (GLP, GCP, GMP)** — Good Practice regulations governing lab work, clinical trials, and drug manufacturing; require validated data pipelines and change control

## Common Pain Points and Use Cases

1. **Readmission risk prediction** — CMS penalties cost hospitals $500M+ annually. Models need to incorporate SDOH data, medication adherence, and post-discharge follow-up gaps to identify patients needing proactive outreach within the 30-day window.
2. **Claims denial prevention** — 10-15% of claims are denied on first submission; rework costs $25-30 per claim. NLP on clinical notes can identify missing documentation before submission.
3. **Clinical trial site selection** — Finding sites with sufficient eligible patient populations, experienced PIs, and low screen-failure rates. EHR-based feasibility queries can accelerate enrollment by 30-40%.
4. **Drug interaction and adverse event detection** — Real-world evidence from EHR data can surface safety signals faster than traditional pharmacovigilance. NLP on clinical notes captures events missed by structured data.
5. **Patient flow optimization** — ED boarding, OR scheduling, and bed management require real-time predictive models. A 1-hour reduction in average boarding time can save a 400-bed hospital $2-4M annually.
6. **Social determinants integration** — Linking census, housing, and food-access data to patient records improves risk stratification accuracy by 15-20% but requires careful de-identification and consent management.
