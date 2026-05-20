---
name: ML Training & Serving
category: agent-bricks
disabled: false
buildable: true
skill: databricks-model-serving
---

# ML Training & Serving — MLflow + Unity Catalog + Model Serving

**One capability, full lifecycle**: train the model with MLflow tracking, register it in Unity Catalog with governance, and consume it either as cheap batch inference over Delta or as a real-time REST endpoint. Same model artifact, two consumption patterns.

## Pain

Data scientists train models in notebooks and lose track of experiments, can't reproduce results, and ship to production without versioning, approvals, or lineage. DevOps then spends weeks wiring up real-time infrastructure — scaling, monitoring, zero-downtime upgrades. Most ML projects never reach production.

## Key Features

**MLflow + Unity Catalog**
- **Experiment tracking** — params, metrics, artifacts, code for every run
- **UC model registry** — versioned, governed, lineage-aware; permissions/audit flow through UC
- **Aliases** (`@prod`, `@challenger`) — promote without rebuilding; repoint in one call
- **Champion/Challenger** — validate new versions side-by-side before promoting
- **Deployment jobs** — automated evaluation, approval gates, promotion

**Model Serving**
Avoid when possible as starting a model serving endpoint is slow and uses quota.
- **Serverless real-time endpoints** — REST API, sub-100ms scoring, scale-to-zero
- **Zero-downtime version swaps** — repoint `@prod` alias, endpoint follows
- **Built-in monitoring** — request logs, latency, error tracking
- **Guardrails** — input validation, rate limiting, output filtering

## Position

Any predictive-model story — fraud, churn, demand, predictive maintenance.
- MLflow is **how you know what's in production and prove compliance**: "which version? Trained on which data? Who approved it?"
- Model Serving is the answer when you need **real-time scoring** — fraud at authorization, recommendations at page load, equipment health in an ops app.
- For **batch** (dashboards, daily scores, precomputed predictions), skip serving — load the same registered model as a Spark UDF and score directly over Delta. Cheaper, simpler, faster to run.

## Pair with these in the demo

- **Genie Code** — before you show any training code, open the coding assistant and show it writing the pipeline from a plain-English prompt. "Train XGBoost with Optuna tuning, register to UC, write gold" generates an entire notebook because the assistant sees your catalog schema. The pitch: non-ML teams ship ML; the data scientist becomes the reviewer, not the author.
- **Feature Store** — mention it (don't necessarily build it) as the answer to "how do we share these features across teams and avoid train/serve skew?" Same feature definitions serve training and the real-time endpoint. Point-in-time correct joins built in. Good demo callout on the feature-engineering cell.

## How It Works

1. **Train** — run XGBoost / LightGBM / sklearn / PyTorch with `mlflow.autolog()`. Each trial's hyperparams, metrics, artifacts, and code land in the experiment.
2. **Register** — `mlflow.register_model(runs:/.../model, "{catalog}.{schema}.my_model")` pushes the best run into UC. Version is auto-incremented.
3. **Promote** — `client.set_registered_model_alias(name, "prod", version)`. The `@prod` alias is a movable label; rollbacks are one call away.
4. **Consume (pick one or both)**:
   - **Batch**: `mlflow.pyfunc.spark_udf(spark, model_uri="models:/{name}@prod")` → score a Delta table → `MERGE` into a predictions table. Dashboards and Genie read from there.
   - **Serving**: `deploy_client.create_endpoint(...)` with the model version. App hits `POST /serving-endpoints/<name>/invocations` with JSON.

## Canonical flow: nightly train + batch-score into a gold table

This is the shape the example notebook follows — use it as the default
unless you have a specific reason not to.

```
silver_<feature>_train   (features + label history, typically 2 tables from the sdp pipeline)
        │
        ▼
   [notebook — runs nightly on a serverless job]
        │  trains + logs to MLflow
        │  registers @prod in UC
        │  scores each entity using its latest features
        ▼
gold_<entity>_predictions   ◄── one row per entity, overwritten each run
        │
        ▼
  dashboards, apps, Genie, serving endpoint — all read from here
```

**Why this shape matters for the demo:**

- **One notebook, one artifact.** No hand-off between "data scientist built a model" and "engineer deploys it" — the same file trains, registers, and produces the gold table downstream consumes. Re-running = retraining.
- **Gold is where truth lives.** Dashboards, Genie, and apps never call the model directly for batch consumption — they read `gold_<entity>_predictions`. This keeps read paths cheap and consistent.
- **Pick batch OR real-time based on the demo's shape — not both.** Once the model is registered in UC, Databricks gives you two production-grade consumption paths:
    - **Batch** (Spark UDF → gold table) — cheapest, cadence-driven, what dashboards/Genie/Apps-with-precomputed-scores read. Use when scores are fine being minutes or hours old.
    - **Model Serving endpoint** (serverless REST, scale-to-zero) — sub-100ms per-request inference on user-supplied inputs. Use when the app needs to score on an action (technician opens a turbine, user submits a claim, fraud check at authorization).

  The example notebook does both for illustration — when you're building a real demo, keep the one that fits the story and drop the other cell.
- **Training data format.** The silver training table has features + labels in the same row. If labels live in a separate event table (e.g. `gold_failure_history`), the notebook joins them in-line with a configurable window (e.g. "label=1 if a failure occurred within 7 days"). Keep the join logic in the notebook during development, promote it to SDP once stable.

## Example Notebook

See `ml-training-serving-notebook-example.py` in this folder — Databricks source notebook covering: build label from silver + event history → Optuna + XGBoost training → MLflow logging → UC registration with `@prod` alias → batch score latest-per-entity → write `gold_turbine_predictions` → (optional) Model Serving endpoint deploy + smoke test. Adapt the dataset, feature list, and label window; keep the scaffolding.

**Env manager for batch scoring.** The example uses `mlflow.pyfunc.spark_udf(..., env_manager="local")` because training and scoring run in the same nightly job — no need to rebuild an env. Switch to `"virtualenv"` (or `"uv"` on MLflow 2.22+) when batch scoring runs in a different runtime than training and you need the model's exact pinned deps.

**Record the experiment in `resources.json`.** The notebook hard-codes `EXPERIMENT_PATH` at the top; after the first successful run, copy that path into `resources.json` as `mlflow_experiment_path`. The app and downstream traces reference it, and the dashboard/Genie use it to surface run history.

## How to Run It — Serverless Job Compute

Do **not** run ML training in the chat's local Python process. The notebook takes 10–20 min end-to-end (Optuna trials + UC register + endpoint warmup) and a dropped local connection would kill it. Use a **serverless job** instead — managed compute, no cluster to provision, 30 min timeout cap.

### Four CLI commands, start to finish

| Step | CLI | What you get back |
|---|---|---|
| Upload | `databricks workspace import <path> --file ... --format SOURCE --language PYTHON --overwrite` | Notebook created at path |
| Submit (async) | `databricks jobs submit --no-wait --json '{...}'` | Returns `{"run_id": N}` immediately |
| Check state | `databricks jobs get-run <RUN_ID>` | `.state.life_cycle_state`, `.state.result_state`, `.tasks[0].run_id` |
| Get output | `databricks jobs get-run-output <TASK_RUN_ID>` | `.notebook_output.result`, `.error`, `.error_trace` |

`--no-wait` is what makes this non-blocking — the CLI returns the moment the run is queued; you poll `get-run` yourself.

> ⚠️ **`get-run-output` takes the TASK run_id, not the submit-level run_id.** They're different IDs. Use the top-level `run_id` returned by `jobs submit` for `get-run` (state polling), then extract `.tasks[0].run_id` from that response and pass that to `get-run-output`. Passing the submit-level id returns an empty/incorrect payload without a helpful error.

### Worked example

```bash
# 1. Upload the notebook to the workspace
databricks workspace import /Workspace/Users/$USER/wind_farm_ml \
  --file ./ml-notebook-example.py \
  --format SOURCE --language PYTHON --overwrite

# 2. Submit as a serverless job (returns {"run_id": N})
RUN_ID=$(databricks jobs submit --no-wait --json '{
  "run_name": "wind-farm-ml",
  "tasks": [{
    "task_key": "train_and_score",
    "notebook_task": {"notebook_path": "/Workspace/Users/'$USER'/wind_farm_ml"},
    "environment_key": "ml_env"
  }],
  "environments": [{
    "environment_key": "ml_env",
    "spec": {
      "client": "4",
      "dependencies": ["mlflow==2.22.0","xgboost==2.1.3","optuna==4.1.0","scikit-learn==1.5.2"]
    }
  }]
}' | jq -r '.run_id')

# 3. Poll until TERMINATED (every ~30s; typical runtime 10–20 min)
databricks jobs get-run "$RUN_ID" | jq '{life: .state.life_cycle_state, result: .state.result_state}'

# 4. Once terminated, pull the notebook output using the TASK run_id
TASK_RUN_ID=$(databricks jobs get-run "$RUN_ID" | jq -r '.tasks[0].run_id')
databricks jobs get-run-output "$TASK_RUN_ID" | jq '.notebook_output.result'
```

**Notes:**
- `spec.client: "4"` is required — `"1"` silently ignores the `dependencies` list. The notebook has its own `%pip install` as a backstop.
- `print()` output is unreliable on serverless; the notebook calls `dbutils.notebook.exit(json.dumps({...}))` at the end so the structured result (model version, AUC, rows scored, endpoint name) comes back in `.notebook_output.result`.
- The serving endpoint itself is already serverless — no extra compute needed when the app calls it during the demo.

## Demo Tips

- Position MLflow as "governance for models, same bar as data": "which version is live? Who approved it? Trained on what?"
- Show the experiment UI — trials compared, feature importance surfaced.
- Show UC lineage — the model is just another governed asset with permissions and audit logs.
- For serving: focus on business outcome. "Every transaction scored in < 50ms before authorization. If this endpoint had been running on that day, those fraudulent transactions would have been blocked."
- If asked "why not just use SageMaker/Vertex?" — answer: "because your features, data, and governance already live here. You don't move data to train; you don't move predictions to consume."
- Free pairing with **Genie Code**: show how the ML code itself can be generated by the coding assistant against the UC-aware schema. Non-ML teams ship ML; the data scientist reviews.

## When to Use

- Story involves a predictive model (fraud, churn, demand, failure prediction)
- You need to show full lifecycle: exploration → training → governance → deployment
- Governance/compliance matters to the customer (regulated industries)
- As the "so what do we do about it?" answer after investigation
- For **batch**: dashboards, daily scores, precomputed predictions in a Delta table
- For **serving**: app or decision flow needs per-request real-time scoring

## Pitfalls

- **Using Model Serving for batch.** Overkill — use the Spark UDF pattern instead.
- **Over-engineering for a demo.** Simple XGBoost + Optuna on 1 silver table is enough to tell the story.
- **Forgetting UC registry UI.** The lineage view ("this model trained on this data version") is compelling; don't skip it.
- **Not connecting the model back to the narrative.** "This is the model that flagged WTG-047" > "We built a classifier."
- **Hand-writing the training code.** Show Genie Code doing it in the demo flow — non-obvious capability most audiences haven't seen.
- **Running training in the main chat process.** Always go through `execute_code(compute_type="serverless")` so it runs independently.

## Connections

- **Notebooks / Genie Code**: Training code is generated in-notebook by the coding assistant.
- **SDP**: Training data comes from Silver/Gold tables the pipeline produces; batch scoring output is another Gold table.
- **Unity Catalog**: Governs the registered model — permissions, lineage, audit.
- **Dashboards**: Read from the batch-scored predictions table.
- **Multi-agent supervisor**: Agents can call the serving endpoint as a tool for on-demand scoring.
- **Databricks Apps**: Live-inference path — apps call the serving endpoint.
- **Lakebase**: Predictions can sync into an operational store the app reads with low latency.

## URLs

- https://docs.databricks.com/aws/en/mlflow/
- https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/ (UC model registry)
- https://docs.databricks.com/aws/en/machine-learning/model-serving/
