# Advisor Morning Book — Databricks App (Calder Pine Private Wealth)

The advisor-facing app of the *wealth-advisor next-best action* demo (see the template's top-level `README.md`
for the story and the demo script). Node + Express (`@databricks/appkit`) + React, Lakebase for the operational
state, OpenAI Agents SDK for the chat agent, MLflow tracing.

## Pages
| Route | View |
|---|---|
| `/` | Morning Book — money in motion / AUM at risk headline, *Call first today* (top 6), money in motion by signal, *Ask the Advisor Copilot* starters, recent activity |
| `/book` | My book — every household with an active signal, ranked, filters (act within 14 days, AUM at risk, lending, model pick blocked, decided) |
| `/clients/:id` | Client page — profile + vulnerable flag, signals, accounts + mortgage, CRM notes with the AI Functions read-out, every next-best action (propensity × suitability S1–S7), **Prep meeting** (streamed), outreach editor, decision write-back + audit trail |
| `/insights` | Desk insights (`config/queries/*.sql` on the SQL warehouse) |
| `/dashboard` | The embedded AI/BI wealth-desk dashboard (`DASHBOARD_ID`) |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Scores + suitability** are computed in batch (`src/ml/train_nba_model.py`): `nba_propensity_model@champion`
  (UC) scores every candidate action, the deterministic rules S1–S7 give PASS / REVIEW / FAIL, and
  `household_opportunities` ranks each advisor's book. `db/sync.ts` mirrors the advisor's book (`ADVISOR_ID`,
  default `ADV-007` Elena Marsh) into Lakebase `app.clients` at boot / on Reset.
- **Meeting prep** (`server/services/prep.ts`, `POST /api/clients/:id/prep`, SSE): read the file → model ranking →
  suitability → deterministic agenda (suitable actions only; REVIEW deferred for vulnerable clients) → the Genie
  agent (`GENIE_SPACE_ID`, Agent mode, policy documents) for the cited policy answer → `DRAFT_MODEL` writes the brief, call opener and a
  FINRA-2210-style outreach email.
- **Decision** (`POST /api/clients/:id/decision`): Lakebase (`app.clients` status + append-only `audit_trail`) AND a
  Delta INSERT into `advisor_decisions` (the dashboard's *Desk activity* table and Genie see it).
- **Chat agent** (`server/agent/advisor.ts`): tools `ask_data` (the Genie agent `GENIE_SPACE_ID`: desk analytics +
  the policy library), `get_morning_book`, `get_client_brief` (Lakebase).
- **Auth**: every model / Genie call goes out with the viewer's OBO token and retries once as the app service
  principal if the token is rejected (`server/lib/auth.ts::authedFetch`).
- **Reset** (`POST /api/admin/reset`, header button): clears decisions, preps and chat history, empties the Delta
  `advisor_decisions` table and re-syncs the book from Delta.

## Run / deploy
Local: `cp .env.template .env`, fill it in, then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8821 ./start.sh`.
Deploy: see `../dab_instructions.md` (bundle deploy → setup job → `databricks apps deploy`). `TEMPLATE_MAP.md` lists every file.
