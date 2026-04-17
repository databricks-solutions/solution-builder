# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Affected merchant** (deterministic — must exist with these exact values):

| merchant_id | merchant_name | mcc | mcc_description | region | risk_score |
|-------------|---------------|-----|-----------------|--------|------------|
| MER-5411-QM | QuickMart Convenience Stores | 5411 | Grocery Stores, Convenience Stores | Northeast | 3 |

12 locations across Northeast region.

**Compromised terminals**: TRM-QM-0847, TRM-QM-0848, TRM-QM-0849 — all at QuickMart locations, installed 6+ months ago.

**Fraud spike stats**: 847 compromised cards, ~2,100 fraud cases (all card_present), peak week ~$2.4M vs ~$600K baseline, fraud rate ~15% vs 0.3% normal.

**Texture of fraud**: Skimming devices installed at compromised terminals. Cards cloned and used at other merchants across multiple regions. Fraud dates: SKIMMING_START + 10 days to NOW.

**Security audit report** (smoking gun for KA): Merchant Security Audit Report — MSA-2025-0423. Auditor: Meridian Bank Merchant Security Division. Findings: POS tampering, skimming overlay devices, pin pad overlay detected, card slot modifications. 3 terminals flagged (TRM-QM-0847/0848/0849). Estimated cards exposed: 800-900. Recommendation: immediate terminal replacement, card reissuance for affected customers. Disposition: "Recommend proactive card blocking for all cards used at these terminals during compromise window."

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, SKIMMING_START_DATE = NOW - 4 weeks, Fraud spike week = NOW - 2 to 3 weeks, Security audit date = NOW - 3 weeks.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| cardholders.parquet | ~200K | Region: Northeast 30%, Southeast 25%, Midwest 25%, West 20%. Card type: credit 60%, debit 40% |
| merchants.parquet | ~5K | Various MCCs. QuickMart (MER-5411-QM) with 12 locations in Northeast |
| terminals.parquet | ~15K | Types: POS, ATM, Online. 3 compromised terminals per Shared Context |
| transactions.parquet | ~2M | ~38K/week baseline. Compromised terminal txns: ~1,200/week for 4 weeks. Skimmed cards appear in fraud 7-14 days after terminal use |
| fraud_cases.parquet | ~25K | Normal: card_present 30%, CNP 55%, ATO 15%. Spike: ~2,100 cases, all card_present |
| merchant_alerts.parquet | ~500 | Types: compliance, security, operational. Key alert: MER-5411-QM terminals, type "security", severity "high" |

### Table Schemas

**cardholders**: `cardholder_id` (PK, CH-NNNNNN), `card_number_hash`, `first_name`, `last_name`, `region`, `account_open_date`, `card_type`, `credit_limit` DECIMAL(10,2)

**merchants**: `merchant_id` (PK, MER-NNNN), `merchant_name`, `mcc`, `mcc_description`, `region`, `risk_score` INT 1-10

**terminals**: `terminal_id` (PK, TRM-XXX-NNNN), `merchant_id` (FK), `terminal_type`, `install_date`, `last_maintenance`, `firmware_version`

**transactions**: `transaction_id` (PK, TXN-YYYYMMDD-NNNNNNNN), `cardholder_id` (FK), `merchant_id` (FK), `terminal_id` (FK), `transaction_date`, `transaction_timestamp`, `amount_usd` DECIMAL(10,2), `auth_code`, `response_code` (approved/declined), `channel` (chip/swipe/contactless/online)

**fraud_cases**: `fraud_case_id` (PK, FRD-NNNNNNNN), `transaction_id` (FK), `cardholder_id` (FK), `fraud_date`, `fraud_amount_usd` DECIMAL(10,2), `fraud_type`, `detection_method` (customer_report/model_alert/rule_trigger)

**merchant_alerts**: `alert_id` (PK, ALT-NNNNNN), `merchant_id` (FK), `terminal_id` (FK, nullable), `alert_date`, `alert_type`, `severity`, `description`, `status` (open/investigating/resolved)

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/security_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Monthly fraud reports (general stats), merchant compliance reviews (other merchants), PCI-DSS audit summaries, security awareness bulletins, incident response procedures, vendor security assessments. NO mention of QuickMart or compromised terminals.

**Key document**: Merchant Security Audit Report per Shared Context. Header: Meridian Bank Merchant Security Division, report MSA-2025-0423, date NOW - 3 weeks, merchant QuickMart (MER-5411-QM). Findings: physical inspection of 12 locations, 3 terminals flagged — TRM-QM-0847 (QuickMart #147, Oak Street), TRM-QM-0848 (QuickMart #152, Main Ave), TRM-QM-0849 (QuickMart #159, Harbor Blvd). Evidence: pin pad overlay, card slot modifications. Estimated compromise: 4 weeks. Risk: HIGH. Cards exposed: 800-900. Disposition: audit completed, terminals scheduled for replacement, "Recommend proactive card blocking for all cards used at these terminals during compromise window."

---

## C. SDP Pipeline

Create pipeline `meridian_fraud_analytics`, catalog `meridian_bank`, target schema `fraud_ops`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | fraud losses, case count, trends by date/region/channel | gold_daily_fraud_summary |
| Dashboard drill-down | terminal-level and merchant-level fraud breakdown | gold_fraud_by_terminal, gold_fraud_by_merchant |
| Genie investigation | Trace fraud → terminals → merchant → root cause | gold_fraud_by_terminal + silver_fraud_cases |

### Source → Bronze (1:1 ingestion)

cardholders/merchants/terminals/transactions/fraud_cases/merchant_alerts.parquet → bronze_{table_name}

### Bronze → Silver (joins)

**silver_transactions**: transactions JOIN cardholders (→ region, card_type) JOIN merchants (→ merchant_name, mcc) JOIN terminals (→ terminal_type). Columns: transaction_id, cardholder_id, merchant_id, terminal_id, transaction_date, transaction_timestamp, amount_usd, channel, region, card_type, merchant_name, mcc, terminal_type.

**silver_fraud_cases**: fraud_cases JOIN transactions (→ terminal_id, merchant_id, channel, amount_usd) JOIN cardholders (→ region) JOIN merchants (→ merchant_name). Columns: fraud_case_id, transaction_id, cardholder_id, fraud_date, fraud_amount_usd, fraud_type, detection_method, terminal_id, merchant_id, merchant_name, channel, region.

**silver_terminal_activity**: Aggregate transactions by terminal_id, merchant_id. Columns: terminal_id, merchant_id, merchant_name, transaction_count, total_amount_usd, unique_cardholders, fraud_count, fraud_amount_usd, fraud_rate.

### Silver → Gold (aggregations)

**gold_daily_fraud_summary** — dims: date, region. Metrics: fraud_count, fraud_amount_usd, transaction_count, fraud_rate.

**gold_fraud_by_terminal** — dims: terminal_id, merchant_id, merchant_name. Metrics: fraud_count, fraud_amount_usd, cards_affected, fraud_rate.

**gold_fraud_by_merchant** — dims: merchant_id, merchant_name, mcc. Metrics: fraud_count, fraud_amount_usd, terminals_affected.

### Filter Coherence Matrix

| Filter | gold_daily_fraud_summary | gold_fraud_by_terminal | gold_fraud_by_merchant |
|--------|--------------------------|------------------------|------------------------|
| date | ✅ | — (cumulative) | — (cumulative) |
| region | ✅ | — | — |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_daily_fraud_summary | date, region | fraud_count, fraud_amount_usd, transaction_count, fraud_rate |
| gold_fraud_by_terminal | — | terminal_id, merchant_id, merchant_name, fraud_count, fraud_amount_usd, cards_affected, fraud_rate |
| gold_fraud_by_merchant | — | merchant_id, merchant_name, mcc, fraud_count, fraud_amount_usd, terminals_affected |
| silver_fraud_cases | region | fraud_case_id, terminal_id, merchant_id, merchant_name, fraud_type, fraud_amount_usd |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Compromised terminal txns | `SELECT COUNT(*) FROM silver_transactions WHERE terminal_id IN ('TRM-QM-0847','TRM-QM-0848','TRM-QM-0849')` | ~4,800 |
| Unique compromised cards | `SELECT COUNT(DISTINCT cardholder_id) FROM silver_transactions WHERE terminal_id IN ('TRM-QM-0847','TRM-QM-0848','TRM-QM-0849')` | 847 |
| Fraud from compromised cards | `SELECT COUNT(*) FROM silver_fraud_cases WHERE terminal_id IN ('TRM-QM-0847','TRM-QM-0848','TRM-QM-0849')` | ~2,100 |
| Fraud rate on compromised terminals | `SELECT fraud_rate FROM gold_fraud_by_terminal WHERE terminal_id LIKE 'TRM-QM-08%'` | ~15% |
| Spike week fraud $ | `SELECT DATE_TRUNC('week', date) as week, SUM(fraud_amount_usd) FROM gold_daily_fraud_summary GROUP BY 1 ORDER BY 2 DESC LIMIT 1` | ~$2.4M vs ~$600K baseline |
| Column names | `DESCRIBE gold_daily_fraud_summary` / `DESCRIBE gold_fraud_by_terminal` | Match specs above |

Add pipeline_id to `resources.json`.
