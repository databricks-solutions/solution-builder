# 01 — Data, AI Functions and gold (Larkspur Health readmissions)

**Target:** `healthcare_lifesciences.readmission_reduction` (bundle variables `catalog` / `schema`). Built by the setup job
(`databricks bundle run readmission_setup`) from an empty schema.

## Raw (data_generation/generate_data.py — synthetic, seeded, dates anchored on the Monday of the current week)
| Table | Grain | Notes |
|---|---|---|
| `hospitals` | hospital (3) | LRMC (flagship, 412 beds), Millbrook, Castle Ridge; Medicare base-operating DRG payments; `data_as_of` = "today" |
| `units` | unit (9) | 4 West Cardiac Step-Down (`LRMC-4W`), 5 East Medicine, 3 North Pulmonary, 6 South Ortho, 7 Central CV Surgery, Millbrook 2 West / 3 East, Castle Ridge 1 Main / 2 South |
| `unit_events` | event | 4 West lost its weekend discharge navigator; HF Transitions Clinic dropped its Saturday session (26 weeks ago) |
| `patients` | patient | synthetic names, age, payer, dual eligible, language, lives alone (registration), has PCP |
| `discharges` | index discharge (~19k over 2 years + planned discharges of the next 3 days) | HRRP condition, LOS, Charlson, ED visits, prior admits, disposition, **followup_7d_scheduled**, weekday, Medicare FFS 65+, DRG payment, readmitted_30d |
| `readmissions` | readmission | days to readmit, reason, cost |
| `discharge_notes` | note (last ~120 days + planned) | free-text discharge summaries — social risks and medication changes live only here |
| `hrrp_benchmarks` | condition | national 30-day readmission rate (HF 19.9%, AMI 13.8%, PN 16.0%, COPD 19.0%, CABG 11.7%, THA/TKA 4.5%) |
| `note_truth` | note | generator ground truth for evaluating the AI extraction only |

**Planted signal:** since the navigator left, 4 West heart-failure patients discharged Friday-Sunday leave with a booked 7-day
follow-up only ~1 in 5 times (weekdays ~70%); HF patients without a follow-up readmit at ~2x the rate. 4 West HF 30-day
readmissions rise from ~19% to ~29% while the other units stay flat. Transportation barriers exist only in the notes and roughly
double readmission risk — the model cannot see them, AI Functions can.

## AI Functions (src/ai/extract_note_insights.py) → `discharge_note_insights`
One `ai_query('databricks-gpt-5-4-mini', …, responseFormat => <strict JSON schema>)` per note, parsed with `from_json`:
lives_alone, transportation_barrier, medication_affordability, caregiver_support, language_barrier, high_risk_med_change,
med_changes[], followup_status (booked / patient_to_call / not_arranged), pending_labs, sdoh_summary. Accuracy vs ground truth is
printed by the task (≈100% on the booleans, ≈95% on follow-up status).

## Gold (src/gold/build_gold.py)
- `gold_discharges` — discharges + patient/unit/hospital/readmission + `outcome_window_closed`, `weekend_discharge` (Fri-Sun),
  `last_26_weeks`, `in_hrrp_window` (trailing 12 months), note-derived risks.
- `gold_readmission_monthly`, `gold_followup_effect`.
- `hrrp_performance` — hospital × condition (Medicare FFS 65+, trailing 12 months): observed rate, ERR estimate
  (credibility-weighted: (R + 150·national) / ((D + 150)·national)), last-6-months ERR, payment share, penalty contribution.
- `hrrp_penalty_estimate` — min(3%, Σ payment share × max(0, ERR − 1)) × base payments; plus the same with HF at its 6-month ERR.
- `demo_resources` (export task) — Genie agent id, documents volume, dashboard id, model — read by the app at boot.
