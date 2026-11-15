# 04 — Portfolio dashboard + Genie

**AI/BI dashboard** "Halcyra ClinOps - Trial Enrollment Portfolio" (`dashboard/trial_enrollment_portfolio.lvdash.json`, schema-less datasets, embedded credentials):
- *Portfolio*: KPIs (active trials, trials > 15% behind, patients randomized, CASCADE % of plan), % of plan by trial over time, median activation days by IRB type, scorecard.
- *CASCADE-CKD deep dive*: randomized/planned/screen-fail/zero-enroller KPIs, actual vs plan curve, screen failures by reason by quarter,
  OTHER-coded failures recovered by AI Functions, SGLT2i uptake by region, REDWOOD-CKD overlap, site league table, model-ranked rescue candidates.

**Genie space** "Halcyra ClinOps - Trial Enrollment & Site Selection" (`src/genie/genie_space.json`, serialized v2, 14 tables sorted):
text instructions define enrollment vs plan, real vs site-coded screen-fail reason, zero enrollers, competitor overlap, activation cycle time, site_scores.
Sample questions (each has verified example SQL):
1. Which trial is furthest behind its enrollment plan? → CASCADE-CKD 397 / 715 (55.5%)
2. What are the top screen failure reasons for CASCADE-CKD? → E4 205 (39.3%), I3 86 (16.5%), E7 65 (12.5%)
3. How has the share of CASCADE-CKD screen failures caused by SGLT2 inhibitor use changed by quarter? → 17.6% (2025-Q2) → 44.6% (2026-Q3)
4. Which active CASCADE-CKD sites have randomized zero patients? → 11 sites
5. What is the median site activation cycle time by IRB type for CASCADE-CKD? → local 250.5 d vs central 146.5 d
6. How did randomization change at CASCADE-CKD sites that also run the REDWOOD-CKD competing trial? → 0.55 → 0.24 per site-month (13 sites)
