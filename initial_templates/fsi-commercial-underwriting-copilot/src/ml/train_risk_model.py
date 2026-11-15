"""
Submission risk model: P(the account runs a loss ratio above 100% | its underwriting characteristics).

Trains on Tidewell's own book — every policy with at least two earned quarters in 2024-Q3…2026-Q2, label
adverse = incurred / earned premium > 1.0 — registers it in Unity Catalog as
<catalog>.<schema>.submission_risk_model with alias @champion, then batch-scores every submission in today's queue
TWICE → submission_risk_scores:

  p_as_submitted   on what the broker's application SAYS (application_extract)
  p_verified       on what the documents SHOW (sov_locations + loss_run_claims, TIV-weighted)

The gap between the two is the story: an account can look clean on the application and not be clean at all.
drivers = the features whose verified value moved the probability most.

    python train_risk_model.py --catalog financial_services --schema commercial_underwriting_copilot \
        --experiment "/Shared/fsi-commercial-underwriting-copilot/submission-risk"
"""
import argparse
import os

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from pyspark.sql import SparkSession
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

FEATURES = ["is_habitational", "hail_belt", "max_roof_age", "old_roof_tiv_share", "frame_tiv_share", "sprinklered_share",
            "max_building_age", "protection_class", "prior_loss_count", "log_prior_loss_amount", "prior_wind_hail_losses", "log_tiv"]
LABELS = {"max_roof_age": "roof age", "old_roof_tiv_share": "TIV under roofs >15 yrs", "frame_tiv_share": "frame construction",
          "sprinklered_share": "sprinklered TIV", "max_building_age": "building age", "protection_class": "protection class",
          "prior_loss_count": "prior losses", "log_prior_loss_amount": "prior loss $", "prior_wind_hail_losses": "wind/hail losses",
          "log_tiv": "TIV", "is_habitational": "habitational", "hail_belt": "hail belt"}
HAIL_BELT = ("TX", "OK", "KS", "NE", "CO")
# monotone: older roofs / more losses / frame can only raise risk; sprinklers only lower it
MONOTONIC = [0, 0, 1, 1, 1, -1, 1, 1, 1, 1, 1, 0]


def band(p: float) -> str:
    return "Low" if p < 0.25 else "Moderate" if p < 0.45 else "High"


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def train(df: pd.DataFrame):
    X, y = df[FEATURES].astype(float), df["adverse"].astype(int)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=11, stratify=y)
    model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_depth=3, min_samples_leaf=25, l2_regularization=1.0,
                                           monotonic_cst=MONOTONIC, random_state=11)
    model.fit(Xtr, ytr)
    auc = roc_auc_score(yte, model.predict_proba(Xte)[:, 1])
    return model, auc, Xtr, float(y.mean())


def drivers(model, sub: pd.DataFrame, ver: pd.DataFrame) -> list[str]:
    """Per submission: which verified features moved p most vs the application (swap one feature at a time)."""
    base = model.predict_proba(ver[FEATURES].astype(float))[:, 1]
    out = []
    deltas = {}
    for f in FEATURES:
        x = ver[FEATURES].astype(float).copy()
        x[f] = sub[f].astype(float).values
        deltas[f] = base - model.predict_proba(x)[:, 1]
    for i in range(len(ver)):
        top = sorted(((deltas[f][i], f) for f in FEATURES), reverse=True)
        out.append("; ".join(f"{LABELS[f]} {'+' if d >= 0 else ''}{d:.2f}" for d, f in top if abs(d) >= 0.02)[:300] or "no material change")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="financial_services")
    ap.add_argument("--schema", default="commercial_underwriting_copilot")
    ap.add_argument("--experiment", default="/Shared/fsi-commercial-underwriting-copilot/submission-risk")
    a, _ = ap.parse_known_args()
    fqs = f"{a.catalog}.{a.schema}"
    spark = get_spark()

    hist = spark.sql(f"""
        WITH ep AS (SELECT policy_id, SUM(earned_premium) ep, COUNT(*) q FROM {fqs}.policy_quarters GROUP BY policy_id),
             inc AS (SELECT policy_id, SUM(incurred_amount) inc FROM {fqs}.claims GROUP BY policy_id)
        SELECT CAST(p.segment_code = 'HAB' AS INT) is_habitational, CAST(p.hail_belt AS INT) hail_belt, p.roof_age_years max_roof_age,
               p.old_roof_tiv_share, p.frame_tiv_share, CAST(p.sprinklered AS INT) sprinklered_share,
               year(p.effective_date) - p.year_built max_building_age, p.protection_class, p.prior_loss_count_5yr prior_loss_count,
               ln(1 + p.prior_loss_amount_5yr) log_prior_loss_amount, p.prior_hail_losses_5yr prior_wind_hail_losses, ln(p.tiv) log_tiv,
               CAST(COALESCE(inc.inc, 0) / ep.ep > 1.0 AS INT) adverse
        FROM {fqs}.policies p JOIN ep ON ep.policy_id = p.policy_id LEFT JOIN inc ON inc.policy_id = p.policy_id
        WHERE ep.q >= 2""").toPandas()
    model, auc, Xtr, base_rate = train(hist)
    print(f"trained on {len(Xtr)} policies, holdout AUC {auc:.3f}, base adverse rate {base_rate:.3f}")

    prof = os.environ.get("DATABRICKS_CONFIG_PROFILE")  # local runs: databricks://<profile>; on Databricks: ambient
    mlflow.set_tracking_uri(f"databricks://{prof}" if prof else "databricks")
    mlflow.set_registry_uri(f"databricks-uc://{prof}" if prof else "databricks-uc")
    try:  # the experiment's parent folder must exist (fresh workspace folder on first run)
        from databricks.sdk import WorkspaceClient

        WorkspaceClient(profile=prof).workspace.mkdirs(os.path.dirname(a.experiment).replace("/Workspace", "", 1))
    except Exception as e:  # noqa: BLE001 — best-effort; set_experiment reports the real error
        print(f"mkdirs {os.path.dirname(a.experiment)}: {e}")
    mlflow.set_experiment(a.experiment)
    uc_name = f"{fqs}.submission_risk_model"
    with mlflow.start_run(run_name="submission_risk_hgb") as run:
        mlflow.log_params({"model": "HistGradientBoostingClassifier", "max_iter": 300, "max_depth": 3, "monotonic": True,
                           "label": "policy loss ratio > 100%", "features": ",".join(FEATURES)})
        mlflow.log_metrics({"holdout_auc": auc, "train_rows": len(Xtr), "base_adverse_rate": base_rate})
        mlflow.sklearn.log_model(model, name="model", signature=infer_signature(Xtr, model.predict_proba(Xtr)[:, 1]),
                                 input_example=Xtr.head(3), registered_model_name=uc_name, serialization_format="cloudpickle")
    from mlflow import MlflowClient

    c = MlflowClient()
    ver = max(int(v.version) for v in c.search_model_versions(f"name='{uc_name}'"))
    c.set_registered_model_alias(uc_name, "champion", str(ver))
    c.update_registered_model(uc_name, description="P(account loss ratio > 100%) for a commercial property / package submission. Trained on "
                              "Tidewell's 2024-Q3..2026-Q2 policy experience. Scored twice per submission: as the application states it and "
                              "as the SOV + loss runs verify it.")
    print(f"registered {uc_name} v{ver} @champion (run {run.info.run_id})")
    champion = mlflow.sklearn.load_model(f"models:/{uc_name}@champion")

    q = spark.sql(f"""
        WITH sov AS (
          SELECT submission_id, SUM(tiv) tiv, MAX(roof_age_years) max_roof_age,
                 SUM(CASE WHEN roof_age_years > 15 THEN tiv ELSE 0 END) / SUM(tiv) old_roof_tiv_share,
                 SUM(CASE WHEN lower(construction) LIKE '%frame%' THEN tiv ELSE 0 END) / SUM(tiv) frame_tiv_share,
                 SUM(CASE WHEN sprinklered THEN tiv ELSE 0 END) / SUM(tiv) sprinklered_share,
                 MAX(2026 - year_built) max_building_age, MAX(protection_class) protection_class
          FROM {fqs}.sov_locations GROUP BY submission_id),
        lr AS (SELECT submission_id, COUNT(*) n, SUM(total_incurred) amt, SUM(CAST(wind_hail AS INT)) wh FROM {fqs}.loss_run_claims GROUP BY submission_id)
        SELECT a.submission_id, CAST(a.segment_code = 'HAB' AS INT) is_habitational,
               CAST(array_contains(array{HAIL_BELT}, a.premises_state) AS INT) hail_belt,
               -- as the application states it
               2026 - a.roof_year s_max_roof_age, CAST(2026 - a.roof_year > 15 AS INT) s_old_roof_tiv_share,
               CAST(lower(a.construction) LIKE '%frame%' AS INT) s_frame_tiv_share, CAST(a.sprinklered AS INT) s_sprinklered_share,
               2026 - a.year_built s_max_building_age, a.protection_class s_protection_class, a.stated_loss_count s_prior_loss_count,
               ln(1 + a.stated_loss_amount) s_log_prior_loss_amount, 0 s_prior_wind_hail_losses, ln(a.total_tiv) s_log_tiv,
               -- as the documents verify it
               sov.max_roof_age v_max_roof_age, sov.old_roof_tiv_share v_old_roof_tiv_share, sov.frame_tiv_share v_frame_tiv_share,
               sov.sprinklered_share v_sprinklered_share, sov.max_building_age v_max_building_age, sov.protection_class v_protection_class,
               COALESCE(lr.n, 0) v_prior_loss_count, ln(1 + COALESCE(lr.amt, 0)) v_log_prior_loss_amount,
               COALESCE(lr.wh, 0) v_prior_wind_hail_losses, ln(sov.tiv) v_log_tiv
        FROM {fqs}.application_extract a JOIN sov ON sov.submission_id = a.submission_id LEFT JOIN lr ON lr.submission_id = a.submission_id
    """).toPandas()
    common = ["is_habitational", "hail_belt"]
    sub = q[common + [f"s_{f}" for f in FEATURES if f not in common]].rename(columns=lambda c: c[2:] if c.startswith("s_") else c)
    verified = q[common + [f"v_{f}" for f in FEATURES if f not in common]].rename(columns=lambda c: c[2:] if c.startswith("v_") else c)
    out = pd.DataFrame({"submission_id": q["submission_id"]})
    out["p_as_submitted"] = champion.predict_proba(sub[FEATURES].astype(float))[:, 1].round(4)
    out["p_verified"] = champion.predict_proba(verified[FEATURES].astype(float))[:, 1].round(4)
    out["band_as_submitted"] = out["p_as_submitted"].map(band)
    out["band_verified"] = out["p_verified"].map(band)
    out["drivers"] = drivers(champion, sub, verified)
    out["model_version"] = f"{uc_name}/{ver}"
    spark.createDataFrame(out).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fqs}.submission_risk_scores")
    spark.sql(f"COMMENT ON TABLE {fqs}.submission_risk_scores IS 'Batch scores of submission_risk_model@champion for every queued submission: "
              f"P(loss ratio > 100%) on the application as stated (p_as_submitted) vs on the SOV + loss runs (p_verified). Bands: Low < 0.25 <= "
              f"Moderate < 0.45 <= High. drivers = features that moved the verified score most.'")
    print(out.sort_values("p_verified", ascending=False).to_string(index=False))


if __name__ == "__main__":
    main()
