# Veridian Mobile — Churn Retention Desk

**Industry:** Media & Entertainment (Telecom) · **Outcome:** Enhance CX to grow revenue → churn prediction & retention
**Customer:** Veridian Mobile — a *fictional* US regional wireless carrier (~32K postpaid accounts in this sample)

## The story

Postpaid churn at Veridian Mobile ran at **~0.94% a month** for most of the year, then jumped to **1.73%** in July
(**+84%**) and stayed there. The retention desk's playbook hasn't changed: every at-risk customer who calls gets the
same **20% discount for 12 months (DISC-20)**.

The data says churn is **three unrelated problems**, not one:

| Driver | What happened (planted in the data) | Where it shows |
|---|---|---|
| **Network** | A 5G standalone-core migration on **2026-06-10** degraded 5 cell sites — **PHX-03, PHX-07, PHX-08, TUS-02, LVS-05**. Dropped-call rate 0.8% → **~3.8%**, 5G download ~210 → **~63 Mbps**. | `gold_network_sites`, `network_quality_monthly` |
| **Bill shock** | The **Switch & Save 12** acquisition campaign (Aug–Oct 2025, $15/line off) rolls off in Aug–Oct 2026 → bills jump ~25–35%. | `billing_monthly`, `customers.promo_end_date` |
| **Competitor** | **Crest Wireless** (fictional) launched **$25/line Unlimited** on 2026-07-01 in 8 Southwest + Texas markets; port-out PIN requests spike there. | `competitor_promos`, `port_out_requests` |

**The aha (CMO):** in `retention_offer_history`, the Aug–Sep *driver-matched* pilot (Network Care Pack for network,
Loyalty Rate Lock for bill shock, Competitive Loyalty Offer for Crest) saved **50.2%** of at-risk customers at
**$122**/offer, vs **29.7%** at **$320**/offer for the blanket DISC-20 — and DISC-20 breaches the margin guardrail
(cost ≤ 30% of 12-month gross margin) on **every** account.

## Personas

- **Priya Raman — Retention Desk manager** (primary user of the app): works the ML-ranked worklist, asks the copilot for
  the next-best offer, records the customer's answer.
- **CMO** — reads the dashboard: churn by region/segment, ARPU at risk by driver, save rate by strategy, live desk decisions.
- **Network / data science leads** — the SHAP drivers, the model in Unity Catalog, the cell-site table.

## Demo script (≈10 min) — exactly what the app does

1. **Open the app** (`churn-retention-copilot`). The story card reads *"Postpaid churn is up 84% since July. It's three
   problems, not one."* — sparkline Oct 2025 → Sep 2026 and the **aha** box (50.2% vs 29.7% save rate).
   KPI row: **757 Critical** accounts (+443 High), **$323K** probability-weighted revenue at risk (ARPU book $1.82M).
   The desk below is the agent's console: the caller queue on the left, the selected caller's subscriber 360 in the middle and the offer desk on the right.
2. **Driver chips** above the caller queue (Competitor **$196K**, Network $63K, Bill shock $43K…). Click a chip → the queue filters to that driver.
3. Click **"Ask why churn is up"** → the copilot dock opens and calls **Genie** (`ask_data`): 0.94% → 1.73%, concentrated in
   the 8 Crest promo markets (2.86% vs 0.97% elsewhere, Jul–Sep), competitor driver carries the most revenue at risk ($196K, 656 accounts).
4. Click **"Who do I call first?"** → `list_top_cases` returns the 5 Critical Southwest accounts ranked by revenue at risk.
5. Click the top row (**Camila Ortiz, VM-131732**, Albuquerque, 8 business lines, 41.6%) → the **case panel**: SHAP
   bars (port-out intent 63%, bill shock 24%), plain-English reasons (port-out PIN in the last 30 days, Crest promo in
   Albuquerque, Switch & Save ends within 60 days), signal tiles, and the **margin-guardrail table** for every offer.
   Point at *Blanket 20% Discount: $666 — over cap $579*.
   *(Click the Network driver card and open an account to show a care-call transcript read by AI Functions —
   sentiment, intent, cancel-threat badge, one-line summary, full transcript.)*
6. Click **"Ask the copilot for the next-best offer"** → the agent runs `get_customer_case` → `evaluate_offers` →
   `stage_offer`: picks **Competitive Loyalty Offer (CREST-MATCH)** — $480 ≤ cap $579, ~44% expected save rate — says
   why DISC-20 was rejected, drafts the call script and stages it. The case panel updates live (status *Offer staged*).
7. Click **"Customer accepted"** → the Lakebase case closes as **Saved**, the audit trail grows, and the decision is
   **written back to Delta** (`retention_decisions`) — the panel confirms *"Written back to Delta"*. KPIs update
   (desk save rate, revenue saved).
8. **What-if** page: Critical + High, 60% contact rate → driver-matched offers keep **~$51K more** annual revenue than
   DISC-20 while spending ~$28K less and breaching the guardrail 0 times (vs 720). Move the slider / add Medium.
9. **CMO Dashboard** page (embedded AI/BI): churn by region (Southwest breaks away in July), churn by segment
   before/after, ARPU at risk by region × driver, save rate + cost by strategy, save rate by offer × driver, the worst
   cell sites (all 5 migrated sites on top), voice-of-customer from AI Functions, and the **live desk decisions** table
   (the accept you just recorded is there).
10. Optional: open the **Genie space** and ask the sample questions below. Reset between demos with the header's
    *Reset the demo* button (re-syncs the Lakebase mirror from Delta).

### Genie sample questions
- *What was the churn rate before July vs since July?* → 0.94% vs 1.73% (≈1.8×)
- *Which cell sites have the worst dropped-call rate in September?* → TUS-02 3.83%, PHX-07 3.81%, PHX-08 3.80%, LVS-05 3.76%, PHX-03 3.76% (all migrated); next non-migrated ~2.09%
- *What is the save rate by offer strategy since August?* → Driver-matched 50.2% ($122), Blanket 29.7% ($320), Rep discretion 24.1% ($136)
- *How much revenue is at risk by top churn driver?* → competitor ≈$196K, network ≈$63K, bill shock ≈$43K (Critical + High)
- *Which offer saves the most customers for each churn driver?* → RATE-LOCK 58.7% (bill shock), NET-CARE 51.9% (network), CREST-MATCH 43.5% (competitor), GOODWILL-50 42.3% (care)

## What's built

| Layer | Asset |
|---|---|
| Data | `data_generation/generate_data.py` — 32,200 accounts, 12 months of network + billing, 11.9K care calls (5.9K with transcripts), 11.3K port-out PIN requests, 12 competitor promos, 8-offer catalog, 6,200 historical offers; gold `gold_churn_monthly`, `gold_network_sites`; PK/FK (RELY) constraints |
| AI Functions | `src/ai/transcript_insights.sql` — `ai_analyze_sentiment`, `ai_classify` (intent + cancel threat), `ai_extract` (competitor, requested remedy), `ai_summarize` → `care_call_insights` |
| ML | `src/ml/train_churn_model.py` — XGBoost on point-in-time monthly snapshots (holdout AUC **0.85**, top-decile lift **6.8×**), registered as `churn_risk_model@champion` in Unity Catalog; SHAP (`pred_contribs`) grouped into driver families → `churn_scores`, `customer_features` |
| App | `app/` — AppKit (Node/React) *Retention Desk*: worklist, case panel, margin-guardrail engine (`server/db/queries/retention.ts`), next-best-offer agent (`server/agent/retentionops.ts`, OpenAI Agents SDK on `databricks-gpt-5-4` + Genie tool), accept/decline → Lakebase + Delta write-back, what-if, embedded dashboard |
| Lakebase | database `sb_churn_retention` in the shared `<project>` project (bundle resource) — mirror of the worked cases + offers, desk state, chat history |
| BI | `dashboard/dashboard.lvdash.json` (schema-less datasets) · `genie/genie_space.json` (serialized v2, 11 tables, instructions, 7 example SQLs) |
| Deploy | `databricks.yml` — complete DAB (schema, Lakebase database, dashboard, app, setup job: data → AI Functions → model → Genie → app grants → `demo_resources`). `bundle deploy` → `bundle run churn_retention_setup` → `bundle run churn_retention_app` — see `dab_instructions.md` |

Bundle, dashboard and Genie live under `/Workspace/Users/<you>/telco-churn-retention`; data lives in `telecommunications.churn_retention`.
