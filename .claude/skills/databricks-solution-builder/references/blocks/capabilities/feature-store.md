---
name: Feature Store
category: agent-bricks
disabled: false
buildable: true
skill: databricks-ml-training
---

# Feature Store — Feature Engineering in Unity Catalog

**Declare features once, train and score from the same table.** A Unity Catalog feature table (primary key, no label) feeds training through `FeatureLookup`; the model is logged with `fe.log_model(training_set=...)`, so `fe.score_batch` looks the features up again from just the key. Only meaningful with **ML Training & Serving** — on its own, ignore it.

## Pain

Training code computes features one way, scoring code another — models degrade silently (training/serving skew). Features get rebuilt per model with no lineage back to where they came from.

## Position

"How do you share features across models and avoid train/serve skew?" The model's lineage in Unity Catalog points at the feature table it was trained from.

## Only when selected

Use the feature store **only when `feature-store` is in `resources.json`**. Otherwise build ML the plain way (`ml-training-serving.md`: gold table → `mlflow` → `spark_udf`) and don't mention the feature store in specs, code, or the talk track.

## Reference — what changes vs the plain notebook

`DEMO_SKILL_DIR/references/example-luxebeauty/ml/` has both: `premium_train_score.py` (plain) and
`premium_train_score_with_feature_store.py` (feature store). Same model (XGBoost + one-hot tier),
same label, same output table and schema (`gold_customer_premium_predictions`) — downstream
dashboard / Genie / app don't change. Start from the plain shape and apply only these deltas:

| Step | Plain (`premium_train_score.py`) | Feature store (`…_with_feature_store.py`) |
|---|---|---|
| Install | `xgboost scikit-learn mlflow` | + `databricks-feature-engineering>=0.16.0`; `fe = FeatureEngineeringClient(model_registry_uri="databricks-uc")` |
| Features | read `gold_customer_features` (features + label) into pandas | `fe.create_table(name=…_features, primary_keys=["customer_id"], df=…)` from the gold table: **features only, no label**, numerics cast to double, nulls filled. Re-run → `fe.write_table(mode="overwrite")` |
| Training data | filter labeled rows in pandas | labels = `customer_id` + `label` only → `FeatureLookup(table_name, lookup_key="customer_id")` → `fe.create_training_set(df=labels, label="label", exclude_columns=["customer_id"])` → `.load_df()` |
| Preprocessing | `featurize()` in the notebook, before fit and before scoring | the same encoding **inside one `mlflow.pyfunc.PythonModel`** (encoder + classifier), `predict()` returns the probability — scoring then needs no notebook code |
| Log + register | `mlflow.xgboost.autolog()` logs the model → `mlflow.register_model(runs:/…/model)` | `autolog(log_models=False)` + `fe.log_model(model=<pyfunc>, flavor=mlflow.pyfunc, training_set=…, registered_model_name=…, signature=…)` — carries feature lineage |
| Alias | `set_registered_model_alias(…, "prod", v)` | same |
| Score | in-process `clf.predict_proba(featurize(all))` (or `spark_udf` at scale) | `fe.score_batch(model_uri="models:/…@prod", df=<customer_id only>, result_type="double")` — features joined from the lineage |
| Serverless | — | keep the notebook's version-parse shim + in-process fallback (`fe.score_batch` broke on serverless 18.x until MLflow 3.15; both no-op once fixed) |
| Names | `…_classifier` | `…_classifier_fs` + one extra table `…_features` |

Threshold, `final_tier`, the predictions write and the validation query are identical.

Basic flow only: no point-in-time joins, online store, or feature serving endpoint unless the brief asks (see `databricks-ml-training/references/feature-store.md`).

## URL

https://docs.databricks.com/aws/en/machine-learning/feature-store/
