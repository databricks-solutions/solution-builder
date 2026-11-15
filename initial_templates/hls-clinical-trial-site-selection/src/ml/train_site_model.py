"""
Site enrollment model — predicts how many patients / month a site will randomize in CASCADE-CKD, and scores every
network site under the CURRENT protocol and with the proposed E4 amendment (stable background SGLT2i allowed).

Training data: site_trial_history (each site's past trials, any sponsor). Target: enroll_rate_per_month.
Features: eligible-patient density in the catchment, competing trials nearby, start-up days, site type / IRB /
coordinator capacity, prior Halcyra experience, renal-metabolic TA flag, and the site's leave-one-out historical
enrollment rate (its track record on its OTHER trials).

Registers <catalog>.<schema>.site_enrollment_model in Unity Catalog (alias @champion) and writes site_scores:
predicted rate current vs amended, estimated activation months, expected randomizations in the next 12 months,
and the candidate ranking used by the app's rescue plan.

    python train_site_model.py --catalog healthcare_lifesciences --schema trial_site_selection \
        --experiment "/Shared/hls-clinical-trial-site-selection/site_enrollment_model_experiment"
"""
from __future__ import annotations

import argparse

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from pyspark.sql import SparkSession
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

FEATURES = ["eligible_density_index", "competing_trials_nearby", "activation_days", "coordinator_fte", "is_central_irb",
            "is_academic", "is_research_network", "prior_halcyra_trials", "is_renal_metabolic_ta", "loo_hist_rate"]
DENSITY_UNIT = 600.0  # eligible patients within 30 miles that correspond to density index 1.0


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    try:
        from databricks.connect import DatabricksSession  # type: ignore

        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


def site_flags(df: pd.DataFrame) -> pd.DataFrame:
    df["is_central_irb"] = (df["irb_type"] == "central").astype(int)
    df["is_academic"] = (df["site_type"] == "academic").astype(int)
    df["is_research_network"] = (df["site_type"] == "research_network").astype(int)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="healthcare_lifesciences")
    ap.add_argument("--schema", default="trial_site_selection")
    ap.add_argument("--experiment", default="/Shared/hls-clinical-trial-site-selection/site_enrollment_model_experiment")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()

    hist = spark.table(f"{s}.site_trial_history").toPandas()
    sites = site_flags(spark.table(f"{s}.sites").toPandas())
    feats = spark.table(f"{s}.gold_site_features").toPandas()

    # leave-one-out track record: mean rate on the site's OTHER past trials
    g = hist.groupby("site_id")["enroll_rate_per_month"]
    hist["_sum"], hist["_n"] = g.transform("sum"), g.transform("count")
    hist["loo_hist_rate"] = np.where(hist["_n"] > 1, (hist["_sum"] - hist["enroll_rate_per_month"]) / (hist["_n"] - 1).clip(lower=1), hist["enroll_rate_per_month"].mean())
    hist["is_renal_metabolic_ta"] = hist["therapeutic_area"].isin(["Nephrology", "Endocrinology"]).astype(int)
    train = hist.merge(sites[["site_id", "coordinator_fte", "is_central_irb", "is_academic", "is_research_network", "prior_halcyra_trials"]], on="site_id")
    X, y = train[FEATURES].astype(float), train["enroll_rate_per_month"].astype(float)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=7)

    mlflow.set_registry_uri("databricks-uc")
    mlflow.set_experiment(args.experiment)
    model_name = f"{s}.site_enrollment_model"
    with mlflow.start_run(run_name="site_enrollment_gbr") as run:
        params = dict(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=7)
        m = GradientBoostingRegressor(**params).fit(Xtr, ytr)
        pred = m.predict(Xte)
        metrics = dict(mae=float(mean_absolute_error(yte, pred)), r2=float(r2_score(yte, pred)), n_train=len(Xtr))
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        imp = dict(sorted(zip(FEATURES, m.feature_importances_.round(4).tolist()), key=lambda kv: -kv[1]))
        mlflow.log_dict(imp, "feature_importance.json")
        mlflow.set_tag("target", "enroll_rate_per_month (randomized patients / site / month)")
        info = mlflow.sklearn.log_model(m, name="model", signature=infer_signature(Xtr, pred), input_example=Xtr.head(3),
                                        registered_model_name=model_name, serialization_format="cloudpickle")
        print("metrics", metrics, "importance", imp)
    client = mlflow.MlflowClient()
    version = max(int(v.version) for v in client.search_model_versions(f"name='{model_name}'"))
    client.set_registered_model_alias(model_name, "champion", str(version))
    client.update_registered_model(model_name, description="Predicts randomized patients per site per month for CASCADE-CKD (GradientBoosting on site_trial_history). Used to rank rescue sites under the current and amended protocol.")

    # ── score every network site for CASCADE-CKD ────────────────────────────────
    f = feats.copy()
    f = site_flags(f)
    f["loo_hist_rate"] = f["hist_rate_all"].fillna(hist["enroll_rate_per_month"].mean())
    f["activation_days"] = np.where(f["irb_type"] == "central", 150, 245) - np.where(f["prior_halcyra_trials"] >= 2, 25, 0)
    f["activation_days"] = np.minimum(f["activation_days"], f["hist_activation_days_median"].fillna(999))
    f["competing_trials_nearby"] = f["competing_dkd_trials"]
    f["is_renal_metabolic_ta"] = 1
    Xc = f.assign(eligible_density_index=f["eligible_current_protocol"] / DENSITY_UNIT)[FEATURES].astype(float)
    Xa = f.assign(eligible_density_index=f["eligible_amended_e4"] / DENSITY_UNIT)[FEATURES].astype(float)
    champion = mlflow.sklearn.load_model(f"models:/{model_name}@champion")
    f["predicted_rate_current"] = champion.predict(Xc).clip(0).round(2)
    f["predicted_rate_amended"] = champion.predict(Xa).clip(0).round(2)
    # Candidate start-up: rescue sites activate directly on the amended protocol (SOP CLINOPS-014 §5.3).
    f["est_activation_months"] = (f["activation_days"] / 30.4).round(1)
    f["expected_randomized_12m"] = (f["predicted_rate_amended"] * (12 - f["est_activation_months"]).clip(lower=0)).round(1)
    eligible = (f["cascade_status"] == "candidate") & (~f["has_dkd_competitor"]) & (f["eligible_amended_e4"] >= 300)
    f["rescue_eligible"] = eligible
    f["rescue_rank"] = f["expected_randomized_12m"].where(eligible).rank(ascending=False, method="first")
    reasons = []
    for _, r in f.iterrows():
        bits = [f"{int(r.eligible_amended_e4)} eligible patients within 30 mi with the amendment ({r.amendment_pool_multiplier}x today)"]
        bits.append(f"track record {r.loo_hist_rate:.2f} pts/mo on past trials")
        bits.append("central IRB" if r.is_central_irb else "local IRB (slower start-up)")
        if r.has_dkd_competitor:
            bits.append(f"competing DKD trial on site ({r.competing_trial_names})")
        if r.prior_halcyra_trials:
            bits.append(f"{int(r.prior_halcyra_trials)} prior Halcyra trials")
        reasons.append("; ".join(bits))
    f["score_rationale"] = reasons
    f["model_version"] = str(version)
    out = f[["site_id", "site_name", "city", "state", "region", "site_type", "irb_type", "cascade_status", "eligible_current_protocol",
             "eligible_amended_e4", "amendment_pool_multiplier", "loo_hist_rate", "competing_dkd_trials", "has_dkd_competitor",
             "competing_trial_names", "prior_halcyra_trials", "predicted_rate_current", "predicted_rate_amended",
             "est_activation_months", "expected_randomized_12m", "rescue_eligible", "rescue_rank", "score_rationale", "model_version"]]
    out = out.rename(columns={"loo_hist_rate": "hist_rate_per_month"})
    sdf = spark.createDataFrame(out)
    sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.site_scores")
    spark.sql(f"COMMENT ON TABLE {s}.site_scores IS 'site_enrollment_model@champion scores for every network site in CASCADE-CKD: predicted randomized patients / month under the current protocol and with the E4 amendment, estimated activation months, expected randomizations in the next 12 months. rescue_rank ranks candidate sites (not yet selected, no competing DKD trial, ≥ 300 amended-eligible patients).'")
    print(out.sort_values("rescue_rank").head(12)[["site_id", "site_name", "city", "predicted_rate_current", "predicted_rate_amended", "est_activation_months", "expected_randomized_12m"]].to_string())
    print(f"registered {model_name} v{version} @champion; run {run.info.run_id}")


if __name__ == "__main__":
    main()
