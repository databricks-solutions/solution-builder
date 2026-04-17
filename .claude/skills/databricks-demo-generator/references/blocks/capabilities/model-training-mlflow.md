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

Data scientists train models in notebooks, lose track of experiments, can't reproduce results. Models go to production without governance — no versioning, no approval workflow, no drift monitoring. When something breaks, nobody knows which version is running or what data trained it.

## Key Features

- **Experiment tracking** — log parameters, metrics, artifacts, code for every run
- **Model registry** — centralized catalog with versioning, staging, approval workflows
- **Unity Catalog integration** — models governed like tables: permissions, lineage, audit logs
- **Deployment jobs** — automated CI/CD: evaluation, comparison, promotion
- **Drift monitoring** — track performance over time, alert when retraining needed

## Position

ML governance, reproducibility, production ML. "How do you know which model is in production? How do you roll back? How do you prove compliance?" MLflow is the answer.

## How It Works

- **Track experiments**: Every run logs hyperparameters, metrics, artifacts to MLflow
- **Register models**: Promote successful experiments to Registry with version tags
- **Champion/Challenger**: New models start as "Challenger"; validated become "Champion"
- **Governance through UC**: Permissions, lineage, audit logs flow through Unity Catalog
- **Deploy with confidence**: Jobs handle evaluation, approval gates, promotion

## Demo Tips

- Position as "governance layer" for ML — same controls as data, applied to models
- Show experiment comparison UI: "which hyperparameters performed best?"
- Lineage: "this model trained on this exact data version"
- Compliance-heavy industries: emphasize audit trail and approval workflows
- Connect to serving: "once approved, deploys automatically"

## When to Use

- Story involves predictive models (fraud scoring, churn, demand forecasting)
- Governance/compliance matters to the customer
- Showing full ML lifecycle (not just inference)
- Bridge between data science exploration and production deployment

## Pitfalls

- Over-engineering for a demo — simple XGBoost with MLflow tracking tells the governance story
- Forgetting registry UI — visual model lineage is compelling
- Not connecting to business story — "this model would have caught the fraud earlier"

## Connections

- **Notebooks**: Training happens in notebooks, MLflow tracks experiments
- **SDP**: Training data from Silver/Gold tables the pipeline produces
- **Model Serving**: Registered models deploy to serving endpoints for real-time inference
- **Dashboard**: Model performance metrics visualized
- **Unity Catalog**: Models are governed assets with permissions and lineage

## URL

https://docs.databricks.com/aws/en/mlflow/
