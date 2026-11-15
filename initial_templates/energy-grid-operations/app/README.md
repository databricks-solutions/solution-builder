# MREC Grid Ops Copilot — Databricks App

The control-room console of the *Grid Ops Copilot* demo (see the template's top-level `README.md` for the
story and the demo script). Node + Express (`@databricks/appkit`) + React, Delta tables on a SQL warehouse
for the grid data and the write-back log, OpenAI Agents SDK for the chat agent, MLflow tracing.

## Pages
| Route | View |
|---|---|
| `/` | Control room — heat-advisory banner, KPIs, T-104 SCADA + forecast chart vs nameplate, risk board, *Why T-104*, relief options (hover = post-action curve, **Approve & dispatch**), control-room action log |
| `/dashboard` | The embedded AI/BI dashboard (`DASHBOARD_ID`) |
| `/platform` | Databricks platform pitch page |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Grid data** (`server/grid/queries.ts`, `/api/grid/*`): SQL on the warehouse (as the app service principal)
  over `${DEMO_CATALOG}.${DEMO_SCHEMA}` — overview, per-transformer curve, relief options, asset detail.
- **Write-back** (`POST /api/grid/actions`, or the agent's `log_operator_action` tool): inserts the approved
  option into the `operator_actions` Delta table.
- **Chat agent** (`server/agent/gridops.ts`): tools `get_grid_overview`, `get_transformer_risk`,
  `get_relief_options`, `log_operator_action`, `ask_data` (Genie agent `GENIE_SPACE_ID`).
  Conversations are kept in memory per app process.
- **Auth**: model calls go out with the viewer's OBO token and retry once as the app service principal if
  the gateway rejects it (401/403, `server/agent/gridops.ts` fetch shim); Genie runs on the OBO token.
- **Reset demo** (header button, `POST /api/admin/reset`): clears the action log and the chat history.

## Run / deploy
Local: `cp .env.template .env`, fill it in, then `DATABRICKS_CONFIG_PROFILE=<profile> ./start.sh` → http://localhost:8816.
Deploy: see `../dab_instructions.md` (`./scripts/build-app.sh` → bundle deploy → setup job → `databricks apps deploy`).
