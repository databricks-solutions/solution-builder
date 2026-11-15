# 02 — Retention Desk app (Databricks App, AppKit)

## Surfaces
- **Retention Desk** (`/`): story strip (churn trend + aha), live KPIs (Lakebase), SHAP driver cards (click → filter), worklist ranked by revenue at risk (tier / region filters).
- **Case panel**: 30-day probability, SHAP driver bars, reasons, signal tiles, last care call (AI Functions badges + summary + transcript), margin-guardrail table for all 8 offers, next-best-offer card, Accept / Decline, audit trail.
- **What-if** (`/whatif`): tiers × contact rate → driver-matched vs blanket DISC-20: expected saves, retained revenue, offer spend, net margin impact, guardrail breaches, offer mix.
- **CMO Dashboard** (`/dashboard`): embedded AI/BI dashboard. **Copilot dock**: the agent (chat, reasoning, MLflow trace link).

## Data flow
- Boot: Delta → Lakebase sync (`server/db/sync.ts`) of Critical/High/Medium cases (`churn_scores` × `customers` × `customer_features` × latest `care_call_insights`) + `offer_catalog` with save rates per driver from `retention_offer_history`.
- Decisions: `POST /api/cases/:id/decision` → Lakebase (status, audit) + `INSERT INTO retention_decisions` on the warehouse (dashboard + Genie see it).

## Margin guardrail (code, not prompt) — `server/db/queries/retention.ts`
cost(offer) ≤ 30% × 12 × monthly bill × 58% gross margin, AND eligibility (NET-CARE needs dropped-call > 2%, RATE-LOCK needs a Switch & Save roll-off, CREST-MATCH needs a Crest market, UPGRADE-200 needs a device plan…). `stage_offer` re-checks server-side and rejects a breach with `GUARDRAIL: …`.

## Agent — `server/agent/retentionops.ts` (OpenAI Agents SDK → `databricks-gpt-5-4` Responses API, OBO)
Tools: `ask_data` (Genie space), `list_top_cases`, `get_customer_case`, `evaluate_offers`, `stage_offer` (write). Flow: case → guardrail evaluation → best allowed driver-matched offer → drafted outreach → staged; the human records the customer's answer. Traces → MLflow experiment `/Shared/solution_builder/<app>-agent-traces`.
