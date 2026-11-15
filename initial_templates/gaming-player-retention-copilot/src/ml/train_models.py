#!/usr/bin/env python
"""
Hollowspire — explainable churn model + LTV model (both XGBoost, both registered in Unity Catalog).

  1. Point-in-time features over WEEKLY SNAPSHOTS: for every player who played in the 14 days
     up to snapshot date S — engagement, spend, Season 7 stage failures (incl. the 7-4 Warden),
     ranked queue waits and abandons, and harmful chat received (from the AI Functions output
     chat_insights — trash talk is a separate feature the model learns to ignore).
     Churn label = no session in (S, S+14].   LTV label = spend in (S, S+28] for players who stayed.
  2. player_churn_model: XGBClassifier, trained on Jun 7 .. Sep 6 snapshots, held out on Sep 13.
     player_ltv_model:   XGBRegressor on Jun 7 .. Aug 30 snapshots (28-day horizon).
  3. Both logged to MLflow and registered as <catalog>.<schema>.player_churn_model / player_ltv_model
     with alias @champion.
  4. Scores every player active in the last 14 days as of 2026-09-27. SHAP (pred_contribs) is grouped
     into driver families: difficulty, matchmaking, toxicity (the three Season 7 problems live ops can
     fix), engagement, spend, profile. top_driver = the largest of difficulty / matchmaking / toxicity
     when it adds >= 0.3 log-odds of churn risk (engagement features are symptoms: they say WHEN, not
     WHY), else "engagement".
     predicted 12-month LTV (if retained) = predicted 28-day spend x 13 x 0.62 (Seasons 3-6 average
     share of the year a retained player stays active); at-risk LTV = churn probability x LTV.

Writes: player_features (as of 2026-09-27), churn_scores, gold_risk_segments (driver x region).

Runs as a DAB spark_python_task (environment with xgboost + mlflow) or locally:
  DATABRICKS_CONFIG_PROFILE=<your-profile> python train_models.py --catalog gaming --schema player_retention_copilot \
      --experiment "/Shared/gaming-player-retention-copilot/player_models_experiment"
"""
import argparse
import datetime as dt
import os

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", default=os.environ.get("CATALOG", "gaming"))
ap.add_argument("--schema", default=os.environ.get("SCHEMA", "player_retention_copilot"))
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
from sklearn.metrics import average_precision_score, mean_absolute_error, roc_auc_score  # noqa: E402

FQ = f"`{args.catalog}`.`{args.schema}`"
CHURN_MODEL = f"{args.catalog}.{args.schema}.player_churn_model"
LTV_MODEL = f"{args.catalog}.{args.schema}.player_ltv_model"
AS_OF = pd.Timestamp("2026-09-27")
LTV_MULT = 13 * 0.62
print(f"== {FQ} ==")

players = spark.table(f"{FQ}.players").toPandas()
daily = spark.table(f"{FQ}.player_daily").toPandas()
stage = spark.table(f"{FQ}.stage_attempts").toPandas()
chat = spark.table(f"{FQ}.chat_insights").select("recipient_player_id", "sent_date", "toxicity_label", "is_harmful").toPandas()

daily["activity_date"] = pd.to_datetime(daily.activity_date)
stage["attempt_date"] = pd.to_datetime(stage.attempt_date)
chat["sent_date"] = pd.to_datetime(chat.sent_date)
players["install_date"] = pd.to_datetime(players.install_date)
P = players.set_index("player_id")
w74 = stage[stage.stage_id == "7-4"]

NUM = ["tenure_days", "active_days_14d", "sessions_14d", "minutes_14d", "minutes_trend", "days_since_last_play",
       "spend_14d", "spend_60d", "is_payer",
       "stage_fails_14d", "warden_fails_total", "warden_cleared", "stuck_on_warden",
       "ranked_queues_14d", "avg_queue_wait_14d", "queue_abandons_14d",
       "harmful_msgs_received_14d", "trash_talk_received_14d",
       "is_competitive", "is_casual", "platform_pc"]
FAMILY = {
    "difficulty": ["stage_fails_14d", "warden_fails_total", "warden_cleared", "stuck_on_warden"],
    "matchmaking": ["ranked_queues_14d", "avg_queue_wait_14d", "queue_abandons_14d"],
    "toxicity": ["harmful_msgs_received_14d", "trash_talk_received_14d"],
    "engagement": ["active_days_14d", "sessions_14d", "minutes_14d", "minutes_trend", "days_since_last_play"],
    "spend": ["spend_14d", "spend_60d", "is_payer"],
    "profile": ["tenure_days", "is_competitive", "is_casual", "platform_pc"],
}
FIXABLE = ["difficulty", "matchmaking", "toxicity"]


def snapshot(S):
    S = pd.Timestamp(S)
    win = daily[(daily.activity_date > S - pd.Timedelta(days=14)) & (daily.activity_date <= S)]
    g = win.groupby("player_id")
    f = pd.DataFrame({
        "active_days_14d": g.size(), "sessions_14d": g.sessions.sum(), "minutes_14d": g.minutes_played.sum(),
        "spend_14d": g.spend_usd.sum(), "ranked_queues_14d": g.ranked_queues.sum(), "queue_abandons_14d": g.queue_abandons.sum(),
        "last_play": g.activity_date.max(),
    })
    wq = win[win.ranked_queues > 0]
    f["avg_queue_wait_14d"] = (wq.avg_queue_wait_sec * wq.ranked_queues).groupby(wq.player_id).sum() / wq.groupby("player_id").ranked_queues.sum()
    last7 = win[win.activity_date > S - pd.Timedelta(days=7)].groupby("player_id").minutes_played.sum()
    prev7 = win[win.activity_date <= S - pd.Timedelta(days=7)].groupby("player_id").minutes_played.sum()
    f["minutes_trend"] = (last7.reindex(f.index).fillna(0) + 10) / (prev7.reindex(f.index).fillna(0) + 10)
    f["spend_60d"] = daily[(daily.activity_date > S - pd.Timedelta(days=60)) & (daily.activity_date <= S)].groupby("player_id").spend_usd.sum()
    st = stage[(stage.attempt_date > S - pd.Timedelta(days=14)) & (stage.attempt_date <= S)]
    f["stage_fails_14d"] = (st.attempts - st.clears).groupby(st.player_id).sum()
    w = w74[w74.attempt_date <= S].groupby("player_id")[["attempts", "clears"]].sum()
    f["warden_fails_total"] = (w.attempts - w.clears)
    f["warden_cleared"] = (w.clears > 0).astype(int)
    ch = chat[(chat.sent_date > S - pd.Timedelta(days=14)) & (chat.sent_date <= S)]
    f["harmful_msgs_received_14d"] = ch[ch.is_harmful].groupby("recipient_player_id").size()
    f["trash_talk_received_14d"] = ch[ch.toxicity_label == "trash_talk"].groupby("recipient_player_id").size()
    f = f.fillna({c: 0 for c in ["avg_queue_wait_14d", "spend_60d", "stage_fails_14d", "warden_fails_total",
                                 "warden_cleared", "harmful_msgs_received_14d", "trash_talk_received_14d"]})
    f["stuck_on_warden"] = ((f.warden_fails_total >= 4) & (f.warden_cleared == 0)).astype(int)
    f["days_since_last_play"] = (S - f.last_play).dt.days
    f["is_payer"] = (f.spend_60d > 0).astype(int)
    pp = P.loc[f.index]
    f["tenure_days"] = (S - pp.install_date).dt.days
    f["is_competitive"] = (pp.player_type == "Competitive").astype(int).values
    f["is_casual"] = (pp.player_type == "Casual").astype(int).values
    f["platform_pc"] = (pp.platform == "PC").astype(int).values
    fut = daily[(daily.activity_date > S) & (daily.activity_date <= S + pd.Timedelta(days=14))].player_id.unique()
    f["label"] = (~f.index.isin(fut)).astype(int)
    f["spend_next_28d"] = daily[(daily.activity_date > S) & (daily.activity_date <= S + pd.Timedelta(days=28))].groupby("player_id").spend_usd.sum().reindex(f.index).fillna(0)
    f["snapshot_date"] = S.date()
    return f


snaps = pd.date_range("2026-06-07", "2026-09-06", freq="7D")
tr = pd.concat([snapshot(s) for s in snaps])
te = snapshot("2026-09-13")
print(f"churn train rows={len(tr):,} pos={tr.label.mean():.3%} | holdout rows={len(te):,} pos={te.label.mean():.3%}")

if args.experiment:
    if LOCAL:
        mlflow.set_tracking_uri("databricks")
    mlflow.set_experiment(args.experiment)
mlflow.set_registry_uri("databricks-uc")
from mlflow import MlflowClient  # noqa: E402
mc = MlflowClient(registry_uri="databricks-uc")

params = dict(n_estimators=400, max_depth=4, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
              min_child_weight=5, reg_lambda=2.0, eval_metric="aucpr", n_jobs=4)
with mlflow.start_run(run_name="xgb_player_churn_14d"):
    churn = xgb.XGBClassifier(**params)
    churn.fit(tr[NUM].astype(float), tr.label, eval_set=[(te[NUM].astype(float), te.label)], verbose=False)
    p_te = churn.predict_proba(te[NUM].astype(float))[:, 1]
    auc, ap_ = roc_auc_score(te.label, p_te), average_precision_score(te.label, p_te)
    top = np.argsort(-p_te)[: max(1, len(p_te) // 10)]
    lift10 = te.label.values[top].mean() / te.label.mean()
    print(f"churn holdout AUC={auc:.3f} PR-AUC={ap_:.3f} top-decile lift={lift10:.2f}x")
    mlflow.log_params(params)
    mlflow.log_metrics({"holdout_auc": auc, "holdout_pr_auc": ap_, "top_decile_lift": lift10,
                        "train_rows": len(tr), "holdout_rows": len(te)})
    mlflow.log_dict(pd.Series(churn.feature_importances_, index=NUM).round(4).to_dict(), "feature_importance.json")
    info = mlflow.xgboost.log_model(churn, name="model", signature=infer_signature(te[NUM].astype(float).head(50), p_te[:50]),
                                    input_example=te[NUM].astype(float).head(5), registered_model_name=CHURN_MODEL)
    churn_version = info.registered_model_version
mc.set_registered_model_alias(CHURN_MODEL, "champion", churn_version)
print(f"registered {CHURN_MODEL} v{churn_version} @champion")

ltv_snaps = pd.date_range("2026-06-07", "2026-08-30", freq="7D")
lt = tr[tr.snapshot_date.isin([s.date() for s in ltv_snaps]) & (tr.label == 0)]
lt_te = tr[(tr.snapshot_date == dt.date(2026, 8, 30)) & (tr.label == 0)]
lt_tr = lt[lt.snapshot_date != dt.date(2026, 8, 30)]
lparams = dict(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
               min_child_weight=10, reg_lambda=2.0, objective="reg:tweedie", tweedie_variance_power=1.3, n_jobs=4)
with mlflow.start_run(run_name="xgb_player_ltv_28d"):
    ltv = xgb.XGBRegressor(**lparams)
    ltv.fit(lt_tr[NUM].astype(float), lt_tr.spend_next_28d)
    pred = ltv.predict(lt_te[NUM].astype(float))
    mae = mean_absolute_error(lt_te.spend_next_28d, pred)
    ratio = pred.sum() / max(lt_te.spend_next_28d.sum(), 1)
    print(f"ltv holdout MAE={mae:.2f} total predicted/actual={ratio:.2f}")
    mlflow.log_params(lparams)
    mlflow.log_metrics({"holdout_mae_28d": mae, "holdout_total_ratio": ratio, "train_rows": len(lt_tr)})
    info = mlflow.xgboost.log_model(ltv, name="model", signature=infer_signature(lt_te[NUM].astype(float).head(50), pred[:50]),
                                    input_example=lt_te[NUM].astype(float).head(5), registered_model_name=LTV_MODEL)
    ltv_version = info.registered_model_version
mc.set_registered_model_alias(LTV_MODEL, "champion", ltv_version)
print(f"registered {LTV_MODEL} v{ltv_version} @champion")

# ---------------------------------------------------------------------------
# Score players active in the last 14 days as of 2026-09-27
# ---------------------------------------------------------------------------
cur = snapshot(AS_OF)
X = cur[NUM].astype(float)
prob = churn.predict_proba(X)[:, 1]
contrib = churn.get_booster().predict(xgb.DMatrix(X), pred_contribs=True)[:, :-1]
cdf = pd.DataFrame(contrib, columns=NUM, index=cur.index)
fam = pd.DataFrame({f: cdf[cols].clip(lower=0).sum(axis=1) for f, cols in FAMILY.items()})
share = fam.div(fam.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
# Engagement features (days since last play, active days…) say WHEN a player is leaving; the three
# fixable families say WHY. A fixable driver is named when it adds >= 0.3 log-odds of churn risk.
best = fam[FIXABLE].idxmax(axis=1)
top_driver = best.where(fam[FIXABLE].max(axis=1) >= 0.3, "engagement")
ltv28 = np.clip(ltv.predict(X), 0, None)
pltv = np.round(ltv28 * LTV_MULT, 2)
pp = P.loc[cur.index]


def mmss(s):
    return f"{int(s // 60)}m {int(s % 60):02d}s"


def reasons(r):
    out = []
    if r.stuck_on_warden:
        out.append(f"Failed The Drowned Warden (7-4) {int(r.warden_fails_total)} times without clearing it")
    elif r.warden_fails_total >= 2 and not r.warden_cleared:
        out.append(f"{int(r.warden_fails_total)} failed attempts on The Drowned Warden (7-4)")
    if r.avg_queue_wait_14d >= 150:
        out.append(f"Average ranked queue wait {mmss(r.avg_queue_wait_14d)} over the last 14 days")
    if r.queue_abandons_14d >= 2:
        out.append(f"Abandoned {int(r.queue_abandons_14d)} ranked queues in 14 days")
    if r.harmful_msgs_received_14d:
        out.append(f"Received {int(r.harmful_msgs_received_14d)} harmful chat message(s) (AI-flagged) in 14 days")
    if r.tenure_days < 14:
        out.append(f"New player — installed {int(r.tenure_days)} days ago")
    if r.minutes_trend < 0.6:
        out.append(f"Play time down {round(100 * (1 - r.minutes_trend))}% week over week")
    if r.days_since_last_play >= 5:
        out.append(f"No session for {int(r.days_since_last_play)} days")
    if r.spend_60d > 0:
        out.append(f"Spent ${r.spend_60d:,.2f} in the last 60 days")
    return out[:4]


tier = np.select([prob >= 0.55, prob >= 0.35, prob >= 0.2], ["Critical", "High", "Medium"], "Low")
DCODE = {"difficulty": "DIFF", "matchmaking": "MATCH", "toxicity": "TOX", "engagement": "ENG"}
scores = pd.DataFrame({
    "player_id": cur.index,
    "gamertag": pp.gamertag.values,
    "region": pp.region.values,
    "platform": pp.platform.values,
    "player_type": pp.player_type.values,
    "spender_tier": pp.spender_tier.values,
    "scored_at": AS_OF,
    "churn_probability_14d": np.round(prob, 4),
    "risk_tier": tier,
    "top_driver": top_driver.values,
    "segment_id": [f"{DCODE[d]}-{r}" for d, r in zip(top_driver.values, pp.region.values)],
    "driver_difficulty_pct": np.round(100 * share.difficulty.values, 1),
    "driver_matchmaking_pct": np.round(100 * share.matchmaking.values, 1),
    "driver_toxicity_pct": np.round(100 * share.toxicity.values, 1),
    "driver_engagement_pct": np.round(100 * share.engagement.values, 1),
    "driver_spend_pct": np.round(100 * share.spend.values, 1),
    "driver_profile_pct": np.round(100 * share.profile.values, 1),
    "top_reasons": [reasons(r) for r in cur.itertuples()],
    "predicted_spend_28d": np.round(ltv28, 2),
    "predicted_ltv_12m": pltv,
    "at_risk_ltv_usd": np.round(prob * pltv, 2),
    "churn_model_version": str(churn_version),
    "ltv_model_version": str(ltv_version),
})
print(scores.risk_tier.value_counts().to_string())
at = scores[scores.risk_tier != "Low"]
print(at.groupby("top_driver").agg(n=("player_id", "size"), at_risk=("at_risk_ltv_usd", "sum"), p=("churn_probability_14d", "mean")).round(1).to_string())
print(at.groupby(["top_driver", "region"]).at_risk_ltv_usd.sum().unstack().round(0).to_string())

feat = cur.reset_index().rename(columns={"index": "player_id"})[["player_id"] + NUM]
feat.insert(1, "as_of_date", AS_OF.date())
spark.createDataFrame(feat).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.player_features")
spark.createDataFrame(scores).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.churn_scores")
spark.sql(f"COMMENT ON TABLE {FQ}.player_features IS 'Point-in-time churn / LTV features per player active in the 14 days to 2026-09-27 (input to player_churn_model and player_ltv_model).'")
spark.sql(f"COMMENT ON TABLE {FQ}.churn_scores IS :c", args={"c": (
    f"14-day churn probability per player active in the last 14 days (as of 2026-09-27) from {CHURN_MODEL} v{churn_version} (@champion), "
    f"SHAP driver shares (difficulty / matchmaking / toxicity / engagement / spend / profile), top_driver, risk_tier "
    f"(Critical >= 0.55, High >= 0.35, Medium >= 0.20, else Low), predicted 12-month LTV if retained from {LTV_MODEL} "
    f"v{ltv_version} and at_risk_ltv_usd = churn probability x predicted LTV. segment_id = <driver code>-<region>.")})

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_risk_segments
COMMENT 'At-risk player segments = top churn driver x region (players with risk_tier Critical, High or Medium). at_risk_ltv_usd = sum of churn probability x predicted 12-month LTV. The unit the Live-Ops Console plans interventions for.'
AS
SELECT s.segment_id,
       concat(CASE s.top_driver WHEN 'difficulty' THEN 'Stuck on the Drowned Warden' WHEN 'matchmaking' THEN 'Ranked queue too long'
                                WHEN 'toxicity' THEN 'Harassed in Raid Finder' ELSE 'Engagement decay' END, ' · ', s.region) AS segment_name,
       s.top_driver AS churn_driver, s.region,
       count(*) AS players_at_risk,
       count_if(s.risk_tier = 'Critical') AS critical_players,
       count_if(s.risk_tier = 'High') AS high_players,
       round(avg(s.churn_probability_14d), 4) AS avg_churn_probability,
       round(sum(s.at_risk_ltv_usd), 2) AS at_risk_ltv_usd,
       round(sum(s.predicted_ltv_12m), 2) AS ltv_book_usd,
       count_if(s.spender_tier <> 'Non-payer') AS payers_at_risk,
       count_if(s.spender_tier = 'Whale') AS whales_at_risk,
       count_if(f.tenure_days < 14) AS new_players_at_risk,
       round(avg(CASE WHEN f.ranked_queues_14d > 0 THEN f.avg_queue_wait_14d END), 0) AS avg_queue_wait_sec,
       round(avg(f.stuck_on_warden), 3) AS stuck_on_warden_share,
       round(avg(CASE WHEN f.harmful_msgs_received_14d > 0 THEN 1 ELSE 0 END), 3) AS harassed_share
FROM {FQ}.churn_scores s JOIN {FQ}.player_features f USING (player_id)
WHERE s.risk_tier <> 'Low'
GROUP BY ALL""")
print(spark.sql(f"SELECT * FROM {FQ}.gold_risk_segments ORDER BY at_risk_ltv_usd DESC").toPandas().head(25).to_string())
print("done.")
