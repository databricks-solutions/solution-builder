# Eligibility Copilot — Databricks App (Westbrook DHS)

The caseworker workbench of the *AI-enabled eligibility determination* demo (see the template's
top-level `README.md` for the story and the demo script). Node + Express (`@databricks/appkit`) +
React, Lakebase for the operational state, OpenAI Agents SDK for the chat agent, MLflow tracing.

## Pages
| Route | View |
|---|---|
| `/` | Home — USWDS-style: official-status alert, Tamarack case clock, county map (days to determination), SNAP trend, county scorecard, policy manual, *Ask the Copilot* starters, recent activity |
| `/cases` | Caseload — *My caseload* / *Tamarack backlog* queues with deadline meters + document dots |
| `/cases/:id` | Case workbench — documents vs `ai_extract` fields, **Run eligibility check** (streamed), rule results with CFR + manual citations, policy-manual answer (Genie agent), resident notice, decision write-back + audit trail |
| `/analytics` | Timeliness & equity charts (`config/queries/*.sql` on the SQL warehouse) |
| `/dashboard` | The embedded AI/BI dashboard (`DASHBOARD_ID`) |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Eligibility check** (`server/services/assess.ts`, `POST /api/cases/:id/assess`): deterministic rule
  engine over the extracted document fields → the Genie agent (`GENIE_SPACE_ID`, Agent mode, policy manual) for the cited
  policy answer → `NOTICE_MODEL` writes the caseworker summary + resident notice in the household's language.
- **Decision** (`POST /api/cases/:id/decision`): written to Lakebase (`app.cases` — status, notice, append-only `audit_trail`).
- **Chat agent** (`server/agent/eligibility.ts`): tools `ask_data` (the Genie agent `GENIE_SPACE_ID`:
  analytics + policy manual), `find_open_cases` (Lakebase queue).
- **Auth**: every model / Genie call goes out with the viewer's OBO token and retries once as the app
  service principal if the token is rejected (`server/lib/auth.ts::authedFetch`).
- **Reset** (`POST /api/admin/reset`, header button): re-syncs the open caseload from Delta into Lakebase and
  clears decisions, notices and chat history.

## Run / deploy
Local: `cp .env.template .env`, fill it in, then `DATABRICKS_CONFIG_PROFILE=<profile> ./start.sh`.
Deploy: see `../dab_instructions.md` (bundle deploy → setup job → `databricks apps deploy`).
`TEMPLATE_MAP.md` lists every file.
