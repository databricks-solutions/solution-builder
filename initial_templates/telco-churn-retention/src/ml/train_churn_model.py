#!/usr/bin/env python
"""
Veridian Mobile — explainable 30-day churn-risk model.

  1. Feature engineering over MONTHLY SNAPSHOTS (Jan..Aug 2026): for every account active
     at the end of month s, features from months s-2..s and the label "churned in s+1".
     (Point-in-time correct: nothing after s leaks into the features, except the promo end
     date, which the business knows in advance.)
  2. XGBoost classifier, evaluated on the most recent snapshot (Aug -> Sep) held out.
  3. Logged to MLflow + registered in Unity Catalog as <catalog>.<schema>.churn_risk_model
     with alias @champion.
  4. Scores every ACTIVE account as of 2026-09-30 and explains each score with SHAP
     (xgboost pred_contribs), grouped into the 4 actionable driver families the retention
     desk can act on — network, bill_shock, competitor, care — plus "port_out_intent"
     (a port-out PIN request: a symptom that says WHEN, not WHY) and "account" (tenure,
     contract, plan) which the desk cannot change. top_driver = the largest actionable one.

Writes: customer_features (current), churn_scores (probability, tier, drivers, $ at risk).

Runs as a DAB spark_python_task (environment with xgboost + mlflow) or locally:
  DATABRICKS_CONFIG_PROFILE=<your-profile> python train_churn_model.py --catalog telecommunications \
      --schema churn_retention_copilot --experiment "/Users/<me>/churn_risk_model"
"""
import argparse
import os

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", default=os.environ.get("CATALOG", "telecommunications"))
ap.add_argument("--schema", default=os.environ.get("SCHEMA", "churn_retention_copilot"))
ap.add_argument("--experiment", default=os.environ.get("EXPERIMENT", ""))
args, _ = ap.parse_known_args()

from pyspark.sql import SparkSession  # noqa: E402

spark = SparkSession.getActiveSession()
LOCAL = spark is None
if LOCAL:
    from databricks.connect import DatabricksSession
    spark = DatabricksSession.builder.profile(os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")).serverless(True).getOrCreate()

import mlflow  # noqa: E402
import xgboost as xgb  # noqa: E402
from mlflow.models import infer_signature  # noqa: E402
from sklearn.metrics import roc_auc_score, average_precision_score  # noqa: E402

FQ = f"`{args.catalog}`.`{args.schema}`"
MODEL_NAME = f"{args.catalog}.{args.schema}.churn_risk_model"
print(f"== {FQ} ==")

cust = spark.table(f"{FQ}.customers").toPandas()
net = spark.table(f"{FQ}.network_quality_monthly").toPandas()
bill = spark.table(f"{FQ}.billing_monthly").toPandas()
calls = spark.table(f"{FQ}.care_calls").select("customer_id", "call_ts", "reason_code", "disposition").toPandas()
pins = spark.table(f"{FQ}.port_out_requests").select("customer_id", "request_date").toPandas()
comp = spark.table(f"{FQ}.competitor_promos").toPandas()

MONTHS = pd.date_range("2025-10-01", "2026-09-01", freq="MS")
mi = {m: i for i, m in enumerate(MONTHS)}
net["mi"] = pd.to_datetime(net.month).map(mi)
bill["mi"] = pd.to_datetime(bill.month).map(mi)
calls["mi"] = pd.to_datetime(calls.call_ts).dt.to_period("M").dt.to_timestamp().map(mi)
pins["mi"] = pd.to_datetime(pins.request_date).dt.to_period("M").dt.to_timestamp().map(mi)
cust["act_mi"] = (pd.to_datetime(cust.activation_date).dt.to_period("M") - pd.Period("2025-10", "M")).apply(lambda x: x.n)
cust["churn_mi"] = pd.to_datetime(cust.churn_date).dt.to_period("M").map(
    lambda p: (p - pd.Period("2025-10", "M")).n if pd.notna(p) else 99)
cust["promo_end_mi"] = pd.to_datetime(cust.promo_end_date).dt.to_period("M").map(
    lambda p: (p - pd.Period("2025-10", "M")).n if pd.notna(p) else -99)

NUM = ["tenure_months", "lines", "monthly_bill", "device_balance", "autopay",
       "dropped_call_rate_3m", "dropped_call_rate_delta", "download_mbps_3m", "outage_minutes_3m",
       "bill_change_3m_pct", "promo_expired_90d", "promo_expiring_60d",
       "competitor_promo_in_market", "port_out_pin_30d", "port_out_pin_90d",
       "care_calls_90d", "retention_calls_90d", "is_family", "is_small_business", "device_installment"]
FAMILY = {
    "network": ["dropped_call_rate_3m", "dropped_call_rate_delta", "download_mbps_3m", "outage_minutes_3m"],
    "bill_shock": ["bill_change_3m_pct", "promo_expired_90d", "promo_expiring_60d", "monthly_bill"],
    "competitor": ["competitor_promo_in_market"],
    "port_out_intent": ["port_out_pin_30d", "port_out_pin_90d"],
    "care": ["care_calls_90d", "retention_calls_90d"],
    "account": ["tenure_months", "lines", "device_balance", "autopay", "is_family", "is_small_business", "device_installment"],
}


def snapshot(s):
    """Features for accounts active at the end of month index s (+ label churn in s+1)."""
    c = cust[(cust.act_mi <= s) & (cust.churn_mi > s)].copy()
    c["tenure_months"] = s - c.act_mi + 1
    n3 = net[(net.mi > s - 3) & (net.mi <= s)].groupby("customer_id").agg(
        dropped_call_rate_3m=("dropped_call_rate_pct", "mean"), download_mbps_3m=("avg_5g_download_mbps", "mean"),
        outage_minutes_3m=("outage_minutes", "mean"))
    nprior = net[(net.mi > s - 9) & (net.mi <= s - 3)].groupby("customer_id").dropped_call_rate_pct.mean().rename("dcr_prior")
    b = bill[bill.mi == s].set_index("customer_id")[["bill_amount", "bill_change_3m_pct"]].rename(columns={"bill_amount": "monthly_bill"})
    cl = calls[(calls.mi > s - 3) & (calls.mi <= s)]
    care = cl.groupby("customer_id").size().rename("care_calls_90d")
    ret = cl[(cl.reason_code == "RETENTION") | (cl.disposition == "Escalated to loyalty")].groupby("customer_id").size().rename("retention_calls_90d")
    p30 = pins[pins.mi == s].groupby("customer_id").size().rename("port_out_pin_30d")
    p90 = pins[(pins.mi > s - 3) & (pins.mi <= s)].groupby("customer_id").size().rename("port_out_pin_90d")
    month_start = MONTHS[s]
    active_comp = comp[(pd.to_datetime(comp.start_date) <= month_start + pd.offsets.MonthEnd(0)) &
                       (comp.end_date.isna() | (pd.to_datetime(comp.end_date) >= month_start))].market_code.unique()
    c = c.set_index("customer_id").join([n3, nprior, b, care, ret, p30, p90])
    c["dropped_call_rate_delta"] = c.dropped_call_rate_3m - c.dcr_prior.fillna(c.dropped_call_rate_3m)
    for col in ["care_calls_90d", "retention_calls_90d", "port_out_pin_30d", "port_out_pin_90d"]:
        c[col] = c[col].fillna(0)
    c["promo_expired_90d"] = ((c.promo_end_mi > s - 3) & (c.promo_end_mi <= s)).astype(int)
    c["promo_expiring_60d"] = ((c.promo_end_mi > s) & (c.promo_end_mi <= s + 2)).astype(int)
    c["competitor_promo_in_market"] = c.market_code.isin(active_comp).astype(int)
    c["autopay"] = c.autopay.astype(int)
    c["is_family"] = (c.segment == "Family").astype(int)
    c["is_small_business"] = (c.segment == "Small Business").astype(int)
    c["device_installment"] = c.contract_type.str.startswith("Device").astype(int)
    c["label"] = (c.churn_mi == s + 1).astype(int)
    c["snapshot_month"] = MONTHS[s].date()
    return c


train_s = list(range(3, 10))   # Jan..Jul snapshots  -> labels Feb..Aug
test_s = [10]                  # Aug snapshot        -> label Sep (held out)
tr = pd.concat([snapshot(s) for s in train_s])
te = pd.concat([snapshot(s) for s in test_s])
print(f"train rows={len(tr):,} pos={tr.label.mean():.3%} | test rows={len(te):,} pos={te.label.mean():.3%}")

X_tr, y_tr = tr[NUM].astype(float), tr.label
X_te, y_te = te[NUM].astype(float), te.label
params = dict(n_estimators=350, max_depth=4, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
              min_child_weight=5, reg_lambda=2.0, eval_metric="aucpr", n_jobs=4)

if args.experiment:
    if LOCAL:
        mlflow.set_tracking_uri("databricks")
    mlflow.set_experiment(args.experiment)
mlflow.set_registry_uri("databricks-uc")

with mlflow.start_run(run_name="xgb_churn_30d") as run:
    model = xgb.XGBClassifier(**params)
    model.fit(X_tr, y_tr, eval_set=[(X_te, y_te)], verbose=False)
    p_te = model.predict_proba(X_te)[:, 1]
    auc = roc_auc_score(y_te, p_te)
    ap_ = average_precision_score(y_te, p_te)
    top = np.argsort(-p_te)[: max(1, len(p_te) // 10)]
    lift10 = y_te.values[top].mean() / y_te.mean()
    print(f"holdout AUC={auc:.3f} PR-AUC={ap_:.3f} top-decile lift={lift10:.2f}x")
    mlflow.log_params(params)
    mlflow.log_metrics({"holdout_auc": auc, "holdout_pr_auc": ap_, "top_decile_lift": lift10,
                        "train_rows": len(tr), "holdout_rows": len(te)})
    imp = pd.Series(model.feature_importances_, index=NUM).sort_values(ascending=False)
    mlflow.log_dict(imp.round(4).to_dict(), "feature_importance.json")
    sig = infer_signature(X_te.head(50), p_te[:50])
    info = mlflow.xgboost.log_model(model, name="model", signature=sig, input_example=X_te.head(5),
                                    registered_model_name=MODEL_NAME)
    version = info.registered_model_version
    print(f"registered {MODEL_NAME} v{version}")

from mlflow import MlflowClient  # noqa: E402
MlflowClient(registry_uri="databricks-uc").set_registered_model_alias(MODEL_NAME, "champion", version)

# ---------------------------------------------------------------------------
# Score active accounts as of Sep 2026 + SHAP drivers
# ---------------------------------------------------------------------------
cur = snapshot(len(MONTHS) - 1)
X = cur[NUM].astype(float)
prob = model.predict_proba(X)[:, 1]
contrib = model.get_booster().predict(xgb.DMatrix(X), pred_contribs=True)[:, :-1]   # drop bias
cdf = pd.DataFrame(contrib, columns=NUM, index=cur.index)
fam = pd.DataFrame({f: cdf[cols].clip(lower=0).sum(axis=1) for f, cols in FAMILY.items()})
share = fam.div(fam.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
actionable = ["network", "bill_shock", "competitor", "care"]
# A port-out PIN in a Crest market is competitor-driven shopping: credit it to "competitor"
# for the top-driver decision (the shares keep the raw SHAP split).
act = fam[actionable].copy()
act["competitor"] += fam.port_out_intent * cur.competitor_promo_in_market.values
top_driver = act.idxmax(axis=1).where(act.max(axis=1) > 0.05, "account")


def reasons(r):
    out = []
    if r.dropped_call_rate_3m > 2:
        out.append(f"Dropped-call rate {r.dropped_call_rate_3m:.1f}% (3-mo avg) on site {r.cell_site_id}")
    if r.promo_expired_90d:
        out.append(f"Switch & Save promo expired — bill +{r.bill_change_3m_pct:.0f}%")
    if r.promo_expiring_60d:
        out.append("Switch & Save promo ends within 60 days")
    if r.port_out_pin_30d:
        out.append("Requested a port-out PIN in the last 30 days")
    if r.competitor_promo_in_market:
        out.append(f"Crest Wireless $25/line promo active in {r.market}")
    if r.retention_calls_90d:
        out.append(f"{int(r.retention_calls_90d)} loyalty/cancel call(s) in 90 days")
    elif r.care_calls_90d >= 2:
        out.append(f"{int(r.care_calls_90d)} care calls in 90 days")
    return out[:4]


tier = np.select([prob >= 0.15, prob >= 0.07, prob >= 0.03], ["Critical", "High", "Medium"], "Low")
scores = pd.DataFrame({
    "customer_id": cur.index,
    "scored_at": pd.Timestamp("2026-09-30"),
    "churn_probability_30d": np.round(prob, 4),
    "risk_tier": tier,
    "top_driver": top_driver.values,
    "driver_network_pct": np.round(100 * share.network.values, 1),
    "driver_bill_shock_pct": np.round(100 * share.bill_shock.values, 1),
    "driver_competitor_pct": np.round(100 * share.competitor.values, 1),
    "driver_care_pct": np.round(100 * share.care.values, 1),
    "driver_port_out_intent_pct": np.round(100 * share.port_out_intent.values, 1),
    "driver_account_pct": np.round(100 * share.account.values, 1),
    "top_reasons": [reasons(r) for r in cur.itertuples()],
    "monthly_bill": cur.monthly_bill.round(2).values,
    "annual_revenue_at_risk": np.round(prob * cur.monthly_bill.values * 12, 2),
    "model_name": MODEL_NAME,
    "model_version": str(version),
})
print(scores.risk_tier.value_counts().to_string())
print(scores.groupby("risk_tier").churn_probability_30d.mean().round(3).to_string())
print(scores[scores.risk_tier.isin(["Critical", "High"])].top_driver.value_counts().to_string())
print(pd.crosstab(scores.risk_tier, scores.top_driver).to_string())
print(fam[scores.set_index("customer_id").risk_tier.isin(["Critical","High"]).values].mean().round(3).to_string())

feat = cur.reset_index()[["customer_id"] + NUM + ["market", "region", "segment", "plan", "cell_site_id"]]
feat.insert(1, "as_of_month", MONTHS[-1].date())
spark.createDataFrame(feat).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.customer_features")
spark.createDataFrame(scores).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.churn_scores")
spark.sql(f"COMMENT ON TABLE {FQ}.customer_features IS 'Point-in-time churn features per active account as of 2026-09 (input to churn_risk_model).'")
spark.sql(f"COMMENT ON TABLE {FQ}.churn_scores IS :c",
          args={"c": f"30-day churn probability per active account from {MODEL_NAME} v{version} (@champion), with SHAP driver shares (network / bill_shock / competitor / care / account) and annual revenue at risk = probability x monthly bill x 12."})
print("done.")
