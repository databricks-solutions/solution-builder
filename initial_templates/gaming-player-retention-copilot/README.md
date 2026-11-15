# Hollowspire Live-Ops Console — Player Retention & LTV Copilot

**Customer (fictional):** Emberline Studios — maker of *Hollowspire*, a free-to-play co-op action RPG with a ranked PvP
ladder (PC, PlayStation, Xbox; ~9-10K daily active players in this sample) · **Industry:** Media & Entertainment (Gaming)

## The story

Season 7 **"The Drowned Crown"** launched on **2026-08-18**. Six weeks later (data as of **2026-09-27**):

- **New-player D7 retention fell from 28.9% (Season 6 installs) to 20.1%** — D1 56.1% → 52.4%, D30 16.4% → 9.7%.
- **14-day churn of weekly active players doubled**, 5.3% → 11.5%.
- **ARPDAU slipped from $0.432 to $0.390** and average DAU from 9,865 to 8,860 (Jul 14–Aug 10 vs since Aug 25).

The live-ops reflex is the **blanket 50% gem sale**. The data says the season broke three different things:

| Driver | What happened (planted in the data) | Where it shows |
|---|---|---|
| **Difficulty** | Stage **7-4 "The Drowned Warden"** clears on **14.0%** of attempts (other Season 7 stages 58–70%); **2,705** players failed it 4+ times and never cleared it. | `gold_stage_funnel`, `stage_attempts` |
| **Matchmaking** | Season 7 split the ranked queue (Ranked + Crown Trials). Queue-weighted wait **APAC 1m 17s → 5m 31s, OCE 1m 36s → 7m 50s** (NA 39s → 54s); 25% of APAC queues abandoned. Competitive players there are the biggest spenders. | `gold_matchmaking_daily`, `player_daily` |
| **Toxicity** | The new cross-play Raid Finder matches newcomers with veterans. New players harassed in their first week retain at **11.1% D7 vs 22.1%**. The keyword filter flags harmless trash talk ("gg ez, get rekt") exactly like harassment — **AI Functions** (`ai_classify`) tell them apart. | `chat_messages` → `chat_insights` |

**The aha (head of live ops):** in `liveops_history` (Seasons 3–6, each run measured against a holdout control group),
**driver-matched fixes lifted 14-day retention by +16.3 pts at $4.96 per retained player; the blanket gem sale +3.3 pts
at $10.69**. Today the plan engine prices the gem sale at **$9,500 for $4,365 of LTV kept (0.46x ROI)** — the
Drowned Warden hotfix keeps **$11,465 for $3,000 (3.8x)** and the queue merge **$3,975 for $2,000 (2.0x)**.

## Personas
- **Head of Live Ops** (primary app user): works the segment board, asks the copilot for a plan, schedules it.
- **Game director / monetization lead** — reads the live-ops dashboard: D1/D7/D30, DAU/ARPDAU, churn by cohort, stage funnel, queues, toxicity, the live-ops calendar.
- **Data science / player safety** — the churn + LTV models in Unity Catalog, SHAP drivers, the AI-labelled moderation queue.

## Demo script (≈10 min) — exactly what the deployed app does

Once deployed, start with **Reset the demo** in the header if anyone used it.

> **Numbers drift per setup-job run.** The raw telemetry is deterministic, but `ai_classify` over the chat queue is not, and its labels feed the churn features. So LTV-at-risk, segment sizes and plan-engine ROIs move a little every time the job runs. The figures below come from a reference run ($90.6K at risk). A later run shows $76.8K at risk across 3,085 players; the largest fixable segment is DIFF-LATAM $7.5K; MATCH-APAC is $4.7K, and its QUEUE-MERGE plan costs $2,000 for a 1.21x ROI; the gem sale is 0.38x. Retention, stage-funnel, queue-wait, ARPDAU and past-intervention numbers are identical on every run.

1. **Live-Ops Console** (`/`) — a game HUD: the Season 7 banner with the D1/D7/D30 cohort curve (Season 6 vs Season 7) as the hero, a stat strip, churn drivers as boss cards, segments as game cards ranked by LTV at risk, and a live-ops calendar of staged plans. Hero: *"New-player D7 retention fell 30% in Season 7. It's three problems, not one."*
   Sparkline of D7 by install week (the Season 7 weeks in red) and the **aha** box (+16.3 pts at $5 vs +3.3 pts at $11).
   KPIs: **D1/D7/D30 52.4 · 20.1 · 9.7%** (was 56.1 · 28.9 · 16.4%), **ARPDAU $0.390** (was $0.432), **3,088 players at
   risk** (1,950 critical, 44 whales), **$91K LTV at risk**, **$12K October live-ops budget**, nothing scheduled yet.
2. **Driver cards** (SHAP top driver): Engagement decay **$51K** / 1,978 players (the normal baseline — fading players,
   no single fix), **Difficulty $25K** / 575, **Matchmaking $13K** / 200 (5 whales), **Toxic chat $1.6K** / 335 (mostly
   new, non-paying players — cheap in revenue, expensive in reputation). Click a card to filter the segment board.
3. Click **"Ask why retention dropped"** → the copilot calls **Genie** (`ask_data`) + `at_risk_summary` (~50 s):
   D7 **28.9% → 20.1%**, stage 7-4 at **14%** clear rate with **2,705** stuck players, APAC **1m 17s → 5m 31s** and OCE
   **1m 36s → 7m 50s**, harassment in the Raid Finder; **$90,613** LTV at risk across **3,088** players; largest overall
   segment **ENG-NA $17,864**, largest *fixable* one **MATCH-APAC $9,442**, and difficulty as a driver **$25,260** — one
   global patch covers every DIFF-* segment. (Phrasing varies per run; the numbers come from Genie SQL and the scores.)
4. Click the **Matchmaking** card, then **Ranked queue too long · APAC** (MATCH-APAC) → the **segment panel**:
   **$9,442** LTV at risk, 138 players at 83% average risk, 25 payers, 3 whales. SHAP bars (the fixable cause first,
   engagement/profile greyed as *symptoms*), evidence tiles (**5m 31s** wait, was 1m 17s; **25%** abandon rate), top
   at-risk players (IronSpecter106, a whale on Xbox, 99% risk, $2,658 at risk — 5m 26s average wait), and the
   **plan-engine table** for every intervention: *Blanket 50% gem sale $9.5K, +3.3 pts, $4.4K kept, 0.5x — ROI < 1*.
5. Click **"Ask the copilot for a plan"** → `get_segment` → `evaluate_interventions` → `stage_plan` (~25-40 s): picks
   **Ranked queue merge + cross-region backfill (QUEUE-MERGE)** — **$2,000** of the $12,000 budget, **+25 pts**, ~50
   players kept, **$3,975** LTV retained, **1.99x ROI**, starts **2026-09-30**, global so it also covers MATCH-OCE and
   MATCH-LATAM — explains why the gem sale was rejected (0.46x), drafts the in-game inbox message and stages it. The
   panel flips to **Plan staged** with the message and a **Schedule for 2026-09-30** button.
6. Click **Schedule for 2026-09-30** → Lakebase marks the three MATCH-* segments *Scheduled*, the audit trail grows,
   and the row is **written back to Delta** (`liveops_schedule`) — the panel confirms *"Written back to Delta:
   liveops_schedule"*. Budget left: **$10,000**.
7. Close the panel, open **Stuck on the Drowned Warden · NA** (DIFF-NA) → **Ask the copilot for a plan** → **Drowned
   Warden difficulty hotfix (DIFF-PATCH)**: **$3,000**, +28.5 pts, ~164 players kept, **$11,465** LTV retained, **3.82x**,
   starts 2026-10-01, covers all five DIFF-* segments. **Schedule** → budget left **$7,000**.
8. In the copilot dock ask **"Why not just run the 50% gem sale for everyone?"** → *"$9,500 … over the $7,000 budget left,
   and even if we could fund it, it's weak"* with a table: GEM-SALE-50 $9,500 / 102 players / $4,365 / 0.46x vs the hotfix
   $3,000 / 164 / $11,465 / 3.82x and the queue merge $2,000 / 50 / $3,975 / 1.99x.
9. **Budget what-if** (`/whatif`): at $12K the copilot's driver-matched plan spends **$7,090** and keeps **$24K** of the
   $91K at risk (3.5x) — DIFF-PATCH, QUEUE-MERGE, SAFE-LOBBY and targeted bundles for lapsing payers — vs the gem sale
   **$9,500 → $4.4K (0.46x)**. Move the slider.
10. **Live-Ops Dashboard** (`/dashboard`, embedded AI/BI): D7 by install week, DAU and ARPDAU by region, churn by cohort
    (new vs veteran), the Season 7 stage funnel (7-4 wall), ranked queue wait by region, LTV at risk by driver × region,
    the moderation queue by AI label, holdout lift by intervention, and the **live-ops calendar** (the two plans you just
    scheduled appear on top of the past measured runs).
11. Optional: open the **Genie space** and ask the sample questions below. **Reset the demo** (header) between runs — it
    re-syncs the Lakebase mirror from Delta and clears `liveops_schedule`.

Talking points: the plan engine is deterministic code (cost, lift, ROI, budget) — the LLM explains and writes, it never
does the arithmetic; the models live in Unity Catalog with lineage to the telemetry; AI Functions run in SQL over the
moderation queue (trash talk is a separate feature the model learns to ignore); player-safety spend (SAFE-LOBBY) is
exempt from the ROI floor by policy; every staged plan is a draft the human schedules.

### Genie sample questions
- *What was new-player D1, D7 and D30 retention for Season 6 vs Season 7 installs?* → 56.1 / 28.9 / 16.4% vs 52.4 / 20.1 / 9.7%
- *Which Season 7 stage has the lowest clear rate?* → 7-4 The Drowned Warden, 14.0% (97,582 attempts, 13,684 clears, 2,705 stuck)
- *How did the average ranked queue wait change by region after Season 7 launched?* → OCE 96 → 470 s, APAC 77 → 331 s, LATAM 71 → 123 s, EU 46 → 60 s, NA 39 → 54 s
- *How much LTV is at risk by churn driver?* → engagement $50,633, difficulty $25,260, matchmaking $13,118, toxicity $1,603
- *Which segments put the most revenue at risk?* → ENG-NA $17,864, ENG-EU $17,709, MATCH-APAC $9,442, DIFF-NA $8,926, DIFF-LATAM $8,742 …
- *How do past driver-matched interventions compare with the blanket gem sale?* → +16.3 pts at $4.96 / retained player (10 runs) vs +3.3 pts at $10.69 (3 runs)
- *What was ARPDAU and average DAU in the four weeks before Season 7 (Jul 14 - Aug 10) vs since Aug 25?* → $0.432 / 9,865 vs $0.390 / 8,860
- *How many flagged chat messages did AI Functions classify as harassment vs trash talk?* → trash_talk 5,388, harassment 1,310 (+ threat 1,307, scam 533, friendly 1,373)

## What's built

| Layer | Asset |
|---|---|
| Data | `data_generation/generate_data.py` — 41,164 players, 1.55M player-days (sessions, minutes, PvE runs, ranked queues + wait, abandons, spend), 292K stage attempts, 39K purchases, 9.9K flagged chat lines, 9-intervention catalog, 13 holdout-measured past runs, budget; gold `gold_daily_kpis`, `gold_retention_cohorts`, `gold_stage_funnel`, `gold_matchmaking_daily`, `gold_churn_weekly`; PK/FK (RELY) |
| AI Functions | `src/ai/chat_toxicity.sql` — `ai_classify` (harassment / threat / scam / trash_talk / friendly) + `ai_analyze_sentiment` → `chat_insights` |
| ML | `src/ml/train_models.py` — XGBoost 14-day churn classifier on weekly point-in-time snapshots (holdout AUC **0.95**, top-decile lift **5.0x**) + XGBoost (Tweedie) 28-day spend model for LTV (holdout predicted/actual 1.00); both registered in UC `@champion`; SHAP (`pred_contribs`) grouped into driver families → `churn_scores`, `player_features`, `gold_risk_segments` |
| App | `app/` — AppKit (Node/React) *Live-Ops Console*: segment board, segment panel, plan engine (`server/db/queries/liveops.ts`), live-ops copilot (`server/agent/liveops-agent.ts`, OpenAI Agents SDK on `databricks-gpt-5-4` + Genie tool), Schedule → Lakebase + Delta write-back, budget what-if, embedded dashboard |
| Lakebase | project `<project>`, db `sb_player_retention_copilot` (bundle-owned) — segment mirror + plans, interventions, budget, chat history |
| BI | `dashboard/liveops_retention.lvdash.json` (schema-less datasets, 19 widgets) · `genie/genie_space.json` (serialized v2, 17 tables, instructions, 8 example SQLs) |
| Deploy | `databricks.yml` (dashboard, app with OBO scopes, setup job) — see `dab_instructions.md` |

Data lives in `gaming.player_retention_copilot`. Deploy/upgrade: `databricks bundle deploy`, then `databricks bundle run player_retention_setup`, then `databricks bundle run liveops_app` (see `dab_instructions.md`).
