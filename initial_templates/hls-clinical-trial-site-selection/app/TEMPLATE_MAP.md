# TEMPLATE_MAP — Trial Site Copilot app

`[D]` = domain-specific to the Halcyra / CASCADE-CKD story; everything else is reusable template infrastructure.

## server/
| File | Role |
|---|---|
| `agent/trial-copilot.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + 7 tools; OBO→SP fallback fetch shim |
| `agent/tools/genie.ts` | `ask_data` tool (Genie Agent API, Agent mode: SQL + documents, SP fallback) |
| `services/trial-data.ts` `[D]` | Read side over Delta gold tables + site_scores (warehouse, cached) |
| `services/rescue.ts` `[D]` | The enrollment-rescue analysis: facts → protocol documents (Genie agent) → projection → memo, streamed step by step |
| `routes/trials.ts` `[D]` | Portfolio / trial overview / sites / rescue SSE / decision write-back |
| `db/schema.ts` `[D]` | Lakebase tables: chat + `site_ops` + `rescue_plans` |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the site network; `execSql` (warehouse) |
| `db/queries/ops.ts` `[D]` | Site / plan queries, approval transaction, activity feed |
| `routes/charts.ts` | `/api/charts/<key>` → `config/queries/<key>.sql` with bound catalog/schema |
| `lib/auth.ts`, `lib/endpoint.ts`, `lib/serving.ts` | OBO + SP-fallback auth, streaming decode, document Q&A (Genie agent) + chat-completion helpers |
| `server.ts`, `chat-stream/*`, `routes/{chat,config,admin,activity}.ts` | Template plumbing |

## shared/
| `projection.ts` `[D]` | Deterministic LPI projection (server + client) |

## client/src/
| File | Role |
|---|---|
| `home/HomeView.tsx` `[D]` | Portfolio home |
| `trials/{TrialWorkbench,charts,api,ui}.tsx` `[D]` | Trial workbench, SVG charts, API client, UI atoms |
| `sites/SiteNetworkView.tsx` `[D]` | Site network (map + tables) |
| `sites/SiteMap.tsx` `[D]` | Leaflet OSM site map, shared by Home and Site network |
| `analytics/AnalyticsView.tsx` `[D]` | Portfolio analytics |
| `chat/*`, `shell/*`, `dashboard/*`, `lib/*` | Template chat dock, chrome, embedded dashboard, session |

## config/
| `app.json` `[D]` | Endpoints, data location + trial id, branding, chat starter script |
| `queries/*.sql` `[D]` | portfolio_pct_of_plan, screen_fail_top_reasons, activation_cycle_time |
