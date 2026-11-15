# 01 — Data, AI Functions and the churn + LTV models

## Tables (`<catalog>.<schema>`, default `gaming.player_retention_copilot`)
| Table | Grain | Notes |
|---|---|---|
| `players` | player (41,164) | region (NA/EU/LATAM/APAC/OCE), country, platform, player_type (Casual / Progression / Competitive), spender_tier (Non-payer / Minnow / Dolphin / Whale), acquisition_channel, install_date, plays_ranked, lifetime_spend_usd, last_active_date, status (Active / Lapsing / Churned = 14+ days inactive), season7_stage_reached, stuck_on_warden |
| `player_daily` | player × day played (1.55M) | sessions, minutes_played, pve_runs, ranked_queues, avg_queue_wait_sec, queue_abandons, spend_usd |
| `stage_attempts` | player × day × stage (292K) | Season 6 (6-1..6-6, from 2026-06-09) and Season 7 (7-1..7-6, from 2026-08-18) attempts + clears |
| `purchases` | purchase (39K) | season pass, gem packs, bundles, skins |
| `chat_messages` | flagged chat line (9.9K) | moderation queue Aug 1–Sep 27: keyword filter or player report; recipient_player_id |
| `chat_insights` | flagged chat line | AI Functions output (below) |
| `intervention_catalog` | intervention (9) | target_driver, kind (game_change / offer / event / safety), scope (global / targeted), fixed_cost_usd + cost_per_player_usd, lead_time_days |
| `liveops_history` | past run (13) | Seasons 3–6, treated vs holdout-control 14-day retention, lift_pp, cost, players retained, strategy (Driver-matched / Blanket sale) |
| `liveops_budget` | month | October 2026: $12,000 |
| `liveops_schedule` | scheduled intervention | app write-back (empty at demo start) |
| `gold_daily_kpis` | day × region | DAU, new_installs, revenue, payers, ARPDAU, ARPPU, season |
| `gold_retention_cohorts` | install day × region × channel | installs, d1/d7/d30_retained (NULL until mature), install_season |
| `gold_stage_funnel` | season × stage | attempts, clears, attempt_clear_rate, players_stuck |
| `gold_matchmaking_daily` | day × region | queues, players_queueing, avg_queue_wait_sec (queue-weighted), abandon_rate |
| `gold_churn_weekly` | week × region × type × tier × tenure band | active_players, churned_14d, churn_rate |
| `player_features` / `churn_scores` | player active in the 14 days to 2026-09-27 (16,928) | model inputs / 14-day churn probability, risk tier, SHAP driver shares, top_driver, segment_id, reasons, predicted 12-month LTV, at-risk LTV |
| `gold_risk_segments` | top driver × region (18) | players at risk (tier ≠ Low), critical/high, payers/whales/new, at_risk_ltv_usd, ltv_book_usd, evidence averages |

## Planted signals (verified by query)
- New-player D7 retention: Season 6 installs 28.9% → Season 7 installs 20.1% (D1 56.1 → 52.4, D30 16.4 → 9.7).
- 14-day churn of weekly actives 5.3% (before 2026-08-17) → 11.5%.
- ARPDAU $0.432 (Jul 14–Aug 10) → $0.390 (since Aug 25); DAU 9,865 → 8,860.
- Stage 7-4 The Drowned Warden: 14.0% attempt clear rate (other S7 stages 58–70%), 2,705 players stuck.
- Ranked queue wait (queue-weighted): APAC 77 → 331 s, OCE 96 → 470 s, LATAM 71 → 123 s, EU 46 → 60 s, NA 39 → 54 s.
- New players (installed Aug 18–Sep 20) harassed in week 1: D7 11.1% vs 22.1% for the rest (1,462 vs 6,442 players).
- History: driver-matched +16.3 pts at $4.96 per retained player vs blanket gem sale +3.3 pts at $10.69.

## AI Functions (`src/ai/chat_toxicity.sql`, SQL warehouse)
`ai_classify(message_text, ['harassment','threat','scam','trash_talk','friendly'])` + `ai_analyze_sentiment` over the
9,911 flagged lines → `chat_insights` (is_harmful = harassment / threat / scam). The keyword filter flags banter too;
only harmful messages feed the model's `harmful_msgs_received_14d` (trash talk is a separate feature it learns to ignore).

## Models (`src/ml/train_models.py`)
- Weekly point-in-time snapshots Jun 7 → Sep 6 (285K rows), features over the 14 days up to the snapshot, label = no
  session in the next 14 days; Sep 13 snapshot held out. **player_churn_model** (XGBClassifier): holdout AUC 0.953,
  PR-AUC 0.889, top-decile lift 5.0x.
- **player_ltv_model** (XGBRegressor, Tweedie): next-28-day spend of players who stayed; holdout predicted/actual 1.00.
  Predicted 12-month LTV = 28-day spend × 13 × 0.62.
- Both registered in UC (`@champion`, v2) with the MLflow experiment in the demo folder.
- Scoring as of 2026-09-27; SHAP (`pred_contribs`) grouped into difficulty / matchmaking / toxicity (fixable causes),
  engagement / spend / profile (symptoms). top_driver = the largest fixable family if it adds ≥ 0.3 log-odds, else
  engagement. Tiers: Critical ≥ 0.55, High ≥ 0.35, Medium ≥ 0.20.
