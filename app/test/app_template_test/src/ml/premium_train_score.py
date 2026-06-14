# Databricks notebook source
# MAGIC %md
# MAGIC # Premium Customer Classifier — train + batch-score
# MAGIC
# MAGIC Trains an XGBoost binary classifier on the ~4K labeled rows in
# MAGIC `gold_customer_features` (premium_status IN ('premium','not_premium')),
# MAGIC registers to UC, sets `@prod`, then batch-scores every customer and
# MAGIC overwrites `gold_customer_premium_predictions`.
# MAGIC
# MAGIC The "hidden premium" beat: the ~46K customers with NULL label get a
# MAGIC `premium_prob` from the model; `final_tier = 'premium'` iff the row
# MAGIC was either CS-tagged OR model-predicted. The app's tiered offer reads
# MAGIC `final_tier` per row.

# COMMAND ----------

import json
import mlflow
import numpy as np
import pandas as pd
from pyspark.sql import functions as F
from datetime import datetime
import xgboost as xgb
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder

CATALOG = "retail_consumer_goods"
SCHEMA  = "luxebeauty_demo"
MODEL_NAME = f"{CATALOG}.{SCHEMA}.customer_premium_classifier"
EXPERIMENT_PATH = "/Workspace/Users/quentin.ambard@databricks.com/luxebeauty_demo/experiments/premium_classifier"

# UC registry + experiment (parent folder pre-created externally — see SKILL.md)
mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(EXPERIMENT_PATH)

# COMMAND ----------

# MAGIC %md ## 1. Load features

# COMMAND ----------

features_pdf = spark.table(f"{CATALOG}.{SCHEMA}.gold_customer_features").toPandas()
labeled = features_pdf[features_pdf["premium_status"].notna()].copy()
unlabeled = features_pdf[features_pdf["premium_status"].isna()].copy()
print(f"Total: {len(features_pdf)} | Labeled: {len(labeled)} | Unlabeled: {len(unlabeled)}")
print("Label distribution:", labeled["premium_status"].value_counts().to_dict())

# Numeric features per spec 03. region/country are weak signals; we
# one-hot encode loyalty_tier (only 3 values) and skip region/country
# to keep the model simple — the dashboard does the geo slice anyway.
NUM_COLS = [
    "total_spend_lifetime", "total_orders_lifetime",
    "lifetime_return_rate", "tenure_months",
    "avg_anger_score_last_90d", "days_since_last_order",
]
TIER_COL = "loyalty_tier"

# Fill na/nulls + cast
for c in NUM_COLS:
    labeled[c]   = pd.to_numeric(labeled[c], errors="coerce").fillna(0.0)
    unlabeled[c] = pd.to_numeric(unlabeled[c], errors="coerce").fillna(0.0)
labeled[TIER_COL]   = labeled[TIER_COL].fillna("unknown")
unlabeled[TIER_COL] = unlabeled[TIER_COL].fillna("unknown")

# One-hot tier (fit on labeled, apply to both)
enc = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
enc.fit(labeled[[TIER_COL]])

def featurize(df):
    tier_oh = enc.transform(df[[TIER_COL]])
    tier_cols = [f"tier_{c}" for c in enc.categories_[0]]
    tier_df = pd.DataFrame(tier_oh, columns=tier_cols, index=df.index)
    # Force numeric float dtype on every NUM_COL — Spark Decimal columns
    # land as `object` in pandas and XGBoost rejects them.
    num_df = df[NUM_COLS].apply(pd.to_numeric, errors="coerce").fillna(0.0).astype("float64").reset_index(drop=True)
    return pd.concat([num_df, tier_df.reset_index(drop=True)], axis=1)

X_lab = featurize(labeled)
y_lab = (labeled["premium_status"] == "premium").astype(int).values

# COMMAND ----------

# MAGIC %md ## 2. Train XGBoost with MLflow autolog

# COMMAND ----------

X_tr, X_va, y_tr, y_va = train_test_split(X_lab, y_lab, test_size=0.2, random_state=42, stratify=y_lab)

mlflow.xgboost.autolog(silent=True)

with mlflow.start_run(run_name="xgb_premium_classifier") as run:
    clf = xgb.XGBClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.08,
        objective="binary:logistic", eval_metric="auc",
        random_state=42, n_jobs=-1,
    )
    clf.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    val_auc = float(roc_auc_score(y_va, clf.predict_proba(X_va)[:, 1]))
    mlflow.log_metric("val_auc", val_auc)

    # Register via the autologged model
    model_uri = f"runs:/{run.info.run_id}/model"
    mv = mlflow.register_model(model_uri=model_uri, name=MODEL_NAME)
    model_version = mv.version
    print(f"Registered {MODEL_NAME} v{model_version} — val_auc={val_auc:.3f}")

# Set @prod alias
from mlflow.tracking import MlflowClient
MlflowClient().set_registered_model_alias(MODEL_NAME, "prod", model_version)
print(f"Alias @prod → v{model_version}")

# COMMAND ----------

# MAGIC %md ## 3. Batch-score every customer (labeled + unlabeled)

# COMMAND ----------

# Score in-process — small dataset (2K rows). For bigger volumes we'd use
# spark_udf, but the local loop is simpler and reliable here.
X_all = featurize(features_pdf.copy())
proba = clf.predict_proba(X_all)[:, 1]

preds_pdf = pd.DataFrame({
    "customer_id":             features_pdf["customer_id"].values,
    "premium_prob":            proba.astype(float),
    "premium_status_labeled":  features_pdf["premium_status"].values,  # NULL on unlabeled
    "predicted_at":            datetime.utcnow(),
})

# Pick a threshold dynamically. Training data is heavily imbalanced
# (~218 premium vs ~20 not_premium at this scale), which makes the
# default 0.5 cutoff over-classify. Per spec § Functional validation,
# we want final_tier='premium' on ~30-120 of the 250 affected-lot
# customers (target ~67). We pick the threshold that makes the
# unlabeled-population predicted-rate ≈ 22% — empirically lands the
# affected cohort in the target band.
unlabeled_mask = preds_pdf["premium_status_labeled"].isna()
target_unlabeled_premium_pct = 0.22
threshold = float(np.quantile(preds_pdf.loc[unlabeled_mask, "premium_prob"], 1 - target_unlabeled_premium_pct))
print(f"Chosen premium-prob threshold: {threshold:.3f} (targets {target_unlabeled_premium_pct:.0%} of unlabeled)")

preds_pdf["is_premium_predicted"] = preds_pdf["premium_prob"] > threshold
# final_tier — what the agent's tiering tool joins on
preds_pdf["final_tier"] = np.where(
    (preds_pdf["premium_status_labeled"] == "premium") | (preds_pdf["is_premium_predicted"]),
    "premium",
    "standard",
)

spark.createDataFrame(preds_pdf).write.mode("overwrite").saveAsTable(
    f"{CATALOG}.{SCHEMA}.gold_customer_premium_predictions"
)

n_total = len(preds_pdf)
n_pred_premium = int(preds_pdf["is_premium_predicted"].sum())
n_labeled_premium = int((preds_pdf["premium_status_labeled"] == "premium").sum())
n_final_premium = int((preds_pdf["final_tier"] == "premium").sum())
print(f"Scored {n_total} | labeled premium {n_labeled_premium} | predicted premium {n_pred_premium} | final_tier=premium {n_final_premium}")

# COMMAND ----------

# MAGIC %md ## 4. Spec validation — affected-lot tier split

# COMMAND ----------

# Per spec § Functional validation: among the 250 affected-lot pending
# returns, final_tier='premium' lands on 30-120 customers (target ~67).
val = spark.sql(f"""
  SELECT
    COUNT(DISTINCT r.customer_id) AS affected_total,
    COUNT(DISTINCT CASE WHEN p.final_tier='premium' THEN r.customer_id END) AS affected_premium,
    COUNT(DISTINCT CASE WHEN p.premium_status_labeled='premium' THEN r.customer_id END) AS affected_premium_labeled,
    COUNT(DISTINCT CASE WHEN p.is_premium_predicted=true AND COALESCE(p.premium_status_labeled,'') <> 'premium' THEN r.customer_id END) AS affected_premium_hidden
  FROM {CATALOG}.{SCHEMA}.gold_customer_returns r
  LEFT JOIN {CATALOG}.{SCHEMA}.gold_customer_premium_predictions p ON p.customer_id = r.customer_id
""").collect()[0].asDict()
print("Affected-lot tier split:", val)

# COMMAND ----------

# MAGIC %md ## 5. Notebook exit

# COMMAND ----------

dbutils.notebook.exit(json.dumps({
    "model_version":     model_version,
    "val_auc":           round(val_auc, 4),
    "total_scored":      n_total,
    "labeled_premium":   n_labeled_premium,
    "predicted_premium": n_pred_premium,
    "final_premium":     n_final_premium,
    "affected_lot":      val,
}))
