# Databricks notebook source
# MAGIC %md
# MAGIC # Predictive Maintenance — AeolisWind Fleet
# MAGIC
# MAGIC David Chen runs 120 wind turbines across 6 sites for AeolisWind. A single
# MAGIC gearbox replacement costs $350K plus $180K of lost generation — over half a
# MAGIC million dollars per catastrophic failure. Last quarter's incident (WTG-031
# MAGIC at Cascade Ridge) set a precedent he's not going to repeat.
# MAGIC
# MAGIC The ask: flag turbines likely to fail in the next 7 days so David's team
# MAGIC can schedule a $50K proactive bearing swap during a planned outage window
# MAGIC instead of waiting for a $530K catastrophic failure. With 18 months of
# MAGIC vibration + failure history from SCADA, we have enough signal to train a
# MAGIC model — and with the rest of the Databricks platform, everything from
# MAGIC feature engineering to real-time scoring lives in one place.
# MAGIC
# MAGIC This notebook produces the artifact the fleet dashboard, the Maintenance
# MAGIC Command Center app, and Genie all read from: a governed model in Unity
# MAGIC Catalog and a nightly gold table of per-turbine failure probabilities.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Before you write a line of ML code — ask Genie Code to do it
# MAGIC
# MAGIC Databricks ships a coding assistant that already knows your catalog, your
# MAGIC table schema, your column types, and your permissions. You don't have to
# MAGIC write the ML pipeline from scratch. Open the assistant in any notebook
# MAGIC and ask:
# MAGIC
# MAGIC > *"Train a binary classifier predicting `label` on
# MAGIC > `silver_failure_features_train`. Use XGBoost with Optuna hyperparameter
# MAGIC > tuning, track to MLflow, register to Unity Catalog with a `@prod` alias,
# MAGIC > batch-score every turbine's latest row into `gold_turbine_predictions`,
# MAGIC > and deploy a serving endpoint for real-time inference."*
# MAGIC
# MAGIC It writes a state-of-the-art, Databricks-idiomatic notebook — MLflow
# MAGIC autologging, feature-importance plots, `scale_pos_weight` for class
# MAGIC imbalance, the whole thing. You review it instead of writing it.
# MAGIC Non-ML teams suddenly ship ML; the data scientist becomes the code
# MAGIC reviewer, not the bottleneck.
# MAGIC
# MAGIC What follows is the hand-written reference — roughly what the assistant
# MAGIC produces, annotated so you can see what it's doing.

# COMMAND ----------

# MAGIC %pip install -q mlflow==2.22.0 xgboost==2.1.3 optuna==4.1.0 scikit-learn==1.5.2
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

# DBTITLE 1,Config
CATALOG = "ai_demo_gen"
SCHEMA = "demo_wind_farm_maintenance_command_center"

FEATURES_TABLE = f"{CATALOG}.{SCHEMA}.silver_failure_features_train"
FAILURES_TABLE = f"{CATALOG}.{SCHEMA}.gold_failure_history"
PREDICTIONS_TABLE = f"{CATALOG}.{SCHEMA}.gold_turbine_predictions"

MODEL_NAME = f"{CATALOG}.{SCHEMA}.wind_turbine_failure_model"
EXPERIMENT_PATH = "/Shared/dbdemos/experiments/wind_turbine_failure_prediction"
ENDPOINT_NAME = "wind-turbine-failure-endpoint"

FEATURE_COLS = [
    "vibration_rms_7d_avg",
    "vibration_rms_2d_avg",
    "vibration_trend_7d",
    "vibration_rms_max",
    "bearing_temp_avg",
    "wind_speed_avg",
]
TARGET_COL = "label"
# Label a feature-row "1" if the same turbine failed within this many days after.
FAILURE_WINDOW_DAYS = 7

# Quiet the chatty Spark Connect INFO logger — model-UDF planning is noisy.
import logging
logging.getLogger("pyspark.sql.connect.client.logging").setLevel(logging.WARNING)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Build the training set
# MAGIC
# MAGIC `silver_failure_features_train` holds daily per-turbine vibration and
# MAGIC operational features produced by our Lakeflow pipeline.
# MAGIC `gold_failure_history` records 18 months of actual main-bearing failures.
# MAGIC
# MAGIC We join the two and label a row `1` if the same turbine failed within 7
# MAGIC days of that snapshot, else `0`. That's our supervised-learning target.
# MAGIC
# MAGIC > **Feature Store** — in production, these features belong in
# MAGIC > [Databricks Feature Store](https://docs.databricks.com/aws/en/machine-learning/feature-store/).
# MAGIC > It gives you discoverability across teams (Marc's churn features and
# MAGIC > Priya's fraud features live in the same catalog), point-in-time correct
# MAGIC > joins, and the exact same feature definitions serving training and
# MAGIC > real-time inference — no train/serve skew. For this example we build
# MAGIC > the training frame inline to keep the notebook self-contained.

# COMMAND ----------

from pyspark.sql import functions as F

features = spark.table(FEATURES_TABLE)
failures = spark.table(FAILURES_TABLE).select("turbine_id", "failure_date")

labeled = (
    features.alias("f")
    .join(failures.alias("x"), on="turbine_id", how="left")
    .withColumn(
        "has_failure_in_window",
        (F.col("x.failure_date") >= F.col("f.date"))
        & (F.col("x.failure_date") <= F.date_add(F.col("f.date"), FAILURE_WINDOW_DAYS)),
    )
    # A feature row gets label=1 if ANY matched failure falls in the window.
    .groupBy(*[F.col(f"f.{c}").alias(c) for c in ["turbine_id", "date", *FEATURE_COLS]])
    .agg(F.max(F.col("has_failure_in_window").cast("int")).alias(TARGET_COL))
    .fillna(0, subset=[TARGET_COL])
)

print(f"Rows: {labeled.count():,}")
labeled.groupBy(TARGET_COL).count().show()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Quick sanity check on the training data

# COMMAND ----------

display(labeled.select(*FEATURE_COLS, TARGET_COL).summary())

# COMMAND ----------

import pandas as pd
df = labeled.toPandas()
# Force features to float64 up front. Integer columns can't represent missing
# values in pandas; keeping them float avoids schema-enforcement errors at
# inference time when the app sends a row with a NaN.
df[FEATURE_COLS] = df[FEATURE_COLS].astype("float64")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Train — XGBoost + Optuna, tracked to MLflow
# MAGIC
# MAGIC Every trial becomes an MLflow run. Hyperparameters, metrics, the trained
# MAGIC model artifact, and the training dataset signature all land in the
# MAGIC experiment automatically — open the **Experiments** tab on the right to
# MAGIC compare trials, see feature importance, and trace any model version back
# MAGIC to the exact code commit and data version that produced it.

# COMMAND ----------

from sklearn.model_selection import train_test_split

X = df[FEATURE_COLS]
y = df[TARGET_COL].astype(int)

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=42
)
print(f"Train: {len(X_train):,}   Test: {len(X_test):,}   Features: {X.shape[1]}")

# COMMAND ----------

import mlflow, optuna, xgboost as xgb
from sklearn.metrics import roc_auc_score, f1_score

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(EXPERIMENT_PATH)

def objective(trial):
    params = {
        "objective": "binary:logistic",
        "eval_metric": "auc",
        "max_depth":        trial.suggest_int("max_depth", 3, 8),
        "learning_rate":    trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "n_estimators":     trial.suggest_int("n_estimators", 100, 400),
        "subsample":        trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
        "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
        "scale_pos_weight": (y_train == 0).sum() / max(1, (y_train == 1).sum()),
    }
    with mlflow.start_run(nested=True):
        mlflow.log_params(params)
        model = xgb.XGBClassifier(**params)
        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
        probs = model.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, probs)
        f1 = f1_score(y_test, (probs > 0.5).astype(int))
        mlflow.log_metrics({"auc": auc, "f1": f1})
        # Passing X_train as the example anchors the signature on realistic data
        # (including NaN handling) — no more "integer columns can't represent
        # missing values" warnings at inference time.
        mlflow.xgboost.log_model(model, "model", input_example=X_train.head(5))
        trial.set_user_attr("run_id", mlflow.active_run().info.run_id)
    return auc

with mlflow.start_run(run_name="predictive-maintenance") as parent_run:
    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=10, show_progress_bar=False)
    best = study.best_trial
    mlflow.log_metric("best_auc", best.value)
    mlflow.log_params({f"best_{k}": v for k, v in best.params.items()})
    best_run_id = best.user_attrs["run_id"]
    print(f"Best AUC: {best.value:.4f}   run_id={best_run_id}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Register to Unity Catalog — one governed asset, `@prod` alias
# MAGIC
# MAGIC Unity Catalog governs models the same way it governs tables: permissions,
# MAGIC lineage (this model ⟵ this training run ⟵ this dataset version ⟵ this
# MAGIC pipeline), audit logs, cross-workspace discovery. The `@prod` alias is a
# MAGIC movable label — if the new version misbehaves in shadow, we repoint
# MAGIC `@prod` back to the previous version in one API call.

# COMMAND ----------

from mlflow import MlflowClient
client = MlflowClient()

model_version = mlflow.register_model(f"runs:/{best_run_id}/model", MODEL_NAME)
client.set_registered_model_alias(MODEL_NAME, "prod", model_version.version)

print(f"Registered {MODEL_NAME} v{model_version.version} as @prod")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Consume the model: batch OR real-time — pick one
# MAGIC
# MAGIC Once a model is registered in Unity Catalog, Databricks gives you two
# MAGIC production-grade consumption patterns. **Pick based on what your demo
# MAGIC actually needs.**
# MAGIC
# MAGIC | | **Batch inference** (cell 6) | **Model Serving endpoint** (cell 7) |
# MAGIC |---|---|---|
# MAGIC | How | Spark UDF loads `@prod`, scores a Delta table, writes gold | Serverless REST endpoint, scale-to-zero, per-request |
# MAGIC | Latency | Minutes (job cadence) | <100 ms, auto-scaling |
# MAGIC | Cost | Cheapest — pay only for the job run | Pay when there's traffic; idle endpoint scales to zero |
# MAGIC | When | Dashboards, Genie, nightly precomputed scores | App that scores on every user action |
# MAGIC
# MAGIC **For most demos, batch is the right answer** — the dashboard, Genie, and
# MAGIC the Maintenance Command Center all read precomputed scores from
# MAGIC `gold_turbine_predictions`. Model Serving is for apps that need per-
# MAGIC request inference on user-supplied inputs (e.g. a technician opens a
# MAGIC turbine detail view and the UI calls the model with live sensor values).
# MAGIC
# MAGIC This notebook runs both for illustration; in your demo, keep the one
# MAGIC that fits the story and delete the other.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Batch score → write `gold_turbine_predictions`
# MAGIC
# MAGIC Nightly pattern: take the latest feature snapshot per turbine, run the
# MAGIC `@prod` model as a Spark UDF, overwrite the predictions gold table. The
# MAGIC dashboard, the app, and Genie all read from here — one table, one source
# MAGIC of truth.

# COMMAND ----------

from pyspark.sql import functions as F, Window

# Latest row per turbine — that's what "score the fleet today" means.
latest_window = Window.partitionBy("turbine_id").orderBy(F.col("date").desc())
latest_features = (
    spark.table(FEATURES_TABLE)
    .withColumn("_rn", F.row_number().over(latest_window))
    .filter(F.col("_rn") == 1)
    .drop("_rn")
)

# env_manager="local" reuses the notebook's Python env — fastest option when
# training and scoring run in the same runtime (as here). Switch to
# "virtualenv" or "uv" when scoring runs in a different runtime and you need
# the model's exact pinned deps.
predict_udf = mlflow.pyfunc.spark_udf(
    spark, model_uri=f"models:/{MODEL_NAME}@prod",
    result_type="double", env_manager="local",
)

scored = (
    latest_features
    .withColumn("failure_probability", predict_udf(*[F.col(c) for c in FEATURE_COLS]))
    .withColumn(
        "recommended_action",
        F.when(F.col("failure_probability") > 0.85, "Schedule Replacement")
         .when(F.col("failure_probability") > 0.65, "Schedule Inspection")
         .when(F.col("failure_probability") > 0.40, "Monitor")
         .otherwise("Healthy"),
    )
    .select("turbine_id", "date", *FEATURE_COLS, "failure_probability", "recommended_action")
)

scored.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(PREDICTIONS_TABLE)
print(f"Wrote {scored.count()} rows → {PREDICTIONS_TABLE}")

# COMMAND ----------

display(scored.orderBy(F.col("failure_probability").desc()).limit(20))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Real-time serving endpoint — scale-to-zero REST API
# MAGIC
# MAGIC Databricks Model Serving turns the UC-registered model into a REST endpoint
# MAGIC with a few configuration lines. The endpoint:
# MAGIC
# MAGIC - **Scales to zero** when idle — you're not paying for compute between
# MAGIC   requests; cold-start warms in seconds.
# MAGIC - **Scales out automatically** under load.
# MAGIC - **Versioned by Unity Catalog** — swap `@prod` and traffic follows with
# MAGIC   zero downtime.
# MAGIC - **Built-in monitoring** — every request logged for drift detection.
# MAGIC
# MAGIC This is the endpoint the Maintenance Command Center app will call when a
# MAGIC technician opens a turbine and wants an instant score on the current
# MAGIC sensor reading.

# COMMAND ----------

import time
from mlflow.deployments import get_deploy_client
deploy_client = get_deploy_client("databricks")

# One served_entity per served model version. The endpoint name is fixed —
# we always re-use it; there is never a second endpoint.
served_name = f"{ENDPOINT_NAME.replace('-', '_')}_v{model_version.version}"

endpoint_config = {
    "served_entities": [{
        "name": served_name,
        "entity_name": MODEL_NAME,
        "entity_version": model_version.version,
        "workload_size": "Small",
        "scale_to_zero_enabled": True,
    }],
    "traffic_config": {"routes": [{
        "served_model_name": served_name,
        "traffic_percentage": 100,
    }]},
}

ENDPOINT_WAIT_TIMEOUT_S = 25 * 60  # cold warmup headroom


def _endpoint_state(name: str) -> dict | None:
    try:
        ep = deploy_client.get_endpoint(endpoint=name)
    except Exception:
        return None
    return (ep.get("state") or {}) if isinstance(ep, dict) else {}


def _wait_until_endpoint_ready(name: str, timeout_s: int = ENDPOINT_WAIT_TIMEOUT_S) -> None:
    """Block until config_update finishes AND ready == READY."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        state = _endpoint_state(name)
        if state is None:
            raise RuntimeError(f"Endpoint {name} does not exist")
        cfg = state.get("config_update", "NOT_UPDATING")
        ready = state.get("ready", "NOT_READY")
        if cfg == "UPDATE_FAILED":
            raise RuntimeError(f"Endpoint {name} update failed: {state}")
        if cfg == "NOT_UPDATING" and ready == "READY":
            print(f"  endpoint ready: config_update={cfg} ready={ready}")
            return
        print(f"  waiting: config_update={cfg} ready={ready}")
        time.sleep(15)
    raise TimeoutError(f"Endpoint {name} not READY after {timeout_s}s")


# Idempotent create-or-update. `update_endpoint_config` is the non-deprecated
# entry point (the old `update_endpoint` is being removed).
state = _endpoint_state(ENDPOINT_NAME)
if state is None:
    print(f"Creating endpoint {ENDPOINT_NAME} with {MODEL_NAME} v{model_version.version}")
    deploy_client.create_endpoint(name=ENDPOINT_NAME, config=endpoint_config)
else:
    cfg = state.get("config_update", "NOT_UPDATING")
    if cfg == "IN_PROGRESS":
        print("Endpoint already updating — waiting for that to finish before ours…")
        _wait_until_endpoint_ready(ENDPOINT_NAME)
    print(f"Updating endpoint {ENDPOINT_NAME} → {MODEL_NAME} v{model_version.version}")
    deploy_client.update_endpoint_config(endpoint=ENDPOINT_NAME, config=endpoint_config)

_wait_until_endpoint_ready(ENDPOINT_NAME)
print(f"Endpoint {ENDPOINT_NAME} is READY at v{model_version.version}")

# COMMAND ----------

# DBTITLE 1,Smoke-test the endpoint
sample = X_test.head(1).to_dict(orient="split")
resp = deploy_client.predict(endpoint=ENDPOINT_NAME, inputs={"dataframe_split": sample})
print(resp)

# COMMAND ----------

import json
dbutils.notebook.exit(json.dumps({
    "model": MODEL_NAME,
    "version": model_version.version,
    "best_auc": best.value,
    "predictions_table": PREDICTIONS_TABLE,
    "rows_scored": scored.count(),
    "endpoint": ENDPOINT_NAME,
}))
