# TEMPLATE_MAP — Readmission Copilot app

`[D]` = domain-specific to the Larkspur Health readmissions story; everything else is reusable template infrastructure.

## server/
| File | Role |
|---|---|
| `agent/care-copilot.ts` `[D]` | Chat agent (OpenAI Agents SDK → Databricks Responses API): system prompt + 9 tools incl. the `create_outreach_task` write-back; OBO→SP fallback fetch shim |
| `agent/tools/genie.ts` | `ask_data` tool (Genie Agent API, Agent mode: SQL + documents, SP fallback) |
| `services/care-data.ts` `[D]` | Read side over the Delta gold tables (warehouse, cached): KPIs, unit / weekday signal, follow-up effect, HRRP |
| `services/transition-plan.ts` `[D]` | The per-patient transition plan: facts → unit events → pathway documents (Genie agent) → pathway task rules → summary + call script, streamed |
| `services/resources.ts` | Resolves the Genie agent id from `demo_resources` (written by the setup job) |
| `routes/care.ts` `[D]` | Command center / HRRP / worklist / plan SSE / approval write-back / outreach tasks |
| `db/schema.ts` `[D]` | Lakebase tables: chat + `worklist` + `transition_plans` + `outreach_tasks` |
| `db/sync.ts` `[D]` | Delta → Lakebase sync of the worklist; `execSql` (warehouse) |
| `db/queries/care.ts` `[D]` | Worklist / plan / task queries, approval transaction, activity feed |
| `routes/charts.ts` | `/api/charts/<key>` → `config/queries/<key>.sql` with bound catalog/schema |
| `lib/auth.ts`, `lib/endpoint.ts`, `lib/serving.ts` | OBO + SP-fallback auth, streaming decode, document Q&A (Genie agent) + chat-completion helpers |
| `server.ts`, `chat-stream/*`, `routes/{chat,config,admin,activity}.ts` | Template plumbing |

## shared/
| `hrrp.ts` `[D]` | Deterministic HRRP what-if (server agent tool + client slider) |

## client/src/
| File | Role |
|---|---|
| `care/CommandCenter.tsx` `[D]` | Home / command center |
| `care/WorklistView.tsx` `[D]` | Worklist + transition workspace + plan approval |
| `care/{HrrpView,OutreachView,charts,api,ui}.tsx` `[D]` | HRRP exposure, outreach queue, SVG charts, API client, UI atoms |
| `analytics/AnalyticsView.tsx` `[D]` | Readmission analytics |
| `chat/*`, `shell/*`, `dashboard/*`, `lib/*` | Template chat dock, chrome, embedded dashboard, session |

## config/
| `app.json` `[D]` | Endpoints, data location, branding, chat starter script |
| `queries/*.sql` `[D]` | readmission_rate_by_condition, followup_rate_by_weekday, hrrp_err_by_condition |
