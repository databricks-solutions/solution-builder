# 03 — Underwriting Copilot app

Databricks App `underwriting-copilot` (Node + Express via `@databricks/appkit`, React, Lakebase `dbgen_commercial_underwriting`,
OpenAI Agents SDK on `databricks-gpt-5-4`, MLflow tracing). Forked from the solution-builder `app_template`.

| Page | Content |
|---|---|
| Home | Hail-belt old-roof LR headline, queue tiles, roof-age trend (warehouse), top of queue, starter questions, activity |
| Submission queue | 24 submissions by priority: TIV, documents consistent/disagree, risk as submitted vs verified, triage lane, desk status |
| Submission workbench | Application vs documents table, SOV (old roofs / frame / unsprinklered in red), loss run, original PDFs (Files API), *Run underwriting review* (streamed steps), decision + per-location premium, rules with doc refs, guideline answer (Genie agent), rationale, broker letter, *Issue / Refer to CUO* |
| CUO referrals | Marcus Oyelaran's queue: *Approve & issue* / *Send back* |
| Portfolio analytics | LR by portfolio cell, hail-belt roof split, queue by lane + decisions issued (Delta write-back) |
| Portfolio dashboard | Embedded AI/BI dashboard |
| Chat dock | Agent tools: `ask_data` (Genie agent: tables + guideline documents), `list_queue`, `get_submission`, `run_underwriting_review`, `refer_to_cuo` |

State: Lakebase `app.*` (submissions + review JSON + audit trail, sov_locations, loss_run_claims, documents, rating_factors,
appetite_rules, chat). Mirrored from Delta at boot; **Reset the demo** wipes it, deletes `uw_decisions`, re-syncs.
Auth: OBO user token with SP fallback on 401/403 (`lib/auth.ts`); app SP has UC SELECT on the schema, MODIFY on
`uw_decisions`, READ_VOLUME, CAN_RUN on the Genie agent.
