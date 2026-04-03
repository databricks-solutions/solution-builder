# ML Notebook - Real-Time Fraud Detection

## Purpose

Build a machine learning model that scores transactions in real-time for fraud probability. This extends the demo from "reactive investigation" to "proactive prevention."

## Model Overview

**Objective:** Score each transaction at authorization time for fraud probability.

**Type:** Binary classification (is_fraud: yes/no) with probability output

**Value Proposition:** "Instead of investigating fraud after chargebacks, we catch it at the moment of authorization - blocking fraudulent transactions before they cost us money."

## Feature Engineering

### Transaction Features

| Feature | Description | Source |
|---------|-------------|--------|
| amount | Transaction amount | transactions |
| amount_zscore | Amount vs cardholder average | calculated |
| channel | CNP, POS, ATM | transactions |
| mcc_code | Merchant category | transactions |
| hour_of_day | Transaction hour | transactions |
| day_of_week | Transaction day | transactions |
| is_weekend | Weekend flag | calculated |

### Velocity Features (Real-Time)

| Feature | Description | Window |
|---------|-------------|--------|
| txn_count_1h | Transactions in last hour | 1 hour |
| txn_amount_1h | Amount in last hour | 1 hour |
| txn_count_24h | Transactions in last 24h | 24 hours |
| txn_amount_24h | Amount in last 24h | 24 hours |
| unique_merchants_24h | Distinct merchants | 24 hours |
| max_amount_24h | Largest transaction | 24 hours |

### Device/Location Features

| Feature | Description | Source |
|---------|-------------|--------|
| device_seen_before | Has cardholder used device | calculated |
| device_card_count | Cards using this device | gold_device_analysis |
| ip_country_match | IP country matches card country | transactions |
| billing_zip_match | AVS check result | transactions |
| distance_from_last_txn | Miles from previous transaction | calculated |

### Merchant Risk Features

| Feature | Description | Source |
|---------|-------------|--------|
| merchant_risk_score | Merchant risk rating | merchants |
| merchant_fraud_rate_7d | Merchant's recent fraud rate | calculated |
| mcc_fraud_rate | Category fraud rate | calculated |
| is_high_risk_mcc | Electronics, travel, etc. | calculated |

### Cardholder Profile Features

| Feature | Description | Source |
|---------|-------------|--------|
| account_age_days | Days since card issued | accounts |
| customer_tenure_months | Total relationship length | cardholders |
| avg_monthly_spend | Typical spending pattern | calculated |
| credit_utilization | Current vs limit | calculated |
| prior_fraud_count | Historical fraud on card | fraud_cases |

## Model Training

### Algorithm
- Primary: Gradient Boosted Trees (XGBoost/LightGBM)
- Real-time inference requires <50ms latency
- Consider: Neural network for complex patterns

### Training Data
- Historical data: 6+ months
- Sampling: Balance fraud (0.08%) vs legitimate
- Train/validation/test: 70/15/15 by time

### Class Imbalance
- Fraud is rare (~0.08%)
- Use: SMOTE, focal loss, or threshold optimization
- Optimize for business metrics, not just accuracy

## Model Evaluation

### Metrics
| Metric | Target | Business Rationale |
|--------|--------|-------------------|
| AUC-ROC | >0.95 | Strong discrimination |
| Precision at 3% FPR | >50% | Acceptable decline rate |
| Recall | >80% | Catch most fraud |
| Detection Rate | >70% | Of fraud $ caught |

### Business Metrics
- **Fraud Detection Rate:** % of fraud $ caught before clearing
- **False Positive Rate:** % of legitimate transactions declined
- **Customer Friction Score:** Declines × customer value
- **Net Fraud Savings:** Fraud prevented - false positive costs

### Threshold Optimization
```
Decline if score > threshold

Trade-off:
- Higher threshold → More fraud, less friction
- Lower threshold → Less fraud, more friction

Optimize for:
net_value = fraud_saved - (false_positives × friction_cost)
```

## Feature Importance

Expected top features:
1. device_card_count (same device, multiple cards = ring)
2. merchant_fraud_rate_7d (compromised merchant)
3. txn_count_1h (velocity)
4. amount_zscore (unusual amount)
5. device_seen_before (new device)
6. billing_zip_match (AVS failure)

## Real-Time Scoring Architecture

```
Transaction Request (authorization)
            │
            ▼
    ┌───────────────┐
    │ Feature Store │ ← Pre-computed cardholder features
    └───────────────┘
            │
            ▼
    ┌───────────────┐
    │  ML Model     │ ← <50ms latency
    │  (Serving)    │
    └───────────────┘
            │
            ▼
    ┌───────────────┐
    │ Decision      │ → Approve / Decline / Challenge
    │ Engine        │
    └───────────────┘
```

### Feature Store Requirements
- Real-time velocity features (streaming)
- Near-real-time merchant risk (hourly refresh)
- Batch cardholder profiles (daily refresh)

## Model Deployment

### Serving
- Model Registry: MLflow
- Serving: Databricks Model Serving (real-time endpoint)
- Latency requirement: <50ms p99

### Integration Points
- Authorization gateway: Score at auth time
- Case management: Feed scores for investigation priority
- Rules engine: ML score as input to hybrid decisioning

### Output Schema

| Field | Type | Description |
|-------|------|-------------|
| transaction_id | STRING | Transaction identifier |
| fraud_score | DOUBLE | Probability 0-1 |
| risk_tier | STRING | High (>0.7), Medium (0.3-0.7), Low (<0.3) |
| top_risk_factors | ARRAY | Contributing features |
| recommended_action | STRING | approve, decline, challenge |

## Demo Integration

### Dashboard Addition
Add real-time scoring panel:
- Score distribution for recent transactions
- Model performance (detection rate vs false positives)
- Top triggered risk factors this hour

### Demo Narrative Extension
"This model runs on every transaction - 2.3 million cards, millions of authorizations per day. When the TechDealz breach happened, the model detected the pattern within hours because the device clustering feature immediately flagged FP-8821 using 50+ cards. We could have blocked those transactions automatically."

## Notebook Structure

1. **Data Preparation**
   - Load historical transactions and fraud labels
   - Feature engineering
   - Train/test split

2. **Exploratory Analysis**
   - Fraud patterns by channel, merchant, time
   - Feature distributions
   - TechDealz case study

3. **Model Training**
   - Baseline model
   - Hyperparameter tuning
   - Cross-validation

4. **Evaluation**
   - ROC/AUC
   - Precision-recall tradeoffs
   - Business metric simulation

5. **Feature Importance**
   - SHAP values
   - Device clustering insight
   - Merchant risk contribution

6. **Deployment**
   - Register model
   - Configure serving endpoint
   - Integration testing

7. **Monitoring**
   - Score distribution drift
   - Performance degradation alerts
   - Retraining triggers
