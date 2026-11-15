# 03 — Trial Site Copilot (Databricks App: Node/Express + React + Lakebase)

Pages: Home (portfolio + story) · CASCADE-CKD workbench (`/trials/CASCADE-CKD`) · Site network (`/sites`) · Portfolio analytics (`/analytics`) ·
Portfolio dashboard (`/dashboard`, embedded AI/BI) · chat dock on every page.

**Read side** (`server/services/trial-data.ts`): Delta gold tables + site_scores via the SQL warehouse (app SP), cached 10 min.
**Write side** (Lakebase `app.*`): `site_ops` (site network mirror with study-manager actions — activation_requested / closure_review) and
`rescue_plans` (analysis JSON, AI memo, status draft/approved/rejected, selected + closure site ids, append-only audit trail).

**Rescue analysis** (`POST /api/trials/:id/rescue`, SSE, `server/services/rescue.ts`): enrollment vs plan → screen failures (AI-read) → eligible pool →
zero enrollers + competition → protocol question to the Genie agent (E4/E7/SAP/SOP documents) → model-ranked candidates (top 15 preselected) →
deterministic projection (`shared/projection.ts`: run rate of last 3 complete months; E4 uplift = 1 + stable-SGLT2i E4 failures × pass rate of the rest ÷ randomized,
over the last 6 months; effective after 2 months; one-off re-screen bolus over 3 months; new sites ramp 50/75/100%) → memo (databricks-claude-sonnet-4-5, facts only).
Result today: LPI Jul 2029 (status quo) → Oct 2028 (E4) → Apr 2028 (E4 + 15 sites); planned Apr 2027.
**Approval** (`POST /api/rescue/:planId/decision`): writes status, edited memo, selected/closure sites, audit entries; flips `site_ops.ops_status`.

**Chat agent** (`server/agent/trial-copilot.ts`, OpenAI Agents SDK → databricks-gpt-5-4 Responses API, MLflow tracing): tools ask_data
(the Genie agent: analytics + protocol documents), screen_fail_breakdown, simulate_amendment, rank_rescue_sites, site_performance, rescue_plan_status.
Auth: OBO token with one retry as the app SP on 401/403 (`lib/auth.ts authedFetch`), user_api_scopes in databricks.yml.
**Reset** (`POST /api/admin/reset`): truncates plans, site_ops and conversations, re-syncs from Delta.
