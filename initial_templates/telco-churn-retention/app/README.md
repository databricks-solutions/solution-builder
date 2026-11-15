# Veridian Retention Desk — Databricks App

AppKit (Node/Express + React) app forked from the Solution Builder action-agent template and rebuilt for churn retention.

| Where | What |
|---|---|
| `client/src/desk/` | Retention Desk: story strip, KPIs, SHAP driver cards, worklist, `CasePanel` (drivers, AI-analyzed last call, guardrail table, staged offer, Accept/Decline) |
| `client/src/whatif/` | Retained-revenue what-if (driver-matched vs blanket DISC-20) |
| `server/db/schema.ts` | Lakebase tables: `retention_cases`, `offers` (+ chat tables) |
| `server/db/sync.ts` | Boot-time Delta → Lakebase mirror (`config/app.json` → `data.tables`) + `execWarehouseSql` |
| `server/db/queries/retention.ts` | Worklist queries, **margin-guardrail engine**, `stageOffer`, `recordDecision`, KPIs, what-if |
| `server/routes/retention.ts` | `/api/cases`, `/api/cases/:id`, `/api/cases/:id/decision` (Lakebase + Delta write-back), `/api/kpis`, `/api/whatif` |
| `server/agent/retentionops.ts` | Next-best-offer agent: `ask_data`, `list_top_cases`, `get_customer_case`, `evaluate_offers`, `stage_offer` |
| `scripts/deploy_app.sh` | Render app.yaml env → build → upload → create/deploy app → UC / Genie / Lakebase grants |

Local: `cp .env.template .env`, fill it (Lakebase endpoint + host, warehouse, `DEMO_CATALOG`/`DEMO_SCHEMA`,
`GENIE_SPACE_ID`, `DASHBOARD_ID`), then `./start.sh` (port 8814). Structural template notes: `TEMPLATE_MAP.md`.
