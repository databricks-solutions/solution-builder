# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `meridian_fraud_analytics` |
| **Catalog** | `meridian_bank` |
| **Target Schema** | `fraud_ops` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_cardholders | cardholders.parquet | Raw cardholder records |
| bronze_merchants | merchants.parquet | Raw merchant data |
| bronze_terminals | terminals.parquet | Raw terminal data |
| bronze_transactions | transactions.parquet | Raw transaction records |
| bronze_fraud_cases | fraud_cases.parquet | Raw fraud records |
| bronze_merchant_alerts | merchant_alerts.parquet | Raw alert data |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_transactions | Transactions joined with cardholder, merchant, terminal info |
| silver_fraud_cases | Fraud cases with full transaction and cardholder context |
| silver_terminal_activity | Terminal-level aggregated transaction stats |

**Key relationships**:
- silver_transactions: transaction + cardholder region + merchant name + terminal info
- silver_fraud_cases: fraud case + original transaction + terminal_id + merchant_id

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_daily_fraud_summary | date, region | fraud_count, fraud_amount_usd, transaction_count, fraud_rate |
| gold_fraud_by_terminal | terminal_id, merchant_id, merchant_name | fraud_count, fraud_amount, cards_affected, fraud_rate |
| gold_fraud_by_merchant | merchant_id, merchant_name, mcc | fraud_count, fraud_amount, terminals_affected |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| Fraud rate for compromised terminals | ~15% |
| Fraud amount in spike week | ~$2.4M |
| Normal weekly fraud | ~$600K |
