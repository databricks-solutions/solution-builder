# 02 — ML: 7-day failure-risk model (Unity Catalog)

**Code:** `src/ml/train_score_model.py` (job task `train_score_model`, serverless, scikit-learn + MLflow 3).
**Model:** `manufacturing.predictive_maintenance_copilot.failure_risk_model` alias **@champion**.

## Features (`asset_health_features`, one row per asset-day, RUNNING hours only)
Relative-to-self drift — each asset against its own 30-day median baseline lagged 14 days:
`vib_ratio`, `vib_trend` (4-day rise as % of baseline), `temp_delta` (°C), `current_ratio`, `pressure_ratio`,
plus `days_since_pm`, `days_since_failure`, asset-type one-hots.
**Label:** `label_fail_7d` = an unplanned failure occurs in the next 1–7 days.

## Training
GradientBoostingClassifier (150 trees, depth 2, lr 0.05, positive weight 3), time-based split (first 60% train /
last 40% test) for the logged metrics (AUC, average precision), then refit on all history. Logged to MLflow with
signature + input example, registered to UC, alias `champion`, then **re-loaded from `models:/…@champion`** to score.

## Scoring → `asset_risk_scores` (one row per asset)
`failure_prob_7d`, `risk_score` (0-100), `risk_tier` (Critical ≥70 · High 40-70 · Watch 15-40 · Healthy),
`predicted_failure_mode` (J3 RV reducer bearing wear / coolant restriction / …), `est_days_to_failure` (vibration-ratio
extrapolation to the historical failure level), `top_driver_1..3` (human-readable: "Vibration RMS 2.6x baseline (3.96 vs
1.53 mm/s)"), `downtime_cost_at_risk_usd` = P × expected unplanned failure cost, `unplanned_failure_cost_usd`.

## What the model can and cannot see (the demo's point)
It sees RA-207 (drift) and RA-211 (early drift). It cannot see RA-214 — same bad grease, no drift yet. The copilot
closes that gap from the CMMS history + the manuals: model = *when*, copilot = *why* and *who else*.
