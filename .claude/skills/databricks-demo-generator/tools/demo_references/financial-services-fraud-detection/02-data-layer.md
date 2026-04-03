# Data Layer - Financial Services Fraud

## Schema Overview

```
cardholders ←──→ accounts ←──→ transactions ←──→ fraud_cases
                                    │
                                    └──→ merchants
```

## Tables

### cardholders
Customer master data (Simulated: Core Banking via Lakeflow Connect)

| Column | Type | Description |
|--------|------|-------------|
| cardholder_id | STRING | Unique customer ID |
| account_open_date | DATE | When account opened |
| credit_limit | DOUBLE | Credit limit |
| zip_code | STRING | Billing zip |
| customer_segment | STRING | Premium, Standard, Basic |
| risk_tier | STRING | Low, Medium, High |
| tenure_months | INT | Months as customer |

**Distribution:**
- 2.3M cardholders
- Segments: 15% Premium, 60% Standard, 25% Basic
- Risk tiers based on credit score ranges

### accounts
Card account details

| Column | Type | Description |
|--------|------|-------------|
| account_id | STRING | Unique account ID |
| cardholder_id | STRING | FK to cardholders |
| card_number_hash | STRING | Hashed PAN (last 4 visible) |
| card_type | STRING | Credit, Debit |
| status | STRING | Active, Blocked, Closed |
| issue_date | DATE | Card issue date |
| expiry_date | DATE | Card expiry |

### transactions
Transaction records (Simulated: Payment Processor via Lakeflow Connect)

| Column | Type | Description |
|--------|------|-------------|
| transaction_id | STRING | Unique transaction ID |
| account_id | STRING | FK to accounts |
| merchant_id | STRING | FK to merchants |
| transaction_time | TIMESTAMP | When occurred |
| amount | DOUBLE | Transaction amount |
| currency | STRING | USD |
| transaction_type | STRING | Purchase, Refund, Cash Advance |
| channel | STRING | CNP (card-not-present), POS, ATM |
| mcc_code | STRING | Merchant category code |
| auth_response | STRING | Approved, Declined |
| decline_reason | STRING | NULL if approved |
| device_fingerprint | STRING | Device ID for CNP |
| ip_address | STRING | For CNP transactions |
| billing_zip_match | BOOLEAN | AVS check result |

**Distribution:**
- ~15M transactions over 6 months
- 70% POS, 25% CNP, 5% ATM
- Normal fraud rate: 0.08%
- **THE EVENT:** March 10-17: TechDealz transactions 8.5% fraud rate

### merchants
Merchant reference data

| Column | Type | Description |
|--------|------|-------------|
| merchant_id | STRING | Unique merchant ID |
| merchant_name | STRING | Business name |
| mcc_code | STRING | Category code |
| mcc_description | STRING | Category name |
| merchant_type | STRING | Online, Retail, Restaurant, etc. |
| risk_score | DOUBLE | Merchant risk rating |
| country | STRING | Merchant country |

**Key merchant:**
- Merchant ID: M-847291
- Name: TechDealz Online
- MCC: 5732 (Electronics Stores)
- Type: Online
- Risk score: Updated to 9.5 on March 15

### fraud_cases
Confirmed fraud records

| Column | Type | Description |
|--------|------|-------------|
| case_id | STRING | Unique case ID |
| transaction_id | STRING | FK to transactions |
| account_id | STRING | Affected account |
| report_date | DATE | When fraud reported |
| fraud_type | STRING | CNP, Counterfeit, Lost/Stolen, Account Takeover |
| fraud_amount | DOUBLE | Amount lost |
| resolution | STRING | Chargeback, Recovery, Write-off |
| linked_case_id | STRING | Related cases (ring detection) |

**Distribution:**
- Normal: ~0.08% of transactions are fraud
- **THE EVENT:** TechDealz transactions: 8.5% fraud rate
- Fraud types for event: 95% CNP, linked to synthetic identities

## The Event Encoding

The fraud spike is caused by:
1. **Merchant breach** at TechDealz Online (card data stolen)
2. **Synthetic identity ring** using compromised cards
3. **Pattern:** Multiple high-value electronics purchases, same device fingerprints, new shipping addresses
4. **Timing:** 2-3 day lag between breach and fraud (cards sold on dark web)
5. **Rule gap:** Existing rules don't catch cross-merchant patterns

## Key Fraud Pattern

```sql
-- The fraud cluster characteristics
SELECT
  device_fingerprint,
  COUNT(DISTINCT account_id) as cards_used,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount,
  COUNT(DISTINCT merchant_id) as merchants_hit
FROM transactions t
JOIN fraud_cases f ON t.transaction_id = f.transaction_id
WHERE transaction_time >= '2024-03-10'
GROUP BY device_fingerprint
HAVING COUNT(DISTINCT account_id) > 5
-- Result: 12 device fingerprints used across 2,847 cards = fraud ring
```

## Relationships for Tracing

```
High fraud rate (dashboard)
    → Filter by channel = "CNP"
    → Filter by date = March 10-17
    → Group by merchant → TechDealz dominates
    → Check fraud_cases → linked_case_id shows ring
    → Check device_fingerprint → same devices across multiple cards
    → Identify compromised cards still active
```
