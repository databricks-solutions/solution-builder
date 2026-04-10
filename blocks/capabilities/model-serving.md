---
name: Model Serving
slug: model-serving
category: capability
tags: [ml, serving, endpoint, inference, mlflow]
description: >
  Context for generating ML model serving specifications, including model training narratives,
  serving endpoint configuration, feature engineering patterns, and how real-time scoring
  integrates into demo stories as the "proactive prevention" layer.
related: [notebooks, declarative-pipeline, multi-agent-supervisor, synthetic-data-gen]
---

# Model Serving

## What It Does

Databricks Model Serving deploys ML models as real-time REST endpoints. In demos, this represents the shift from "reactive investigation" to "proactive prevention" — scoring transactions, patients, parts, or other entities in real-time against a trained model.

## When to Use in a Demo

- When the demo narrative benefits from a "what if we could have caught this earlier?" moment.
- As an extension to the core dashboard/Genie/KA flow — the model is the "so what do we do about it" answer.
- For demos that need real-time scoring, recommendation, or classification.

## Key Configuration Decisions

1. **Model type:** Binary classification is the most common demo pattern (fraud/not-fraud, readmission/no-readmission, defect/no-defect). Keep it simple — the audience cares about the business outcome, not the algorithm.
2. **Feature engineering:** Define 15-25 features across 4-5 categories (transaction features, velocity features, entity profile features, contextual features). Document each feature's source table.
3. **Training approach:** Use MLflow for experiment tracking and model registry. Algorithm choice: XGBoost/LightGBM for tabular data. Train in a notebook, register to MLflow, deploy to a serving endpoint.
4. **Evaluation metrics:** Pick 3-4 metrics that map to business outcomes (not just AUC). Include at least one business metric like "fraud dollars caught" or "readmissions prevented."
5. **Serving endpoint:** Configure with input/output schema. Latency target should be stated (typically <100ms for real-time scoring).

## Common Pitfalls

- Over-engineering the ML pipeline for a demo — the model does not need to be production-grade. A simple XGBoost with good features tells the story.
- Training on data that does not include "the event" — the model should show it can detect the pattern the demo is about.
- Feature importance that does not align with the narrative — if the demo is about merchant fraud, merchant-related features should rank highly.
- Forgetting to connect the model back to the demo story — always include a narrative beat like "if this model had been running, it would have caught X."
- Deploying a model endpoint without testing the input schema matches what the pipeline produces.

## How It Connects to Other Components

- **Notebooks:** Model is trained and evaluated in a notebook.
- **Declarative pipeline:** Features come from Silver/Gold tables the pipeline produces.
- **Dashboard:** Model performance metrics can be added as a dashboard panel.
- **Multi-agent supervisor:** Optionally, a third agent can call the serving endpoint for on-demand scoring.
- **Synthetic data gen:** Training data must include the event with correct labels.

## Example Specification Snippet

```yaml
model_serving:
  objective: "Score transactions for fraud probability at authorization time"
  model_type: binary_classification
  algorithm: xgboost
  features:
    transaction: [amount, amount_zscore, channel, mcc_code, hour_of_day]
    velocity: [txn_count_1h, txn_amount_1h, txn_count_24h]
    device: [device_seen_before, device_card_count, ip_country_match]
    merchant: [merchant_risk_score, merchant_fraud_rate_7d]
    profile: [account_age_days, avg_monthly_spend, prior_fraud_count]
  evaluation:
    metrics: [auc_roc, precision_at_3pct_fpr, recall, detection_rate]
    business_metric: "Net fraud savings = fraud_prevented - false_positive_costs"
  serving:
    endpoint_name: "fraud-scoring-endpoint"
    latency_target: "<50ms p99"
    output_schema:
      - fraud_score: double  # 0-1 probability
      - risk_tier: string    # High, Medium, Low
      - top_risk_factors: array
      - recommended_action: string  # approve, decline, challenge
  narrative_hook: >
    If this model had been running when TechDealz was breached,
    it would have flagged the device clustering within hours.
```
