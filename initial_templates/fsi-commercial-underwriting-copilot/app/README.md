# Underwriting Copilot — Databricks App (Tidewell Specialty Insurance)

The underwriting workbench of the *commercial P&C underwriting copilot* demo (see the template's top-level README).
Node + Express (`@databricks/appkit`) + React, Lakebase (Postgres) for the desk's operational state, OpenAI Agents SDK
for the chat agent, MLflow tracing. Tidewell Specialty Insurance and every insured / broker are fictional.

| Route | What it is |
|---|---|
| `/` | Home — hail-belt habitational loss-ratio headline, queue tiles, roof-age trend, *Ask the Copilot* starters, recent desk activity |
| `/queue` | Submission queue — today's 24 submissions, triage lane, application-vs-document discrepancies, ML risk as submitted vs verified |
| `/submissions/:id` | Submission workbench — application vs SOV vs loss run, the original PDFs, *Run underwriting review*, pricing, rules, guideline answer (Genie agent), broker letter, *Issue / Refer to CUO* |
| `/referrals` | CUO referral queue — Approve & issue / Send back |
| `/analytics` | Portfolio analytics (warehouse charts: loss ratio by cell, roof-age split, queue by lane + decisions issued) |
| `/dashboard` | Embedded AI/BI portfolio dashboard |

- **Review** (`server/services/underwrite.ts`, `POST /api/submissions/:id/review`, SSE): documents → risk model
  (as submitted vs verified) → deterministic appetite / authority rules (`appetite_rules`) + one guideline question to the
  Genie agent (documents) → TSI-RATE-03 pricing per location (`rating_factors`) → an FM drafts the rationale + broker letter.
- **Issue / refer** (`POST …/issue`, `…/approve`, `…/send-back`): above $25M TIV (after exclusions) or on an appetite
  referral the review goes to the CUO; issuing writes to Lakebase and back to Delta (`uw_decisions`).
- **Chat agent** (`server/agent/underwriting.ts`): `ask_data` (the Genie agent: tables + guideline documents), `list_queue`, `get_submission`,
  `run_underwriting_review`, `refer_to_cuo`. It never issues a decision.
- **Reset the demo** (header): wipes the Lakebase desk tables + chats, deletes `uw_decisions`, re-syncs from Delta.

Local run: `cp .env.template .env` (fill DEMO_CATALOG/SCHEMA, warehouse, Lakebase, GENIE_SPACE_ID,
DASHBOARD_ID), then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8801 ./start.sh`.
