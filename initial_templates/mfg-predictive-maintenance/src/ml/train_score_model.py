"""
TechRobotics — failure-risk model: feature engineering, training, UC registration, fleet scoring.

Reads  <catalog>.<schema>.{assets, sensor_readings, maintenance_work_orders, failure_events}
Writes <catalog>.<schema>.asset_health_features   daily per-asset condition features (+ label)
       <catalog>.<schema>.asset_risk_scores       latest fleet scoring (one row per asset)
       UC model <catalog>.<schema>.failure_risk_model  (alias @champion)

Model: scikit-learn GradientBoostingClassifier predicting P(unplanned failure within 7 days)
from sensor-drift features relative to each asset's own lagged baseline + maintenance context.
Top drivers per asset are derived from the feature deviations (explainable to a reliability
engineer: "vibration 2.7x baseline", "+12 C").

Usage (Databricks job / serverless):  python train_score_model.py --catalog X --schema Y
Local test (no Spark / MLflow):        python train_score_model.py --local-in /path/to/parquet_dir
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

HORIZON_DAYS = 7
FEATURES = ["vib_ratio", "vib_trend", "temp_delta", "current_ratio", "pressure_ratio",
            "days_since_pm", "days_since_failure",
            "is_robot", "is_cnc", "is_press", "is_compressor"]
FAILURE_VIB_RATIO = 3.2  # typical vibration ratio at breakdown (from history) — used for RUL extrapolation


def daily_from_sensors(sensor: pd.DataFrame) -> pd.DataFrame:
    s = sensor[sensor.machine_state == "RUNNING"].copy()
    s["d"] = pd.to_datetime(s.reading_ts).dt.normalize()
    return s.groupby(["asset_id", "d"]).agg(
        vib=("vibration_rms_mm_s", "mean"), temp=("temperature_c", "mean"),
        cur=("motor_current_a", "mean"), pres=("pressure_bar", "mean")).reset_index()


def build_features(daily: pd.DataFrame, assets: pd.DataFrame, wos: pd.DataFrame, fails: pd.DataFrame) -> pd.DataFrame:
    out = []
    pm = wos[wos.work_type == "Preventive"][["asset_id", "scheduled_ts"]].copy()
    pm["pm_d"] = pd.to_datetime(pm.scheduled_ts).dt.normalize()
    fl = fails[["asset_id", "failure_ts"]].copy()
    fl["f_d"] = pd.to_datetime(fl.failure_ts).dt.normalize()
    a_idx = assets.set_index("asset_id")
    for aid, g in daily.groupby("asset_id"):
        g = g.sort_values("d").set_index("d")
        full = g.reindex(pd.date_range(g.index.min(), g.index.max(), freq="D"))
        r3 = full[["vib", "temp", "cur", "pres"]].rolling(3, min_periods=1).mean()
        base = full[["vib", "temp", "cur", "pres"]].shift(14).rolling(30, min_periods=10).median()
        prev = full["vib"].shift(4).rolling(4, min_periods=2).mean()
        f = pd.DataFrame(index=full.index)
        f["asset_id"] = aid
        f["vib_mean"] = r3.vib
        f["temp_mean"] = r3.temp
        f["current_mean"] = r3.cur
        f["pressure_mean"] = r3.pres
        f["vib_baseline"] = base.vib
        f["temp_baseline"] = base.temp
        f["vib_ratio"] = r3.vib / base.vib
        f["vib_trend"] = (r3.vib - prev) / base.vib
        f["temp_delta"] = r3.temp - base.temp
        f["current_ratio"] = r3.cur / base.cur
        f["pressure_ratio"] = r3.pres / base.pres
        days = f.index.values
        p_days = np.sort(pm[pm.asset_id == aid].pm_d.values)
        f_days = np.sort(fl[fl.asset_id == aid].f_d.values)

        def since(events):
            if len(events) == 0:
                return np.full(len(days), 365.0)
            idx = np.searchsorted(events, days, side="right") - 1
            res = np.where(idx >= 0, (days - events[np.clip(idx, 0, None)]) / np.timedelta64(1, "D"), 365.0)
            return np.minimum(res.astype(float), 365.0)

        def until(events):
            if len(events) == 0:
                return np.full(len(days), np.inf)
            idx = np.searchsorted(events, days, side="left")
            ok = idx < len(events)
            res = np.full(len(days), np.inf)
            res[ok] = (events[idx[ok]] - days[ok]) / np.timedelta64(1, "D")
            return res

        f["days_since_pm"] = since(p_days)
        f["days_since_failure"] = since(f_days)
        ttf = until(f_days)
        f["days_to_failure"] = np.where(np.isfinite(ttf), ttf, np.nan)
        f["label_fail_7d"] = ((ttf > 0) & (ttf <= HORIZON_DAYS)).astype(int)
        typ = a_idx.loc[aid, "asset_type"]
        f["asset_type"] = typ
        f["age_years"] = (f.index - pd.Timestamp(a_idx.loc[aid, "install_date"])).days / 365.25
        f["is_robot"] = int(typ == "Robot")
        f["is_cnc"] = int(typ == "CNC")
        f["is_press"] = int(typ == "Servo Press")
        f["is_compressor"] = int(typ == "Compressor")
        out.append(f.reset_index(names="feature_date"))
    feats = pd.concat(out, ignore_index=True)
    return feats.dropna(subset=["vib_ratio", "temp_delta", "pressure_ratio", "current_ratio", "vib_mean"])


def train(feats: pd.DataFrame):
    latest = feats.feature_date.max()
    # train on history, holding out nothing from "today" (scoring set) — time-based split for eval
    hist = feats[feats.feature_date < latest - pd.Timedelta(days=HORIZON_DAYS)]
    cut = hist.feature_date.min() + (hist.feature_date.max() - hist.feature_date.min()) * 0.6
    tr, te = hist[hist.feature_date < cut], hist[hist.feature_date >= cut]
    params = dict(n_estimators=150, max_depth=2, learning_rate=0.05, subsample=0.85, random_state=7)
    w = np.where(tr.label_fail_7d == 1, 3.0, 1.0)
    m = GradientBoostingClassifier(**params).fit(tr[FEATURES], tr.label_fail_7d, sample_weight=w)
    p = m.predict_proba(te[FEATURES])[:, 1]
    metrics = dict(auc=float(roc_auc_score(te.label_fail_7d, p)) if te.label_fail_7d.nunique() > 1 else float("nan"),
                   avg_precision=float(average_precision_score(te.label_fail_7d, p)) if te.label_fail_7d.sum() else float("nan"),
                   train_rows=int(len(tr)), test_rows=int(len(te)),
                   train_positives=int(tr.label_fail_7d.sum()), test_positives=int(te.label_fail_7d.sum()))
    final = GradientBoostingClassifier(**params).fit(
        hist[FEATURES], hist.label_fail_7d, sample_weight=np.where(hist.label_fail_7d == 1, 3.0, 1.0))
    return final, metrics, params


def explain(row) -> list[str]:
    cands = []
    if row.vib_ratio > 1.15:
        cands.append(((row.vib_ratio - 1.0) * 2.0,
                      f"Vibration RMS {row.vib_ratio:.1f}x baseline "
                      f"({row.vib_mean:.2f} vs {row.vib_baseline:.2f} mm/s)"))
    if row.temp_delta > 2.5:
        cands.append((row.temp_delta / 5.0, f"Temperature +{row.temp_delta:.1f} °C vs baseline "
                                             f"({row.temp_mean:.1f} °C)"))
    if row.pressure_ratio < 0.95:
        cands.append(((1 - row.pressure_ratio) * 8.0, f"Pressure {(1 - row.pressure_ratio) * 100:.0f}% below baseline "
                                                        f"({row.pressure_mean:.2f} bar)"))
    if row.current_ratio > 1.05:
        cands.append(((row.current_ratio - 1) * 6.0, f"Motor current +{(row.current_ratio - 1) * 100:.0f}% vs baseline"))
    if row.vib_trend > 0.15:
        cands.append((row.vib_trend * 2.5, f"Vibration still rising (+{row.vib_trend * 100:.0f}% of baseline in 4 days)"))
    if row.days_since_pm < 30 and (row.vib_ratio > 1.3 or row.temp_delta > 4):
        cands.append((0.9, f"Drift began after PM {int(row.days_since_pm)} days ago"))
    cands.sort(key=lambda x: -x[0])
    return [c[1] for c in cands[:3]] or ["All condition indicators within normal band"]


def likely_mode(row) -> str:
    t = row.asset_type
    if row.pressure_ratio < 0.95:
        return {"CNC": "Coolant system restriction / pump", "Servo Press": "Hydraulic overload seal leak"}.get(t, "Pressure loss")
    if row.vib_ratio > 1.3 and row.temp_delta > 3:
        return {"Robot": "J3 RV reducer bearing wear", "CNC": "Spindle bearing wear",
                "Servo Press": "Crank bearing wear"}.get(t, "Bearing wear")
    if row.temp_delta > 4 and row.current_ratio > 1.08:
        return {"Robot": "Servo motor overheat", "Compressor": "Discharge valve failure"}.get(t, "Motor overheat")
    return "No developing failure mode"


def score(model, feats: pd.DataFrame, assets: pd.DataFrame, version: str) -> pd.DataFrame:
    latest = feats.sort_values("feature_date").groupby("asset_id").tail(1).copy()
    latest["failure_prob_7d"] = model.predict_proba(latest[FEATURES])[:, 1]
    a = assets.set_index("asset_id")
    rows = []
    for r in latest.itertuples():
        prob = float(r.failure_prob_7d)
        tier = "Critical" if prob >= 0.7 else "High" if prob >= 0.4 else "Watch" if prob >= 0.15 else "Healthy"
        rul = None
        if r.vib_ratio > 1.3 and r.vib_trend > 0.05:
            slope = r.vib_trend / 4.0  # ratio points per day
            rul = float(np.clip((FAILURE_VIB_RATIO - r.vib_ratio) / max(slope, 1e-3), 0.5, 60))
        elif r.pressure_ratio < 0.95:
            rul = float(np.clip((r.pressure_ratio - 0.62) / 0.03, 1, 45))
        cost_hr = float(a.loc[r.asset_id, "downtime_cost_per_hour"])
        exp_dt = {"Robot": 13.0, "CNC": 12.0, "Servo Press": 11.0, "Test Stand": 2.0, "Compressor": 5.0}[r.asset_type]
        drivers = explain(r)
        rows.append(dict(
            asset_id=r.asset_id, scored_at=pd.Timestamp.now().floor("min"), feature_date=r.feature_date,
            failure_prob_7d=round(prob, 4), risk_score=int(round(prob * 100)), risk_tier=tier,
            predicted_failure_mode=likely_mode(r) if tier != "Healthy" else "No developing failure mode",
            est_days_to_failure=round(rul, 1) if (rul is not None and tier != "Healthy") else None,
            expected_downtime_hours=exp_dt,
            downtime_cost_at_risk_usd=round(prob * exp_dt * cost_hr, 0),
            unplanned_failure_cost_usd=round(exp_dt * cost_hr + 4200 + exp_dt * 900, 0),
            top_driver_1=drivers[0], top_driver_2=drivers[1] if len(drivers) > 1 else None,
            top_driver_3=drivers[2] if len(drivers) > 2 else None,
            vib_ratio=round(float(r.vib_ratio), 3), temp_delta_c=round(float(r.temp_delta), 2),
            pressure_ratio=round(float(r.pressure_ratio), 3), current_ratio=round(float(r.current_ratio), 3),
            days_since_pm=int(r.days_since_pm), model_version=version))
    return pd.DataFrame(rows).sort_values("failure_prob_7d", ascending=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="predictive_maintenance_copilot")
    ap.add_argument("--local-in", default=None)
    ap.add_argument("--experiment", default=None, help="MLflow experiment path (default: /Users/<me>/pdm_failure_risk_model)")
    args, _ = ap.parse_known_args()

    if args.local_in:
        rd = lambda t: pd.read_parquet(f"{args.local_in}/{t}.parquet")  # noqa: E731
        assets, wos, fails = rd("assets"), rd("maintenance_work_orders"), rd("failure_events")
        daily = daily_from_sensors(rd("sensor_readings"))
    else:
        from pyspark.sql import SparkSession
        spark = SparkSession.getActiveSession() or SparkSession.builder.getOrCreate()
        fq = lambda t: f"`{args.catalog}`.`{args.schema}`.`{t}`"  # noqa: E731
        assets = spark.table(fq("assets")).toPandas()
        wos = spark.table(fq("maintenance_work_orders")).toPandas()
        fails = spark.table(fq("failure_events")).toPandas()
        daily = spark.sql(f"""
            SELECT asset_id, date_trunc('DAY', reading_ts) AS d,
                   avg(vibration_rms_mm_s) AS vib, avg(temperature_c) AS temp,
                   avg(motor_current_a) AS cur, avg(pressure_bar) AS pres
            FROM {fq('sensor_readings')} WHERE machine_state = 'RUNNING'
            GROUP BY ALL""").toPandas()
        daily["d"] = pd.to_datetime(daily.d).dt.tz_localize(None)

    feats = build_features(daily, assets, wos, fails)
    model, metrics, params = train(feats)
    print("metrics:", json.dumps(metrics))
    imp = sorted(zip(FEATURES, model.feature_importances_), key=lambda x: -x[1])
    print("importances:", [(k, round(v, 3)) for k, v in imp])

    version = "local"
    if not args.local_in:
        import mlflow
        from mlflow.models import infer_signature
        mlflow.set_registry_uri("databricks-uc")
        model_name = f"{args.catalog}.{args.schema}.failure_risk_model"
        import os
        user = spark.sql("SELECT current_user()").first()[0]
        exp = args.experiment or os.environ.get("MLFLOW_EXPERIMENT", f"/Users/{user}/pdm_failure_risk_model")
        mlflow.set_experiment(exp)
        with mlflow.start_run(run_name="gbt_failure_risk_7d") as run:
            mlflow.log_params({**params, "horizon_days": HORIZON_DAYS, "features": ",".join(FEATURES)})
            mlflow.log_metrics({k: v for k, v in metrics.items() if isinstance(v, float) and not np.isnan(v)})
            mlflow.log_dict({k: float(v) for k, v in imp}, "feature_importances.json")
            sig = infer_signature(feats[FEATURES].head(50), model.predict_proba(feats[FEATURES].head(50))[:, 1])
            info = mlflow.sklearn.log_model(model, name="model", signature=sig, serialization_format="cloudpickle",
                                            input_example=feats[FEATURES].head(3),
                                            registered_model_name=model_name)
            print("run:", run.info.run_id)
        from mlflow import MlflowClient
        c = MlflowClient(registry_uri="databricks-uc")
        v = info.registered_model_version
        c.set_registered_model_alias(model_name, "champion", v)
        c.update_registered_model(model_name, description=(
            "P(unplanned failure within 7 days) per asset from condition-monitoring drift features. "
            "GradientBoostingClassifier. Scores land in asset_risk_scores."))
        version = f"{model_name}/{v}"
        # score with the REGISTERED model (proves the UC round-trip)
        model = mlflow.sklearn.load_model(f"models:/{model_name}@champion")

    scores = score(model, feats, assets, version)
    print(scores[["asset_id", "risk_score", "risk_tier", "predicted_failure_mode", "est_days_to_failure",
                  "top_driver_1"]].head(10).to_string())
    if args.local_in:
        return
    ff = feats.copy()
    ff["days_to_failure"] = ff["days_to_failure"].astype(float)
    spark.createDataFrame(ff).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq("asset_health_features"))
    spark.createDataFrame(scores).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq("asset_risk_scores"))
    spark.sql(f"COMMENT ON TABLE {fq('asset_health_features')} IS 'Daily per-asset condition features vs lagged baseline + 7-day failure label (ML training set).'")
    spark.sql(f"COMMENT ON TABLE {fq('asset_risk_scores')} IS 'Latest fleet scoring by failure_risk_model@champion: 7-day failure probability, risk tier, top drivers, remaining-useful-life estimate, downtime cost at risk.'")
    print("wrote asset_health_features + asset_risk_scores")


if __name__ == "__main__":
    main()
