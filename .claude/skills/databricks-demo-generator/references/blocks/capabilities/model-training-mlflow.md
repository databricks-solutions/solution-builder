---
name: Model Training + MLflow
category: ai-genai-ml
disabled: false
---

# Notebooks + Managed MLflow

**EDA + experiment + lifecycle workbench**: collaborative notebooks plus MLflow tracking, registry and deployment.

## Pain

EDA happens in local notebooks, BI tools, ad-hoc scripts - no consistent lineage or reproducibility. Model experiments tracked in spreadsheets and filenames. Nobody can say which run is in prod or how it was trained.

## Key Features

- **Collaborative notebooks** - real-time co-editing, version control
- **Experiment tracking** - parameters, metrics, artifacts logged automatically
- **Model registry** - staging, production, archived with approvals
- **Lineage** - trace model back to training data and code
- **One-click deployment** - notebook to serving endpoint

## Position

"How do your data scientists actually work?" - import data, EDA in notebook, log runs, compare, register best model, deploy. FSI: stress reproducibility + auditability for risk/churn/fraud models.

## Demo Tips

- **For ML-centric demos** - when the story involves prediction, scoring, or classification
- Great for churn prediction, fraud detection, demand forecasting narratives
- Show the full lifecycle: data → EDA → train → compare experiments → register → deploy
- MLflow experiment tracking is visually impressive - show metrics comparison
- Emphasize **reproducibility**: "we can trace this model back to exact training data"
- Model registry stages (staging → production) show governance
- Can deploy to Model Serving with one click

## When to Include

Include ML/MLflow when the demo involves:
- Prediction (churn, fraud, demand, risk)
- Classification (sentiment, defect detection)
- Time series forecasting
- Any scenario where "the model" is central to the story

## Workflow

```
Data → Notebook (EDA) → Training → MLflow (tracking) → Registry → Serving
```

## URL

https://www.databricks.com/product/managed-mlflow
