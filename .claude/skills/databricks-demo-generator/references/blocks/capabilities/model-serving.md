---
name: Model Serving
category: agent-bricks
disabled: false
buildable: false
skill: databricks-model-serving
---

# Model Serving — Real-Time Inference

**Serverless endpoints** for real-time model inference. Deploy registered models as REST APIs with auto-scaling, low latency, and built-in monitoring.

## Pain

ML models sit in notebooks but never reach production. When they do, DevOps spends weeks building infrastructure. Scaling is manual, monitoring is absent, and updating a model means downtime. Real-time scoring at scale requires specialized infrastructure that most teams don't have.

## Key Features

- **Serverless deployment** — No infrastructure to manage, scales to zero when idle
- **Low latency** — Sub-100ms response times for real-time scoring
- **Zero-downtime updates** — Swap model versions without service interruption
- **Auto-scaling** — Handles traffic spikes automatically
- **Built-in monitoring** — Request logs, latency metrics, error tracking

## Position

When the demo needs real-time scoring — fraud detection at authorization, recommendations at page load, risk assessment at application submit. "The model doesn't just analyze historical data, it scores every transaction in real time."

## How It Works

- **Deploy from registry**: Point to an MLflow model version, specify compute size
- **REST API**: Endpoint receives JSON, returns predictions in milliseconds
- **Champion/Challenger**: Route traffic between model versions for A/B testing
- **Guardrails**: Input validation, rate limiting, output filtering
- **Monitoring**: Every request logged for debugging and drift detection

## Demo Tips

- Focus on the business outcome: "every transaction scored before authorization"
- Show the latency: "<50ms to decide if this is fraud"
- Connect to the narrative: "if this endpoint had been running, it would have blocked the fraudulent transactions"
- Don't over-engineer — a simple binary classifier tells the story

## When to Use in a Demo

- When real-time decisions matter (fraud, recommendations, risk scoring)
- As the "so what do we do about it?" answer after investigation
- When showing the full pipeline from data to action
- **Note**: For batch scoring, you don't need Model Serving — just run inference in a notebook or pipeline

## Common Pitfalls

- Using Model Serving for batch inference (overkill — use notebooks/pipelines instead)
- Forgetting to test that endpoint input schema matches pipeline output
- Over-engineering the model for a demo — simple XGBoost is fine
- Not connecting the endpoint back to the demo story

## How It Connects to Other Components

- **MLflow**: Models come from the registry with governance and lineage
- **SDP**: Features for inference come from Gold tables
- **Multi-agent supervisor**: Agents can call serving endpoints for on-demand scoring
- **Synthetic data**: Test data must include realistic inputs for the endpoint
- **Dashboard**: Model performance metrics can be visualized

## Example Specification Snippet

```yaml
model_serving:
  objective: "Score transactions for fraud probability at authorization time"
  source: "models:/fraud-classifier/Champion"
  latency_target: "<50ms p99"
  input_schema:
    - amount: double
    - merchant_risk_score: double
    - device_seen_before: boolean
    - velocity_1h: integer
  output_schema:
    - fraud_score: double       # 0-1 probability
    - risk_tier: string         # High, Medium, Low
    - recommended_action: string # approve, decline, challenge
  narrative_hook: >
    Every transaction scored in real-time. The compromised merchant
    would have been flagged within hours, not weeks.
```

## URL

https://docs.databricks.com/aws/en/machine-learning/model-serving/
