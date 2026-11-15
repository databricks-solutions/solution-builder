# 01 — Data: synthetic caseload, document AI, gold layer

Catalog/schema: `public_sector.eligibility_copilot` (DAB variables `catalog` / `schema`). Built by the setup job
`[PUBSEC] Eligibility Copilot - Setup` (serverless), three Python tasks + deploy notebooks:

| Task | File | Output |
|---|---|---|
| generate_data | `data_generation/generate_data.py` | raw tables below (seeded, relative to run date) |
| extract_documents | `src/ai/extract_documents.py` | `document_extractions` via **`ai_extract` v2.1** (typed schema + per-field confidence) |
| build_gold | `src/gold/build_gold.py` | `gold_applications`, `gold_county_monthly`, `gold_county_backlog`, metric view `mv_eligibility_processing` |

## Tables
| Table | Grain | Notes |
|---|---|---|
| `counties` | 8 counties | region_type urban/suburban/rural, caseworker FTE now vs a year ago (Tamarack 7 → 4) |
| `caseworkers` | worker | county office staff + **State surge team** (`CW-SURGE-01` = Keisha Jackson) |
| `households` | household | size, children, elderly/disabled, preferred language, self-reported race/ethnicity (civil-rights reporting only) |
| `applications` | application (~12.7k, 12 months) | program SNAP/Medicaid, channel online/mail/phone/in_person, status, determination, denial_reason, processing_days, rfi_count, expedited_screening |
| `application_documents` | document (~2.4k, open cases only) | synthetic OCR text: paystub, photo_id, lease, utility_bill, bank_statement, employer_letter (layoff), self_declaration |
| `document_extractions` | document | ai_extract fields: person_name, issuer, document_date, expiration_date, employment_end_date, gross_pay, pay_frequency, address/city/state, monthly_rent, account_balance, declares_no_income, extraction_confidence |
| `document_truth` | open application | ground truth of planted issues (missing_income/residency/identity, stale_paystub, expired_id, out_of_state_address, pre_layoff_paystub) — eval only |
| `program_rules` | rule (11) | SNAP-ID/RES/INC-VER/GROSS/RESOURCES/EXPEDITE, MA-ID/RES/CIT/INC-VER/MAGI with CFR + WDHS manual citation |
| `income_limits` | household size 1–8 | FY2026 SNAP 130%/100% FPL + max allotment, Medicaid 138% FPL |
| `gold_applications` | application | + timeliness_standard_days (7 expedited / 30 SNAP / 45 Medicaid), met_timeliness, is_open, is_overdue, is_procedural_denial |

## Planted signal (the Tamarack bottleneck)
Mill closure ~150 days before the run date (+60% Tamarack volume); staff cut 7 → 4 ~120 days before. Rural
applicants use mail (37%), arrive with missing documents more often, every RFI round trip costs ~2–4 weeks.
Result (verified): Tamarack SNAP on-time **~29–33%** vs **~93%** elsewhere over the last 3 months, median 38 days,
**58 open cases per worker** vs 2–9, procedural denials ~2–3x the state rate. Approval by race/ethnicity flat (76–78%).

## Hero cases (Tamarack, assigned to Keisha)
APP-240117 Dana Whitfield (layoff; pre-layoff stub over the limit, $0 current income, expedited, 31 days late) ·
APP-240233 Maria Delgado (Spanish, Medicaid, stale stub + no residency proof → RFI) · APP-240358 Robert Kowalski
(income over limit → deny) · APP-240402 Aaliyah Brooks (clean approve) · APP-240519 Tyler Begay (expired ID + Idaho lease).
