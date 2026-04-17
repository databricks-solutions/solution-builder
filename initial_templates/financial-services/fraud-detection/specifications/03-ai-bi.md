# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `Meridian Bank Fraud Operations` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs | gold_daily_fraud_summary | date, region | fraud_count, fraud_amount_usd, transaction_count, fraud_rate |
| Fraud trend | gold_daily_fraud_summary | date, region | fraud_amount_usd |
| Fraud by channel | silver_fraud_cases | — | channel, fraud_amount_usd |
| Top merchants | gold_fraud_by_merchant | — | merchant_name, fraud_amount_usd, fraud_count |
| Terminal analysis | gold_fraud_by_terminal | — | terminal_id, merchant_name, fraud_amount_usd, cards_affected, fraud_rate |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | Region | Fraud Status      │
├─────────────────────────────────────────────────────────────────┤
│ [Fraud $2.4M ⚠️ 3x] [Cases 847] [Avg Resolve 4.2hrs] [+180%]  │
├─────────────────────────────────────────────────────────────────┤
│ DAILY FRAUD LOSSES (full width) ← THE SPIKE                    │
│ Baseline ~$27K/day, spike to $80K+ at SKIMMING_START+10d       │
├─────────────────────────────────────────────────────────────────┤
│ Fraud by Channel (bar)          │ Top Merchants by Fraud (table)│
│ In-Store POS dominant           │ QuickMart at top              │
├─────────────────────────────────────────────────────────────────┤
│ TERMINAL FRAUD ANALYSIS (full width)                            │
│ Scatter: terminal_id vs fraud_amount, TRM-QM cluster visible   │
├─────────────────────────────────────────────────────────────────┤
│ EMBEDDED GENIE SPACE                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_daily_fraud_summary | Last 30 days |
| Region | region | gold_daily_fraud_summary | All |

All filters affect ALL widgets.

### Validation

Spike visible (fraud ~$600K/week → ~$2.4M). Channel breakdown shows In-Store POS dominant. QuickMart at top of merchant table. Terminal scatter shows TRM-QM cluster. Region filter works (select "Northeast" → all widgets update).

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `Meridian Fraud Analytics` Genie Space.

### Tables

gold_daily_fraud_summary (trends), gold_fraud_by_terminal (terminal-level), gold_fraud_by_merchant (merchant-level), silver_fraud_cases (individual cases), bronze_terminals (terminal details), bronze_merchants (merchant details).

### Instructions

```
You analyze Meridian Bank fraud data for the fraud operations team.

BASELINES: Normal weekly fraud ~$600K, normal fraud rate ~0.3%, anomaly threshold >10%.

INVESTIGATION FLOW for "Why is fraud so high?":
1. gold_daily_fraud_summary → SUM(fraud_amount_usd) by week → spot 4x spike (~$2.4M vs $600K)
2. gold_fraud_by_terminal → WHERE fraud_rate > 0.10 → TRM-QM-0847, TRM-QM-0848, TRM-QM-0849
3. gold_fraud_by_merchant → QuickMart dominates
4. silver_fraud_cases → fraud_type WHERE terminal_id LIKE 'TRM-QM%' → all card_present
5. Conclude: "3 compromised terminals at QuickMart driving 4x fraud spike via card_present fraud. 847 cards affected. Suggest checking security audit reports."
```

### Sample Questions

"Why is fraud so high this week?" / "Which terminals have the most fraud?" / "Which merchant has the highest fraud rate?" / "Show me fraud trends for the last 8 weeks" / "What's the common factor in recent fraud cases?"

### Validation

"Why is fraud so high?" → 4x spike, 3 terminals, QuickMart, 847 cards. "Which terminals have fraud?" → TRM-QM-0847/0848/0849.

Add genie_space_id to `resources.json`.
