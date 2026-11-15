# 04 — Databricks App: Eligibility Copilot (caseworker workbench)

Forked from the solution-builder app template (Node/Express AppKit + React + Lakebase/Drizzle + OpenAI Agents SDK + MLflow tracing).

| Route | What it shows |
|---|---|
| `/` Home | Story hero (Tamarack numbers live from Lakebase), 4-step workflow, overdue-by-county bars, chat starter chips, recent workbench activity |
| `/cases` Caseload | Scopes: My caseload (CW-SURGE-01) / Tamarack backlog / Statewide; status filters; search; per-row deadline meter (day N of 7/30/45) and ID / residency / income document dots |
| `/cases/:id` Workbench | Household card, every document (OCR scan vs ai_extract fields + confidence), **Run eligibility check** (streamed steps → recommendation → rule-by-rule table with citations, hover highlights evidence docs → missing documents → policy-manual answer), editable notice draft, decision buttons, audit trail |
| `/analytics` | Monthly SNAP on-time % Tamarack vs rest of state + county scorecard (SQL warehouse, `config/queries/*.sql`) |
| `/dashboard` | Embedded AI/BI dashboard |
| Chat dock | Agent (databricks-gpt-5-4) with `ask_data` (the Genie agent: analytics + policy manual), `find_open_cases` (Lakebase) |

Server: `routes/cases.ts`, `db/queries/cases.ts`, `services/assess.ts`, `lib/serving.ts`, `agent/eligibility.ts`,
`db/sync.ts` (boot-time Delta → Lakebase mirror of the ~760 open cases + 2.4k documents). Lakebase database
`sb_eligibility_determination` in project `<project>` (bundle resource `eligibility_db`). Config: `config/app.json` (+ env from
`databricks.yml` → `resources.apps.eligibility_app.config` / `.env`; the Genie agent id from `<catalog>.<schema>.demo_resources`).
