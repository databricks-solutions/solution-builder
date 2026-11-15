"""
Detractor-risk model: P(passenger scores 0-6 on the post-trip NPS survey | how the disruption was handled).

Trains on irops_history (survey respondents only), registers it in Unity Catalog as
<catalog>.<schema>.detractor_risk_model with alias @champion, then batch-scores every Winter Storm Harlan
passenger under three scenarios → pax_detractor_risk:

  p_same_day    re-accommodated the same day, proactive notice, party kept together
  p_next_day    next-day flight, hotel per the Aeralis policy (G5), onward connection missed if any
  p_autoprotect what AutoProtect actually did (FIFO; no hotel, no proactive notice, parties split)

The IROPS desk agent uses (p_next_day - p_same_day) to break ties inside a priority tier (who is hurt most by an
overnight) and reports the plan's predicted detractor rate next to AutoProtect's.

    python train_detractor_model.py --catalog retail_consumer_goods --schema travel_disruption_copilot \
        --experiment "/Shared/travel-disruption-rebooking/detractor_risk_experiment"
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

FEATURES = ["arrival_delay_hours", "overnight", "hotel_provided", "misconnect", "party_split", "special_assistance",
            "tier_rank", "proactive_notice", "away_from_home"]
TIERS = {"Member": 0, "Silver": 1, "Gold": 2, "Platinum": 3, "Diamond": 4}


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="retail_consumer_goods")
    ap.add_argument("--schema", default="travel_disruption_copilot")
    ap.add_argument("--experiment", default="/Shared/travel-disruption-rebooking/detractor_risk_experiment")
    a, _ = ap.parse_known_args()
    fqs = f"{a.catalog}.{a.schema}"
    spark = get_spark()

    h = spark.sql(f"""SELECT arrival_delay_hours, CAST(overnight AS INT) overnight, CAST(hotel_provided AS INT) hotel_provided,
            CAST(misconnect AS INT) misconnect, CAST(party_split AS INT) party_split,
            CAST(special_assistance OR unaccompanied_minor OR lap_infant AS INT) special_assistance, tier_rank,
            CAST(proactive_notice AS INT) proactive_notice, CAST(away_from_home AS INT) away_from_home,
            CAST(detractor AS INT) detractor
        FROM {fqs}.irops_history WHERE nps_score IS NOT NULL ORDER BY history_pax_id""").toPandas()  # stable order → same split/model every run
    X, y = h[FEATURES].astype(float), h["detractor"].astype(int)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=7, stratify=y)
    model = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, max_depth=4, random_state=7)
    model.fit(Xtr, ytr)
    auc = roc_auc_score(yte, model.predict_proba(Xte)[:, 1])
    print(f"trained on {len(Xtr)} respondents, holdout AUC {auc:.3f}, base detractor rate {y.mean():.3f}")

    prof = os.environ.get("DATABRICKS_CONFIG_PROFILE")  # local runs: databricks://<profile>; on Databricks: ambient
    mlflow.set_tracking_uri(f"databricks://{prof}" if prof else "databricks")
    mlflow.set_registry_uri(f"databricks-uc://{prof}" if prof else "databricks-uc")
    mlflow.set_experiment(a.experiment)
    uc_name = f"{fqs}.detractor_risk_model"
    with mlflow.start_run(run_name="detractor_risk_hgb") as run:
        mlflow.log_params({"model": "HistGradientBoostingClassifier", "max_iter": 250, "max_depth": 4, "features": ",".join(FEATURES)})
        mlflow.log_metrics({"holdout_auc": auc, "train_rows": len(Xtr), "base_detractor_rate": float(y.mean())})
        info = mlflow.sklearn.log_model(model, name="model", signature=infer_signature(Xtr, model.predict_proba(Xtr)[:, 1]),
                                        input_example=Xtr.head(3), registered_model_name=uc_name,
                                        serialization_format="cloudpickle")
    from mlflow import MlflowClient

    c = MlflowClient()
    ver = max(int(v.version) for v in c.search_model_versions(f"name='{uc_name}'"))
    c.set_registered_model_alias(uc_name, "champion", str(ver))
    c.update_registered_model(uc_name, description="P(detractor, NPS 0-6) for an IROPS-disrupted passenger given how the disruption "
                              "was handled. Trained on Aeralis irops_history survey respondents. Used by the IROPS desk agent.")
    print(f"registered {uc_name} v{ver} @champion (run {run.info.run_id})")

    champion = mlflow.sklearn.load_model(f"models:/{uc_name}@champion")
    pax = spark.sql(f"""
        SELECT p.pax_id, p.loyalty_tier, p.away_from_home, p.onward_long_haul, p.ssr_codes, p.eu_uk_261, p.party_size,
               ap.arrival_delay_hours ap_delay, ap.overnight ap_overnight, ap.misconnect ap_misconnect, ap.party_split ap_split,
               (SELECT MIN(o.arrival_delay_hours) FROM {fqs}.alternate_options o WHERE o.disrupted_flight_id = p.disrupted_flight_id AND o.same_day) sd_delay,
               (SELECT MIN(o.arrival_delay_hours) FROM {fqs}.alternate_options o WHERE o.disrupted_flight_id = p.disrupted_flight_id AND NOT o.same_day) nd_delay
        FROM {fqs}.passengers p JOIN {fqs}.autoprotect_rebookings ap ON ap.pax_id = p.pax_id""").toPandas()
    tier = pax["loyalty_tier"].map(TIERS).astype(float)
    ssr = pax["ssr_codes"].fillna("").str.contains("UMNR|WCHR|WCHC|BLND|DEAF|MEDA|INFT").astype(float)
    away = pax["away_from_home"].astype(float)
    entitled = ((tier >= 2) | (ssr > 0) | pax["eu_uk_261"].notna()).astype(float)

    def score(delay, overnight, hotel, misconnect, split, proactive):
        df = pd.DataFrame({"arrival_delay_hours": delay, "overnight": overnight, "hotel_provided": hotel, "misconnect": misconnect,
                           "party_split": split, "special_assistance": ssr, "tier_rank": tier, "proactive_notice": proactive,
                           "away_from_home": away})[FEATURES].astype(float)
        return champion.predict_proba(df)[:, 1]

    one, zero = np.ones(len(pax)), np.zeros(len(pax))
    sd = pax["sd_delay"].fillna(pax["nd_delay"]).astype(float)
    nd = pax["nd_delay"].astype(float)
    out = pd.DataFrame({
        "pax_id": pax["pax_id"],
        "p_same_day": score(sd, zero, zero, zero, zero, one),
        "p_next_day": score(nd, one, entitled * away, pax["onward_long_haul"].astype(float), zero, one),
        "p_autoprotect": score(pax["ap_delay"].astype(float), pax["ap_overnight"].astype(float), zero,
                               pax["ap_misconnect"].astype(float), pax["ap_split"].astype(float), zero),
    })
    out["overnight_harm"] = out["p_next_day"] - out["p_same_day"]
    out["model_version"] = f"{uc_name}/{ver}"
    for col in ["p_same_day", "p_next_day", "p_autoprotect", "overnight_harm"]:
        out[col] = out[col].round(4)
    spark.createDataFrame(out).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fqs}.pax_detractor_risk")
    spark.sql(f"COMMENT ON TABLE {fqs}.pax_detractor_risk IS 'Batch scores of detractor_risk_model@champion for every Harlan passenger: "
              f"P(detractor) if re-accommodated same day / next day / as AutoProtect left them. overnight_harm = p_next_day - p_same_day.'")
    print(f"scored {len(out)} passengers → {fqs}.pax_detractor_risk; mean p_autoprotect {out.p_autoprotect.mean():.3f}, "
          f"p_same_day {out.p_same_day.mean():.3f}, p_next_day {out.p_next_day.mean():.3f}")


if __name__ == "__main__":
    main()
