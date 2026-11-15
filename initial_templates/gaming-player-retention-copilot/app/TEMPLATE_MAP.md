# TEMPLATE_MAP — Hollowspire Live-Ops Console app

File map for this app (forked from the solution-builder `app_template`). `[D]` = domain-specific to the
Emberline Studios / Hollowspire live-ops story; the rest is reusable template infrastructure.

## Server (`server/`)
| File | Role |
|---|---|
| `server.ts` | AppKit bootstrap: env/config, Lakebase pool + migrations, Delta→Lakebase sync, route registration, MLflow experiment |
| `agent/liveops-agent.ts` `[D]` | Live-ops copilot (OpenAI Agents SDK → Databricks Responses API, `databricks-gpt-5-4`): system prompt + tools `ask_data`, `at_risk_summary`, `list_segments`, `get_segment`, `evaluate_interventions`, `stage_plan`; fetch shim (64-char id strip, OBO→SP auth retry) |
| `agent/tools/genie.ts` | `ask_data` — Genie agent (Agent mode, SSE) via `authedFetch`, SQL steps streamed into the Thinking panel |
| `agent/tools/{logged-tool,types}.ts` | Tool wrapper (error logging) and shared types |
| `chat-stream/*` | SSE turn runner: builds the agent, streams reasoning / tool / text events, persists messages |
| `db/schema.ts` `[D]` | Lakebase `app.*` tables: conversations, messages, feedback, **segments**, **interventions**, **budget** |
| `db/sync.ts` `[D]` | Delta → Lakebase sync: gold_risk_segments + SHAP shares, top players, driver evidence, AI-labelled chat, intervention catalog + holdout lift, budget; `execWarehouseSql` |
| `db/queries/liveops.ts` `[D]` | Segment queries, the deterministic **plan engine** (cost / lift / LTV retained / ROI / budget), `stagePlan`, `decidePlan`, KPIs, budget what-if |
| `db/queries/chat.ts` | Chat persistence |
| `routes/liveops.ts` `[D]` | `/api/segments`, `/api/segments/:id`, `POST /api/segments/:id/decision` (Lakebase + Delta `liveops_schedule` write-back), `/api/kpis`, `/api/whatif` |
| `routes/admin.ts` | `POST /api/admin/reset` — wipes app tables, clears `liveops_schedule`, re-syncs from Delta ("Reset demo") |
| `routes/{chat,config,dev-log}.ts` | Conversations + `/api/chat/stream`, `/api/config` + `/api/me`, client-error logging |
| `lib/auth.ts` | `authHeaders` (OBO token, SDK chain locally), `spAuthHeaders`, `authedFetch` (retries once as the app SP on 401/403) |
| `lib/endpoint.ts` | `fixMojibake` — re-decodes only deltas that look like mojibake |

## Client (`client/src/`)
| File | Role |
|---|---|
| `console/ConsoleView.tsx` `[D]` | Home: Season 7 story strip (D7 by install week + holdout aha), KPIs, driver cards, segment board |
| `console/SegmentPanel.tsx` `[D]` | Segment drawer: LTV at risk, SHAP bars, evidence tiles, AI-labelled chat, top players, plan-engine table, staged plan + Schedule / Send back, audit |
| `console/chips.tsx` `[D]` | Tier / driver / status chips |
| `whatif/WhatIfView.tsx` `[D]` | Budget what-if: copilot plan vs blanket gem sale |
| `dashboard/DashboardView.tsx` | Embedded AI/BI dashboard |
| `chat/*` | Copilot dock + conversation view, streaming, thinking panel, scripted next prompts (`config/app.json` assistantScript) |
| `shell/*` | Sidebar, header (Reset demo) |
| `lib/liveops.ts` `[D]` | API client + types for the console |

## Config
- `config/app.json` — branding, data table names, agent model, assistant script (env placeholders for IDs).
- `app.yaml` — command, OBO scopes, env (catalog/schema/Genie/dashboard IDs of the live deployment).
