# Warranty Copilot — Databricks App (Brightwater Cycle Works)

The warranty & field-quality engineer's console of the *warranty cost optimization* demo (see the template's
top-level `README.md` for the story and the demo script). Node + Express (`@databricks/appkit`) + React,
Lakebase for the operational state + write-back, OpenAI Agents SDK for the chat agent, MLflow tracing.

## Pages
| Route | View |
|---|---|
| `/` | Home — quality workbench: Pareto of failure codes (hero), early-warning signal cards with control-chart sparklines, claim triage table (miscoded labor codes), *Ask the Copilot* starters, recent activity |
| `/signals` | Early-warning board — every AI failure mode × supplier, last 90 days vs the prior 12 months per 1,000 bike-years |
| `/signals/:id` | Signal workbench — weekly claims, lot cohort chart, claims (dealer code vs AI mode), **Assemble root-cause case** (streamed), findings confirmed / ruled out, lot table, exposure, supplier-quality library answer, priced containment, supplier 8D + chargeback notice, **Open quality case** |
| `/claims` | Claims explorer — technician notes with `ai_classify` / `ai_extract` output next to the dealer labor code |
| `/cases` | Quality cases written back to Lakebase |
| `/analytics` | Cost & recovery charts (`config/queries/*.sql` on the SQL warehouse) |
| `/dashboard` | The embedded AI/BI dashboard (`DASHBOARD_ID`) |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Root-cause case** (`server/services/analyze.ts`, `POST /api/signals/:id/analyze`): live SQL on the Delta gold
  tables (cohort, firmware, same-line control group, climate, E21 telemetry) → the Genie agent
  (`GENIE_SPACE_ID`, Agent mode: PPAP / PCN / SQA documents) → deterministic exposure + containment pricing → `NOTICE_MODEL` writes the
  root-cause statement and the supplier 8D / chargeback notice.
- **Quality case** (`POST /api/signals/:id/case`, or the chat tool `open_quality_case` when asked): written to
  Lakebase (`app.quality_cases` + the signal's append-only audit trail).
- **Chat agent** (`server/agent/warranty.ts`): `ask_data` (the Genie agent `GENIE_SPACE_ID`: analytics +
  supplier documents), `list_warranty_signals`, `get_root_cause_evidence`, `open_quality_case`.
- **Auth**: every model / Genie call goes out with the viewer's OBO token and retries once as the app service
  principal if the token is rejected (`server/lib/auth.ts::authedFetch`).
- **Reset** (`POST /api/admin/reset`, header button): re-syncs signals + claims from Delta into Lakebase and clears
  analyses, quality cases and chat history.

## Run / deploy
Local: `cp .env.template .env`, fill it in, then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8823 ./start.sh`.
Deploy: see `../dab_instructions.md` (`bundle deploy` → `bundle run warranty_setup` → `bundle run warranty_app`).
`TEMPLATE_MAP.md` lists every file.
