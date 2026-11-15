# 02 — Live-Ops Console app (Databricks App on Lakebase)

**User:** head of live ops. **Job:** decide which live-ops interventions to ship this month, for which players, within budget.

## Screens
- **Console** (`/`): Season 7 story strip (new-player D7 by install week, holdout aha), KPIs (D1/D7/D30 Season 7 vs 6,
  ARPDAU, players at risk, LTV at risk, budget left), driver cards (SHAP top driver → filter), **segment board** (driver ×
  region, ranked by LTV at risk, evidence column, status).
- **Segment panel**: LTV at risk + SHAP bars (fixable causes first, symptoms greyed), evidence tiles per driver, AI-labelled
  chat sample (toxicity), top at-risk players with model reasons, **plan-engine table**, staged plan + player message,
  **Schedule for <date>** / **Send back**, audit trail.
- **Budget what-if** (`/whatif`): copilot plan (largest net value first within the budget) vs the blanket gem sale.
- **Live-Ops Dashboard** (`/dashboard`): embedded AI/BI dashboard.
- **Copilot dock**: chat with reasoning panel, scripted suggestions.

## Plan engine (deterministic, `server/db/queries/liveops.ts`)
For a segment × intervention: coverage (targeted/region = the segment; global = every segment with the same driver;
GEM-SALE-50 = all), players targeted (TGT-OFFER = payers only), cost = fixed + per-player × players, lift = holdout
lift from `liveops_history`, LTV retained = lift × covered LTV book (capped at at-risk LTV), ROI. **Allowed** = targets the
driver AND cost ≤ remaining budget AND (ROI ≥ 1 OR kind = safety). Re-checked on `stage_plan` and on Schedule.

## Agent (`server/agent/liveops-agent.ts`, `databricks-gpt-5-4`, OpenAI Agents SDK)
Tools: `ask_data`, `at_risk_summary`, `list_segments`, `get_segment`, `evaluate_interventions`, `stage_plan` (WRITE:
stages the plan + player message; the human schedules). OBO token with one retry as the app service principal on 401/403.

## Write-back
Schedule → Lakebase `app.segments` (status scheduled on every covered segment, audit) + Delta `liveops_schedule`
(INSERT via the SQL warehouse). Reset demo → truncate app tables, `DELETE FROM liveops_schedule`, re-sync from Delta.
