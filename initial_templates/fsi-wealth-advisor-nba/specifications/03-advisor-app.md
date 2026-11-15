# 03 — Advisor Morning Book (Databricks App)

AppKit (Node/Express + React) forked from the solution-builder `app_template`; Lakebase database
`dbgen_wealth_advisor_copilot` (schema `app`). See `app/README.md` + `app/TEMPLATE_MAP.md`.

## Screens
- **Morning book** `/`: headline (money in motion / AUM at risk from Lakebase), 4 KPI tiles, *Call first today* (top 6 with
  model pick struck through when blocked + best suitable action), 4-step explainer, opportunities by signal, copilot
  starters, *Why the model never gets the last word*, recent activity.
- **My book** `/book`: all 69 households of ADV-007, filters (act within 14 days, AUM at risk, lending, model pick blocked, decided), search.
- **Client page** `/clients/:id`: profile badges, KPI tiles, signals, accounts + mortgage (refi window in red), CRM notes
  with AI chips, NBA table (propensity bar, assets, expected revenue, suitability pill, expandable S1–S7), **Prep
  meeting** (SSE steps), then a full-width brief: headline + why now, blocked model pick, agenda, not-on-agenda, policy
  library answer, disclosures, call opener, editable email, decision buttons (**Meeting booked / Send email & log
  proposal / Not now**), audit trail.
- **Desk insights** `/insights`, **Wealth-desk dashboard** `/dashboard` (embedded), chat dock on every page.

## Meeting prep (`POST /api/clients/:id/prep`, `server/services/prep.ts`)
1. read file → 2. model ranking → 3. suitability counts → 4. deterministic agenda (`planMeeting`: suitable only, estate
review first for bereavement/inheritance, REVIEW deferred for vulnerable clients, ≤ 3 items) → 5. policy question to the
Genie agent (documents) chosen by case (blocked pick + bereavement / lending / rollover / CD) → 6. `databricks-claude-sonnet-4-5` writes
headline, why-now, talking points, call opener, email (FINRA 2210 rules + required footer). Saved to `app.clients.meeting_prep`.

## Decision write-back (`POST /api/clients/:id/decision`)
Lakebase: status, decision, action, notes, outreach, append-only `audit_trail`. Delta: `INSERT INTO advisor_decisions`
(statement API, parameterized) → dashboard *Desk activity* + Genie.

## Chat agent (`server/agent/advisor.ts`, `databricks-gpt-5-4`, Responses API)
Tools `ask_data` (the Genie agent *Calder Pine - Wealth Desk*: analytics + policy library), `get_morning_book`, `get_client_brief`
(id or name). Rules: never recommend a FAIL action; numbers only from tools; the advisor decides.

## Auth
OBO token with one retry as the app SP on 401/403 (`lib/auth.ts::authedFetch`, OpenAI fetch shim). `user_api_scopes`:
serving.serving-endpoints, ai-gateway, dashboards.genie, sql, sql.statement-execution, postgres, catalog.*:read. App SP has
SELECT on the schema, MODIFY on `advisor_decisions`, READ_VOLUME, CAN_RUN on the Genie agent.
