# 02 — The root-cause case (app `server/services/analyze.ts`)

Streamed from `POST /api/signals/:id/analyze`; deterministic core `buildEvidence()` is also the chat tool `get_root_cause_evidence`.

| Step | Source | Output |
|---|---|---|
| Claims evidence | Lakebase `app.claims` (mirror of `gold_claims`) | dealer-code split, water share, top fault code |
| Cohort isolation | `gold_signal_cohorts` + `gold_lot_quality` + `supplier_lots` | suspect values, rate vs rest (per 1,000 bike-years), same-PCN scope lots, plant stock to quarantine (lot qty − bikes built) |
| Alternatives (live SQL) | `units` × `gold_claims` | firmware 3.2.0 vs 3.1.4 outside the suspect lots; same build window with the other supplier's controller (T5/Kessler); wet vs dry inside the cohort |
| Telemetry | `telemetry_fault_events` | fault-reporting bikes per 1,000 connected (suspect vs other); **at-risk = ≥ 2 E21 in the last 30 days and no claim yet** |
| Supplier library | Genie agent (supplier documents) | cited answer on PCN approval + SQA §8 recovery |
| Exposure + options | `gold_signal_exposure` + playbook | stop-ship/quarantine · pay as they come · wet-region campaign · full campaign (seal kit $22 + 0.3 h × $96 = $50.80, 85% effective) · chargeback (claims to date + $35 × claims + campaign, SQA §8.1/§8.2) |
| Write-up | `NOTICE_MODEL` (chat completions, JSON) | headline, root cause (≤ 60 words), VP summary (≤ 70 words), plain-text 8D + chargeback notice |

Write-back: `POST /api/signals/:id/case` (or chat `open_quality_case` on explicit request) inserts `app.quality_cases`
(id `QC-<year>-0142+`), with the selected options, campaign cost and chargeback amount, and appends to the signal's audit trail.
