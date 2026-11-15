#!/usr/bin/env python
"""
Calder Pine — next-best-action propensity model + suitability guardrail.

  1. Train an XGBoost classifier on 18 months of offers (nba_history): P(client accepts action A |
     trigger T, how fast the advisor reacted, the household's profile). Holdout = the last 3 months.
  2. Log to MLflow and register in Unity Catalog as <catalog>.<schema>.nba_propensity_model @champion.
  3. Score every (household, candidate action) pair for households with an active signal
     (gold_household_signals) -> propensity, assets in scope, expected 12-month revenue.
  4. Apply the deterministic suitability rules S1-S7 (suitability_rules / CPW policy) to every pair
     -> PASS / REVIEW / FAIL with a rule-by-rule JSON the app and the agent show verbatim.
  5. Write nba_recommendations (one row per pair) and household_opportunities (one row per household:
     money in motion, AUM at risk, the model's top action vs the best SUITABLE action, priority rank
     within the advisor's book = the Morning Book order).

The propensity model is deliberately NOT suitability-aware: it learned from what advisors sold
(buffered structured notes to inheritance recipients "converted"). The guardrail is a separate,
explainable layer — never trained, never skipped.

Runs as a DAB spark_python_task (environment with xgboost + mlflow) or locally:
  DATABRICKS_CONFIG_PROFILE=<your-profile> python train_nba_model.py --catalog financial_services \
      --schema wealth_advisor_copilot --experiment "/Shared/fsi-wealth-advisor-nba/nba_propensity_experiment"
"""
import argparse
import json
import os

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", default=os.environ.get("CATALOG", "financial_services"))
ap.add_argument("--schema", default=os.environ.get("SCHEMA", "wealth_advisor_copilot"))
ap.add_argument("--experiment", default=os.environ.get("EXPERIMENT", ""))
args, _ = ap.parse_known_args()

from pyspark.sql import SparkSession  # noqa: E402

spark = SparkSession.getActiveSession()
if spark is None:
    from databricks.connect import DatabricksSession
    spark = DatabricksSession.builder.profile(os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")).serverless(True).getOrCreate()

import mlflow  # noqa: E402
import xgboost as xgb  # noqa: E402
from mlflow.models import infer_signature  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402

CAT, SCH = args.catalog, args.schema
FQ = f"`{CAT}`.`{SCH}`"
AS_OF = pd.Timestamp("2026-09-28")

hist = spark.table(f"{FQ}.nba_history").toPandas()
hh = spark.table(f"{FQ}.households").toPandas()
actions = spark.table(f"{FQ}.nba_actions").toPandas()
signals = spark.table(f"{FQ}.gold_household_signals").toPandas()
accounts = spark.table(f"{FQ}.accounts").toPandas()
liab = spark.table(f"{FQ}.liabilities").toPandas()
events = spark.table(f"{FQ}.life_events").toPandas()
flows = spark.table(f"{FQ}.cash_flows_monthly").toPandas()
try:  # AI Functions read-out of CRM notes (src/ai/note_insights.sql) — a note that names another firm = flight risk
    flight = set(spark.sql(f"SELECT DISTINCT household_id FROM {FQ}.note_insights WHERE flight_risk_mention").toPandas().household_id)
except Exception as e:  # noqa: BLE001 — optional input
    print("note_insights not available yet:", str(e)[:80])
    flight = set()

ACTIONS = actions.action_code.tolist()
TRIGGERS = ["Calendar (no trigger)", "CD maturity", "Idle cash", "Inheritance received", "Death of spouse", "Retirement",
            "Job change", "Business sale", "Home purchase planned", "Refi window", "Concentrated position",
            "Child starting college", "New grandchild"]
SEG = {"Emerging HNW": 0, "HNW": 1, "Very HNW": 2, "UHNW": 3}
EXPV = {"Limited": 0, "Moderate": 1, "Extensive": 2}
HH = hh.set_index("household_id")


def features(df):
    """df: household_id, action_code, trigger_type, days_since_trigger, trigger_amount -> model matrix."""
    h = HH.loc[df.household_id]
    X = pd.DataFrame({
        "days_since_trigger": df.days_since_trigger.fillna(365).clip(0, 365).astype(float).values,
        "log_trigger_amount": np.log1p(df.trigger_amount.fillna(0).astype(float)).values,
        "segment": h.segment.map(SEG).values.astype(float),
        "age": h.primary_age.values.astype(float),
        "log_aum": np.log1p(h.aum.values.astype(float)),
        "risk_score": h.risk_score.values.astype(float),
        "experience": h.investment_experience.map(EXPV).values.astype(float),
        "tenure_years": h.tenure_years.values.astype(float),
        "cash_pct": h.cash_pct.values.astype(float),
    })
    for a in ACTIONS:
        X[f"act_{a}"] = (df.action_code.values == a).astype(float)
    for t in TRIGGERS:
        X[f"trg_{t}"] = (df.trigger_type.values == t).astype(float)
    return X


# ---------------------------------------------------------------- train
hist["offer_date"] = pd.to_datetime(hist.offer_date)
X = features(hist)
y = hist.accepted.astype(int).values
test = (hist.offer_date >= "2026-07-01").values
clf = xgb.XGBClassifier(n_estimators=350, max_depth=5, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
                        eval_metric="auc", random_state=7)
clf.fit(X[~test], y[~test])
auc = roc_auc_score(y[test], clf.predict_proba(X[test])[:, 1])
p_test = clf.predict_proba(X[test])[:, 1]
top = p_test >= np.quantile(p_test, 0.9)
lift = y[test][top].mean() / y[test].mean()
print(f"holdout AUC {auc:.3f}  top-decile lift {lift:.1f}x  (n_test={test.sum()})")
clf.fit(X, y)  # refit on everything for scoring

mlflow.set_tracking_uri("databricks")  # workspace MLflow (default on Databricks; needed under Databricks Connect)
mlflow.set_registry_uri("databricks-uc")
if args.experiment:
    mlflow.set_experiment(args.experiment)
model_name = f"{CAT}.{SCH}.nba_propensity_model"
with mlflow.start_run(run_name="nba_propensity_xgb") as run:
    mlflow.log_params({"n_estimators": 350, "max_depth": 5, "learning_rate": 0.05, "train_rows": int(len(X))})
    mlflow.log_metrics({"holdout_auc": float(auc), "top_decile_lift": float(lift)})
    sig = infer_signature(X.head(50), clf.predict_proba(X.head(50))[:, 1])
    info = mlflow.xgboost.log_model(clf, name="model", signature=sig, input_example=X.head(5), registered_model_name=model_name)
from mlflow import MlflowClient  # noqa: E402

mc = MlflowClient(registry_uri="databricks-uc")
ver = max(int(v.version) for v in mc.search_model_versions(f"name='{model_name}'"))
mc.set_registered_model_alias(model_name, "champion", str(ver))
mc.update_registered_model(model_name, description="Next-best-action propensity: P(client accepts action | trigger, reaction speed, household profile). XGBoost on nba_history. NOT suitability-aware — the Morning Book applies the suitability rules S1-S7 on top.")
print(f"registered {model_name} v{ver} @champion  run={run.info.run_id}")

# ---------------------------------------------------------------- candidate pairs
TRIG_ACT = {
    "CD maturity": ["CD-LADDER", "MANAGED-PORTFOLIO", "STRUCTURED-NOTE"],
    "Idle cash": ["CASH-MMF", "MANAGED-PORTFOLIO", "STRUCTURED-NOTE", "PRIVATE-CREDIT"],
    "Inheritance received": ["MANAGED-PORTFOLIO", "STRUCTURED-NOTE", "ESTATE-REVIEW", "CASH-MMF"],
    "Death of spouse": ["ESTATE-REVIEW", "STRUCTURED-NOTE", "CASH-MMF"],
    "Retirement": ["IRA-ROLLOVER", "MANAGED-PORTFOLIO"],
    "Job change": ["IRA-ROLLOVER"],
    "Held-away 401(k)": ["IRA-ROLLOVER"],
    "Business sale": ["MANAGED-PORTFOLIO", "PRIVATE-CREDIT", "ESTATE-REVIEW"],
    "Home purchase planned": ["SBLOC", "MORTGAGE-REFI"],
    "Refi window": ["MORTGAGE-REFI"],
    "Concentrated position": ["DIRECT-INDEX", "SBLOC"],
    "Child starting college": ["EDU-529"],
    "New grandchild": ["EDU-529", "ESTATE-REVIEW"],
}
signals["signal_date"] = pd.to_datetime(signals.signal_date)
rows = []
for s in signals.itertuples():
    if s.signal_type not in TRIG_ACT:
        continue
    trig = "Retirement" if s.signal_type == "Held-away 401(k)" else s.signal_type
    lag = max(0, (AS_OF - s.signal_date).days)
    for a in TRIG_ACT[s.signal_type]:
        rows.append([s.household_id, a, trig, s.signal_type, lag, float(s.amount or 0)])
for h_ in signals.household_id.unique():
    rows.append([h_, "ANNUAL-REVIEW", "Calendar (no trigger)", "Calendar", None, 0.0])
cand = pd.DataFrame(rows, columns=["household_id", "action_code", "trigger_type", "signal_type", "days_since_trigger", "trigger_amount"])
cand["propensity"] = clf.predict_proba(features(cand))[:, 1]
# one row per (household, action): keep the trigger that gives the highest propensity
cand = cand.sort_values("propensity", ascending=False).drop_duplicates(["household_id", "action_code"])

# ---------------------------------------------------------------- assets in scope + revenue
accounts["maturity_date"] = pd.to_datetime(accounts.maturity_date)
cd60 = accounts[(accounts.maturity_date >= AS_OF) & (accounts.maturity_date <= AS_OF + pd.Timedelta(days=60))].groupby("household_id").balance.sum()
cd_next = accounts[accounts.maturity_date >= AS_OF].groupby("household_id").maturity_date.min()
mort = liab[(liab.rate_pct >= 6.65) & (liab.balance >= 150_000)].set_index("household_id")
home = events[events.event_type == "Home purchase planned"].groupby("household_id").amount_estimate.max()
BPS = dict(zip(actions.action_code, actions.revenue_bps))
ACT = actions.set_index("action_code")


def idle(h):
    return max(0.0, h.sweep_cash - max(50_000.0, 0.03 * h.aum))


def assets_in_scope(h_, a):
    h = HH.loc[h_]
    i = idle(h)
    return {
        "CD-LADDER": float(cd60.get(h_, 0.0)) + 0.3 * i, "CASH-MMF": 0.3 * i, "MANAGED-PORTFOLIO": 0.6 * i,
        "STRUCTURED-NOTE": 0.5 * i, "PRIVATE-CREDIT": 0.3 * i,
        "DIRECT-INDEX": float(h.concentrated_pct * h.aum), "IRA-ROLLOVER": float(h.held_away_401k),
        "MORTGAGE-REFI": float(mort.balance.get(h_, 0.0)) if h_ in mort.index else 0.0,
        "SBLOC": float(home.get(h_, 0.3 * h.aum * 0.5)), "ESTATE-REVIEW": float(h.aum), "EDU-529": 60_000.0,
        "ANNUAL-REVIEW": 0.05 * float(h.aum),
    }[a]


cand["assets_in_scope"] = [round(assets_in_scope(h_, a), -2) for h_, a in zip(cand.household_id, cand.action_code)]
# relationship actions (estate review) protect AUM rather than earn new revenue -> no revenue in the ranking
cand["expected_revenue_12m"] = [0.0 if a == "ESTATE-REVIEW" else round(p * v * BPS[a] / 10_000, 2)
                                for p, v, a in zip(cand.propensity, cand.assets_in_scope, cand.action_code)]
cand = cand[(cand.assets_in_scope > 0) | cand.action_code.isin(["ESTATE-REVIEW"])]

# ---------------------------------------------------------------- suitability (deterministic, S1-S7)
RULES = spark.table(f"{FQ}.suitability_rules").toPandas().set_index("rule_id")


def suitability(h_, a, amount):
    h, p = HH.loc[h_], ACT.loc[a]
    out = []

    def add(rid, result, finding):
        out.append({"rule_id": rid, "rule": RULES.loc[rid, "rule_name"], "result": result, "finding": finding,
                    "citation": RULES.loc[rid, "citation"]})
    add("S1", "PASS" if h.risk_score >= p.min_risk_score else "FAIL",
        f"Client risk profile {h.risk_profile} ({h.risk_score}/5) vs product minimum {p.min_risk_score}/5")
    add("S2", "PASS" if h.time_horizon_years >= p.min_horizon_years else "FAIL",
        f"Time horizon {h.time_horizon_years} yrs vs minimum {p.min_horizon_years} yrs")
    if p.illiquid:
        add("S3", "PASS" if h.liquidity_need == "Low" else "FAIL",
            f"Illiquid product; client liquidity need is {h.liquidity_need}")
    else:
        add("S3", "PASS", f"Liquid product; client liquidity need {h.liquidity_need}")
    if p.complexity == "Complex":
        add("S4", "PASS" if h.investment_experience == "Extensive" else "FAIL",
            f"Complex product requires Extensive experience; client has {h.investment_experience}")
    else:
        add("S4", "PASS", f"{p.complexity} product; client experience {h.investment_experience}")
    if h.vulnerable_client:
        res = "FAIL" if p.complexity == "Complex" else "REVIEW" if p.complexity == "Moderate" else "PASS"
        add("S5", res, f"Vulnerable client — {h.vulnerable_reason}. " + (
            "No complex products for 12 months." if res == "FAIL" else
            "Planning meeting + supervisor pre-approval first." if res == "REVIEW" else "Simple action allowed."))
    else:
        add("S5", "PASS", "Not flagged as a vulnerable client")
    liquid_nw = float(h.net_worth_estimate) * 0.6
    if p.complexity == "Complex" and a != "SBLOC":
        add("S6", "PASS" if amount <= 0.10 * liquid_nw else "FAIL",
            f"Proposed ${amount:,.0f} vs 10% cap of estimated liquid net worth (${0.10 * liquid_nw:,.0f})")
    elif a == "SBLOC":
        add("S6", "REVIEW" if h.concentrated_pct > 0.30 else "PASS",
            f"Collateral: {h.concentrated_symbol} is {h.concentrated_pct:.0%} of the portfolio — reduced advance rate (50%)" if h.concentrated_pct > 0.30
            else "Diversified collateral (70% advance rate)")
    else:
        add("S6", "PASS", "No concentration limit for this action")
    if a == "IRA-ROLLOVER":
        add("S7", "REVIEW", "Deliver the PTE 2020-02 plan-vs-IRA comparison (D-ROLL) before the client decides")
    status = "FAIL" if any(r["result"] == "FAIL" for r in out) else "REVIEW" if any(r["result"] == "REVIEW" for r in out) else "PASS"
    return status, out


st = [suitability(h_, a, v) for h_, a, v in zip(cand.household_id, cand.action_code, cand.assets_in_scope)]
cand["suitability_status"] = [s for s, _ in st]
cand["failed_rules"] = [",".join(r["rule_id"] for r in rr if r["result"] == "FAIL") for _, rr in st]
cand["rule_results"] = [json.dumps(rr) for _, rr in st]
cand = cand.merge(actions[["action_code", "action_name", "category", "complexity", "required_disclosures"]], on="action_code")
cand["model_rank"] = cand.groupby("household_id").expected_revenue_12m.rank(ascending=False, method="first").astype(int)
ok_order = cand.assign(_o=cand.suitability_status.map({"PASS": 0, "REVIEW": 1, "FAIL": 9}))
ok_order = ok_order[ok_order._o < 9].sort_values(["household_id", "expected_revenue_12m"], ascending=[True, False])
cand["suitable_rank"] = None
cand.loc[ok_order.index, "suitable_rank"] = ok_order.groupby("household_id").cumcount() + 1
cand["propensity"] = cand.propensity.round(4)
cand["model_version"] = str(ver)
cand["scored_at"] = AS_OF.date()

# ---------------------------------------------------------------- household opportunities (the Morning Book)
sig_g = signals.groupby("household_id")
recent_out = flows[(pd.to_datetime(flows.month) >= "2026-08-01") & (flows.external_transfers_out > 0)].groupby("household_id").external_transfers_out.sum()
bev = events[events.event_type.isin(["Death of spouse", "Inheritance received"]) & (pd.to_datetime(events.event_date) >= "2026-03-01")]
uncalled = set(bev[~bev.advisor_contacted_within_30d.astype(bool)].household_id)
hh["last_contact_date"] = pd.to_datetime(hh.last_contact_date)
opp = []
for h_, g in cand.groupby("household_id"):
    h = HH.loc[h_]
    s = sig_g.get_group(h_)
    mim = float(s[~s.signal_type.isin(["Death of spouse", "New grandchild", "Refi window", "External outflow", "Concentrated position"])].amount.sum())
    lending = float(s[s.signal_type == "Refi window"].amount.sum())
    days_since_contact = int((AS_OF - pd.Timestamp(h.last_contact_date)).days) if pd.notna(h.last_contact_date) else 999
    risk = 0.0
    if h_ in uncalled:
        risk = max(risk, 0.40 * h.aum)
    if h_ in recent_out.index or (idle(h) >= 250_000 and days_since_contact > 90) or h_ in flight:
        risk = max(risk, float(h.sweep_cash))
    top = g.sort_values("expected_revenue_12m", ascending=False).iloc[0]
    # best SUITABLE action = what the advisor can actually put on the agenda: PASS (or REVIEW with its
    # condition — except for a vulnerable client, where REVIEW waits for the planning meeting); the generic
    # annual review only when nothing else qualifies. Mirrors app/server/services/prep.ts planMeeting().
    okg = g[g.suitable_rank.notna() & ~((g.suitability_status == "REVIEW") & bool(h.vulnerable_client))].sort_values("suitable_rank")
    okg = okg[okg.action_code != "ANNUAL-REVIEW"] if (okg.action_code != "ANNUAL-REVIEW").any() else okg
    best = okg.iloc[0] if len(okg) else None
    dta = s.days_to_act.dropna()
    dta = int(dta.min()) if len(dta) else 60
    urgency = max(0, 30 - dta) * 150
    score = (float(best.expected_revenue_12m) if best is not None else 0.0) + 0.004 * risk + 0.0005 * mim + min(1500.0, 0.0015 * lending) + urgency
    score += 5000 if h_ in flight else 0  # the client said out loud they may move money
    opp.append({
        "household_id": h_, "advisor_id": h.advisor_id, "household_name": h.household_name,
        "primary_name": f"{h.primary_first_name} {h.primary_last_name}", "segment": h.segment, "aum": float(h.aum),
        "money_in_motion": round(mim, -2), "lending_opportunity": round(lending, -2), "aum_at_risk": round(risk, -2),
        "signals": " · ".join(dict.fromkeys(s.sort_values("days_to_act").signal_type)),
        "headline_signal": s.sort_values(["days_to_act", "amount"], ascending=[True, False]).iloc[0].detail,
        "days_to_act": dta, "days_since_contact": days_since_contact,
        "top_model_action": top.action_code, "top_model_propensity": float(top.propensity),
        "top_model_status": top.suitability_status,
        "best_suitable_action": None if best is None else best.action_code,
        "best_suitable_status": None if best is None else best.suitability_status,
        "best_expected_revenue_12m": 0.0 if best is None else float(best.expected_revenue_12m),
        "model_top_blocked": bool(top.suitability_status == "FAIL"), "flight_risk_mention": h_ in flight,
        "priority_score": round(score, 2),
    })
opp = pd.DataFrame(opp)
opp["book_rank"] = opp.groupby("advisor_id").priority_score.rank(ascending=False, method="first").astype(int)

cand_out = cand[["household_id", "action_code", "action_name", "category", "complexity", "trigger_type", "signal_type",
                 "days_since_trigger", "propensity", "assets_in_scope", "expected_revenue_12m", "model_rank",
                 "suitability_status", "suitable_rank", "failed_rules", "rule_results", "required_disclosures",
                 "model_version", "scored_at"]].copy()
cand_out["days_since_trigger"] = cand_out.days_since_trigger.astype("float")
cand_out["suitable_rank"] = cand_out.suitable_rank.astype("float")
spark.createDataFrame(cand_out).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.nba_recommendations")
spark.sql(f"COMMENT ON TABLE {FQ}.nba_recommendations IS 'One row per (household, candidate next-best action): model propensity (nba_propensity_model@champion), assets in scope, expected 12-month revenue, model_rank, suitability status (PASS/REVIEW/FAIL) with rule_results JSON (S1-S7), suitable_rank (null when blocked).'")
spark.createDataFrame(opp).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.household_opportunities")
spark.sql(f"COMMENT ON TABLE {FQ}.household_opportunities IS 'The Morning Book: one row per household with an active signal — money in motion, AUM at risk, the model top action vs the best SUITABLE action, book_rank within the advisor book.'")
print(opp[opp.advisor_id == "ADV-007"].sort_values("book_rank").head(8)[["household_name", "money_in_motion", "aum_at_risk", "top_model_action", "top_model_status", "best_suitable_action", "priority_score"]].to_string())
print("blocked share:", round(opp.model_top_blocked.mean() * 100, 1), "%")
print(cand[cand.household_id == "HH-10042"][["action_code", "propensity", "assets_in_scope", "expected_revenue_12m", "model_rank", "suitability_status", "failed_rules"]].to_string())
