# ML Notebook - Readmission Risk Prediction

## Purpose

Build a model that predicts which patients are at high risk of 30-day readmission at the time of discharge. This enables proactive intervention before patients leave the hospital.

## Model Overview

**Objective:** Predict probability of 30-day readmission for each patient at discharge.

**Type:** Binary classification (will_readmit_30d: yes/no)

**Value Proposition:** "Instead of reacting after patients return, we identify high-risk patients before discharge and ensure they get extra support - extended education, home health, earlier follow-up."

## Feature Engineering

### Patient Features

| Feature | Description | Source |
|---------|-------------|--------|
| age | Patient age at admission | patients |
| gender | M/F | patients |
| insurance_type | Medicare, Medicaid, Commercial | patients |
| risk_score | Comorbidity index | patients |
| prior_admissions_12m | Admissions in past year | admissions |
| prior_readmissions | Previous 30-day readmits | readmissions |

### Admission Features

| Feature | Description | Source |
|---------|-------------|--------|
| length_of_stay | Days in hospital | admissions |
| service_line | Cardiology, Orthopedics, etc. | admissions |
| procedure_complexity | High/Medium/Low | procedures |
| icu_days | Days in ICU | admissions |
| discharge_disposition | Home, SNF, Rehab | admissions |

### Discharge Process Features

| Feature | Description | Source |
|---------|-------------|--------|
| has_coordinator | Discharge coordinator assigned | discharge_details |
| education_completed | Education checklist done | discharge_details |
| follow_up_scheduled | Appointment made | discharge_details |
| med_reconciliation | Medications reviewed | discharge_details |
| home_health_ordered | Home services arranged | discharge_details |
| discharge_quality_score | Composite score | calculated |

### Derived Features

| Feature | Calculation |
|---------|-------------|
| is_complex_cardiac | procedure IN ('TAVR', 'CABG') |
| discharge_gap_count | Count of missing discharge elements |
| high_risk_profile | age > 75 AND risk_score > 6 |

### Target Variable

```sql
-- Label: Was patient readmitted within 30 days?
SELECT
  admission_id,
  CASE
    WHEN readmission_id IS NOT NULL THEN 1
    ELSE 0
  END as readmitted_30d
FROM silver_admission_details a
LEFT JOIN bronze_readmissions r ON a.admission_id = r.original_admission_id
```

## Model Training

### Algorithm
- Primary: Gradient Boosted Trees (XGBoost)
- Alternative: Logistic Regression for interpretability in clinical settings

### Training Data
- Historical data: 12+ months
- Exclude: patients who expired, transferred to other facilities
- Train/test split: 70/30 by time

### Class Imbalance
- Readmission rate ~11-18% (minority class)
- Use: SMOTE, class weights, or threshold tuning

## Model Evaluation

### Metrics
| Metric | Target | Clinical Rationale |
|--------|--------|-------------------|
| AUC-ROC | >0.75 | Good discrimination |
| Recall (sensitivity) | >70% | Catch high-risk patients |
| Precision | >40% | Manageable intervention load |
| PPV at top 20% | >25% | Top quintile actionable |

### Clinical Utility
- Goal: Identify top 20% highest-risk patients for intervention
- Intervention: Extended education, home health, 48-hour follow-up call
- Cost of intervention: ~$200/patient
- Cost of readmission: ~$15,000/patient
- Break-even: Prevent 1 in 75 interventions

## Feature Importance

Expected top features:
1. prior_readmissions (strongest predictor)
2. discharge_quality_score (modifiable!)
3. risk_score (comorbidities)
4. has_coordinator (modifiable!)
5. length_of_stay
6. procedure_complexity

**Key insight:** Discharge process features are modifiable - we can improve outcomes by improving the discharge process.

## Model Deployment

### Scoring at Discharge
- Trigger: When discharge order is placed
- Score patient in real-time
- Display risk level in EHR

### Output: Readmission Risk Dashboard

| Column | Type | Description |
|--------|------|-------------|
| patient_id | STRING | Patient MRN |
| admission_id | STRING | Current admission |
| risk_score | DOUBLE | Probability 0-1 |
| risk_tier | STRING | High (>0.25), Medium (0.15-0.25), Low (<0.15) |
| top_risk_factors | STRING | Contributing factors |
| recommended_actions | STRING | Suggested interventions |

### Intervention Workflow
```
Patient approaching discharge
        ↓
Model scores risk
        ↓
High risk? → Alert care team
        ↓
Care team reviews
        ↓
Implement interventions:
- Extended education session
- Home health referral
- 48-hour follow-up call
- Earlier clinic appointment
```

## Demo Integration

### Dashboard Addition
Add "Patients at Risk" panel showing:
- Patients currently in 0-30 day post-discharge window
- Risk tier distribution
- Recommended interventions

### Demo Narrative Extension
"We currently have 23 TAVR patients in their 30-day window who discharged without full education. The model flags 8 of them as high-risk. We can proactively call them today for follow-up education before they end up back in our ED."

## Notebook Structure

1. **Data Preparation**
   - Load patient, admission, discharge data
   - Feature engineering
   - Train/test split

2. **Exploratory Analysis**
   - Readmission drivers
   - Discharge process correlation
   - TAVR subgroup analysis

3. **Model Training**
   - Baseline model
   - Hyperparameter tuning
   - Cross-validation

4. **Evaluation**
   - AUC, precision, recall
   - Feature importance
   - Subgroup performance (TAVR, cardiac, etc.)

5. **Clinical Validation**
   - Review with clinical team
   - Identify actionable insights
   - Define intervention thresholds

6. **Deployment**
   - Register model
   - Real-time scoring pipeline
   - Integration points with EHR
