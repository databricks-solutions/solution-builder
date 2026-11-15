# 01 — Data, AI Functions and ML

**Target:** `<catalog>.<schema>` (live: `financial_services.commercial_underwriting_copilot`). Everything is produced by
`data_generation/generate_data.py` (seeded, deterministic) and the setup-job tasks in `databricks.yml`.

## Scenario
Tidewell Specialty Insurance (fictional US middle-market commercial property & package carrier). Today is **Monday 28
September 2026**. Loss experience runs by accident quarter 2024-Q3 → 2026-Q2. Appetite Bulletin **TSI-UW-B-2026-07**
(effective 1 Jul 2026) took hail-belt habitational locations with roofs older than 15 years out of appetite. 24 broker
submissions wait in the queue, each a packet of three PDFs.

## Raw tables (generator)
| Table | Rows | Notes |
|---|---:|---|
| `brokers` | 36 | tier Premier / Preferred / Standard |
| `policies` | 2,700 | segment, state, `hail_belt`, construction, `roof_age_years`, sprinklers, PC, TIV, prior losses, premium |
| `policy_quarters` | ~9.2K | earned premium per policy per quarter (denominator) |
| `claims` | ~880 | accident quarter, peril, incurred (numerator) |
| `submission_history` | ~6.1K | BOUND / QUOTED_NOT_BOUND / DECLINED (hit ratio) |
| `submission_inbox` | 24 | today's emails (facts are in the PDFs) |
| `submission_documents` | 72 | APPLICATION / SOV / LOSS_RUN PDFs in volume `submission_docs` (rendered with reportlab) |
| `appetite_rules` | 7 | machine-readable rules with guideline `doc_ref` |
| `rating_factors` | 30 | TSI-RATE-03 rating plan |
| `uw_decisions` | 0 | write-back from the app |

## Planted signal
* Claims are calibrated to a target loss ratio per (segment × hail belt × roof > 15 × quarter): the book runs ~55-60%,
  hail-belt habitational goes **60% → 110%** (2024-Q3 → 2026-Q2), driven by roofs > 15 years (**59% → 164%**, ~87%
  hail/wind) while newer roofs stay ~60-70%. Claims are allocated to policies weighted by a latent risk (roof age,
  frame, prior hail, sprinklers, PC) so the ML model can learn it.
* Hero **SUB-26-0417 Lone Star Residential Partners LP** (Halvorsen & Pike, 4 DFW apartment communities, $38.6M):
  the application says joisted masonry, roofs 2019, sprinklered, 1 loss / $18,400. The SOV shows **Loc 3 Cedar Hollow
  Apartments** (Arlington) frame, 1984, unsprinklered, roof 2004 (22 yrs); the loss run shows 4 losses / $369,300 incl.
  two hail/wind claims at Loc 3. Contrasts: SUB-26-0422 Brazos Valley Cold Storage (clean, fast track),
  SUB-26-0409 Gulf Breeze Motor Lodge (Panama City Beach FL → decline), SUB-26-0412 (stale 3-year loss run → request info).

## AI Functions (`src/ai/extract_submissions.py`)
`ai_parse_document` (v2.0) over every PDF → `submission_documents_parsed`; `ai_query('databricks-gpt-5-4-mini', …,
responseFormat => json_schema)` per doc type → `application_extract`, `sov_locations`, `loss_run_summary`,
`loss_run_claims`; `ai_classify` business description → segment. A self-check fails the task if the hero packet is mis-read.

## ML (`src/ml/train_risk_model.py`)
`submission_risk_model` (HistGradientBoosting, monotonic constraints) — label = policy loss ratio > 100% on Tidewell's own
book (holdout AUC ~0.72). Registered in UC with alias `@champion`; batch-scores each queued submission twice →
`submission_risk_scores` (`p_as_submitted` on the application, `p_verified` on SOV + loss runs, bands, drivers).
Hero: **Low 0.02 → High 0.64**.

## Gold (`src/gold/build_gold.py`)
`gold_portfolio_quarterly` (quarter × portfolio_cell × roof_band), `gold_broker_performance` (T12M hit ratio, book LR),
`gold_submission_queue` (application vs documents, discrepancies, rules_hit, scores, triage_lane, priority_score),
`v_uw_decisions_latest`.
