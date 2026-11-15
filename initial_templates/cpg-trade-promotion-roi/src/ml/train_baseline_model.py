"""
Crestwood Snacks — ML baseline demand model ("what would have sold WITHOUT the promotion").

The post-event analysis is only as good as its baseline. A naive "average of the 4 weeks before"
baseline is biased by holidays, seasonality and the previous event's hangover, so we train a model:

  * training rows = CLEAN weeks only: no promotion on the SKU, not in the 4-week post-event window
    (pantry loading), and not a sister SKU during an event (cannibalization)
  * features     = retailer, SKU, week-of-year harmonics, snack-holiday week, trend
  * model        = scikit-learn GradientBoostingRegressor on log(units) (TransformedTargetRegressor)
  * holdout      = the last 16 clean weeks → MAPE / WAPE logged to MLflow
  * registered   = Unity Catalog model <catalog>.<schema>.baseline_demand_model, alias @champion

Then the champion scores every retailer x SKU x week (104 history weeks + the 13 plan weeks) into
<catalog>.<schema>.baseline_forecast — consumed by src/gold/build_gold.py.

Usage: python train_baseline_model.py --catalog retail_consumer_goods --schema trade_promotion_roi
                                      [--experiment /Workspace/.../trade_promo_baseline_experiment]
"""
import argparse
import datetime as dt

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

parser = argparse.ArgumentParser()
parser.add_argument("--catalog", default="retail_consumer_goods")
parser.add_argument("--schema", default="trade_promotion_roi")
parser.add_argument("--experiment", default="")
args, _ = parser.parse_known_args()
CAT, SCH = args.catalog, args.schema
T = lambda n: f"{CAT}.{SCH}.{n}"  # noqa: E731
MODEL_NAME = T("baseline_demand_model")

def get_spark():
    """Ambient session on Databricks (job task / notebook); Databricks Connect (serverless) locally."""
    try:
        from pyspark.sql import SparkSession
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except ImportError:
        from pyspark.sql import SparkSession
        return SparkSession.builder.getOrCreate()


spark = get_spark()
pos = spark.table(T("pos_weekly_sales")).toPandas()
events = spark.table(T("promo_events")).toPandas()
products = spark.table(T("products")).toPandas()
cal = spark.table(T("calendar_weeks")).toPandas()
for df, cols in ((pos, ["week_start"]), (events, ["start_week", "end_week"]), (cal, ["week_start"])):
    for c in cols:
        df[c] = pd.to_datetime(df[c]).dt.date

weeks = sorted(cal.week_start)
widx = {w: i for i, w in enumerate(weeks)}
fam = products.set_index("sku").brand_family.to_dict()
carried = set(zip(pos.retailer_id, pos.sku))

# ── flag the weeks a promotion contaminates
dirty = set()
for e in events.itertuples():
    i0 = widx[e.start_week]
    for k in range(i0, i0 + int(e.weeks) + 4):            # event + pantry-loading window
        if k < len(weeks):
            dirty.add((e.retailer_id, e.sku, weeks[k]))
    for s, f in fam.items():                             # sister SKUs during the event
        if f == fam[e.sku] and s != e.sku and (e.retailer_id, s) in carried:
            for k in range(i0, i0 + int(e.weeks)):
                dirty.add((e.retailer_id, s, weeks[k]))
pos["clean"] = [(r, s, w) not in dirty for r, s, w in zip(pos.retailer_id, pos.sku, pos.week_start)]


def features(df: pd.DataFrame) -> pd.DataFrame:
    c = cal.set_index("week_start")
    woy = df.week_start.map(lambda w: w.timetuple().tm_yday) / 365.25
    return pd.DataFrame({
        "retailer_id": df.retailer_id.astype(str),
        "sku": df.sku.astype(str),
        "holiday": df.week_start.map(c.holiday).fillna("none").astype(str),
        "woy_sin": np.sin(2 * np.pi * woy), "woy_cos": np.cos(2 * np.pi * woy),
        "woy_sin2": np.sin(4 * np.pi * woy), "woy_cos2": np.cos(4 * np.pi * woy),
        "trend": df.week_start.map(widx).astype(float),
    })


def make_model():
    pre = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), ["retailer_id", "sku", "holiday"])],
                            remainder="passthrough")
    gbr = GradientBoostingRegressor(n_estimators=600, max_depth=4, learning_rate=0.05, subsample=0.9, random_state=7)
    return TransformedTargetRegressor(regressor=Pipeline([("pre", pre), ("gbr", gbr)]), func=np.log1p, inverse_func=np.expm1)


train = pos[pos.clean & (pos.units_sold > 0)].copy()
cut = sorted(train.week_start.unique())[-16]
tr, ho = train[train.week_start < cut], train[train.week_start >= cut]

if args.experiment:
    mlflow.set_experiment(args.experiment)
mlflow.set_registry_uri("databricks-uc")
with mlflow.start_run(run_name="baseline_demand_gbr") as run:
    m = make_model().fit(features(tr), tr.units_sold)
    pred = m.predict(features(ho))
    mape = float(np.mean(np.abs(pred - ho.units_sold) / ho.units_sold))
    wape = float(np.sum(np.abs(pred - ho.units_sold)) / np.sum(ho.units_sold))
    naive = ho.merge(tr.groupby(["retailer_id", "sku"]).units_sold.mean().rename("naive").reset_index(), on=["retailer_id", "sku"])
    naive_wape = float(np.sum(np.abs(naive.naive - naive.units_sold)) / np.sum(naive.units_sold))
    mlflow.log_params({"model": "GradientBoostingRegressor", "n_estimators": 600, "max_depth": 4, "learning_rate": 0.05,
                       "target": "log1p(units)", "training_rows": len(tr), "holdout_weeks": 16})
    mlflow.log_metrics({"holdout_mape": mape, "holdout_wape": wape, "naive_mean_wape": naive_wape})
    print(f"holdout MAPE {mape:.3%}  WAPE {wape:.3%}  (naive retailer-SKU mean WAPE {naive_wape:.3%})")
    final = make_model().fit(features(train), train.units_sold)
    X = features(train.head(50))
    kw = dict(name="model", signature=infer_signature(X, final.predict(X)), input_example=X.head(5), registered_model_name=MODEL_NAME)
    try:  # MLflow >= 3.9 serializes sklearn with skops: trust the types of the model WE just trained
        try:
            import skops.io as sio
            trusted = sio.get_untrusted_types(data=sio.dumps(final))
        except Exception:
            trusted = ["sklearn.tree._tree.Tree", "sklearn.compose._column_transformer._RemainderColsList"]
        info = mlflow.sklearn.log_model(final, skops_trusted_types=trusted, **kw)
    except TypeError:  # older MLflow: pickle
        info = mlflow.sklearn.log_model(final, **kw)
    version = info.registered_model_version

client = mlflow.MlflowClient(registry_uri="databricks-uc")
client.set_registered_model_alias(MODEL_NAME, "champion", version)
client.update_registered_model(MODEL_NAME, description=(
    "Crestwood baseline demand (units/week without promotion) per retailer x SKU. Trained on clean non-promoted weeks; "
    "used by the post-event analysis (incremental lift = actual - baseline) and to forecast next quarter's promo plan."))
print(f"registered {MODEL_NAME} v{version} @champion")

# ── score every retailer x SKU x week (history + plan) with the champion
try:
    champ = mlflow.sklearn.load_model(f"models:/{MODEL_NAME}@champion")
except Exception as ex:  # e.g. skops trust list on load — the champion IS `final`
    print(f"(load @champion failed: {str(ex)[:120]} — scoring with the in-memory champion)")
    champ = final
grid = pd.DataFrame([(r, s, w) for (r, s) in sorted(carried) for w in weeks], columns=["retailer_id", "sku", "week_start"])
grid["baseline_units"] = np.round(champ.predict(features(grid)), 1)
plan_weeks = set(cal[cal.is_plan_week].week_start)
grid["is_future"] = grid.week_start.isin(plan_weeks)
grid["model_version"] = str(version)
grid = grid.merge(pos[["retailer_id", "sku", "week_start", "units_sold", "clean"]], how="left", on=["retailer_id", "sku", "week_start"])
grid = grid.rename(columns={"clean": "is_clean_week"})
grid["scored_at"] = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
spark.createDataFrame(grid).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(T("baseline_forecast"))
spark.sql(f"COMMENT ON TABLE {T('baseline_forecast')} IS 'ML baseline (baseline_demand_model@champion): expected units per retailer x SKU x week without promotion - history + next quarter'")
print(f"baseline_forecast: {len(grid)} rows ({int(grid.is_future.sum())} future)")
