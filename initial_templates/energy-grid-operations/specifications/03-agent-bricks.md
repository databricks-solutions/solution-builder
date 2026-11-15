# 03 — Grid Ops Copilot app + agent

Databricks App `grid-ops-copilot` (Node + Express via `@databricks/appkit`, React + Tailwind), forked from the
solution-builder `app_template`. The template's Lakebase mirror was intentionally dropped: the only write is
one audit row per approved action, which goes straight to the Delta table `operator_actions` through the SQL
warehouse (`server/lib/sql.ts`, named parameters). Chat conversations are in-memory per app process.

## Control room (`client/src/control/`)
Heat-advisory banner → 6 KPIs → load-vs-rating chart (SCADA 36 h + forecast 48 h + P10-P90 band + nameplate /
emergency lines, overlaid with the post-action curve of the selected option) → forecast/hot-spot/aging stats →
transformer risk board (click to inspect) · relief option cards (Approve & dispatch) · action log · asset condition
(health, DGA sparkline, risk drivers, critical facilities) · service-territory map.

## REST (`server/routes/grid.ts`)
`GET /api/grid/overview`, `/api/grid/transformers/:id/{curve,options,detail}`, `GET|POST /api/grid/actions`
(write-back), `POST /api/admin/reset` (clears the action log + chats).

## Agent `GridOps` (`server/agent/gridops.ts`, OpenAI Agents SDK → `databricks-gpt-5-4` Responses API, MLflow traced)
| tool | effect |
|---|---|
| get_grid_overview | system KPIs + every transformer's forecast / health / risk |
| get_transformer_risk | one asset: forecast summary, recent SCADA, DGA, critical facilities, outages |
| get_relief_options | costed options with post-action peak / hot-spot / N-1 / rank |
| ask_data | open-ended analytics through the Genie agent (Agent mode; OBO, SP fallback) |
| log_operator_action | **WRITE** — inserts the approved option into `operator_actions`; only after explicit approval |

Flow: explain the risk as a chain → rank options in a table + recommendation → STOP for approval →
on "approve option 1" call `log_operator_action` and confirm the action id and expected result.
The app service principal needs USE CATALOG / USE SCHEMA / SELECT on the schema and MODIFY on `operator_actions`.
