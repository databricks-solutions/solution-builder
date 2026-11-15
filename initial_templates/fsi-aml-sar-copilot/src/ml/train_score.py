#!/usr/bin/env python
"""
Train the AML alert-risk model, register it in Unity Catalog, and score the queue.

Label   : alert ended in a SAR filing (1) vs closed as a false positive (0) — 12 months of
          investigator dispositions in gold_alert_features.
Model   : scikit-learn GradientBoostingClassifier on behavioural + KYC + network features.
Registry: <catalog>.<schema>.aml_alert_risk_model  (alias @champion)
Outputs : gold_alert_scores (every alert) and gold_alert_queue (open + in-review alerts,
          ML-ranked, with plain-English reason codes and the rules-engine rank for contrast).

Run: python train_score.py --catalog demo_generator --schema aml_sar_copilot [--experiment <path>]
"""
import argparse
import os

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split

FEATURES = ["rule_score", "sub_ctr_cnt_30d", "sub_ctr_amt_30d", "cash_in_30d", "cash_branches_30d",
            "hr_wire_out_30d", "funds_in_30d", "funds_out_30d", "pass_through_ratio", "cash_vs_expected",
            "account_age_days", "kyc_risk_level", "pep_flag", "is_business", "network_size",
            "network_degree", "network_parties_alerted_30d", "prior_alerts_90d"]


def get_spark():
    try:
        from databricks.connect import DatabricksSession
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        from pyspark.sql import SparkSession
        return SparkSession.builder.getOrCreate()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--catalog", default="demo_generator")
    p.add_argument("--schema", default="aml_sar_copilot")
    p.add_argument("--experiment", default="/Shared/fsi-aml-sar-copilot/aml_alert_risk")
    a, _ = p.parse_known_args()
    fq = f"{a.catalog}.{a.schema}"
    spark = get_spark()
    # sort: toPandas() row order is not stable across runs -> the split (and the model) would change on every re-run
    feats = spark.table(f"{fq}.gold_alert_features").toPandas().sort_values("alert_id").reset_index(drop=True)
    for f in FEATURES:
        feats[f] = pd.to_numeric(feats[f]).astype(float)
    # labels mature slowly (QA + SAR decision can take 30-60 days) -> train only on alerts raised before
    # 1-Aug-2026; the most recent dispositions are not yet trustworthy ground truth.
    lab = feats[feats.label.notna() & (pd.to_datetime(feats.alert_ts) < "2026-08-01")].copy()
    X, y = lab[FEATURES], lab.label.astype(int)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=7, stratify=y)

    if "DATABRICKS_RUNTIME_VERSION" not in os.environ:
        os.environ.setdefault("MLFLOW_TRACKING_URI", "databricks")
    mlflow.set_registry_uri("databricks-uc")
    try:
        mlflow.set_experiment(a.experiment)
    except Exception as e:  # folder missing on a fresh workspace -> fall back to /Shared
        print("experiment fallback:", e)
        mlflow.set_experiment("/Shared/aml_sar_copilot_alert_risk")
    model_name = f"{fq}.aml_alert_risk_model"
    with mlflow.start_run(run_name="gbm_alert_risk") as run:
        clf = GradientBoostingClassifier(n_estimators=250, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=7)
        clf.fit(Xtr, ytr)
        pte = clf.predict_proba(Xte)[:, 1]
        auc, ap = roc_auc_score(yte, pte), average_precision_score(yte, pte)
        # rules-engine baseline on the same hold-out: how well does rule_score alone rank SARs?
        auc_rules = roc_auc_score(yte, Xte.rule_score)
        mlflow.log_params({"n_estimators": 250, "max_depth": 3, "learning_rate": 0.05, "n_train": len(Xtr)})
        mlflow.log_metrics({"test_auc": auc, "test_avg_precision": ap, "rules_baseline_auc": auc_rules})
        imp = pd.Series(clf.feature_importances_, index=FEATURES).sort_values(ascending=False)
        mlflow.log_dict(imp.round(4).to_dict(), "feature_importance.json")
        sig = infer_signature(Xtr, clf.predict_proba(Xtr)[:, 1])
        info = mlflow.sklearn.log_model(clf, name="model", signature=sig, input_example=Xtr.head(3),
                                        registered_model_name=model_name, serialization_format="cloudpickle")
        print(f"AUC {auc:.3f} (rules baseline {auc_rules:.3f}) | AP {ap:.3f}\n{imp.head(8)}")
    client = mlflow.MlflowClient()
    version = info.registered_model_version
    client.set_registered_model_alias(model_name, "champion", version)
    client.update_registered_model(model_name, description=(
        "Northwind Federal AML alert-risk model: probability a TMS alert ends in a SAR filing. "
        "GradientBoosting on 30-day behaviour, KYC and entity-network features. "
        f"Hold-out AUC {auc:.3f} vs rules-score baseline {auc_rules:.3f}."))

    # score every alert with the registered champion
    champion = mlflow.sklearn.load_model(f"models:/{model_name}@champion")
    feats["ml_risk_score"] = np.round(champion.predict_proba(feats[FEATURES])[:, 1] * 100, 1)
    feats["model_version"] = str(version)
    out = feats[["alert_id", "ml_risk_score", "model_version"]]
    spark.createDataFrame(out).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.gold_alert_scores")
    spark.sql(f"COMMENT ON TABLE {fq}.gold_alert_scores IS 'ML risk score (0-100 = P(SAR)) for every alert from {model_name}@champion.'")

    spark.sql(f"""
    CREATE OR REPLACE TABLE {fq}.gold_alert_queue
    COMMENT 'Investigator work queue: open + in-review alerts ranked by ML risk, with rules-engine rank and reason codes.' AS
    SELECT a.alert_id, a.customer_id, c.customer_name, c.customer_type, c.occupation_or_industry, c.kyc_risk_rating,
           a.scenario, a.alert_ts, a.status, a.assigned_analyst, a.rule_score, s.ml_risk_score,
           rank() OVER (ORDER BY s.ml_risk_score DESC, a.rule_score DESC) AS ml_rank,
           rank() OVER (ORDER BY a.rule_score DESC) AS rules_rank,
           CASE WHEN s.ml_risk_score >= 70 THEN 'critical' WHEN s.ml_risk_score >= 40 THEN 'high'
                WHEN s.ml_risk_score >= 15 THEN 'medium' ELSE 'low' END AS ml_risk_band,
           a.triggered_amount, n.cluster_id, n.cluster_size,
           datediff(current_date(), a.alert_ts) AS age_days,
           filter(array(
             CASE WHEN f.sub_ctr_cnt_30d >= 3 THEN concat(f.sub_ctr_cnt_30d, ' cash deposits of $8K-$10K (just under CTR) in 30 days') END,
             CASE WHEN f.cash_branches_30d >= 3 THEN concat('cash deposited at ', f.cash_branches_30d, ' different branches') END,
             CASE WHEN n.cluster_size >= 3 THEN concat('linked to a ', n.cluster_size, '-party network (shared address / phone / device / transfers)') END,
             CASE WHEN f.network_parties_alerted_30d >= 2 THEN concat(f.network_parties_alerted_30d, ' linked parties also alerted in 30 days') END,
             CASE WHEN f.pass_through_ratio >= 0.8 AND f.funds_in_30d >= 20000 THEN concat(cast(round(least(f.pass_through_ratio,1)*100) AS INT), '% of inflows moved out again within 30 days') END,
             CASE WHEN f.hr_wire_out_30d > 0 THEN concat('$', format_number(f.hr_wire_out_30d, 0), ' wired to high-risk jurisdictions') END,
             CASE WHEN f.account_age_days < 240 THEN concat('relationship only ', f.account_age_days, ' days old') END,
             CASE WHEN f.cash_vs_expected >= 5 THEN concat('cash ', cast(f.cash_vs_expected AS INT), 'x the expected KYC profile') END
           ), x -> x IS NOT NULL) AS reason_codes
    FROM {fq}.alerts a
    JOIN {fq}.gold_alert_scores s USING (alert_id)
    JOIN {fq}.gold_alert_features f USING (alert_id)
    JOIN {fq}.customers c ON c.customer_id = a.customer_id
    JOIN {fq}.gold_customer_network n ON n.customer_id = a.customer_id
    WHERE a.status IN ('open', 'in_review')
    """)
    print(spark.sql(f"SELECT ml_rank, rules_rank, customer_name, scenario, rule_score, ml_risk_score FROM {fq}.gold_alert_queue ORDER BY ml_rank LIMIT 15").toPandas().to_string())


if __name__ == "__main__":
    main()
