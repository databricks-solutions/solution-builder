# 01 — Data, network and ML alert-risk model

**Catalog/schema:** `financial_services.aml_sar_copilot` (DAB vars). Window: 2025-10-01 → 2026-09-28 (as of 2026-09-29).

## Raw (data_generation/generate_data.py, deterministic seed 20260929)
| Table | Grain | Notes |
|---|---|---|
| customers | customer | 2,560 individuals + 440 businesses + 9 ring parties; `kyc_risk_rating` (cash-intensive businesses are HIGH by policy), `expected_monthly_cash`, address/phone/device |
| accounts | account | checking + savings / money market |
| transactions | txn | cash_deposit/withdrawal, ach_in/out, wire_in/out, p2p_in/out, internal_in/out; `cash_below_ctr` ($8K–$10K cash), `high_risk_country` (AE, HK, PA, CY, TR, NG, VE, KY, VG) |
| customer_attributes | customer × attr | address / phone / device, for entity resolution |
| alerts | alert | 14-day rule buckets per customer. Scenarios: structuring below CTR, high cash vs profile, high-risk wire, rapid movement, large round-dollar wires. `rule_score` = scenario base + magnitude + KYC weight (low 0 / medium 10 / high 25, PEP +10). Status: open (≥ 2026-09-10), in_review, closed_no_sar, sar_filed |
| sar_cases | SAR | detection → filing days (drifts from ~20 to ~25 days), `sla_breached` = > 30 days |

Background typologies: 14 historical rings (3–6 parties, structuring + funnel + offshore wires → SARs) and 36 solo
bad actors (pass-through, structuring, high-risk wires). 260 households share an address (legitimate links).

## Gold (src/transform/build_gold.py)
* `gold_network_edges`: shared address/phone/device pairs plus internal/P2P transfer aggregates.
* `gold_customer_network`: union-find connected components → `cluster_id`, `cluster_size`, `degree`.
* `gold_network_clusters`: clusters of 3+ parties, with 60-day cash in, sub-CTR deposits, branches, high-risk wires and open alerts.
* `gold_alert_features`: 30-day window per alert (sub-CTR count/amount, cash, branches, high-risk wires, funds in/out,
  pass-through ratio, cash vs expected, account age, KYC level, PEP, business flag, network size/degree, linked parties
  alerted in the last 30 days, prior alerts in 90 days) + `label`.
* Write-back: `case_decisions`, `case_audit_log`, `sar_drafts`.

## ML (src/ml/train_score.py)
GradientBoostingClassifier (250 trees, depth 3) trained on dispositioned alerts raised before 2026-08-01. Hold-out AUC
**0.93** vs **0.31** for `rule_score` alone. Registered as `aml_alert_risk_model`, alias `@champion`. It scores every alert
(`gold_alert_scores`) and builds `gold_alert_queue` (open + in-review, `ml_rank`, `rules_rank`, band, reason codes).
**Acceptance:** all 35 open alerts of `NET-290001` rank in the ML top 36, with an average rules rank of about 263 of 330.
