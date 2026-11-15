# CMS Hospital Readmissions Reduction Program (HRRP) — internal primer (Larkspur Finance & Quality)

## What it is
HRRP is a Medicare value-based purchasing program that **reduces Medicare inpatient (IPPS) base-operating DRG payments** to hospitals with more readmissions than expected. The reduction applies to **all** Medicare fee-for-service discharges in the fiscal year, not only to readmitted patients, and is **capped at 3%** of base-operating DRG payments.

## Conditions measured (Medicare FFS beneficiaries aged 65+)
Acute myocardial infarction (AMI), heart failure (HF), pneumonia (PN), chronic obstructive pulmonary disease (COPD), coronary artery bypass graft surgery (CABG) and elective primary total hip / total knee arthroplasty (THA/TKA). Readmissions are **unplanned** readmissions for any cause to any acute-care hospital within **30 days** of discharge.

## Excess readmission ratio (ERR)
For each condition, ERR = predicted readmissions ÷ expected readmissions, using a hierarchical risk-adjustment model over a 3-year performance period. ERR > 1.0 means worse than expected. **Larkspur Finance estimates ERR internally from the hospital's observed readmission rate vs the national rate over a trailing 12 months, credibility-weighted toward 1.0 (150 pseudo-discharges at the national rate) so small volumes do not swing it** — directionally useful for management, not a substitute for the CMS calculation.

## Payment adjustment
Payment reduction ≈ Σ over conditions of (condition payments ÷ total base-operating DRG payments) × max(0, ERR − peer-group median ERR) × a neutrality modifier, capped at 3%. Hospitals are compared within **peer groups** defined by their proportion of dual-eligible (Medicare + Medicaid) patients. For planning, Larkspur Finance uses a peer median of 1.00.

## What moves the ERR
Early follow-up (within 7 days) for HF, AMI and COPD; reliable medication reconciliation; addressing social needs (transportation, cost); weekend-discharge processes; home health for high-risk patients. A reduction of ~10 HF readmissions a year at Larkspur Regional moves its HF ERR by about 0.02.

## Timing
Penalties are published in the IPPS final rule each August and apply from October 1 (start of the federal fiscal year), based on discharges from roughly 2-5 years earlier — so a readmission avoided today reduces a penalty paid two to three years from now, and it compounds across overlapping 3-year windows.
