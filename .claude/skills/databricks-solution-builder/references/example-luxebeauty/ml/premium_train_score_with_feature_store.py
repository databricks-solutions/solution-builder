# Databricks notebook source
# MAGIC %md
# MAGIC # Premium Customer Classifier — Feature Store Edition
# MAGIC
# MAGIC Same XGBoost binary classifier as `premium_train_score.py`, but uses
# MAGIC **Databricks Feature Engineering** (`FeatureEngineeringClient`) to:
# MAGIC
# MAGIC 1. Store per-customer features in a **UC Feature Table** with a primary key
# MAGIC 2. Build the training set via **`FeatureLookup`** — declarative, no manual joins
# MAGIC 3. Log the model with **`fe.log_model(training_set=...)`** — captures feature lineage in UC
# MAGIC 4. Batch-score with **`fe.score_batch()`** — features auto-joined from the feature table
# MAGIC
# MAGIC The output table `gold_customer_premium_predictions` has the **same schema**
# MAGIC as the non-feature-store version so all downstream consumers (app, Genie, dashboard) work unchanged.

# COMMAND ----------

# MAGIC %pip install databricks-feature-engineering>=0.16.0 xgboost scikit-learn mlflow>=2.22.0
# MAGIC dbutils.library.restartPython()

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
from databricks.feature_engineering import FeatureEngineeringClient, FeatureLookup
from mlflow.tracking import MlflowClient

# COMMAND ----------

# MAGIC %md
# MAGIC ### Compatibility shim — serverless 18.x runtime version parsing (self-obsoleting)
# MAGIC
# MAGIC **Temporary.** As of the July 2026 serverless 18.3 rollout, the runtime
# MAGIC reports its version as `18.x-photon-scala2` (non-numeric minor). MLflow's
# MAGIC version parser (used internally by `mlflow.pyfunc.spark_udf`, which
# MAGIC `fe.score_batch()` calls) does `int(minor)` / `Version(...)` and crashes
# MAGIC with `InvalidVersion: '18.x-photon-scala2'` — so `fe.score_batch()` fails
# MAGIC on serverless. This is a **platform regression**, not a code issue
# MAGIC (ES-2047313 / ES-2051485 / SUP-32127).
# MAGIC
# MAGIC The fix is merged upstream (mlflow PR #24336/#24353) and ships in
# MAGIC **MLflow 3.15 → serverless (~Aug 2026)**. The cell below mirrors that fix
# MAGIC as a runtime monkeypatch so `fe.score_batch()` works on serverless
# MAGIC **today**, and **auto-no-ops** once the patched MLflow lands — no cleanup
# MAGIC needed when this solution builder is cloned later.

# COMMAND ----------

# ── Self-obsoleting compat shim for serverless 18.x version parsing ──────────
# Mirrors mlflow PR #24336/#24353: tolerate a non-numeric minor ("18.x" → major
# 18, minor sentinel) instead of int()/Version() crashing. Guarded so it only
# patches when the installed MLflow still has the buggy behavior; once the
# fixed MLflow ships to serverless, this becomes a no-op automatically.
def _install_dbr_version_shim():
    import re
    import mlflow.utils.databricks_utils as du

    # 1) Fix DatabricksRuntimeVersion.parse() — the fe.score_batch() call site.
    drv = getattr(du, "DatabricksRuntimeVersion", None)
    if drv is not None and hasattr(drv, "parse"):
        _orig_parse = drv.parse

        def _safe_parse(cls, version_string):
            try:
                return _orig_parse.__func__(cls, version_string) \
                    if hasattr(_orig_parse, "__func__") else _orig_parse(version_string)
            except Exception:
                # e.g. "18.x-photon-scala2" → major=18, minor=999 sentinel
                m = re.match(r"^(\d+)\.(\d+|x)", str(version_string))
                major = int(m.group(1)) if m else 0
                minor = int(m.group(2)) if (m and m.group(2).isdigit()) else 999
                try:
                    return cls(major=major, minor=minor)
                except Exception:
                    # Fallback for differing constructor signatures across versions.
                    inst = drv.__new__(drv)
                    setattr(inst, "major", major)
                    setattr(inst, "minor", minor)
                    return inst

        drv.parse = classmethod(_safe_parse)

    # 2) Fix the mlflow.pyfunc.spark_udf() version gate (Version(runtime_version)).
    import mlflow.pyfunc as _pyfunc
    from packaging.version import Version, InvalidVersion
    _orig_version = _pyfunc.Version if hasattr(_pyfunc, "Version") else Version

    def _safe_version(v):
        try:
            return _orig_version(v)
        except InvalidVersion:
            m = re.match(r"^(\d+)(?:\.(\d+))?", str(v))
            major = m.group(1) if m else "0"
            minor = m.group(2) if (m and m.group(2)) else "0"
            return Version(f"{major}.{minor}")

    if hasattr(_pyfunc, "Version"):
        _pyfunc.Version = _safe_version

try:
    _install_dbr_version_shim()
    print("Serverless 18.x version-parse shim installed (auto-no-op once MLflow 3.15+ lands).")
except Exception as _e:
    print(f"Version-parse shim not applied (likely already fixed in this MLflow): {_e}")

# COMMAND ----------

# Widget-overridable config (works under DAB job and manual runs). No hardcoded
# default catalog/schema — same pattern as premium_train_score.py.
try:
    dbutils.widgets.text("catalog", "", "Catalog")
    dbutils.widgets.text("schema",  "", "Schema")
    CATALOG = dbutils.widgets.get("catalog")
    SCHEMA  = dbutils.widgets.get("schema")
except NameError:
    import os
    CATALOG = os.environ.get("DEMO_CATALOG")
    SCHEMA  = os.environ.get("DEMO_SCHEMA")
assert CATALOG and SCHEMA, "catalog + schema are required (widgets in-job, DEMO_CATALOG/DEMO_SCHEMA env locally)"

MODEL_NAME = f"{CATALOG}.{SCHEMA}.customer_premium_classifier_fs"
FEATURE_TABLE_NAME = f"{CATALOG}.{SCHEMA}.customer_premium_features"
EXPERIMENT_PATH = f"/Shared/{CATALOG}_{SCHEMA}_premium_classifier_fs"

# UC registry + experiment
mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(EXPERIMENT_PATH)

# Feature Engineering client
fe = FeatureEngineeringClient(model_registry_uri="databricks-uc")

print(f"Catalog: {CATALOG}")
print(f"Schema:  {SCHEMA}")
print(f"Model:   {MODEL_NAME}")
print(f"Feature Table: {FEATURE_TABLE_NAME}")

# COMMAND ----------

# MAGIC %md ## 1. Load features from gold layer and create Feature Table

# COMMAND ----------

# Read the gold_customer_features table produced by SDP pipeline
features_sdf = spark.table(f"{CATALOG}.{SCHEMA}.gold_customer_features")
print(f"Total customers in gold_customer_features: {features_sdf.count()}")

# The feature columns we'll store in the Feature Table
FEATURE_COLS = [
    "total_spend_lifetime", "total_orders_lifetime",
    "lifetime_return_rate", "tenure_months",
    "avg_anger_score_last_90d", "days_since_last_order",
    "loyalty_tier",
]

# Build the feature DataFrame: customer_id (PK) + feature columns
# Cast numeric columns to double to avoid Spark Decimal issues with XGBoost
feature_df = features_sdf.select(
    "customer_id",
    F.col("total_spend_lifetime").cast("double"),
    F.col("total_orders_lifetime").cast("double"),
    F.col("lifetime_return_rate").cast("double"),
    F.col("tenure_months").cast("double"),
    F.col("avg_anger_score_last_90d").cast("double"),
    F.col("days_since_last_order").cast("double"),
    F.coalesce(F.col("loyalty_tier"), F.lit("unknown")).alias("loyalty_tier"),
).fillna(0.0, subset=[
    "total_spend_lifetime", "total_orders_lifetime",
    "lifetime_return_rate", "tenure_months",
    "avg_anger_score_last_90d", "days_since_last_order",
])

# COMMAND ----------

# Create or overwrite the Feature Table in Unity Catalog
# primary_keys is required and cannot be added after creation
try:
    fe.create_table(
        name=FEATURE_TABLE_NAME,
        primary_keys=["customer_id"],
        df=feature_df,
        description="Per-customer behavioral features for the premium classifier. "
                    "Source: gold_customer_features (SDP gold layer). "
                    "Consumed by the premium_classifier_fs model via FeatureLookup.",
    )
    print(f"Created feature table: {FEATURE_TABLE_NAME}")
except Exception as e:
    if "already exists" in str(e).lower():
        # Table exists — overwrite the data
        fe.write_table(
            name=FEATURE_TABLE_NAME,
            df=feature_df,
            mode="overwrite",
        )
        print(f"Updated existing feature table: {FEATURE_TABLE_NAME}")
    else:
        raise

# Verify
print(f"Feature table row count: {spark.table(FEATURE_TABLE_NAME).count()}")

# COMMAND ----------

# MAGIC %md ## 2. Prepare labels (training data)

# COMMAND ----------

# Labels come from gold_customer_features — only rows where premium_status is non-null
# We need customer_id (the lookup key) + the label
labels_sdf = (
    features_sdf
    .filter(F.col("premium_status").isNotNull())
    .select(
        "customer_id",
        F.when(F.col("premium_status") == "premium", 1).otherwise(0).alias("label"),
    )
)

print(f"Labeled customers: {labels_sdf.count()}")
print("Label distribution:")
labels_sdf.groupBy("label").count().show()

# COMMAND ----------

# MAGIC %md ## 3. Build training set with FeatureLookup

# COMMAND ----------

# FeatureLookup: declarative feature retrieval — no manual joins needed.
# The lookup_key maps customer_id in our labels to the feature table's primary key.
feature_lookups = [
    FeatureLookup(
        table_name=FEATURE_TABLE_NAME,
        lookup_key="customer_id",
        # All feature columns are included by default (omit feature_names to get all)
    ),
]

# create_training_set joins labels with features automatically
training_set = fe.create_training_set(
    df=labels_sdf,
    feature_lookups=feature_lookups,
    label="label",
    exclude_columns=["customer_id"],  # drop the key — not a training feature
)

# Load as pandas for sklearn/XGBoost training
training_pdf = training_set.load_df().toPandas()
print(f"Training set shape: {training_pdf.shape}")
print(f"Columns: {list(training_pdf.columns)}")

# COMMAND ----------

# MAGIC %md ## 4. Feature preprocessing + Train XGBoost

# COMMAND ----------

# Separate features and label
y = training_pdf["label"].values
X_raw = training_pdf.drop(columns=["label"])

# Numeric features — same set as the original notebook
NUM_COLS = [
    "total_spend_lifetime", "total_orders_lifetime",
    "lifetime_return_rate", "tenure_months",
    "avg_anger_score_last_90d", "days_since_last_order",
]
TIER_COL = "loyalty_tier"

# One-hot encode loyalty_tier (fit on labeled data)
enc = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
enc.fit(X_raw[[TIER_COL]])


class PremiumClassifierModel(mlflow.pyfunc.PythonModel):
    """Encoder + XGBoost bundled in ONE artifact.

    Because the one-hot encoding lives INSIDE the model, predict() consumes the
    RAW feature-table columns (numeric features + the string `loyalty_tier`) and
    returns the premium probability. This is what lets fe.score_batch() work:
    it auto-joins the raw feature columns from customer_premium_features and
    feeds them straight to predict() — no manual re-encoding, no train/serve skew.
    """

    def __init__(self, encoder, classifier, num_cols, tier_col):
        self.encoder = encoder
        self.classifier = classifier
        self.num_cols = num_cols
        self.tier_col = tier_col

    def _featurize(self, df):
        """One-hot encode loyalty_tier and concat with numeric features.
        Identical logic on the training and serving side — the whole point."""
        tier_oh = self.encoder.transform(df[[self.tier_col]])
        tier_cols = [f"tier_{c}" for c in self.encoder.categories_[0]]
        tier_df = pd.DataFrame(tier_oh, columns=tier_cols, index=df.index)
        num_df = df[self.num_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0).astype("float64").reset_index(drop=True)
        return pd.concat([num_df, tier_df.reset_index(drop=True)], axis=1)

    def predict(self, context, model_input, params=None):
        X = self._featurize(model_input)
        return self.classifier.predict_proba(X)[:, 1]   # premium probability


def featurize(df):
    """Module-level helper used ONLY for the train/val split below.
    Mirrors PremiumClassifierModel._featurize so training matches serving."""
    tier_oh = enc.transform(df[[TIER_COL]])
    tier_cols = [f"tier_{c}" for c in enc.categories_[0]]
    tier_df = pd.DataFrame(tier_oh, columns=tier_cols, index=df.index)
    num_df = df[NUM_COLS].apply(pd.to_numeric, errors="coerce").fillna(0.0).astype("float64").reset_index(drop=True)
    return pd.concat([num_df, tier_df.reset_index(drop=True)], axis=1)

X = featurize(X_raw)
X_tr, X_va, y_tr, y_va = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

# Train with MLflow autolog
# log_models=False: let autolog capture params/metrics only — fe.log_model
# below is the sole model logger, so there's no competing artifact and
# feature lineage is correctly attached to the registered model.
mlflow.xgboost.autolog(log_models=False, silent=True)

with mlflow.start_run(run_name="xgb_premium_fs") as run:
    clf = xgb.XGBClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.08,
        objective="binary:logistic", eval_metric="auc",
        random_state=42, n_jobs=-1,
    )
    clf.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    val_auc = float(roc_auc_score(y_va, clf.predict_proba(X_va)[:, 1]))
    mlflow.log_metric("val_auc", val_auc)
    print(f"Validation AUC: {val_auc:.4f}")

    # Wrap encoder + classifier into ONE pyfunc so the model consumes raw
    # feature-table columns and returns premium probability. This is what makes
    # fe.score_batch() work keys-only in Section 6 (no manual re-encoding): the
    # bundled pyfunc IS the object score_batch loads and runs on the auto-joined
    # feature rows.
    wrapped = PremiumClassifierModel(enc, clf, NUM_COLS, TIER_COL)

    # fe.log_model INSIDE the same run block — captures feature lineage so
    # the registered model shows customer_premium_features as an upstream
    # dependency in Unity Catalog's lineage graph. flavor=mlflow.pyfunc
    # because the artifact is a custom PythonModel (encoder + booster).
    # This registered @prod model is the lineage-bearing artifact.
    from mlflow.models import infer_signature
    sig_sample = X_raw.head(5).copy()                     # raw feature cols (NUM_COLS + loyalty_tier)
    signature = infer_signature(sig_sample, wrapped.predict(None, sig_sample))

    fe.log_model(
        model=wrapped,
        artifact_path="fs_model",
        flavor=mlflow.pyfunc,
        training_set=training_set,
        registered_model_name=MODEL_NAME,
        signature=signature,
    )

# COMMAND ----------

# MAGIC %md ## 5. Set model alias

# COMMAND ----------

# Get the registered version and set @prod alias
client = MlflowClient()
versions = client.search_model_versions(f"name='{MODEL_NAME}'")
model_version = max(versions, key=lambda v: int(v.version)).version
print(f"Registered {MODEL_NAME} v{model_version} — val_auc={val_auc:.3f}")

client.set_registered_model_alias(MODEL_NAME, "prod", model_version)
print(f"Alias @prod → v{model_version}")

# COMMAND ----------

# MAGIC %md ## 6. Batch-score every customer with `fe.score_batch()`
# MAGIC
# MAGIC This is the canonical Feature-Store scoring path: pass **keys only** and
# MAGIC `fe.score_batch()` **auto-joins** every feature from
# MAGIC `customer_premium_features` via the model's registered lineage, then runs
# MAGIC the bundled pyfunc's `predict()` (which one-hot encodes `loyalty_tier`
# MAGIC internally and returns the premium probability).
# MAGIC
# MAGIC This is the offline/online-parity story — identical feature lookup and
# MAGIC preprocessing at scoring time as at training time — and it scales to
# MAGIC Spark-sized populations (no per-row Python).
# MAGIC
# MAGIC > The serverless 18.x version-parse regression that would otherwise break
# MAGIC > this call is handled by the compatibility shim near the top of the
# MAGIC > notebook (self-obsoleting once MLflow 3.15+ reaches serverless). A
# MAGIC > defensive in-process fallback is included below in case the shim can't
# MAGIC > apply on some future runtime — the output is identical either way.

# COMMAND ----------

# Keys only — Feature Store auto-joins customer_premium_features via model lineage.
keys_sdf = spark.table(FEATURE_TABLE_NAME).select("customer_id")

try:
    scored_sdf = fe.score_batch(
        model_uri=f"models:/{MODEL_NAME}@prod",
        df=keys_sdf,
        result_type="double",                 # pyfunc returns a probability
    )
    # score_batch appends a single non-key output column ("prediction" by
    # default). Resolve defensively in case the runtime names it differently.
    pred_col = "prediction" if "prediction" in scored_sdf.columns else \
        [c for c in scored_sdf.columns if c != "customer_id"][-1]
    preds_pdf = (
        scored_sdf
        .select("customer_id", F.col(pred_col).alias("premium_prob"))
        .toPandas()
    )
    scored_via = "fe.score_batch"
    print("Scored via fe.score_batch() (Feature Store auto-join).")
except Exception as e:
    # Defensive fallback: if the serverless version-parse regression ever slips
    # past the shim, score in-process with the SAME bundled pyfunc. Identical
    # features + preprocessing → identical result; only the execution path differs.
    scored_via = f"in_process_fallback ({type(e).__name__})"
    print(f"fe.score_batch() unavailable ({type(e).__name__}: {e}); "
          f"falling back to in-process scoring with the same pyfunc.")
    feats_pdf = spark.table(FEATURE_TABLE_NAME).toPandas()
    preds_pdf = pd.DataFrame({
        "customer_id":  feats_pdf["customer_id"].values,
        "premium_prob": wrapped.predict(None, feats_pdf).astype(float),
    })

# Join back the CS label for premium_status_labeled (unchanged downstream contract).
labels_pdf = (
    features_sdf.select("customer_id", "premium_status")
    .toPandas()
    .rename(columns={"premium_status": "premium_status_labeled"})
)
preds_pdf = preds_pdf.merge(labels_pdf, on="customer_id", how="left")
preds_pdf["premium_prob"] = preds_pdf["premium_prob"].astype(float)
preds_pdf["predicted_at"] = datetime.utcnow()

# Dynamic threshold — same logic as original notebook
# Target ~22% of unlabeled population predicted as premium
unlabeled_mask = preds_pdf["premium_status_labeled"].isna()
target_unlabeled_premium_pct = 0.22
threshold = float(np.quantile(preds_pdf.loc[unlabeled_mask, "premium_prob"], 1 - target_unlabeled_premium_pct))
print(f"Chosen premium-prob threshold: {threshold:.3f} (targets {target_unlabeled_premium_pct:.0%} of unlabeled)")

preds_pdf["is_premium_predicted"] = preds_pdf["premium_prob"] > threshold
preds_pdf["final_tier"] = np.where(
    (preds_pdf["premium_status_labeled"] == "premium") | (preds_pdf["is_premium_predicted"]),
    "premium",
    "standard",
)

# Write to the same output table as the original notebook
spark.createDataFrame(preds_pdf).write.mode("overwrite").saveAsTable(
    f"{CATALOG}.{SCHEMA}.gold_customer_premium_predictions"
)

n_total = len(preds_pdf)
n_pred_premium = int(preds_pdf["is_premium_predicted"].sum())
n_labeled_premium = int((preds_pdf["premium_status_labeled"] == "premium").sum())
n_final_premium = int((preds_pdf["final_tier"] == "premium").sum())
print(f"Scored {n_total} | labeled premium {n_labeled_premium} | predicted premium {n_pred_premium} | final_tier=premium {n_final_premium}")

# COMMAND ----------

# MAGIC %md ## 7. Validation — affected-lot tier split

# COMMAND ----------

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

# MAGIC %md ## 8. Notebook exit

# COMMAND ----------

dbutils.notebook.exit(json.dumps({
    "model_name":        MODEL_NAME,
    "feature_table":     FEATURE_TABLE_NAME,
    "model_version":     model_version,
    "val_auc":           round(val_auc, 4),
    "scored_via":        scored_via,
    "total_scored":      n_total,
    "labeled_premium":   n_labeled_premium,
    "predicted_premium": n_pred_premium,
    "final_premium":     n_final_premium,
    "affected_lot":      val,
}))
