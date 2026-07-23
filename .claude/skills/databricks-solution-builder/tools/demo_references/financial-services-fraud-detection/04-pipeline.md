# Pipeline - Financial Services Fraud

## Architecture

```
Bronze (raw) → Silver (enriched) → Gold (aggregated + features)
```

## Bronze Layer

### bronze_transactions
- Source: Payment Processor (simulated Lakeflow Connect)
- Real-time streaming + batch historical
- Schema: As-is from authorization system

### bronze_fraud_cases
- Source: Fraud Case Management System
- Schema: As-is, includes chargeback data

### bronze_merchants
- Source: Merchant Master (Visa/MC networks)
- Schema: As-is

### bronze_cardholders
- Source: Core Banking (simulated Lakeflow Connect)
- Schema: As-is

### bronze_accounts
- Source: Card Management System
- Schema: As-is

## Silver Layer

### silver_transactions_enriched
Transactions with full context.

```sql
SELECT
  t.transaction_id,
  t.account_id,
  t.merchant_id,
  t.transaction_time,
  t.amount,
  t.channel,
  t.mcc_code,
  t.device_fingerprint,
  t.ip_address,
  m.merchant_name,
  m.merchant_type,
  m.risk_score as merchant_risk,
  c.customer_segment,
  c.risk_tier as customer_risk,
  a.credit_limit,
  -- Fraud flag
  CASE WHEN f.case_id IS NOT NULL THEN 1 ELSE 0 END as is_fraud
FROM bronze_transactions t
JOIN bronze_merchants m ON t.merchant_id = m.merchant_id
JOIN bronze_accounts a ON t.account_id = a.account_id
JOIN bronze_cardholders c ON a.cardholder_id = c.cardholder_id
LEFT JOIN bronze_fraud_cases f ON t.transaction_id = f.transaction_id
```

### silver_fraud_enriched
Fraud cases with full transaction context.

```sql
SELECT
  f.*,
  t.amount,
  t.channel,
  t.merchant_id,
  t.device_fingerprint,
  m.merchant_name,
  m.mcc_code
FROM bronze_fraud_cases f
JOIN silver_transactions_enriched t ON f.transaction_id = t.transaction_id
JOIN bronze_merchants m ON t.merchant_id = m.merchant_id
```

### silver_velocity_features
Real-time velocity calculations per card.

```sql
SELECT
  account_id,
  transaction_time,
  -- 1-hour velocity
  COUNT(*) OVER (
    PARTITION BY account_id
    ORDER BY transaction_time
    RANGE BETWEEN INTERVAL 1 HOUR PRECEDING AND CURRENT ROW
  ) as txn_count_1h,
  SUM(amount) OVER (
    PARTITION BY account_id
    ORDER BY transaction_time
    RANGE BETWEEN INTERVAL 1 HOUR PRECEDING AND CURRENT ROW
  ) as txn_amount_1h,
  -- 24-hour velocity
  COUNT(*) OVER (...) as txn_count_24h,
  SUM(amount) OVER (...) as txn_amount_24h
FROM bronze_transactions
```

## Gold Layer

### gold_daily_fraud_metrics
Daily fraud KPIs.

```sql
SELECT
  DATE(transaction_time) as txn_date,
  channel,
  mcc_code,
  merchant_id,
  COUNT(*) as total_transactions,
  SUM(amount) as total_volume,
  SUM(is_fraud) as fraud_count,
  SUM(CASE WHEN is_fraud = 1 THEN amount ELSE 0 END) as fraud_amount,
  SUM(is_fraud) / COUNT(*) as fraud_rate
FROM silver_transactions_enriched
GROUP BY DATE(transaction_time), channel, mcc_code, merchant_id
```

### gold_merchant_fraud_analysis
Fraud by merchant for investigation.

```sql
SELECT
  merchant_id,
  merchant_name,
  mcc_code,
  txn_date,
  total_transactions,
  fraud_count,
  fraud_rate,
  fraud_amount,
  -- Anomaly flag
  CASE
    WHEN fraud_rate > 0.02 THEN 'CRITICAL'
    WHEN fraud_rate > 0.005 THEN 'WARNING'
    ELSE 'NORMAL'
  END as alert_level
FROM gold_daily_fraud_metrics
```

### gold_device_analysis
Fraud ring detection by device fingerprint.

```sql
SELECT
  device_fingerprint,
  COUNT(DISTINCT account_id) as unique_cards,
  COUNT(*) as transactions,
  SUM(amount) as total_amount,
  SUM(is_fraud) as fraud_count,
  ARRAY_AGG(DISTINCT merchant_id) as merchants_hit,
  MIN(transaction_time) as first_seen,
  MAX(transaction_time) as last_seen
FROM silver_transactions_enriched
WHERE device_fingerprint IS NOT NULL
GROUP BY device_fingerprint
HAVING COUNT(DISTINCT account_id) > 3  -- Suspicious: same device, multiple cards
```

### gold_compromised_cards
Cards with TechDealz exposure for reissue list.

```sql
SELECT
  a.account_id,
  a.card_number_hash,
  c.cardholder_id,
  MIN(t.transaction_time) as first_techdealz_txn,
  MAX(t.transaction_time) as last_techdealz_txn,
  COUNT(*) as techdealz_txn_count,
  SUM(t.is_fraud) as fraud_count,
  a.status as current_status,
  CASE
    WHEN SUM(t.is_fraud) > 0 THEN 'CONFIRMED_COMPROMISED'
    ELSE 'POTENTIALLY_COMPROMISED'
  END as risk_status
FROM bronze_accounts a
JOIN silver_transactions_enriched t ON a.account_id = t.account_id
JOIN bronze_cardholders c ON a.cardholder_id = c.cardholder_id
WHERE t.merchant_id = 'M-847291'  -- TechDealz
  AND t.transaction_time >= '2024-03-01'
GROUP BY a.account_id, a.card_number_hash, c.cardholder_id, a.status
```

## Data Quality Checks

- [ ] All transactions have valid merchant references
- [ ] Fraud cases link to existing transactions
- [ ] No duplicate transaction IDs
- [ ] Timestamps are within expected ranges
- [ ] Amount values are positive for purchases
