---
name: Financial Services
category: domain
suggested_patterns: [anomaly-detection, compliance-audit, real-time-monitoring, customer-segmentation]
suggested_capabilities: [aibi-dashboards, genie, knowledge-assistant, supervisor-agent, sdp, model-serving, streaming]
---

## Terminology

- **SAR** — Suspicious Activity Report; mandatory filing when a transaction pattern suggests money laundering or fraud
- **KYC** — Know Your Customer; identity verification and due diligence at account opening
- **CNP** — Card Not Present; transaction where the physical card is not used (ecommerce, phone orders)
- **MCC** — Merchant Category Code; 4-digit code classifying what a merchant sells
- **PD / LGD / EAD** — Probability of Default, Loss Given Default, Exposure at Default; core credit risk parameters
- **VaR** — Value at Risk; maximum expected loss at a given confidence level over a time horizon
- **Basis points (bps)** — 1/100th of a percentage point; used for interest rates and spreads
- **FICO score** — Consumer credit score ranging 300-850; prime threshold typically 670+
- **Synthetic identity** — Fabricated identity combining real and fake PII elements to open fraudulent accounts
- **Reg E / Reg Z** — Federal regulations governing electronic fund transfers and consumer credit disclosures
- **Basel III** — International banking regulation framework for capital adequacy and liquidity

## KPIs and Baseline Metrics

| KPI | Healthy Baseline | Red Flag |
|-----|-----------------|----------|
| Fraud rate (card transactions) | 0.05-0.10% | >0.15% |
| False positive rate (fraud alerts) | 95-98% (most alerts are false) | >99% (missing real fraud) |
| SAR filing volume (per $1B deposits) | 200-400/year | Sudden 2x spike |
| Net charge-off rate | 1.5-2.5% (credit cards) | >4% |
| Loan approval rate | 55-70% | <40% or >85% (too loose) |
| 30-day delinquency rate | 2-4% | >6% |
| Cost per transaction (ACH) | $0.25-$0.50 | >$1.00 |
| Claims loss ratio (insurance) | 60-75% | >85% |
| Model monitoring drift (PSI) | <0.10 | >0.25 |
| Time to detect fraud | <30 seconds (real-time) | >5 minutes |

## Personas

- **Jennifer Walsh, VP of Fraud Operations** — Owns the fraud detection stack and alert triage process. Cares about false positive rates, fraud losses, and analyst throughput. Needs to explain spikes to regulators.
- **David Nakamura, Chief Risk Officer** — Responsible for credit risk models, capital reserves, and regulatory stress testing. Focused on model validation, fair lending compliance, and portfolio concentration risk.
- **Amara Osei, BSA/AML Compliance Officer** — Manages transaction monitoring rules, SAR filings, and KYC refresh cycles. Under pressure from OCC examiners to reduce investigation backlogs.
- **Raj Krishnamurthy, Head of Quantitative Analytics** — Builds pricing models, VaR calculations, and trading strategies. Needs low-latency data pipelines and feature stores for real-time model inference.

## Data Entities and Relationships

- **Accounts** (account_id, customer_id, account_type, open_date, status, branch_id, credit_limit)
- **Customers** (customer_id, kyc_status, risk_rating, onboard_date, pep_flag, country)
- **Transactions** (txn_id, account_id, amount, currency, timestamp, channel, merchant_id, mcc_code, auth_code)
- **Fraud Alerts** (alert_id, txn_id, rule_triggered, score, disposition, analyst_id, resolution_time)
- **Credit Applications** (app_id, customer_id, requested_amount, fico_score, dti_ratio, decision, decision_date)
- **AML Cases** (case_id, customer_id, case_type, status, assigned_analyst, sar_filed, escalation_level)
- **Market Data** (symbol, timestamp, bid, ask, volume, vwap)
- **Claims** (claim_id, policy_id, loss_date, reported_date, amount, category, adjuster_id, status)

Key relationships: Customers -> Accounts -> Transactions -> Fraud Alerts; Credit Applications reference Customers; AML Cases aggregate suspicious Transactions across Accounts.

## Regulatory and Compliance

- **BSA/AML** — Bank Secrecy Act requires transaction monitoring, CTR filing (>$10K cash), and SAR filing within 30 days of detection
- **FCRA** — Fair Credit Reporting Act governs how credit data is used in lending decisions; adverse action notices required
- **ECOA / Fair Lending** — Models must not discriminate on protected classes; disparate impact testing required
- **SOX** — Sarbanes-Oxley requires audit trails for financial reporting data transformations
- **GLBA** — Gramm-Leach-Bliley Act mandates customer data privacy and security safeguards
- **CECL** — Current Expected Credit Losses standard requires lifetime loss estimation for loan portfolios
- **SR 11-7 (Model Risk Management)** — Fed guidance requiring model validation, ongoing monitoring, and governance for all material models

## Common Pain Points and Use Cases

1. **Real-time fraud detection** — Card-not-present fraud is growing 15-20% annually. Rules-based systems generate excessive false positives (97-99% of alerts). ML models need sub-second inference on streaming transactions.
2. **AML transaction monitoring** — Legacy rule sets produce 95%+ false positives in alert queues. Analysts spend 30-45 minutes per case investigation. Graph analytics can reveal hidden relationships across accounts.
3. **Credit risk modeling** — Regulatory pressure for explainable models conflicts with performance gains from ensemble methods. Feature engineering from alternative data (rent payments, utility bills) can expand credit access.
4. **Model risk management** — Production models drift over time; PSI monitoring, champion/challenger testing, and automated retraining pipelines are needed to stay compliant with SR 11-7.
5. **Regulatory reporting** — Quarterly stress tests (CCAR/DFAST) require massive data aggregation across silos. Lineage and audit trails are essential for examiner scrutiny.
6. **Claims fraud (insurance)** — Staged accidents, inflated medical bills, and provider collusion networks. SIU teams need network analysis and anomaly detection to prioritize investigations.
