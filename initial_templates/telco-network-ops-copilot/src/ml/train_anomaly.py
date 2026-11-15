"""
Cell KPI anomaly detection — the model that sees what no alarm threshold does.

1. Features per cell per day from gold_cell_kpi_daily (the SDP pipeline): each KPI vs the cell's OWN lagged
   baseline (median of days d-20 .. d-7, so a slow drift can't hide in its own baseline) + the 7-day slope of the
   dropped-call rate.
2. An Isolation Forest over every cell-day (standardized deviations), logged to MLflow and registered in Unity
   Catalog as <catalog>.<schema>.cell_kpi_anomaly_model with alias @champion.
3. anomaly_score 0-100 = breadth (how many KPIs deviate > 4 robust sigma from the whole network that day, in the
   degrading direction) scaled by the Isolation Forest percentile, + human-readable top factors →
   <catalog>.<schema>.cell_health_daily (the incident-queue task turns flagged cells into NOC incidents).

    python train_anomaly.py --catalog telecommunications --schema network_ops_copilot \
        --experiment "/Shared/telco-network-ops-copilot/kpi_anomaly_experiment"
"""
import argparse

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from pyspark.sql import SparkSession


def get_spark() -> SparkSession:
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


# feature -> degrading direction is POSITIVE for every feature below (deltas are oriented so bigger = worse)
FEATURES = ["drop_delta", "rrc_delta", "sinr_delta", "vswr_delta", "ul_delta", "prb_delta", "avail_gap", "drop_slope_7d"]
SCORED_DAYS = 8


def features_sql(fqs: str) -> str:
    return f"""
    WITH d AS (SELECT *, datediff(day, (SELECT max(day) FROM {fqs}.gold_cell_kpi_daily)) AS di FROM {fqs}.gold_cell_kpi_daily),
    base AS (
      SELECT a.cell_id, a.day,
             percentile_approx(b.drop_call_rate_pct, 0.5) b_drop, percentile_approx(b.rrc_setup_success_pct, 0.5) b_rrc,
             percentile_approx(b.avg_sinr_db, 0.5) b_sinr, percentile_approx(b.max_vswr, 0.5) b_vswr,
             percentile_approx(b.ul_interference_dbm, 0.5) b_ul, percentile_approx(b.peak_prb_utilization_pct, 0.5) b_prb
      FROM d a JOIN d b ON a.cell_id = b.cell_id AND b.di BETWEEN a.di - 20 AND a.di - 7
      WHERE a.di > -{SCORED_DAYS}
      GROUP BY a.cell_id, a.day),
    slope AS (
      SELECT a.cell_id, a.day, regr_slope(b.drop_call_rate_pct, b.di) s
      FROM d a JOIN d b ON a.cell_id = b.cell_id AND b.di BETWEEN a.di - 6 AND a.di
      WHERE a.di > -{SCORED_DAYS} GROUP BY a.cell_id, a.day)
    SELECT d.cell_id, d.site_id, d.sector, d.day, d.availability_pct, d.drop_call_rate_pct, d.rrc_setup_success_pct, d.avg_sinr_db,
           d.max_vswr, d.ul_interference_dbm, d.peak_prb_utilization_pct,
           base.b_drop, base.b_rrc, base.b_sinr, base.b_vswr, base.b_ul, base.b_prb,
           coalesce(d.drop_call_rate_pct - base.b_drop, 0) drop_delta,
           coalesce(base.b_rrc - d.rrc_setup_success_pct, 0) rrc_delta,
           coalesce(base.b_sinr - d.avg_sinr_db, 0) sinr_delta,
           coalesce(d.max_vswr - base.b_vswr, 0) vswr_delta,
           coalesce(d.ul_interference_dbm - base.b_ul, 0) ul_delta,
           coalesce(d.peak_prb_utilization_pct - base.b_prb, 0) prb_delta,
           100 - coalesce(d.availability_pct, 100) avail_gap,
           coalesce(slope.s, 0) drop_slope_7d
    FROM d JOIN base USING (cell_id, day) LEFT JOIN slope USING (cell_id, day)"""


def factor_text(r, f):
    return {
        "drop_delta": f"Dropped-call rate {r.drop_call_rate_pct:.2f}% vs {r.b_drop:.2f}% baseline",
        "rrc_delta": f"RRC setup success {r.rrc_setup_success_pct:.1f}% vs {r.b_rrc:.1f}% baseline",
        "sinr_delta": f"Average SINR {r.avg_sinr_db:.1f} dB vs {r.b_sinr:.1f} dB baseline",
        "vswr_delta": f"VSWR {r.max_vswr:.2f} vs {r.b_vswr:.2f} baseline (alarm threshold 2.0 not reached)",
        "ul_delta": f"Uplink interference {r.ul_interference_dbm:.1f} dBm vs {r.b_ul:.1f} dBm baseline",
        "prb_delta": f"Peak PRB utilization {r.peak_prb_utilization_pct:.0f}% vs {r.b_prb:.0f}% baseline",
        "avail_gap": f"Availability {r.availability_pct:.1f}%",
        "drop_slope_7d": f"Dropped-call rate rising {7 * r.drop_slope_7d:+.2f} pts per week",
    }[f]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="telecommunications")
    ap.add_argument("--schema", default="network_ops_copilot")
    ap.add_argument("--experiment", default="/Shared/telco-network-ops-copilot/kpi_anomaly_experiment")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    model_name = f"{fqs}.cell_kpi_anomaly_model"
    spark = get_spark()
    mlflow.set_registry_uri("databricks-uc")
    try:
        mlflow.set_tracking_uri("databricks")
    except Exception:
        pass

    # toPandas() row order is not stable across runs; sort so the Isolation Forest (row-order sensitive subsampling) is
    # reproducible and the demo's anomaly flags don't move between setup-job runs.
    pdf = spark.sql(features_sql(fqs)).toPandas().sort_values(["cell_id", "day"]).reset_index(drop=True)
    for c in pdf.columns:
        if c not in ("cell_id", "site_id", "sector", "day"):
            pdf[c] = pdf[c].astype(float)
    print(f"features: {len(pdf):,} cell-days")
    X = pdf[FEATURES]
    pipe = Pipeline([("scale", StandardScaler()), ("iforest", IsolationForest(n_estimators=300, max_samples=4096, random_state=42))])
    mlflow.set_experiment(args.experiment)
    with mlflow.start_run(run_name="cell_kpi_anomaly_model"):
        pipe.fit(X)
        raw = -pipe.score_samples(X)
        mlflow.log_params({"model": "IsolationForest", "n_estimators": 300, "features": ",".join(FEATURES), "rows": len(X),
                           "baseline": "cell median of days d-20..d-7"})
        sig = infer_signature(X.head(50), pipe.score_samples(X.head(50)))
        kw = dict(name="model", signature=sig, registered_model_name=model_name, input_example=X.head(3))
        try:  # mlflow >= 3.x serializes sklearn with skops and asks us to trust the tree node storage
            mlflow.sklearn.log_model(pipe, skops_trusted_types=["sklearn.tree._tree.Tree"], **kw)
        except TypeError:
            mlflow.sklearn.log_model(pipe, **kw)
    from mlflow import MlflowClient

    cl = MlflowClient()
    v = max(int(m.version) for m in cl.search_model_versions(f"name='{model_name}'"))
    cl.set_registered_model_alias(model_name, "champion", str(v))
    print(f"registered {model_name} v{v} @champion")

    # robust z vs the whole network on the same day (degrading direction only)
    z = pd.DataFrame(index=pdf.index)
    for f in FEATURES:
        g = pdf.groupby("day")[f]
        med = g.transform("median")
        mad = g.transform(lambda s: (s - s.median()).abs().median()) * 1.4826
        floor = {"avail_gap": 1.0, "vswr_delta": 0.05, "drop_delta": 0.08, "drop_slope_7d": 0.02}.get(f, 0.2)
        z[f] = (pdf[f] - med) / np.maximum(mad, floor)
    n_dev = (z >= 4).sum(axis=1)
    pct = pd.Series(raw).rank(pct=True).values
    pdf["anomaly_score"] = (100 * (1 - 0.5 ** n_dev) * (0.6 + 0.4 * pct)).round(1)
    pdf["deviating_kpis"] = n_dev.astype(int)
    pdf["iforest_score"] = raw.round(4)
    pdf["top_factors"] = [
        [factor_text(pdf.loc[i], f) for f in z.loc[i].sort_values(ascending=False).index if z.at[i, f] >= 4][:4]
        for i in pdf.index]
    pdf["is_anomaly"] = pdf["anomaly_score"] >= 70
    out = pdf[["cell_id", "site_id", "sector", "day", "anomaly_score", "is_anomaly", "deviating_kpis", "iforest_score", "top_factors",
               "availability_pct", "drop_call_rate_pct", "b_drop", "rrc_setup_success_pct", "b_rrc", "avg_sinr_db", "b_sinr", "max_vswr", "b_vswr",
               "ul_interference_dbm", "b_ul", "peak_prb_utilization_pct", "b_prb", "drop_slope_7d"]].rename(columns={
        "b_drop": "baseline_drop_call_rate_pct", "b_rrc": "baseline_rrc_setup_success_pct", "b_sinr": "baseline_sinr_db", "b_vswr": "baseline_vswr",
        "b_ul": "baseline_ul_interference_dbm", "b_prb": "baseline_peak_prb_pct"})
    sdf = spark.createDataFrame(out)
    sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fqs}.cell_health_daily")
    spark.sql(f"COMMENT ON TABLE {fqs}.cell_health_daily IS 'KPI anomaly score per cell per day (last {SCORED_DAYS} days) from cell_kpi_anomaly_model@champion: "
              f"anomaly_score 0-100 (>= 70 = is_anomaly), the deviating KPIs vs the cell''s own lagged baseline (median of days d-20..d-7) and readable top_factors.'")
    top = out.sort_values("anomaly_score", ascending=False).drop_duplicates("cell_id").head(12)
    print(top[["cell_id", "day", "anomaly_score", "deviating_kpis", "top_factors"]].to_string())


if __name__ == "__main__":
    main()
