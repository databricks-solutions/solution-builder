"""
30-day readmission risk model — scores every open discharge for the care-transitions worklist.

Training data: gold_discharges with a closed 30-day window (~2 years, all conditions). Target: readmitted_30d.
Features: LACE-style clinical risk (LOS, emergency admission, Charlson index, ED visits in 6 months, prior admissions),
condition, discharge disposition, social history from registration (lives alone, dual eligible, has a PCP), weekend
discharge and — the lever the care team controls — whether a 7-day follow-up was booked before discharge.

Registers <catalog>.<schema>.readmission_risk_model in Unity Catalog (alias @champion) and writes
discharge_risk_scores for every open discharge (planned, or discharged < 30 days ago):
  risk_score                predicted probability of an unplanned 30-day readmission
  risk_if_followup          same patient with a 7-day follow-up booked
  risk_if_followup_hh       … plus home health at discharge
  risk_tier                 High (≥ 30%) / Medium (≥ 18%) / Low
  top_drivers               the 3 features that raise this patient's risk most (sensitivity vs a neutral value)
Then creates the transition_worklist view the app mirrors into Lakebase.

    python train_readmission_model.py --catalog healthcare_lifesciences --schema readmission_reduction \
        --experiment "/Shared/hls-readmission-reduction/readmission_model_experiment"
"""
from __future__ import annotations

import argparse

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from pyspark.sql import SparkSession
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

CONDS = ["HF", "AMI", "PN", "COPD", "CABG", "THA_TKA"]
FEATURES = ["age", "los_days", "emergency_admit", "charlson_index", "ed_visits_6m", "prior_admits_12m", "discharge_med_count",
            "lives_alone", "dual_eligible", "has_pcp", "disp_snf", "disp_home_health", "weekend_discharge", "followup_7d_scheduled"] + [f"cond_{c}" for c in CONDS]
# feature → (neutral value, label shown to the coordinator)
DRIVERS = {
    "followup_7d_scheduled": (1, "No 7-day follow-up booked"),
    "ed_visits_6m": (0, "{v} ED visits in the last 6 months"),
    "prior_admits_12m": (0, "{v} admission(s) in the last 12 months"),
    "charlson_index": (2, "Charlson comorbidity index {v}"),
    "los_days": (4, "Length of stay {v} days"),
    "lives_alone": (0, "Lives alone"),
    "dual_eligible": (0, "Dual eligible (Medicare + Medicaid)"),
    "has_pcp": (1, "No primary care physician"),
    "age": (70, "Age {v}"),
    "weekend_discharge": (0, "Weekend discharge"),
    "disp_snf": (0, "Discharged to a skilled nursing facility"),
}


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    try:
        from databricks.connect import DatabricksSession  # type: ignore

        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


def featurize(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    for c in ["age", "los_days", "charlson_index", "ed_visits_6m", "prior_admits_12m", "discharge_med_count"]:
        out[c] = df[c].astype(float)
    out["emergency_admit"] = (df["admit_type"] == "Emergency").astype(float)
    for c in ["lives_alone", "dual_eligible", "has_pcp", "weekend_discharge", "followup_7d_scheduled"]:
        out[c] = df[c].fillna(False).astype(bool).astype(float)
    out["disp_snf"] = (df["discharge_disposition"] == "Skilled nursing facility").astype(float)
    out["disp_home_health"] = (df["discharge_disposition"] == "Home with home health").astype(float)
    for c in CONDS:
        out[f"cond_{c}"] = (df["hrrp_condition"] == c).astype(float)
    return out[FEATURES]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="healthcare_lifesciences")
    ap.add_argument("--schema", default="readmission_reduction")
    ap.add_argument("--experiment", default="/Shared/hls-readmission-reduction/readmission_model_experiment")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    cols = "encounter_id, age, los_days, admit_type, charlson_index, ed_visits_6m, prior_admits_12m, discharge_med_count, lives_alone, dual_eligible, has_pcp, discharge_disposition, weekend_discharge, followup_7d_scheduled, hrrp_condition, readmitted_30d, outcome_window_closed, status, discharge_date"
    df = spark.sql(f"SELECT {cols} FROM {s}.gold_discharges").toPandas()
    train = df[(df["outcome_window_closed"]) & (df["status"] == "discharged")]
    X, y = featurize(train), train["readmitted_30d"].astype(int)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=11, stratify=y)

    mlflow.set_tracking_uri("databricks")
    mlflow.set_registry_uri("databricks-uc")
    mlflow.set_experiment(args.experiment)
    model_name = f"{s}.readmission_risk_model"
    with mlflow.start_run(run_name="readmission_gbc") as run:
        params = dict(n_estimators=250, max_depth=3, learning_rate=0.05, subsample=0.9, min_samples_leaf=40, random_state=11)
        m = GradientBoostingClassifier(**params).fit(Xtr, ytr)
        p = m.predict_proba(Xte)[:, 1]
        metrics = dict(auc=float(roc_auc_score(yte, p)), brier=float(brier_score_loss(yte, p)), base_rate=float(y.mean()), n_train=len(Xtr))
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        imp = dict(sorted(zip(FEATURES, m.feature_importances_.round(4).tolist()), key=lambda kv: -kv[1]))
        mlflow.log_dict(imp, "feature_importance.json")
        mlflow.set_tag("target", "unplanned 30-day readmission (any Larkspur hospital)")
        mlflow.sklearn.log_model(m, name="model", signature=infer_signature(Xtr, m.predict_proba(Xtr.head(50))[:, 1]),
                                 input_example=Xtr.head(3), registered_model_name=model_name, serialization_format="cloudpickle")
        print("metrics", metrics, "importance", imp)
    client = mlflow.MlflowClient()
    version = max(int(v.version) for v in client.search_model_versions(f"name='{model_name}'"))
    client.set_registered_model_alias(model_name, "champion", str(version))
    client.update_registered_model(model_name, description="Larkspur Health 30-day unplanned readmission risk (GradientBoostingClassifier on 2 years of index discharges: LACE-style clinical risk, condition, disposition, social history, weekend discharge, 7-day follow-up booked). Scores the care-transitions worklist.")

    # ── score every open discharge ─────────────────────────────────────────────
    champion = mlflow.sklearn.load_model(f"models:/{model_name}@champion")
    open_ = df[(df["status"] == "planned") | (~df["outcome_window_closed"])].copy()
    Xo = featurize(open_)
    prob = lambda frame: champion.predict_proba(frame)[:, 1]
    open_["risk_score"] = prob(Xo).round(4)
    open_["risk_if_followup"] = prob(Xo.assign(followup_7d_scheduled=1.0)).round(4)
    open_["risk_if_followup_hh"] = prob(Xo.assign(followup_7d_scheduled=1.0, disp_home_health=1.0, disp_snf=0.0)).round(4)
    deltas = {}
    for f_, (neutral, _) in DRIVERS.items():
        deltas[f_] = open_["risk_score"].values - prob(Xo.assign(**{f_: float(neutral)}))
    drivers = []
    for i, (_, r) in enumerate(open_.iterrows()):
        ranked = sorted(((deltas[f_][i], f_) for f_ in DRIVERS), reverse=True)
        out = []
        for d, f_ in ranked[:3]:
            if d < 0.01:
                break
            v = Xo.iloc[i][f_]
            out.append(f"{DRIVERS[f_][1].format(v=int(v))} (+{round(d * 100)} pts)")
        drivers.append(out)
    open_["top_drivers"] = drivers
    open_["risk_tier"] = np.where(open_["risk_score"] >= 0.30, "High", np.where(open_["risk_score"] >= 0.18, "Medium", "Low"))
    open_["model_version"] = str(version)
    out = open_[["encounter_id", "risk_score", "risk_if_followup", "risk_if_followup_hh", "risk_tier", "top_drivers", "model_version"]]
    spark.createDataFrame(out).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{s}.discharge_risk_scores")
    spark.sql(f"COMMENT ON TABLE {s}.discharge_risk_scores IS 'readmission_risk_model@champion scores for every OPEN discharge (planned, or discharged < 30 days ago): risk_score = probability of an unplanned 30-day readmission; risk_if_followup = the same patient with a 7-day follow-up booked; risk_if_followup_hh = plus home health; risk_tier High (≥30%) / Medium (≥18%) / Low; top_drivers = the features raising this patient''s risk most (percentage points vs a neutral value).'")
    spark.sql(f"ALTER TABLE {s}.discharge_risk_scores ALTER COLUMN encounter_id SET NOT NULL")
    spark.sql(f"ALTER TABLE {s}.discharge_risk_scores ADD CONSTRAINT discharge_risk_scores_pk PRIMARY KEY (encounter_id) RELY")

    spark.sql(f"""
      CREATE OR REPLACE VIEW {s}.transition_worklist
      COMMENT 'Care-transitions worklist: patients with a planned discharge in the next days or discharged in the last 7 days, with the readmission risk score, its top drivers, the what-if risk with a 7-day follow-up, and what AI Functions read in the discharge note.'
      AS SELECT g.encounter_id, g.patient_id, g.patient_name, g.age, g.sex, g.primary_language, g.payer, g.dual_eligible, g.hospital_id, g.hospital_name,
                g.unit_id, g.unit_name, g.hrrp_condition, g.condition_label, g.principal_dx, g.principal_dx_code, g.admit_date, g.discharge_date,
                g.discharge_dow, g.weekend_discharge, g.status, g.los_days, g.charlson_index, g.ed_visits_6m, g.prior_admits_12m, g.discharge_med_count,
                g.discharge_disposition, g.lives_alone, g.has_pcp, g.followup_7d_scheduled, g.followup_date, g.followup_clinic, g.attending,
                g.medicare_ffs_65, sc.risk_score, sc.risk_if_followup, sc.risk_if_followup_hh, sc.risk_tier, sc.top_drivers, sc.model_version,
                i.transportation_barrier, i.medication_affordability, i.caregiver_support, i.language_barrier, i.high_risk_med_change,
                i.med_changes, i.followup_status AS note_followup_status, i.pending_labs, i.sdoh_summary, n.note_text
         FROM {s}.gold_discharges g
         JOIN {s}.discharge_risk_scores sc USING (encounter_id)
         LEFT JOIN {s}.discharge_note_insights i USING (encounter_id)
         LEFT JOIN {s}.discharge_notes n USING (encounter_id)
         WHERE g.status = 'planned' OR g.discharge_date >= date_sub((SELECT max(data_as_of) FROM {s}.hospitals), 7)
    """)
    top = spark.sql(f"SELECT patient_name, unit_id, hrrp_condition, discharge_date, status, risk_score, risk_if_followup, top_drivers FROM {s}.transition_worklist ORDER BY risk_score DESC LIMIT 8").toPandas()
    print(top.to_string())
    print(f"registered {model_name} v{version} @champion; run {run.info.run_id}")


if __name__ == "__main__":
    main()
