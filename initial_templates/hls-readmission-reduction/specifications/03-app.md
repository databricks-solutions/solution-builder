# 03 — Readmission Copilot (Databricks App: Node/Express + React + Lakebase)

Pages: Command center `/` · Discharge worklist `/worklist/:encounterId` · Outreach queue `/outreach` · HRRP exposure `/hrrp` ·
Readmission analytics `/analytics` · Readmissions dashboard `/dashboard` (embedded AI/BI) · chat dock on every page.

**Read side** (`server/services/care-data.ts`): Delta gold tables via the SQL warehouse, cached 10 min.
**Write side** (Lakebase database created by the bundle, schema `app`): `worklist` (mirror of `transition_worklist` with
plan status), `transition_plans` (plan JSON, status draft/approved, audit trail), `outreach_tasks` (the write-back).

**Transition plan** (`POST /api/worklist/:id/plan`, SSE, `server/services/transition-plan.ts`): risk + drivers → note insights →
unit events → the Genie agent over the pathway documents (question built from the patient's facts) → deterministic task rules (follow-up
booking with the weekend rule, 48-h call, pharmacist med-rec, BMP, home health, Ride Assist, financial counseling, interpreter
teach-back — each citing its pathway section) → what-if risk → summary + 48-hour call script (databricks-claude-sonnet-4-5, facts only).
**Approval** (`POST /api/plans/:id/approve`): one transaction writes the selected tasks to `outreach_tasks`, marks the plan
approved and the worklist row `plan_approved`.

**HRRP what-if** (`shared/hrrp.ts`, server tool + client slider): readmissions avoided = 4 West weekend HF Medicare discharges ×
(target − current follow-up share) × (rate without − with follow-up) at the 6-month run rate → new HF ERR → penalty.

**Chat agent** (`server/agent/care-copilot.ts`, OpenAI Agents SDK → databricks-gpt-5-4 Responses API, MLflow tracing): ask_data
(the Genie agent: analytics + pathway documents), readmission_signal, hrrp_exposure, get_worklist, get_patient, build_transition_plan,
**create_outreach_task** (write-back), outreach_queue. Auth: OBO token with one retry as the app SP on 401/403.
The Genie agent id is read at boot from `demo_resources`. **Reset** (header): truncates plans, tasks, conversations and
re-syncs the worklist.
