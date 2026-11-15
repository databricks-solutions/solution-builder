# 01 — Data, AI Functions and the churn-risk model

## Tables (`<catalog>.<schema>`, default `telecommunications.churn_retention_copilot`)
| Table | Grain | Notes |
|---|---|---|
| `customers` | account | segment (Consumer/Family/Small Business), plan, lines, region/market/cell_site_id, tenure, contract, device balance, autopay, `acquisition_promo` (Switch & Save 12), `promo_end_date`, `status`, `churn_date`, `exit_reason` |
| `network_quality_monthly` | account × month | dropped_call_rate_pct, avg_5g_download_mbps, outage_minutes |
| `billing_monthly` | account × month | bill_amount, promo_discount, bill_change_3m_pct, overage |
| `care_calls` | call | reason_code, disposition, transcript (Jul–Sep 2026 only) |
| `care_call_insights` | call | AI Functions output (see below) |
| `port_out_requests` | request | number-transfer PIN requests; `led_to_churn` |
| `competitor_promos` | promo × market | Crest Wireless $25/line (2026-07-01, 8 markets); Summit Mobile (Nov–Feb, Northeast) |
| `offer_catalog` | offer | cost model (`fixed` / `per_line_month` / `pct_bill_month`), duration, eligibility, guardrail 30% of 12-mo gross margin (58%) |
| `retention_offer_history` | offer | Apr–Sep 2026; strategy Blanket / Driver-matched (pilot, Aug–Sep) / Rep discretion; `saved` = accepted AND active 90 days later |
| `retention_decisions` | decision | app write-back (accept/decline) |
| `gold_churn_monthly` | month × region × market × segment × plan | active_start, churned, churn_rate_pct |
| `gold_network_sites` | month × cell site | dropped-call, 5G speed, churned, `migrated_to_5g_sa_core` |
| `customer_features` / `churn_scores` | active account | model inputs as of 2026-09 / 30-day probability, tier, SHAP driver shares, reasons, revenue at risk |

## Planted signals (all verified by query)
- Monthly churn 0.94% (Oct–Jun) → 1.73% (Jul–Sep); Phoenix 0.88% → 4.53%.
- 5 migrated sites at ~3.8% dropped-call rate in Sep vs ≤2.1% for every other site.
- Save rate since Aug: driver-matched 50.2% ($122 avg cost) vs blanket DISC-20 29.7% ($320).
- Best offer per driver: RATE-LOCK (bill shock 58.7%), NET-CARE (network 51.9%), CREST-MATCH (competitor 43.5%), GOODWILL-50 (care 42.3%).

## AI Functions (`src/ai/transcript_insights.sql`, SQL warehouse)
`ai_analyze_sentiment` · `ai_classify` (6 intents) · `ai_classify` (cancel threat) · `ai_extract` (competitor, requested_remedy) · `ai_summarize(…, 20)` over 5,934 transcripts.

## Model (`src/ml/train_churn_model.py`)
- Monthly snapshots Jan–Jul 2026 (features from s-2..s, label = churned in s+1); Aug→Sep held out.
- 20 features: tenure, lines, bill, device balance, autopay, 3-mo dropped-call rate + delta, 5G speed, outage, bill change, promo expired 90d / expiring 60d, competitor promo in market, port-out PIN 30d/90d, care / retention calls 90d, segment, contract.
- XGBoost (350 trees, depth 4). Holdout AUC 0.85, PR-AUC 0.25, top-decile lift 6.8×.
- Registered `<catalog>.<schema>.churn_risk_model`, alias `@champion`; SHAP `pred_contribs` grouped into network / bill_shock / competitor / care / port_out_intent / account. `top_driver` = largest actionable family (a port-out PIN in a Crest market counts as competitor).
- Tiers on 30-day probability: Critical ≥ 15%, High ≥ 7%, Medium ≥ 3% (759 / ~400 / ~830 accounts).
