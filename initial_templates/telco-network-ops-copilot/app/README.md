# NOC Copilot — app

The NOC engineer workbench of the *Network monitoring, anomaly detection & triage* telecom demo (see the
template's top-level README for the story and demo script). Node + Express (`@databricks/appkit`) + React,
Lakebase for the writable state, the SQL warehouse for everything in Delta.

| Route | What it is |
|---|---|
| `/` | Home — the story, live tiles, the 4-step workflow, the incident queue, starter questions, recent activity |
| `/incidents` | Correlated incident queue (mirrored from `noc_incidents` into Lakebase at boot) |
| `/incidents/:id` | Incident workbench — blast radius (every site under the router, down vs up) or 21-day KPI trend per sector, raw alarms, **Triage this incident** (streamed agent tool calls), root cause, customer impact, timeline, action plan (NOC runbook RB-7), field dispatch, **Open trouble ticket & dispatch** / **Close as explained** write-back + audit trail |
| `/tickets` | Trouble tickets + dispatches opened from the workbench (Lakebase `app.trouble_tickets`) |
| `/analytics` | Network analytics — alarms per 5 min (storm vs rest), the slow-burn sector, ignored early warnings (ai_classify) |
| `/dashboard` | Embedded AI/BI dashboard (VP Network Operations view) |

- **Triage agent** (`server/services/triage.ts`): `TRIAGE_MODEL` (default `databricks-claude-sonnet-4-5`) in a
  chat-completions tool loop. Tools are parameterized read-only SQL over `DEMO_CATALOG.DEMO_SCHEMA` (correlated
  incident, topology, alarm history, optics, RAN KPIs, customer impact, planned activity, field technicians) plus
  `ask_noc_runbook` (the Genie agent `GENIE_SPACE_ID` over the runbook documents); it must finish with `submit_triage`.
- **Chat agent** (`server/agent/copilot.ts`): `databricks-gpt-5-4` on the Responses API with `ask_data`
  (the Genie agent `GENIE_SPACE_ID`: network analytics + NOC runbooks) and `find_incidents`.
- Every model / Genie call uses the viewer's OBO token and retries once as the app service principal on 401/403.
- **Reset demo** (header) wipes the Lakebase tables and re-syncs the incident queue from Delta.

Local run: copy `.env.template` → `.env`, fill the values, then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8804 ./start.sh`.
