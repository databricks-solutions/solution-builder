# 04 — Dashboard and Genie

## AI/BI dashboard "Tidewell - Commercial Property Portfolio & Underwriting"
`dashboard/commercial_underwriting_portfolio.lvdash.json` (schema-less datasets; DAB `dataset_catalog/schema`, `embed_credentials: true`).
* **Portfolio**: KPIs for the last four quarters (earned premium, book LR, hail-belt habitational LR, …with roofs > 15 yrs),
  LR by portfolio cell (line), hail-belt habitational by roof band (line), perils (stacked bar), last-4Q vs prior-4Q table, brokers T12M.
* **Underwriting queue**: submissions by triage lane, queue table with discrepancies, risk as submitted vs verified and the
  decision issued (live `uw_decisions` write-back).

## Genie agent "Tidewell Commercial Underwriting - Portfolio & Queue"
`genie/genie_space.json` (serialized v2, tables sorted). 13 tables (policies, policy_quarters, claims, gold_portfolio_quarterly,
brokers, submission_history, gold_broker_performance, gold_submission_queue, sov_locations, loss_run_claims,
submission_risk_scores, appetite_rules, uw_decisions), instructions (LR = ratio of sums, last four quarters = 2025-Q3..2026-Q2,
hail belt definition, hit ratio, tables-vs-documents routing), the `uw_guidelines` documents volume (6 guideline docs,
answered in Agent mode), 8 example SQLs, 7 sample questions:
1. Which segment's loss ratio deteriorated the most over the last four quarters?
2. Hail-belt habitational LR by quarter, roofs over 15 years vs newer
3. Which perils drove hail-belt habitational losses in the last four quarters?
4. Hit ratio by broker tier over the last 12 months
5. Submissions in the queue by triage lane, with total TIV
6. Which queued submissions have documents that disagree with the application?
7. What does the appetite bulletin say about hail-belt habitational roofs older than 15 years, and when does a submission need CUO referral? (documents)
