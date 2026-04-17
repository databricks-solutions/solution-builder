---
name: Model Serving
category: agent-bricks
disabled: false
buildable: false
skill: databricks-model-serving
---

# Model Serving — Real-Time Inference

Serverless endpoints for real-time model inference. Deploy registered models as REST APIs with auto-scaling, low latency, and built-in monitoring.

## Pain

ML models sit in notebooks but never reach production. When they do, DevOps spends weeks on infrastructure. Scaling is manual, monitoring absent, updates mean downtime. Real-time scoring at scale requires specialized infrastructure most teams lack.

## Key Features

- **Serverless deployment** — No infrastructure, scales to zero when idle
- **Low latency** — Sub-100ms for real-time scoring
- **Zero-downtime updates** — Swap model versions without interruption
- **Auto-scaling** — Handles traffic spikes automatically
- **Built-in monitoring** — Request logs, latency metrics, error tracking

## Position

When the demo needs real-time scoring — fraud at authorization, recommendations at page load, risk at application submit. "The model doesn't just analyze historical data, it scores every transaction in real time."

## How It Works

- **Deploy from registry**: Point to MLflow model version, specify compute size
- **REST API**: JSON in, predictions out in milliseconds
- **Champion/Challenger**: Route traffic between versions for A/B testing
- **Guardrails**: Input validation, rate limiting, output filtering
- **Monitoring**: Every request logged for debugging and drift detection

## Demo Tips

- Focus on business outcome: "every transaction scored before authorization"
- Show latency: "<50ms to decide if this is fraud"
- Connect to narrative: "if this endpoint had been running, it would have blocked the fraudulent transactions"
- Don't over-engineer — a simple binary classifier tells the story

## When to Use

- When real-time decisions matter (fraud, recommendations, risk scoring)
- As the "so what do we do about it?" answer after investigation
- When showing full pipeline from data to action
- **Note**: For batch scoring, skip Model Serving — use notebooks/pipelines instead

## Pitfalls

- Using Model Serving for batch inference (overkill — use notebooks/pipelines)
- Forgetting to test endpoint input schema matches pipeline output
- Over-engineering the model for a demo — simple XGBoost is fine
- Not connecting the endpoint back to the demo story

## Connections

- **MLflow**: Models come from registry with governance and lineage
- **SDP**: Features for inference come from Gold tables
- **Multi-agent supervisor**: Agents can call serving endpoints for on-demand scoring
- **Synthetic data**: Test data must include realistic endpoint inputs
- **Dashboard**: Model performance metrics can be visualized

## URL

https://docs.databricks.com/aws/en/machine-learning/model-serving/
