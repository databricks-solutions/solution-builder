# 02 — Site enrollment model + protocol documents (Genie agent)

## site_enrollment_model (Unity Catalog, alias @champion)
- Training: `site_trial_history` (1,246 past site-trials). Target: randomized patients / site / month.
- Features: eligible_density_index (eligible patients within 30 mi ÷ 600), competing_trials_nearby, activation_days, coordinator_fte,
  is_central_irb, is_academic, is_research_network, prior_halcyra_trials, is_renal_metabolic_ta, loo_hist_rate (leave-one-out track record).
- sklearn GradientBoostingRegressor (300 trees, depth 3). Holdout: MAE 0.13, R² 0.63. Importance: track record 0.51, density 0.29, competition 0.14.
- Logged to `<workspace_folder>/site_enrollment_model_experiment`; registered `healthcare_lifesciences.trial_site_selection.site_enrollment_model` v1 @champion.
- Batch scoring → `site_scores`: predicted rate with the current protocol and with the E4 amendment (density from `eligible_amended_e4`),
  estimated activation months (central 150 d / local 245 d, −25 d with ≥ 2 prior Halcyra trials), expected randomized in 12 months,
  `rescue_rank` over candidates with no competing DKD trial and ≥ 300 amended-eligible patients (43 candidates).

## CASCADE-CKD protocol documents (the Genie agent's documents volume, Agent mode)
Source volume `/Volumes/healthcare_lifesciences/trial_site_selection/protocol_docs` (from `src/protocol/*.md`):
protocol v3.0 §4–6 (E4 rationale §5.3 = efficacy-design; E7 §5.4 = safety, DSMB-only), SAP v2.0 §9.1–9.5 + Appendix C
(stable SGLT2i → keep N=1,200 / 368 events, +3 months follow-up, add stratification factor), 2023 feasibility (15% SGLT2i assumed; risk R-04),
SOP CLINOPS-014 (rescue-plan content, approvals, IRB timelines 30/60 days, re-screening, diversity guardrail).
The Genie agent answers protocol questions from these documents only, cites document + section and separates efficacy-design
from safety criteria; numbers come from the tables.
