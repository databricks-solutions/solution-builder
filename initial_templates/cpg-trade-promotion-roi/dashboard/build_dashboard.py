"""Builds dashboard/trade_promotion_roi.lvdash.json (schema-less datasets; the DAB injects catalog/schema).
   python build_dashboard.py dashboard/trade_promotion_roi.lvdash.json"""
import json
import sys

OUT = sys.argv[1]
DS = {
 "ds_kpi": ("Headline KPIs (last 2 years)", """SELECT
  SUM(trade_spend_usd) AS trade_spend,
  SUM(incremental_gross_profit_usd) AS incremental_gp,
  SUM(net_profit_usd) AS net_profit,
  SUM(net_profit_usd) / SUM(trade_spend_usd) AS roi,
  AVG(CASE WHEN net_profit_usd < 0 THEN 1.0 ELSE 0.0 END) AS share_events_lost_money,
  SUM(CASE WHEN retailer_name = 'ValuMax Stores' AND tactic = 'BOGO' THEN net_profit_usd END) AS valumax_bogo_net_profit
FROM gold_event_roi"""),
 "ds_events": ("Completed promotions (post-event analysis)", """SELECT event_id, event_name, retailer_name, channel, product_name, brand, tactic, funding_method, start_week, quarter,
  discount_depth, volume_lift_pct, pantry_loading_pct_of_lift, cannibalization_pct_of_lift, forward_buy_units,
  baseline_units, actual_units, gross_incremental_units, post_event_dip_units, cannibalized_units, net_incremental_units,
  trade_spend_usd, incremental_gross_profit_usd, net_profit_usd, roi, verdict, is_last_52_weeks
FROM gold_event_roi"""),
 "ds_tactic": ("ROI by retailer x tactic", """SELECT retailer_name, tactic, SUM(events) AS events, SUM(trade_spend_usd) AS trade_spend,
  SUM(net_profit_usd) AS net_profit, SUM(net_profit_usd) / SUM(trade_spend_usd) AS roi,
  SUM(gross_incremental_units) / SUM(baseline_units) AS volume_lift
FROM gold_tactic_response GROUP BY ALL"""),
 "ds_leakage": ("Where the lift goes, by tactic", """SELECT tactic, 'Net incremental' AS component, SUM(net_incremental_units) AS units FROM gold_event_roi GROUP BY tactic
UNION ALL SELECT tactic, 'Pantry-loading dip', SUM(post_event_dip_units) FROM gold_event_roi GROUP BY tactic
UNION ALL SELECT tactic, 'Cannibalized sister SKUs', SUM(cannibalized_units) FROM gold_event_roi GROUP BY tactic"""),
 "ds_spend_q": ("Trade spend by quarter and retailer", """SELECT quarter, retailer_name, SUM(trade_spend_usd) AS trade_spend, SUM(net_profit_usd) AS net_profit
FROM gold_event_roi GROUP BY ALL"""),
 "ds_plan": ("Next quarter promo plan forecast", """SELECT plan_event_id, plan_week, start_week, retailer_name, product_name, tactic, discount_depth, funding_method,
  forecast_units, trade_spend_usd, net_profit_usd, roi, forecast_flag, recommended_scenario_label, recommended_net_profit_usd, recommended_roi, planner_note
FROM gold_plan_forecast"""),
 "ds_plan_kpi": ("Next quarter KPIs", """SELECT COUNT(*) AS planned_events, SUM(trade_spend_usd) AS planned_spend, SUM(net_profit_usd) AS forecast_net_profit,
  SUM(net_profit_usd) / SUM(trade_spend_usd) AS forecast_roi,
  COUNT_IF(forecast_flag = 'Money-losing') AS money_losing_events,
  SUM(CASE WHEN forecast_flag = 'Money-losing' THEN recommended_net_profit_usd - net_profit_usd END) AS replan_upside
FROM gold_plan_forecast"""),
 "ds_replan": ("Money-losing events: as planned vs recommended", """SELECT concat(plan_event_id, ' ', product_name) AS event, 'As planned' AS scenario, net_profit_usd AS net_profit FROM gold_plan_forecast WHERE forecast_flag = 'Money-losing'
UNION ALL SELECT concat(plan_event_id, ' ', product_name), 'Recommended re-plan', recommended_net_profit_usd FROM gold_plan_forecast WHERE forecast_flag = 'Money-losing'"""),
}


def ds(name):
    d, q = DS[name]
    return {"name": name, "displayName": d, "queryLines": [ln + "\n" for ln in q.split("\n")]}


def f(n, e=None):
    return {"name": n, "expression": e or f"`{n}`"}


def w(name, dsn, fields, spec, pos, disagg=True):
    return {"widget": {"name": name, "queries": [{"name": "main_query", "query": {"datasetName": dsn, "fields": fields, "disaggregated": disagg}}],
                       "spec": spec}, "position": pos}


def text(name, lines, pos):
    return {"widget": {"name": name, "multilineTextboxSpec": {"lines": lines}}, "position": pos}


def counter(name, dsn, field, title, fmt, pos):
    return w(name, dsn, [f(field)], {"version": 2, "widgetType": "counter", "encodings": {"value": {"fieldName": field, "displayName": title, "format": fmt}},
                                     "frame": {"showTitle": True, "title": title}}, pos)


PCT = {"type": "number-percent", "decimalPlaces": {"type": "max", "places": 1}}
USD = {"type": "number-currency", "currencyCode": "USD", "abbreviation": "compact", "decimalPlaces": {"type": "max", "places": 1}}
NUM = {"type": "number-plain", "abbreviation": "compact", "decimalPlaces": {"type": "max", "places": 0}}


def pos(x, y, wd, h):
    return {"x": x, "y": y, "width": wd, "height": h}


def table(name, dsn, cols, title, p, per=10):
    return w(name, dsn, [f(c) for c, _ in cols], {"version": 1, "widgetType": "table", "encodings": {"columns": [
        {"fieldName": c, "displayName": d} for c, d in cols]}, "invisibleColumns": [], "allowHTMLByDefault": False, "itemsPerPage": per,
        "frame": {"showTitle": True, "title": title}}, p)


p1 = [
 text("p1_title", ["# Crestwood Snacks — Trade Spend & Promotion ROI\n", "\n",
   "Post-event analysis of every completed trade promotion across our 5 retail accounts. Incremental volume is measured against the "
   "**ML baseline** (`baseline_demand_model@champion`) and netted for **pantry loading** (the dip in the 4 weeks after), **cannibalization** "
   "of sister SKUs and **forward buying** on off-invoice deals. ROI = (incremental gross profit − trade spend) ÷ trade spend (TPG-2027)."], pos(0, 0, 6, 3)),
 counter("kpi_spend", "ds_kpi", "trade_spend", "Trade spend — last 2 years", USD, pos(0, 3, 1, 3)),
 counter("kpi_gp", "ds_kpi", "incremental_gp", "Incremental gross profit", USD, pos(1, 3, 1, 3)),
 counter("kpi_np", "ds_kpi", "net_profit", "Net profit after trade spend", USD, pos(2, 3, 1, 3)),
 counter("kpi_roi", "ds_kpi", "roi", "Blended promotion ROI", PCT, pos(3, 3, 1, 3)),
 counter("kpi_lost", "ds_kpi", "share_events_lost_money", "Share of events that lost money", PCT, pos(4, 3, 1, 3)),
 counter("kpi_vm", "ds_kpi", "valumax_bogo_net_profit", "ValuMax BOGO net profit", USD, pos(5, 3, 1, 3)),
 w("scatter", "ds_events", [f("volume_lift_pct"), f("roi"), f("tactic"), f("event_name")],
   {"version": 3, "widgetType": "scatter", "encodings": {
     "x": {"fieldName": "volume_lift_pct", "scale": {"type": "quantitative"}, "displayName": "Volume lift vs ML baseline", "format": PCT},
     "y": {"fieldName": "roi", "scale": {"type": "quantitative"}, "displayName": "ROI", "format": PCT},
     "color": {"fieldName": "tactic", "scale": {"type": "categorical"}, "displayName": "Tactic"}},
    "frame": {"showTitle": True, "title": "Every promotion: the biggest volume spikes (BOGO) are the ones that lose money"}}, pos(0, 6, 3, 8)),
 w("tactic_roi", "ds_tactic", [f("tactic"), f("retailer_name"), f("roi_agg", "SUM(`net_profit`) / SUM(`trade_spend`)")],
   {"version": 3, "widgetType": "bar", "encodings": {
     "x": {"fieldName": "tactic", "scale": {"type": "categorical"}, "displayName": "Tactic"},
     "y": {"fieldName": "roi_agg", "scale": {"type": "quantitative"}, "displayName": "ROI", "format": PCT},
     "color": {"fieldName": "retailer_name", "scale": {"type": "categorical", "mappings": [{"value": "Greenleaf Market", "color": "#094074"}, {"value": "Harbor Fresh Grocers", "color": "#3C6997"}, {"value": "QuickPantry", "color": "#5ADBFF"}, {"value": "BulkWise Club", "color": "#FFDD4A"}, {"value": "ValuMax Stores", "color": "#FE9000"}]}, "displayName": "Retailer"}},
    "mark": {"layout": "group"},
    "frame": {"showTitle": True, "title": "ROI by tactic and retailer (last 104 weeks)"}}, pos(3, 6, 3, 8), False),
 w("leakage", "ds_leakage", [f("tactic"), f("component"), f("sum(units)", "SUM(`units`)")],
   {"version": 3, "widgetType": "bar", "encodings": {
     "x": {"fieldName": "tactic", "scale": {"type": "categorical"}, "displayName": "Tactic"},
     "y": {"fieldName": "sum(units)", "scale": {"type": "quantitative"}, "displayName": "Units", "format": NUM},
     "color": {"fieldName": "component", "scale": {"type": "categorical", "mappings": [{"value": "Net incremental", "color": "#094074"}, {"value": "Pantry-loading dip", "color": "#FFDD4A"}, {"value": "Cannibalized sister SKUs", "color": "#FE9000"}]}, "displayName": "Where the gross lift went"}},
    "frame": {"showTitle": True, "title": "Where the lift goes: net incremental vs pantry loading vs cannibalization"}}, pos(0, 14, 3, 7), False),
 w("spend_q", "ds_spend_q", [f("quarter"), f("retailer_name"), f("sum(trade_spend)", "SUM(`trade_spend`)")],
   {"version": 3, "widgetType": "bar", "encodings": {
     "x": {"fieldName": "quarter", "scale": {"type": "categorical"}, "displayName": "Quarter"},
     "y": {"fieldName": "sum(trade_spend)", "scale": {"type": "quantitative"}, "displayName": "Trade spend", "format": USD},
     "color": {"fieldName": "retailer_name", "scale": {"type": "categorical", "mappings": [{"value": "Greenleaf Market", "color": "#094074"}, {"value": "Harbor Fresh Grocers", "color": "#3C6997"}, {"value": "QuickPantry", "color": "#5ADBFF"}, {"value": "BulkWise Club", "color": "#FFDD4A"}, {"value": "ValuMax Stores", "color": "#FE9000"}]}, "displayName": "Retailer"}},
    "frame": {"showTitle": True, "title": "Trade spend by quarter and retailer"}}, pos(3, 14, 3, 7), False),
 table("lost_table", "ds_events", [("event_name", "Event"), ("start_week", "Start week"), ("funding_method", "Funding"), ("volume_lift_pct", "Volume lift"),
       ("pantry_loading_pct_of_lift", "Pantry loading (% of lift)"), ("cannibalization_pct_of_lift", "Cannibalization (% of lift)"),
       ("forward_buy_units", "Forward-buy units"), ("trade_spend_usd", "Trade spend"), ("net_profit_usd", "Net profit"), ("roi", "ROI"), ("verdict", "Verdict")],
       "All completed promotions — sort by net profit to see the money-losers", pos(0, 21, 6, 8)),
]
p2 = [
 text("p2_title", ["## Next quarter — draft promo calendar forecast\n", "\n",
   "Each planned event is forecast with the ML baseline for its weeks × the account's historical response to the tactic. "
   "Events forecast to lose money must be re-planned (TPG-2027 §3.2, §5); the recommended compliant alternative is shown."], pos(0, 0, 6, 2)),
 counter("kpi_pe", "ds_plan_kpi", "planned_events", "Planned events", NUM, pos(0, 2, 1, 3)),
 counter("kpi_ps", "ds_plan_kpi", "planned_spend", "Planned trade spend", USD, pos(1, 2, 1, 3)),
 counter("kpi_pnp", "ds_plan_kpi", "forecast_net_profit", "Forecast net profit", USD, pos(2, 2, 1, 3)),
 counter("kpi_proi", "ds_plan_kpi", "forecast_roi", "Forecast blended ROI", PCT, pos(3, 2, 1, 3)),
 counter("kpi_pml", "ds_plan_kpi", "money_losing_events", "Money-losing events", NUM, pos(4, 2, 1, 3)),
 counter("kpi_up", "ds_plan_kpi", "replan_upside", "Re-plan upside (net profit)", USD, pos(5, 2, 1, 3)),
 w("replan_bar", "ds_replan", [f("event"), f("scenario"), f("sum(net_profit)", "SUM(`net_profit`)")],
   {"version": 3, "widgetType": "bar", "encodings": {
     "x": {"fieldName": "event", "scale": {"type": "categorical"}, "displayName": "Planned event"},
     "y": {"fieldName": "sum(net_profit)", "scale": {"type": "quantitative"}, "displayName": "Forecast net profit", "format": USD},
     "color": {"fieldName": "scenario", "scale": {"type": "categorical"}, "displayName": "Scenario"}},
    "mark": {"layout": "group"},
    "frame": {"showTitle": True, "title": "The 4 money-losing ValuMax BOGOs: as planned vs recommended re-plan"}}, pos(0, 5, 6, 7), False),
 table("plan_table", "ds_plan", [("plan_event_id", "Event"), ("start_week", "Start"), ("retailer_name", "Retailer"), ("product_name", "Product"), ("tactic", "Tactic"),
       ("funding_method", "Funding"), ("trade_spend_usd", "Trade spend"), ("net_profit_usd", "Forecast net profit"), ("roi", "Forecast ROI"),
       ("forecast_flag", "Flag"), ("recommended_scenario_label", "Recommended"), ("recommended_net_profit_usd", "Recommended net profit")],
       "Draft calendar with forecast (sorted by start week)", pos(0, 12, 6, 9), 15),
]
dash = {"datasets": [ds(n) for n in DS], "pages": [
    {"name": "roi", "displayName": "Post-event ROI", "layout": p1, "pageType": "PAGE_TYPE_CANVAS"},
    {"name": "plan", "displayName": "Next quarter plan", "layout": p2, "pageType": "PAGE_TYPE_CANVAS"}],
    "uiSettings": {"theme": {"visualizationColors": ["#094074", "#3C6997", "#5ADBFF", "#FFDD4A", "#FE9000"], "widgetHeaderAlignment": "LEFT"}}}
json.dump(dash, open(OUT, "w"), indent=1)
print("ok", OUT)
