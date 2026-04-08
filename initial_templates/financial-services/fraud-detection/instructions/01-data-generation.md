# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

Use dynamic dates relative to NOW:

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| SKIMMING_START_DATE | NOW - 4 weeks | When skimming devices installed |
| Fraud spike week | NOW - 2 to 3 weeks | When fraud peaks |

---

## Output Location

Upload to the **raw_data** volume.

**Files to Generate**:
```
{raw_data_volume}/
├── cardholders.parquet        (~200,000 rows)
├── merchants.parquet          (~5,000 rows)
├── terminals.parquet          (~15,000 rows)
├── transactions.parquet       (~2,000,000 rows)
├── fraud_cases.parquet        (~25,000 rows)
└── merchant_alerts.parquet    (~500 rows)
```

---

## Table Schemas

### 1. cardholders (~200,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| cardholder_id | STRING | Primary key (format: CH-NNNNNN) |
| card_number_hash | STRING | Hashed card number |
| first_name | STRING | |
| last_name | STRING | |
| region | STRING | "Northeast", "Southeast", "Midwest", "West" |
| account_open_date | DATE | |
| card_type | STRING | "credit", "debit" |
| credit_limit | DECIMAL(10,2) | For credit cards |

**Distribution**:
- Region: Northeast ~30%, Southeast ~25%, Midwest ~25%, West ~20%
- Card type: credit ~60%, debit ~40%

---

### 2. merchants (~5,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| merchant_id | STRING | Primary key (format: MER-NNNN) |
| merchant_name | STRING | Business name |
| mcc | STRING | Merchant Category Code |
| mcc_description | STRING | Category name |
| region | STRING | Geographic region |
| risk_score | INT | 1-10 risk rating |

**The affected merchant** (QuickMart - convenience stores):
- Merchant ID: MER-5411-QM
- MCC: 5411 (Grocery Stores, Convenience Stores)
- 12 locations across Northeast region
- Normal risk_score: 3

---

### 3. terminals (~15,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| terminal_id | STRING | Primary key (format: TRM-XXX-NNNN) |
| merchant_id | STRING | FK to merchants |
| terminal_type | STRING | "POS", "ATM", "Online" |
| install_date | DATE | |
| last_maintenance | DATE | |
| firmware_version | STRING | |

**The 3 compromised terminals**:
- TRM-QM-0847, TRM-QM-0848, TRM-QM-0849
- All at QuickMart locations
- Installed 6+ months ago

---

### 4. transactions (~2,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| transaction_id | STRING | Primary key (format: TXN-YYYYMMDD-NNNNNNNN) |
| cardholder_id | STRING | FK to cardholders |
| merchant_id | STRING | FK to merchants |
| terminal_id | STRING | FK to terminals |
| transaction_date | DATE | |
| transaction_timestamp | TIMESTAMP | |
| amount_usd | DECIMAL(10,2) | |
| auth_code | STRING | Authorization code |
| response_code | STRING | "approved", "declined" |
| channel | STRING | "chip", "swipe", "contactless", "online" |

**Transaction patterns**:
- ~38,000 transactions/week baseline
- Compromised terminal transactions: ~1,200/week for 4 weeks
- Skimmed cards start appearing in fraud 7-14 days after terminal use

---

### 5. fraud_cases (~25,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| fraud_case_id | STRING | Primary key (format: FRD-NNNNNNNN) |
| transaction_id | STRING | FK to transactions |
| cardholder_id | STRING | FK to cardholders |
| fraud_date | DATE | When fraud detected |
| fraud_amount_usd | DECIMAL(10,2) | Amount lost |
| fraud_type | STRING | "card_present", "card_not_present", "account_takeover" |
| detection_method | STRING | "customer_report", "model_alert", "rule_trigger" |

**Normal fraud distribution**: card_present ~30%, CNP ~55%, ATO ~15%

**Affected card fraud** (the spike):
- ~2,100 fraud cases from 847 compromised cards
- All card_present fraud (cloned cards used at other merchants)
- Fraud dates: SKIMMING_START + 10 days to NOW
- Peak week: ~$2.4M vs ~$600K baseline
- fraud_type: "card_present"
- Geographic pattern: fraud occurs across multiple regions (cards cloned and distributed)

---

### 6. merchant_alerts (~500 rows)

| Column | Type | Description |
|--------|------|-------------|
| alert_id | STRING | Primary key (format: ALT-NNNNNN) |
| merchant_id | STRING | FK to merchants |
| terminal_id | STRING | FK to terminals (nullable) |
| alert_date | DATE | |
| alert_type | STRING | "compliance", "security", "operational" |
| severity | STRING | "low", "medium", "high", "critical" |
| description | STRING | Alert details |
| status | STRING | "open", "investigating", "resolved" |

**Key alert for affected terminals**:
- Alert for MER-5411-QM terminals
- alert_type: "security"
- severity: "high"
- description: "POS terminal physical inspection flagged - potential tampering"

---

## Validation

After generating and uploading the data, verify:

| What to Check | Expected |
|---------------|----------|
| Transactions at compromised terminals | ~4,800 (4 weeks × 1,200/week) |
| Unique cards used at compromised terminals | 847 cards |
| Fraud cases from compromised cards | ~2,100 |
| Fraud rate on compromised cards | ~15% vs 0.3% normal |
| Fraud $ in spike week | ~$2.4M vs ~$600K baseline |
