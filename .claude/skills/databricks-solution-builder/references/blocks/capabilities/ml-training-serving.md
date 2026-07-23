---
name: ML Training & Serving
category: agent-bricks
disabled: false
buildable: true
skill: databricks-model-serving
---

# ML Training & Serving — MLflow + Unity Catalog

**One capability, full lifecycle**: train with MLflow, register in Unity Catalog, consume the same artifact as cheap batch inference over Delta or (when needed) a real-time REST endpoint. Same model, two consumption patterns.

> Everything technical — Optuna+autolog code, alias mechanics, Spark UDF patterns, serverless job submission, endpoint deployment — lives in the **`databricks-ml-training`** / **`databricks-model-serving`** Databricks Agent Skills (DAS). This block exists to help you *position* the capability in the demo narrative. The build agent reads the skill for *how*.

## Pain

Data scientists train in notebooks, lose track of experiments, ship without versioning or lineage. DevOps then spends weeks wiring real-time infra. Most ML projects never reach production.

## Position

Any predictive-model story — fraud, churn, demand, predictive maintenance.

- **MLflow + UC**: governance for models, same bar as data. "Which version is live? Trained on what? Who approved it?"
- **Batch (default)**: Spark UDF over Delta → gold predictions table → dashboards/Genie/apps read from there. Cheapest, simplest, fits demo timelines.
- **Real-time serving (avoid when possible)**: only when the demo genuinely needs per-request scoring (fraud at authorization, recommendation at page load). Endpoints take ~5–15 min to warm up, eat quota, and add a moving part to explain. **Default to batch.**

## Canonical shape

```
silver_<features>  +  label
        ▼
   notebook (serverless job):
      train → register → @prod → spark_udf score → gold_<entity>_predictions
        ▼
gold_<entity>_predictions   ◄── dashboards, Genie, apps (syc), agents read this
```

One notebook, one artifact. Re-running = retraining. Gold table is the only thing downstream consumers see — read paths never call the model directly.

## Pair with these in the demo

- **Genie Code** — (story only, open the coding assistant and ask it to write the notebook from a plain-English prompt. *"Train XGBoost with Optuna, register to UC, write gold predictions"* etc)
- **Feature Store** — name-drop as the answer to "how do we share features across teams and avoid train/serve skew?" Avoid adding feature store unless really required. Good callout on the feature-engineering cell.
- **SDP** — training data comes from silver/gold tables SDP produces. Batch predictions are *another* gold table SDP-adjacent consumers read.
- **dashboard** — all read the predictions table, never the model directly. Same governance covers the model and the data it learned from.
- **App/Agent** - read from the predictions tables synchronized to lakebase (PG) for fast, realtime access 


## When to use

- Story has a predictive model (fraud, churn, demand, failure)
- Need to show full lifecycle: features → training → governance → consumption
- Governance/compliance matters (regulated industries)
- As the "so what do we do about it?" beat after a data-driven investigation

## When NOT to add a serving endpoint

- Do not add model serving endpoint by default, prefer a lakebase table for realtime access
- Every consumer reads a table (dashboards, Genie, agents-via-Genie, batch jobs)
- Scores can be minutes/hours old without breaking the story
- You don't have time/quota to defend a real-time path on stage

If any of those are true, skip the endpoint and just go with prediction as a batch in the same notebook as the model training

## Demo tips

- Show the **MLflow experiment UI** — trials compared, feature importance, AUC leaderboard. One screen, big payoff.
- Show **UC lineage** for the registered model — same governance surface as a table.
- Connect the model output back to the narrative: *"This is the prediction that flagged customer X"* > *"We built a classifier."*
- If the audience asks "why not SageMaker/Vertex?" — *"Because your features, data, and governance already live here. You don't move data to train; you don't move predictions to consume."*

## Pitfalls

- **Using serving for batch.** Overkill. Spark UDF pattern instead.
- **Over-engineering for a demo.** XGBoost + Optuna on one silver table is enough.
- **Skipping UC lineage in the walkthrough.** It's the most compelling MLflow surface; show it.
- **Hand-writing training code on stage.** Show Genie Code generating it.

## Connections

- **SDP** → produces training features + label; consumes predictions as another gold table.
- **Unity Catalog** → governs the registered model: permissions, lineage, audit.
- **Dashboards / Genie** → read predictions table.
- **Multi-agent supervisor / Knowledge Assistant** → agents call Genie over the predictions table (no direct model call needed for batch shape).
- **Databricks Apps / Lakebase** → predictions can sync to Lakebase for low-latency app reads.

## URLs

- https://docs.databricks.com/aws/en/mlflow/
- https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/ (UC model registry)
- https://docs.databricks.com/aws/en/machine-learning/model-serving/
