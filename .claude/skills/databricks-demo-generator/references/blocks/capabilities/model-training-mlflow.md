---
name: ML + MLflow
category: agent-bricks
disabled: false
buildable: true
skill: databricks-model-serving
---

# MLflow — Model Training & Lifecycle

**Unified platform** for experiment tracking, model registry, and ML lifecycle management. The governance backbone for productionizing ML.

## Pain

Data scientists train models in notebooks, lose track of experiments, can't reproduce results. Models go to production without governance — no versioning, no approval workflow, no drift monitoring. When something breaks, nobody knows which model version is running or what data trained it.

## Key Features

- **Experiment tracking** — Log parameters, metrics, artifacts, and code for every training run
- **Model registry** — Centralized catalog with versioning, staging, and approval workflows
- **Unity Catalog integration** — Models governed like tables: permissions, lineage, audit logs
- **Deployment jobs** — Automated CI/CD for models: evaluation, comparison, promotion
- **Drift monitoring** — Track model performance over time, alert when retraining needed

## Position

Any conversation about ML governance, reproducibility, or production ML. "How do you know which model is in production? How do you roll back? How do you prove compliance?" MLflow is the answer.

## How It Works

- **Track experiments**: Every training run logs hyperparameters, metrics, and artifacts to MLflow
- **Register models**: Promote successful experiments to the Model Registry with version tags
- **Champion/Challenger**: New models start as "Challenger"; validated models become "Champion"
- **Governance through UC**: Model permissions, lineage, and audit logs flow through Unity Catalog
- **Deploy with confidence**: Deployment jobs handle evaluation, approval gates, and promotion

## Demo Tips

- Position as the "governance layer" for ML — same controls as data, applied to models
- Show the experiment comparison UI: "which hyperparameters performed best?"
- Highlight lineage: "this model was trained on this exact data version"
- For compliance-heavy industries: emphasize audit trail and approval workflows
- Connect to model serving: "once approved, the model deploys automatically"

## When to Use in a Demo

- When the story involves predictive models (fraud scoring, churn prediction, demand forecasting)
- When governance/compliance is important to the customer
- When showing the full ML lifecycle (not just inference)
- As the bridge between data science exploration and production deployment

## Common Pitfalls

- Over-engineering for a demo — a simple XGBoost with MLflow tracking tells the governance story
- Forgetting to show the registry UI — the visual model lineage is compelling
- Not connecting to the business story — "this model would have caught the fraud earlier"

## How It Connects to Other Components

- **Notebooks**: Training happens in notebooks, MLflow tracks the experiments
- **SDP**: Training data comes from Silver/Gold tables the pipeline produces
- **Model Serving**: Registered models deploy to serving endpoints for real-time inference
- **Dashboard**: Model performance metrics can be visualized
- **Unity Catalog**: Models are governed assets with permissions and lineage

## URL

https://docs.databricks.com/aws/en/mlflow/
