"""
Crestwood Snacks — GOLD layer: post-event analysis + next-quarter plan forecast + re-plan scenarios.

Reads the silver tables + the ML baseline (`baseline_forecast`, written by src/ml/train_baseline_model.py)
and writes:

  gold_event_roi         one row per completed promotion — the post-event analysis:
                         baseline (ML) vs actual → gross incremental → minus pantry-loading dip (4 post weeks)
                         → minus sister-SKU cannibalization → net incremental units; trade spend
                         (per-unit allowance on scanned units, or on every unit bought on deal for off-invoice
                         accounts — forward buying) + fixed fees; incremental gross profit; net profit; ROI
  gold_event_weekly      week-by-week curve per event (4 pre, event, 4 post): actual vs baseline, sister SKUs
  gold_tactic_response   retailer x tactic x funding: average lift, dip, cannibalization, forward-buy ratios, ROI
  gold_plan_scenarios    every planned event x candidate tactic: forecast units, spend, profit, ROI, policy check
  gold_plan_forecast     the as-planned forecast of every next-quarter event (+ the recommended alternative)
  trade_promo_metrics    UC metric view over gold_event_roi (governed KPIs for Genie / dashboard)

ROI definition (Crestwood Trade Promotion Guidelines TPG-2027 §3):
  incremental gross profit = net incremental units x unit gross margin (list price - COGS)
                             - cannibalized sister units x sister unit margin
  trade spend              = allowance per unit x (scanned event units | units bought on deal) + fixed fees
  net profit               = incremental gross profit - trade spend
  ROI                      = net profit / trade spend           (< 0 = the event lost money)

Usage: python build_gold.py --catalog retail_consumer_goods --schema trade_promotion_roi
"""
import argparse
import datetime as dt

import numpy as np
import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument("--catalog", default="retail_consumer_goods")
parser.add_argument("--schema", default="trade_promotion_roi")
parser.add_argument("--dry-run", default="", help="local tuning: read /tmp pickle from generate_data --dry-run")
args, _ = parser.parse_known_args()
CAT, SCH = args.catalog, args.schema
T = lambda n: f"{CAT}.{SCH}.{n}"  # noqa: E731

POST_WEEKS = 4
PRE_WEEKS = 4
# policy guardrails (TPG-2027): depth <= 30% without a VP Sales exception, forecast ROI >= 0 (target >= +15%)
MAX_DEPTH = 0.30
ROI_HURDLE = 0.0
STANDARD = {  # candidate tactics for a re-plan: depth, mfr funding share, feature, display
    "BOGO": (0.50, 0.50, True, False),
    "Feature + Display": (0.22, 0.50, True, True),
    "TPR": (0.18, 0.50, False, False),
    "Multi-buy": (0.30, 0.40, True, False),
}

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


if args.dry_run:
    import pickle
    d = pickle.load(open(f"{args.dry_run}/data.pkl", "rb"))
    retailers, products, events, pos, shp, plan = d["retailers"], d["products"], d["promo_events"], d["pos"], d["shp"], d["plan"]
    rows = []
    for (rid, sku), b in d["base"].items():
        for i, w in enumerate(sorted(pos.week_start.unique())):
            rows.append(dict(week_start=w, retailer_id=rid, sku=sku, baseline_units=b[i], is_future=False))
    base = pd.DataFrame(rows)
    fut = [dict(week_start=w, retailer_id=k[0], sku=k[1], baseline_units=v[i], is_future=True)
           for k, v in d["fut_base"].items() for i, w in enumerate(d["plan_weeks"])]
    base = pd.concat([base, pd.DataFrame(fut)])
    spark = None
else:
    spark = get_spark()
    rd = lambda n: spark.table(T(n)).toPandas()  # noqa: E731
    retailers, products, events, pos, shp, plan = (rd(n) for n in ["retailers", "products", "promo_events", "pos_weekly_sales",
                                                                     "retailer_shipments", "promo_plan"])
    base = rd("baseline_forecast")

for df in (pos, shp, base):
    df["week_start"] = pd.to_datetime(df["week_start"]).dt.date
for c in ("start_week", "end_week"):
    events[c] = pd.to_datetime(events[c]).dt.date
    plan[c] = pd.to_datetime(plan[c]).dt.date

P = products.set_index("sku")
R = retailers.set_index("retailer_id")
fam = products.groupby("brand_family").sku.apply(list).to_dict()
weeks = sorted(pos.week_start.unique())
widx = {w: i for i, w in enumerate(weeks)}
POS = pos.set_index(["retailer_id", "sku", "week_start"]).units_sold.to_dict()
SHP = shp.set_index(["retailer_id", "sku", "week_start"])[["units_shipped", "units_on_deal"]].to_dict("index")
BASE = base.set_index(["retailer_id", "sku", "week_start"]).baseline_units.to_dict()
carried = set(zip(pos.retailer_id, pos.sku))


def sisters_of(rid, sku):
    return [x for x in fam[P.loc[sku].brand_family] if x != sku and (rid, x) in carried]


# ─────────────────────────────────────────────────────────────── post-event analysis
roi_rows, curve_rows = [], []
for e in events.itertuples():
    rid, sku = e.retailer_id, e.sku
    i0 = widx[e.start_week]
    ev_w = weeks[i0:i0 + e.weeks]
    post_w = weeks[i0 + e.weeks:i0 + e.weeks + POST_WEEKS]
    pre_w = weeks[max(0, i0 - PRE_WEEKS):i0]
    sis = sisters_of(rid, sku)
    m = float(P.loc[sku].unit_margin_usd)
    base_ev = sum(BASE[(rid, sku, w)] for w in ev_w)
    act_ev = sum(POS[(rid, sku, w)] for w in ev_w)
    gross = act_ev - base_ev
    dip = sum(BASE[(rid, sku, w)] - POS[(rid, sku, w)] for w in post_w)
    can_units = sum(BASE[(rid, s, w)] - POS[(rid, s, w)] for s in sis for w in ev_w)
    can_gp = sum((BASE[(rid, s, w)] - POS[(rid, s, w)]) * float(P.loc[s].unit_margin_usd) for s in sis for w in ev_w)
    deal = sum(SHP[(rid, sku, w)]["units_on_deal"] for w in [weeks[i0 - 1]] + ev_w)
    fwd = max(deal - act_ev, 0.0) if e.funding_method == "off-invoice" else 0.0
    paid_units = deal if e.funding_method == "off-invoice" else act_ev
    variable = paid_units * float(e.allowance_per_unit_usd)
    subsidised_baseline = base_ev * float(e.allowance_per_unit_usd)
    spend = variable + float(e.fixed_fees_usd)
    net_units = gross - dip - can_units
    inc_gp = (gross - dip) * m - can_gp
    net_profit = inc_gp - spend
    roi = net_profit / spend if spend else None
    roi_rows.append(dict(
        event_id=e.event_id, event_name=e.event_name, retailer_id=rid, retailer_name=R.loc[rid].retailer_name,
        channel=R.loc[rid].channel, sku=sku, product_name=P.loc[sku].product_name, brand=P.loc[sku].brand,
        brand_family=P.loc[sku].brand_family, tactic=e.tactic, discount_depth=float(e.discount_depth),
        feature_ad=bool(e.feature_ad), in_store_display=bool(e.in_store_display), funding_method=e.funding_method,
        start_week=e.start_week, end_week=e.end_week, weeks=int(e.weeks),
        quarter=f"{pd.Timestamp(e.start_week).year}-Q{(pd.Timestamp(e.start_week).month - 1) // 3 + 1}",
        is_last_52_weeks=bool(i0 >= len(weeks) - 52),
        baseline_units=round(base_ev), actual_units=int(act_ev), gross_incremental_units=round(gross),
        volume_lift_pct=round(gross / base_ev, 4) if base_ev else None,
        post_event_dip_units=round(dip), cannibalized_units=round(can_units), forward_buy_units=round(fwd),
        net_incremental_units=round(net_units),
        pantry_loading_pct_of_lift=round(dip / gross, 4) if gross > 0 else None,
        cannibalization_pct_of_lift=round(can_units / gross, 4) if gross > 0 else None,
        units_paid_allowance=round(paid_units), allowance_per_unit_usd=float(e.allowance_per_unit_usd),
        variable_trade_spend_usd=round(variable, 2), fixed_fees_usd=float(e.fixed_fees_usd),
        trade_spend_usd=round(spend, 2), subsidised_baseline_usd=round(subsidised_baseline, 2),
        forward_buy_cost_usd=round(fwd * float(e.allowance_per_unit_usd), 2),
        incremental_revenue_usd=round(net_units * float(P.loc[sku].list_price_usd), 2),
        incremental_gross_profit_usd=round(inc_gp, 2), net_profit_usd=round(net_profit, 2),
        roi=round(roi, 4) if roi is not None else None,
        verdict="Lost money" if net_profit < 0 else ("Pays back" if (roi or 0) >= 0.15 else "Marginal"),
        key_account_manager=e.key_account_manager,
    ))
    for rel, w in [(k - len(pre_w), w) for k, w in enumerate(pre_w)] + [(k, w) for k, w in enumerate(ev_w + post_w)]:
        phase = "pre" if rel < 0 else ("event" if rel < e.weeks else "post")
        curve_rows.append(dict(
            event_id=e.event_id, rel_week=int(rel), phase=phase, week_start=w,
            actual_units=int(POS[(rid, sku, w)]), baseline_units=round(BASE[(rid, sku, w)]),
            sister_actual_units=int(sum(POS[(rid, s, w)] for s in sis)),
            sister_baseline_units=round(sum(BASE[(rid, s, w)] for s in sis)),
            units_shipped=int(SHP[(rid, sku, w)]["units_shipped"]), units_on_deal=int(SHP[(rid, sku, w)]["units_on_deal"])))
roi = pd.DataFrame(roi_rows)
curve = pd.DataFrame(curve_rows)

# ─────────────────────────────────────────────────────────────── tactic response (retailer x tactic x funding)
g = roi.groupby(["retailer_id", "retailer_name", "tactic", "funding_method"])
resp = g.agg(events=("event_id", "count"), baseline_units=("baseline_units", "sum"), gross=("gross_incremental_units", "sum"),
             dip=("post_event_dip_units", "sum"), can=("cannibalized_units", "sum"), fwd=("forward_buy_units", "sum"),
             actual=("actual_units", "sum"), spend=("trade_spend_usd", "sum"), profit=("net_profit_usd", "sum"),
             gp=("incremental_gross_profit_usd", "sum"), avg_depth=("discount_depth", "mean")).reset_index()
resp["avg_lift_multiplier"] = (resp.actual / resp.baseline_units).round(4)
resp["dip_ratio"] = (resp.dip / resp.gross).round(4)
resp["cannibalization_ratio"] = (resp.can / resp.gross).round(4)
resp["forward_buy_ratio"] = (resp.fwd / resp.actual).round(4)
resp["roi"] = (resp.profit / resp.spend).round(4)
resp = resp.rename(columns={"spend": "trade_spend_usd", "profit": "net_profit_usd", "gp": "incremental_gross_profit_usd",
                            "gross": "gross_incremental_units", "dip": "post_event_dip_units", "can": "cannibalized_units",
                            "fwd": "forward_buy_units", "actual": "actual_units"})


def response_for(rid, tactic, funding):
    """Historical response of this retailer to this tactic; falls back to channel-wide, then portfolio."""
    r = resp[(resp.retailer_id == rid) & (resp.tactic == tactic)]
    if len(r):
        lift = (r.actual_units.sum() / r.baseline_units.sum())
        dip = r.post_event_dip_units.sum() / r.gross_incremental_units.sum()
        can = r.cannibalized_units.sum() / r.gross_incremental_units.sum()
        n = int(r.events.sum())
    else:
        a = resp[resp.tactic == tactic]
        lift, dip = a.actual_units.sum() / a.baseline_units.sum(), a.post_event_dip_units.sum() / a.gross_incremental_units.sum()
        can, n = a.cannibalized_units.sum() / a.gross_incremental_units.sum(), 0
    f = resp[(resp.retailer_id == rid) & (resp.tactic == tactic) & (resp.funding_method == "off-invoice")]
    if funding == "off-invoice":
        fwd = (f.forward_buy_units.sum() / f.actual_units.sum()) if len(f) else \
            resp[(resp.tactic == tactic) & (resp.funding_method == "off-invoice")].pipe(
                lambda x: x.forward_buy_units.sum() / max(x.actual_units.sum(), 1))
    else:
        fwd = 0.0
    return float(lift), float(dip), float(can), float(fwd), n


def forecast(pe, tactic, depth, share, feature, display, funding):
    rid, sku = pe.retailer_id, pe.sku
    wk = [pe.start_week + dt.timedelta(days=7 * k) for k in range(int(pe.weeks))]
    b = sum(BASE.get((rid, sku, w), 0.0) for w in wk)
    lift, dip_r, can_r, fwd_r, n = response_for(rid, tactic, funding)
    if tactic in ("TPR", "Feature + Display"):
        lift = 1 + (lift - 1) * (1 + 1.6 * (depth - STANDARD[tactic][0]))
    units = b * lift
    gross = units - b
    dip = gross * dip_r
    can = gross * can_r
    fwd = units * fwd_r
    shelf = float(pe.regular_shelf_price_usd)
    allowance = shelf * depth * share
    fixed = (float(R.loc[rid].feature_fee_usd) if feature else 0.0) + (float(R.loc[rid].display_fee_usd) if display else 0.0)
    spend = allowance * (units + fwd) + fixed
    sis = sisters_of(rid, sku)
    m = float(P.loc[sku].unit_margin_usd)
    m_s = float(np.mean([P.loc[s].unit_margin_usd for s in sis])) if sis else m
    gp = (gross - dip) * m - can * m_s
    profit = gp - spend
    return dict(baseline_units=round(b), forecast_units=round(units), gross_incremental_units=round(gross),
                post_event_dip_units=round(dip), cannibalized_units=round(can), forward_buy_units=round(fwd),
                net_incremental_units=round(gross - dip - can), allowance_per_unit_usd=round(allowance, 3),
                fixed_fees_usd=round(fixed, 2), trade_spend_usd=round(spend, 2), incremental_gross_profit_usd=round(gp, 2),
                net_profit_usd=round(profit, 2), roi=round(profit / spend, 4) if spend else None,
                promo_price_usd=round(shelf * (1 - depth), 2), analog_events=n,
                volume_units_total=round(units - dip))  # event + the post-event hangover (what volume the P&L really keeps)


LABEL = {"BOGO": "BOGO (50% effective)", "Feature + Display": "Feature + Display, 22% TPR", "TPR": "Shelf TPR 18%",
         "Multi-buy": "Multi-buy (~30% off, e.g. 2 for $X)"}
scen_rows = []
for pe in plan.itertuples():
    r = R.loc[pe.retailer_id]
    cands = [("as_planned", pe.tactic, float(pe.discount_depth), float(pe.mfr_funding_share), bool(pe.feature_ad),
              bool(pe.in_store_display), pe.funding_method)]
    for t, (dep, sh, fe, di) in STANDARD.items():
        if t == pe.tactic:
            continue
        if pe.retailer_id == "R05" and t == "BOGO":
            continue
        fund = pe.funding_method
        if t != "BOGO" and r.default_funding_method == "off-invoice" and bool(r.scan_settlement_available):
            fund = "scan-based"   # the trade terms allow scan-down settlement for non-BOGO events
        cands.append((t.lower().replace(" + ", "_").replace("-", "_").replace(" ", "_"), t, dep, sh, fe, di, fund))
    for key, t, dep, sh, fe, di, fund in cands:
        f = forecast(pe, t, dep, sh, fe, di, fund)
        issues = []
        if dep > MAX_DEPTH:
            issues.append("depth > 30% needs a VP Sales exception (TPG-2027 §4.1)")
        if (f["roi"] or 0) < ROI_HURDLE:
            issues.append("forecast ROI below the 0% hurdle (TPG-2027 §3.2)")
        scen_rows.append(dict(
            plan_event_id=pe.plan_event_id, scenario_key=key, is_as_planned=(key == "as_planned"), tactic=t,
            scenario_label=("As planned: " if key == "as_planned" else "") + (LABEL[t] if t in LABEL else t)
            + (" - scan-based" if fund == "scan-based" and pe.funding_method == "off-invoice" else ""),
            discount_depth=dep, mfr_funding_share=sh, feature_ad=fe, in_store_display=di, funding_method=fund,
            policy_compliant=not issues, policy_notes="; ".join(issues) or "Compliant with TPG-2027", **f))
scen = pd.DataFrame(scen_rows)
asp = scen[scen.is_as_planned].set_index("plan_event_id")
scen["net_profit_delta_usd"] = scen.apply(lambda s: round(s.net_profit_usd - asp.loc[s.plan_event_id].net_profit_usd, 2), axis=1)
scen["volume_delta_units"] = scen.apply(lambda s: round(s.volume_units_total - asp.loc[s.plan_event_id].volume_units_total), axis=1)
scen["trade_spend_delta_usd"] = scen.apply(lambda s: round(s.trade_spend_usd - asp.loc[s.plan_event_id].trade_spend_usd, 2), axis=1)
# recommended = the compliant scenario with the highest net profit (as planned wins ties)
scen["recommended"] = False
for pid, grp in scen.groupby("plan_event_id"):
    ok = grp[grp.policy_compliant]
    if len(ok):
        best = ok.sort_values(["net_profit_usd", "is_as_planned"], ascending=[False, False]).index[0]
        scen.loc[best, "recommended"] = True

fc = plan.merge(asp.reset_index()[["plan_event_id", "baseline_units", "forecast_units", "gross_incremental_units",
                                   "post_event_dip_units", "cannibalized_units", "forward_buy_units", "net_incremental_units",
                                   "allowance_per_unit_usd", "trade_spend_usd", "incremental_gross_profit_usd",
                                   "net_profit_usd", "roi", "analog_events", "volume_units_total", "policy_notes"]],
                on="plan_event_id")
rec = scen[scen.recommended].set_index("plan_event_id")
fc["retailer_name"] = fc.retailer_id.map(R.retailer_name)
fc["product_name"] = fc.sku.map(P.product_name)
fc["brand"] = fc.sku.map(P.brand)
fc["forecast_flag"] = np.where(fc.net_profit_usd < 0, "Money-losing", np.where(fc.roi < 0.15, "Below target", "On track"))
fc["recommended_scenario_key"] = fc.plan_event_id.map(rec.scenario_key)
fc["recommended_scenario_label"] = fc.plan_event_id.map(rec.scenario_label)
fc["recommended_net_profit_usd"] = fc.plan_event_id.map(rec.net_profit_usd)
fc["recommended_roi"] = fc.plan_event_id.map(rec.roi)
fc["week_number"] = fc.start_week.map(lambda w: sorted(plan.start_week.unique()).index(w) if False else None)
first = min(plan.start_week)
fc["plan_week"] = fc.start_week.map(lambda w: (w - first).days // 7 + 1)
fc = fc.drop(columns=["week_number"])

if args.dry_run:
    pd.set_option("display.width", 250, "display.max_columns", 40)
    print(resp[["retailer_name", "tactic", "funding_method", "events", "avg_lift_multiplier", "dip_ratio", "cannibalization_ratio",
                "forward_buy_ratio", "roi"]].to_string())
    print(roi.groupby(["retailer_id","tactic"])[["net_profit_usd","trade_spend_usd"]].sum().assign(roi=lambda x: x.net_profit_usd/x.trade_spend_usd).round(3)); print(roi.verdict.value_counts())
    print(fc[["plan_event_id", "retailer_name", "sku", "tactic", "funding_method", "trade_spend_usd", "net_profit_usd", "roi", "forecast_flag",
              "recommended_scenario_label", "recommended_net_profit_usd", "recommended_roi"]].to_string())
    raise SystemExit(0)


# ─────────────────────────────────────────────────────────────── write
def save(df, name, comment):
    spark.createDataFrame(df).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(T(name))
    spark.sql(f"COMMENT ON TABLE {T(name)} IS '{comment}'")
    print(f"  {name:22s} {len(df):>6} rows")


save(roi, "gold_event_roi", "Post-event analysis per completed promotion: ML baseline vs actual, pantry-loading dip, cannibalization, forward buy, trade spend, incremental gross profit, net profit and ROI")
save(curve, "gold_event_weekly", "Week-by-week curve per promotion (4 weeks before, event, 4 weeks after): actual vs ML baseline for the promoted SKU and its sister SKUs, shipments vs units on deal")
save(resp, "gold_tactic_response", "Historical response by retailer x tactic x funding method: lift multiplier, pantry-loading dip, cannibalization and forward-buy ratios, ROI")
save(scen, "gold_plan_scenarios", "Next-quarter re-plan scenarios: every planned event x candidate tactic with forecast units, trade spend, net profit, ROI and the TPG-2027 policy check")
save(fc, "gold_plan_forecast", "Next-quarter draft promo calendar with the as-planned forecast (ML baseline + historical response), money-losing flag and the recommended compliant alternative")

spark.sql(f"""
CREATE OR REPLACE VIEW {T('trade_promo_metrics')}
WITH METRICS
LANGUAGE YAML
COMMENT 'Governed trade-promotion KPIs over the post-event analysis (Crestwood TPG-2027 definitions)'
AS $$
version: 1.1
source: {T('gold_event_roi')}
dimensions:
  - name: Retailer
    expr: retailer_name
  - name: Channel
    expr: channel
  - name: Tactic
    expr: tactic
  - name: Funding Method
    expr: funding_method
  - name: Brand
    expr: brand
  - name: Product
    expr: product_name
  - name: Quarter
    expr: quarter
  - name: Event Start Week
    expr: start_week
  - name: Last 52 Weeks
    expr: is_last_52_weeks
measures:
  - name: Events
    expr: COUNT(1)
  - name: Trade Spend
    expr: SUM(trade_spend_usd)
  - name: Incremental Gross Profit
    expr: SUM(incremental_gross_profit_usd)
  - name: Net Profit
    expr: SUM(net_profit_usd)
  - name: ROI
    expr: SUM(net_profit_usd) / NULLIF(SUM(trade_spend_usd), 0)
  - name: Volume Lift
    expr: SUM(gross_incremental_units) / NULLIF(SUM(baseline_units), 0)
  - name: Gross Incremental Units
    expr: SUM(gross_incremental_units)
  - name: Net Incremental Units
    expr: SUM(net_incremental_units)
  - name: Pantry Loading Share
    expr: SUM(post_event_dip_units) / NULLIF(SUM(gross_incremental_units), 0)
  - name: Cannibalization Share
    expr: SUM(cannibalized_units) / NULLIF(SUM(gross_incremental_units), 0)
  - name: Forward Buy Units
    expr: SUM(forward_buy_units)
  - name: Money Losing Events
    expr: COUNT(1) FILTER (WHERE net_profit_usd < 0)
$$""")
print("  trade_promo_metrics    metric view")
for t, k in [("gold_event_roi", "event_id"), ("gold_plan_forecast", "plan_event_id")]:
    spark.sql(f"ALTER TABLE {T(t)} ALTER COLUMN {k} SET NOT NULL")
    try:
        spark.sql(f"ALTER TABLE {T(t)} ADD CONSTRAINT pk_{t} PRIMARY KEY ({k}) RELY")
    except Exception as ex:
        print(f"  (pk {t}: {str(ex)[:80]})")
print("gold done")
