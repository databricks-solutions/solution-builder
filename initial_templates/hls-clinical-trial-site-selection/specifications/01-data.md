# 01 — Data & AI Functions (healthcare_lifesciences.trial_site_selection)

**Source systems simulated:** EDC screening log (site-coded reason + coordinator free text), CTMS start-up milestones,
de-identified EHR-network catchment counts (30 mi around each site, criterion by criterion), registry monitoring of competing trials,
feasibility database (each site's past trials, any sponsor). All synthetic (`data_generation/generate_data.py`, seed 20261001, dates relative to run day).

| Table | Grain | Key facts |
|---|---|---|
| trials | trial | 5 trials; CASCADE-CKD target 1,200, 24-month enrollment, planned screen-fail 35% |
| protocol_criteria | trial × criterion | I1–I5, E1–E7 for CASCADE-CKD with feasibility-assumed pass rate + rationale; E4 assumed 15% SGLT2i |
| sites | site | 205 US sites: type, IRB (central/local), coordinator FTE, prior Halcyra trials, lat/lon |
| trial_sites / site_activation | trial × site | CASCADE: 64 active, 5 activating, 3 not activated; milestone dates, cycle_time_days |
| enrollment_plan | trial × month | planned cumulative randomized (S-curve, target × x^1.5) |
| screening_log | screened patient | outcome, coded_reason (criterion or OTHER), coordinator_note |
| screening_truth | screen failure | ground-truth criterion + months on SGLT2i (evaluation only) |
| site_catchment | site | T2D+CKD → eGFR → UACR → HbA1c → SGLT2i (all / stable ≥ 12 wk) → potassium; eligible current vs amended |
| population_trends | quarter × region | SGLT2i share 14% (2023-Q1) → ~47–53% today |
| competing_trials / competing_trial_sites | trial / trial × site | REDWOOD-CKD (opened ~8 months ago) at 13 active CASCADE sites + candidates |
| site_trial_history | past site-trial | 1,246 rows — ML training data |

**Planted signal:** E4 hazard grows 0.17 → 0.36 per screened patient over the study; 58% of E4 failures coded OTHER (vs 18% for other criteria);
REDWOOD-CKD overlap × 0.45 rate; 11 zero enrollers; local IRB +~95 days start-up.

**AI Functions** (`src/ai/classify_screen_fails.py`) → `screen_fail_reasons`:
- `ai_classify(coordinator_note, [10 criterion labels])` for every OTHER-coded failure (164 in CASCADE-CKD; 100% agree with ground truth).
- `ai_query('databricks-gpt-oss-20b', …, returnType => 'INT')` → months on SGLT2i for every E4 failure → `sglt2i_stable_12wk` (205/205 correct vs truth).

**Gold** (`src/gold/build_gold.py`): gold_trial_enrollment_monthly, gold_site_performance (incl. pre/post-competitor rate, is_zero_enroller),
gold_screen_fail_monthly (real vs site-coded vs AI-recovered), gold_site_features (model features).
