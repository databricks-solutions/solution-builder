# ML Notebook - Predictive Maintenance

## Purpose

Build a machine learning model that predicts equipment failures before they cause quality issues. This extends the demo from "reactive investigation" to "proactive prevention."

## Model Overview

**Objective:** Predict which machines will have quality issues in the next 7 days based on telemetry patterns.

**Type:** Binary classification (will_have_quality_issue: yes/no)

**Value Proposition:** "Instead of waiting for defects to spike and investigating after the fact, we can predict which machines need attention before they cause problems."

## Feature Engineering

### Input Features (from machine_telemetry)

| Feature | Description | Window |
|---------|-------------|--------|
| avg_vibration_7d | Average spindle vibration last 7 days | Rolling 7-day |
| max_vibration_7d | Max vibration last 7 days | Rolling 7-day |
| vibration_trend | Slope of vibration over time | Rolling 14-day |
| avg_temperature_7d | Average spindle temperature | Rolling 7-day |
| temp_vibration_correlation | Correlation between temp and vibration | Rolling 7-day |
| days_since_maintenance | Days since last PM | Point in time |
| days_until_maintenance_due | Days until scheduled PM | Point in time |
| operating_hours_since_pm | Hours run since last maintenance | Cumulative |

### Derived Features

| Feature | Calculation |
|---------|-------------|
| maintenance_overdue | 1 if days_until_maintenance_due < 0 |
| vibration_anomaly | 1 if avg_vibration_7d > 1.5 * historical_baseline |
| vibration_acceleration | vibration_trend > 0.1 mm/s per week |

### Target Variable

```sql
-- Label: Did this machine have >1.5% defect rate in the next 7 days?
SELECT
  machine_id,
  reading_date,
  CASE
    WHEN future_defect_rate > 0.015 THEN 1
    ELSE 0
  END as will_have_quality_issue
FROM (
  SELECT
    t.machine_id,
    t.reading_date,
    AVG(q.defect_rate) as future_defect_rate
  FROM machine_features t
  JOIN gold_daily_quality_metrics q
    ON t.machine_id = q.machine_id
    AND q.production_date BETWEEN t.reading_date AND t.reading_date + 7
  GROUP BY t.machine_id, t.reading_date
)
```

## Model Training

### Algorithm
- Start with: Gradient Boosted Trees (XGBoost or LightGBM)
- Alternative: Random Forest for interpretability

### Training Data
- Historical data: 6+ months
- Train/validation/test split: 70/15/15 by time (no future leakage)
- Handle class imbalance: quality issues are rare events

### Hyperparameters to Tune
- max_depth: [3, 5, 7]
- learning_rate: [0.01, 0.05, 0.1]
- n_estimators: [100, 200, 500]
- min_child_weight: [1, 3, 5]

## Model Evaluation

### Metrics
| Metric | Target | Rationale |
|--------|--------|-----------|
| Recall | >80% | Catch most failures (false negatives are costly) |
| Precision | >60% | Don't cry wolf too often |
| F1 Score | >0.70 | Balance |
| AUC-ROC | >0.85 | Overall discrimination |

### Confusion Matrix Interpretation
- **False Negative (Miss):** Machine fails, we didn't predict → Quality issues, costly rework
- **False Positive (False Alarm):** We predict failure, machine is fine → Unnecessary inspection (cheaper)
- **Bias toward recall** - better to inspect a healthy machine than miss a failing one

## Feature Importance

Expected top features:
1. vibration_trend (rising vibration is strongest signal)
2. days_since_maintenance (longer = higher risk)
3. maintenance_overdue (binary flag)
4. avg_vibration_7d (absolute level)
5. operating_hours_since_pm

## Model Deployment

### Serving
- Register model in MLflow Model Registry
- Deploy as real-time endpoint or batch scoring

### Batch Scoring Pipeline
```
Daily job:
1. Pull latest telemetry for all machines
2. Calculate features
3. Score each machine
4. Write predictions to gold_machine_risk_scores
5. Alert on high-risk machines
```

### Output Table: gold_machine_risk_scores

| Column | Type | Description |
|--------|------|-------------|
| machine_id | STRING | Machine identifier |
| score_date | DATE | When prediction was made |
| risk_score | DOUBLE | Probability of quality issue (0-1) |
| risk_level | STRING | Low (<0.3), Medium (0.3-0.6), High (>0.6) |
| top_risk_factors | STRING | Comma-separated list of contributing factors |

## Demo Integration

### Dashboard Addition
Add a "Predictive Risk" panel showing:
- Machines ranked by risk score
- CNC-B-007 should show HIGH risk (would have been flagged days before defects spiked)
- Top risk factors displayed

### Narrative Extension
"If we had this model running last week, CNC-B-007 would have been flagged on March 8 - three days before defects started. The model detected rising vibration and overdue maintenance as risk factors."

## Notebook Structure

1. **Data Preparation**
   - Load telemetry and quality data
   - Feature engineering
   - Train/test split

2. **Exploratory Analysis**
   - Correlation between telemetry and future defects
   - Visualize CNC-B-007 telemetry leading up to event

3. **Model Training**
   - Train baseline model
   - Hyperparameter tuning
   - Cross-validation

4. **Evaluation**
   - Metrics on test set
   - Confusion matrix
   - Feature importance plot

5. **Deployment**
   - Register model
   - Create scoring pipeline
   - Test on current data

6. **Business Value**
   - Calculate: "If we had this model, we would have caught X failures Y days early"
   - Show CNC-B-007 case study
