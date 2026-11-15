# 03 — Databricks App "PA Copilot" (UM nurse workbench)

Forked from the solution-builder `app_template` (AppKit Node/Express + React, Lakebase via Drizzle, OpenAI Agents SDK,
MLflow tracing). App name `prior-auth-copilot`.

## Data flow
- Boot: `server/db/sync.ts` mirrors the OPEN queue from Delta (pa_requests ⨝ members/providers/policies ⨝ ai_case_review,
  ai_criteria_evidence, clinical_notes, snapshot_info) into Lakebase `app.pa_cases`, `app.case_criteria`, `app.case_notes`,
  `app.app_meta` (as the app service principal). "Reset demo" wipes + re-syncs and clears Delta `um_decisions`.
- Decisions: `POST /api/cases/:id/decide` (approve | pend | refer_md) and `POST /api/cases/auto-approve` update Lakebase
  (status + JSONB audit trail) and append to Delta `um_decisions` (`server/lib/writeback.ts`).
- Live AI: `POST /api/cases/:id/review` re-runs the criteria review for one case on the Foundation Model API
  (same prompt + strict JSON schema as the ai_query batch); `POST /api/policy/ask` → the Genie agent over the policy documents (OBO, SP fallback).

## Screens
- **Briefing** (`/`): Monday-08:00 hero for Dana Whitfield RN, KPI tiles (open, expedited, past due, weekend faxes awaiting
  indexing, decided), AI-lane bar + cards, "Release N auto-approvals", PA Copilot starter prompts, recent decisions.
- **Worklist** (`/queue`): lane tabs (All / Auto-approve / Nurse fast-track / Request info / MD review / Decided), SLA clock
  badges vs CMS 72h/7d (breached / at risk / ok) at the snapshot, expedited filter, search; the auto-approval release dialog
  restates the rule (approve-only, confidence ≥ 0.85, all criteria cited).
- **Case review** (`/case/:id`): request + member/provider facts, audit trail; clinical documents with every evidence quote
  highlighted and tagged C1/C2/C3; AI recommendation (label, confidence, rationale, model); policy criteria checklist with
  quotes + source note ids; decision panel (Approve / Pend with an auto-drafted provider request letter / Refer to Medical
  Director — nurses never deny); "Ask the medical policy" (Genie agent, documents).
- **Analytics** (`/analytics`): 3 warehouse charts (config/queries/*.sql). **CMS ops dashboard** (`/dashboard`): embedded AI/BI.

## Agent — `server/agent/paops.ts` (databricks-gpt-5-4, Responses API)
Tools: `queue_overview`, `get_case`, `find_auto_approval_lane`, `release_auto_approvals` (WRITE, two-step confirm),
`ask_data` (the Genie agent: CMS metrics + policy documents). Scripted chips in `config/app.json`.
