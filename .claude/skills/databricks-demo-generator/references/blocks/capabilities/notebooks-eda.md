---
name: Notebooks & EDA
category: ai-bi
disabled: false
---

# Notebooks

## What It Does

Databricks notebooks provide interactive, cell-by-cell execution environments for Python, SQL, Scala, and R. In demos, notebooks serve three roles: ML model training and evaluation, ad-hoc data exploration and validation, and data generation scripting.

## When to Use in a Demo

- **ML training:** When the demo includes a model serving endpoint, a notebook trains and evaluates the model. This is the most common demo notebook.
- **Data exploration:** When the audience includes data scientists who want to see hands-on analysis beyond dashboards.
- **Data generation:** The synthetic data generation script typically runs as a notebook.
- **Validation:** A notebook can verify pipeline outputs, data quality, and end-to-end correctness.

## Key Configuration Decisions

1. **Notebook structure:** Use a clear section flow with markdown headers. ML notebooks: Data Prep → EDA → Feature Engineering → Training → Evaluation → Deployment. Exploration notebooks: Context → Questions → Analysis → Findings.
2. **Narrative thread:** Every notebook should tell a story. Use markdown cells between code cells to explain what is happening and why. The audience reads the notebook like a document.
3. **Compute:** Serverless compute for SQL and lightweight Python. ML Runtime clusters for training (GPU if deep learning). Specify the compute requirement in the spec.
4. **MLflow integration:** For ML notebooks, log experiments, parameters, metrics, and artifacts to MLflow. Register the final model to the MLflow Model Registry.
5. **Cell output design:** Key cells should produce visualizations or formatted tables — not raw DataFrames. Use `display()`, matplotlib, or plotly for visual outputs.

## Common Pitfalls

- Wall-of-code notebooks with no markdown explanation — the audience loses the thread. Alternate between explanation and code.
- Notebooks that take too long to run during a demo — pre-run cells and use cached results for training steps that take minutes.
- ML notebooks that do not connect back to the demo story — always include a "so what" section that ties model results to the business problem.
- Using `print()` instead of `display()` for DataFrames — `display()` renders interactive tables in Databricks.
- Forgetting to specify the cluster/compute requirements — a notebook that needs ML Runtime will fail on a SQL warehouse.

## How It Connects to Other Components

- **Model serving:** The notebook trains the model and registers it; model serving deploys it.
- **Declarative pipeline:** Notebooks can read from pipeline Gold tables for analysis and model training.
- **Synthetic data gen:** Data generation often runs as a notebook before the pipeline.
- **Dashboard:** Notebook analysis findings can motivate additional dashboard panels.

## Example Specification Snippet

```yaml
notebook:
  name: "Real-Time Fraud Detection Model"
  language: python
  compute: ml_runtime_14.3_gpu
  sections:
    - title: "Data Preparation"
      description: "Load 6 months of historical transactions with fraud labels"
      reads_from: [silver_transactions_enriched, gold_device_analysis]
    - title: "Exploratory Analysis"
      description: "Fraud patterns by channel, merchant, time — TechDealz case study"
      outputs: [fraud_rate_trend_chart, channel_breakdown, merchant_concentration]
    - title: "Feature Engineering"
      description: "Build 25 features across transaction, velocity, device, merchant, profile"
    - title: "Model Training"
      description: "XGBoost with hyperparameter tuning, class imbalance handling"
      mlflow: { experiment: "fraud-detection", log: [params, metrics, model] }
    - title: "Evaluation"
      description: "AUC, precision-recall, business metric simulation"
      key_metrics: { auc_roc: ">0.95", recall: ">80%", detection_rate: ">70%" }
    - title: "Feature Importance"
      description: "SHAP values — device_card_count and merchant_fraud_rate dominate"
    - title: "Deployment"
      description: "Register model, configure serving endpoint"
      registers_to: "mlflow_model_registry"
  narrative_hook: >
    "The model detected the TechDealz pattern within hours because device
    clustering immediately flagged FP-8821 using 50+ cards."
```

## URL

https://www.databricks.com/product/collaborative-notebooks
