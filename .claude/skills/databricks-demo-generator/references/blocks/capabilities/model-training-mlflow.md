---
name: MLflow
category: genai-ml
disabled: false
---

# ML / MLflow — Training, Registry & Serving

**End-to-end ML lifecycle**: collaborative notebooks, MLflow experiment tracking, model registry, and serverless model serving endpoints.

## Pain

EDA happens in local notebooks with no lineage or reproducibility. Experiments tracked in spreadsheets. Nobody can say which run is in prod or how it was trained. Deploying means GPU procurement, infra ops, scaling headaches, and no cost visibility.

## Key Features

- **Collaborative notebooks** - real-time co-editing, version control
- **Experiment tracking** - parameters, metrics, artifacts logged automatically
- **Model registry** - staging, production, archived with approvals
- **Lineage** - trace model back to training data and code
- **Serverless serving** - instant startup, auto-scaling, pay-per-token, no GPU management
- **Any model** - foundation models, fine-tuned, custom agents via AI Gateway
- **Guardrails** - input/output filtering, PII detection
- **Tracing** - full observability of every call

## Position

"How do your data scientists actually work?" - import data, EDA in notebook, log runs, compare, register best model, deploy to a serverless endpoint. Host any model with one click, pay only for what you use. FSI: stress reproducibility + auditability for risk/churn/fraud models.

## Demo Tips

- **For ML-centric demos** - when the story involves prediction, scoring, or classification
- Great for churn prediction, fraud detection, demand forecasting narratives
- Show the full lifecycle: data → EDA → train → compare experiments → register → deploy
- MLflow experiment tracking is visually impressive - show metrics comparison
- Emphasize **reproducibility**: "we can trace this model back to exact training data"
- Model registry stages (staging → production) show governance
- Serverless serving: key differentiator is pay-per-token with no GPU management

## When to Include

Include ML/MLflow when the demo involves:
- Prediction (churn, fraud, demand, risk)
- Classification (sentiment, defect detection)
- Time series forecasting
- Any scenario where "the model" is central to the story

## Workflow

```
Data → Notebook (EDA) → Training → MLflow (tracking) → Registry → Serving Endpoint
```

## URL

https://www.databricks.com/product/managed-mlflow
