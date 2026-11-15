# CASCADE-CKD Statistical Analysis Plan — Version 2.0 (excerpt: Sections 9.1–9.5, Appendix C)

## 9.1 Sample size
368 primary endpoint events provide 90% power to detect a hazard ratio of 0.70 at two-sided alpha 0.05, assuming a
placebo event rate of 6.8 per 100 patient-years. With 1,200 participants, a 24-month enrollment period and ~36 months
median follow-up, the event target is expected to be reached ~12 months after the last patient in.

## 9.2 Stratification
Randomization is stratified by eGFR category and UACR category (protocol §4).

## 9.3 Primary analysis
Cox proportional hazards model stratified by the randomization strata; treatment as the only covariate.

## 9.4 Prespecified subgroups — including baseline SGLT2 inhibitor use
Prespecified subgroups: age, sex, race/ethnicity, region, baseline eGFR category, baseline UACR category, and
**baseline SGLT2 inhibitor use (yes/no)**. The SGLT2i subgroup was prespecified because protocol §6.3 allows an SGLT2
inhibitor to be started after randomization.

**Appendix C — sensitivity of the design to background SGLT2 inhibitor use.** Simulations run for the v2.0 SAP show that
if up to 50% of randomized participants are on a stable SGLT2 inhibitor at baseline:
- the placebo event rate is expected to fall by ~18% (6.8 → 5.6 per 100 patient-years) because SGLT2 inhibitors are renoprotective;
- the relative treatment effect of velmeraptan is expected to be additive (no interaction), consistent with other MRA programs;
- **the event target (368) and the sample size (1,200) can be kept unchanged**; the lower event rate is absorbed by
  about **3 additional months of follow-up** before the primary analysis;
- if background SGLT2 inhibitor use is allowed, **baseline SGLT2i use (yes/no) should be added as a third
  randomization stratification factor** so the arms stay balanced.

## 9.5 Handling of protocol amendments
Participants randomized under different protocol versions are analysed together; protocol version is included as a
sensitivity-analysis covariate. A change to eligibility requires a biostatistics impact memo (SOP CLINOPS-014 §4.2).
