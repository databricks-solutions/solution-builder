# Northwind Federal — AML Investigator Copilot (Databricks App)

Node + Express (`@databricks/appkit` server plugin) + React 19 / Tailwind. Forked from the
solution-builder `app_template`, trimmed to this use case (no Lakebase: case state is written
straight to governed Delta tables so the dashboard + Genie see it live).

| Route | What |
|---|---|
| `/` | Alert queue ranked by the UC-registered ML model; toggle to legacy rules ranking; "hidden network" banner |
| `/network/:clusterId` | Entity-resolution graph (shared address/phone/device + fund flows + offshore wires) |
| `/case/:alertId` | Case file: reason codes, 60-day cash chart, transactions, **Investigator Copilot** (SAR agent), decision + audit trail |
| `/decisions` | Every decision written back (`case_decisions`) |
| `/dashboard` | Embedded AI/BI compliance dashboard + Genie link |

Server: `server/routes/aml.ts` (REST + SSE), `server/lib/sql.ts` (Statement Execution API, named params),
`server/agent/sar-agent.ts` (Foundation Model API tool-calling loop: 5 SQL evidence tools + `search_aml_policy`
→ the Genie agent in Agent mode (`server/lib/genie-agent.ts`, policy documents), finishes with `submit_sar_draft`).

Local: `cp .env.template .env`, fill it, `./start.sh` → http://localhost:8811.
Deploy: `bash scripts/build-app.sh` (builds `dist/` + `client/dist/`), `databricks bundle deploy` from the
template root, then `databricks apps deploy <app> --source-code-path <bundle root>/files/app`.
The app service principal needs `USE CATALOG`, `USE SCHEMA` + `SELECT` on the schema and `MODIFY` on
`case_decisions`, `case_audit_log`, `sar_drafts`.
