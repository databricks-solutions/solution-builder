# 01 — Synthetic data, AI criteria review, semantic layer

Catalog/schema: `healthcare_lifesciences.prior_auth_automation` (DAB variables `catalog` / `schema`).
Everything is **synthetic** — no PHI; names, NPIs and member ids are invented.

## A. Generator — `data_generation/generate_data.py`
Plain `.py` (DAB `spark_python_task`, or local Databricks Connect serverless with Python 3.12).
Deterministic (`random.Random(20260929)`); the queue snapshot `AS_OF` is the **latest Monday 08:00 UTC**
so the Monday-morning story is identical whenever it is regenerated. 120 days of history.

| Table | Rows | Notes |
|---|---:|---|
| `members` | 4,200 | LOB mix: Medicare Advantage 55% · Commercial PPO 30% · Medicaid 15% |
| `providers` | 132 | 13 practice groups, fake NPIs, `epa_enabled` flag |
| `reviewers` | 17 | 14 UM nurses + 3 medical directors |
| `medical_policies` | 11 | MV-RAD-014 (MRI L-spine), MV-RAD-022, MV-CAR-005, MV-ORT-007, MV-ORT-011, MV-SLP-003, MV-DME-019, MV-PHM-042, MV-ONC-012, MV-GAS-002, MV-REH-009; `auto_approval_eligible` |
| `policy_criteria` | 33 | 3 required criteria per policy |
| `pa_requests` | ~5,600 | event-timeline simulation (intake → queue → nurse → pend/MD → decision); `sla_hours` 72/168, `sla_met`, `criteria_met_on_first_review`, `status` as of the snapshot, `final_outcome = 'Open'` for the ~196 open cases |
| `clinical_notes` | ~7,200 | one clinical summary per request (+ a supporting document 30% of the time) built from criterion-specific evidence sentences |
| `snapshot_info` | 1 | `as_of_ts`, `pilot_start_ts` |
| `_gt_documentation_profile` | ~5,600 | hidden ground truth (clear / missing / notmet / complex) used only to score the AI review |

Policy documents (12 markdown files: 11 policies + `MV-UM-000` program description) → UC volume `policy_docs`
(documents searched by the Genie agent). PK/FK constraints (RELY) + table/column comments for Genie.

### Planted signals (what the demo uncovers)
1. **~52% first-pass clean** (every criterion documented at first review) but clean nurse approvals wait a **median ~63h (~2.6 days)** → auto-approval candidates.
2. **Expedited 72h compliance ≈ 99%** except **weekend faxes (Fri 3pm–Sun) ≈ 21%** — manual fax indexing on Monday. Overall expedited ≈ 93%, standard 7-day ≈ 82%.
3. **MRI Lumbar Spine** is the #1 pended service (`Missing documentation: 6 weeks conservative therapy`, 426 pends); **Cascade Spine & Pain Associates** pend rate **58%**, **Northside Orthopedic Associates 4%** (≈92% first-pass clean → gold-card candidate).
4. **Auto-approval pilot**: clean ePA imaging requests auto-approved in minutes for the last 3 weeks (`decided_by_role = 'Automation'`).
5. Denial rate ≈ 12%; only medical directors deny.

## B. AI Functions review — `src/deploy/build_ai_review.sql`
`ai_query('databricks-gpt-5-4-mini', prompt, responseFormat => <strict json_schema>)` over every open case:
criteria text + all notes → per-criterion `status` (Met / Not Met / Not Documented), verbatim `evidence` + `source_note_id`,
`recommendation` (APPROVE / PEND / REFER_MD — automation never denies), `confidence`, `rationale`, `missing_information`.
Outputs `ai_case_review_raw`, `ai_criteria_evidence` (one row per case × criterion) and `ai_case_review` with the
**MV-UM-000 rule**: `auto_approve_candidate = policy auto-eligible AND all criteria Met AND APPROVE AND confidence ≥ 0.85`,
plus `ai_lane` (Auto-approval lane / Nurse fast-track / Request information / Physician review).
An **evidence guard** keeps the auto lane honest: every Met criterion must cite its own distinct quote (≥ 25 chars)
that is not note boilerplate (header / request line) — otherwise the case drops to Nurse fast-track.
Scored against the hidden ground truth on the current snapshot: **189/196** recommendations match; the auto-approval
lane holds **61** cases with **1** where the generator had left a criterion undocumented (the model inferred it from a
neighbouring sentence). `ai_query` is non-deterministic, so lane counts move by a few cases on every rebuild.

## C. Semantic layer + write-back — `src/deploy/build_metric_view.sql`
- `pa_ops_metrics` UC metric view (YAML 1.1, joins providers + policies): Requests, Decided Requests, Open Backlog,
  Approval / Denial Rate, SLA Compliance, SLA Breaches, Avg/Median Turnaround Hours, Auto-Approval Rate,
  First-Pass Clean Rate, Pend Rate; dimensions incl. Urgency, Channel, Line of Business, Policy, Practice Group,
  Arrival Window (weekend fax window).
- `um_decisions` Delta table — every decision taken in the app (nurse or `AUTO-RULE-v1`) is appended here.
