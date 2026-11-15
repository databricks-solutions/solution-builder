# 02 — Readmission risk model + care-pathway documents (Genie agent)

## Model (src/ml/train_readmission_model.py)
- `healthcare_lifesciences.readmission_reduction.readmission_risk_model` — scikit-learn GradientBoostingClassifier, MLflow
  experiment `<workspace_folder>/readmission_model_experiment`, registered in Unity Catalog with alias **@champion**.
- Training: every discharge with a closed 30-day window. Features: age, LOS, emergency admission, Charlson, ED visits (6 mo), prior
  admissions (12 mo), discharge meds, lives alone, dual eligible, has PCP, SNF / home-health disposition, weekend discharge,
  **7-day follow-up booked**, condition one-hots. AUC ≈ 0.66 (typical for 30-day readmission models; LACE ≈ 0.65-0.70).
- Scoring → `discharge_risk_scores` for every open discharge: `risk_score`, `risk_if_followup` (same patient, follow-up booked),
  `risk_if_followup_hh` (+ home health), `risk_tier` (High ≥ 30%, Medium ≥ 18%), `top_drivers` (sensitivity vs a neutral value).
- `transition_worklist` view = open discharges (planned + discharged in the last 7 days) × scores × note insights × note text —
  the app mirrors it into Lakebase.

## Care-pathway documents (the Genie agent's `care_pathways` volume, src/care_pathways/*.md, answered in Agent mode)
HF transitions pathway CTP-HF-03 (7-day follow-up booked before discharge, med rec, BMP in 3-5 days after a diuretic/ARNI/MRA
change, risk-based intensity, home-health criteria), policy CT-201 (follow-up scheduling, **Friday/weekend discharge protocol**,
48-hour call), COPD/pneumonia pathway CTP-PULM-02, CT-305 (Ride Assist, meds-to-beds, home health, telehealth), CMS HRRP primer.
The Genie agent cites the sections; the app SP gets READ VOLUME + CAN_RUN on the agent (grant_app task).
