# STALE: plant_reliability.lvdash.json is now edited directly. Do NOT re-run this script, it would overwrite the dashboard.
import json, uuid, sys
OUT = sys.argv[1]
DS = {
 "ds_kpi": ("Headline KPIs", """SELECT
  (SELECT avg(oee) FROM oee_daily WHERE line LIKE 'Line 2%' AND production_date >= current_date() - INTERVAL 7 DAYS) AS line2_oee_7d,
  (SELECT avg(oee) FROM oee_daily WHERE line LIKE 'Line 2%' AND production_date BETWEEN current_date() - INTERVAL 63 DAYS AND current_date() - INTERVAL 21 DAYS) AS line2_oee_baseline,
  (SELECT avg(oee) FROM oee_daily WHERE production_date >= current_date() - INTERVAL 30 DAYS) AS plant_oee_30d,
  (SELECT sum(unplanned_downtime_hours) FROM oee_daily WHERE production_date >= current_date() - INTERVAL 30 DAYS) AS unplanned_downtime_h_30d,
  (SELECT sum(mtbf_hours * greatest(failures_12m, 1)) / greatest(sum(failures_12m), 1) FROM asset_reliability_12m) AS plant_mtbf_hours,
  (SELECT sum(total_cost_usd) FROM failure_events WHERE failure_ts >= current_timestamp() - INTERVAL 365 DAYS) AS failure_cost_12m,
  (SELECT sum(downtime_cost_at_risk_usd) FROM asset_risk_scores) AS cost_at_risk_7d,
  (SELECT count(*) FROM asset_risk_scores WHERE risk_tier IN ('Critical','High')) AS assets_at_risk"""),
 "ds_oee_weekly": ("Weekly OEE by line", """SELECT date_trunc('WEEK', production_date) AS week, line,
  avg(oee) AS oee, avg(availability) AS availability, avg(performance) AS performance, avg(quality) AS quality
FROM oee_daily WHERE production_date >= current_date() - INTERVAL 182 DAYS
GROUP BY ALL"""),
 "ds_failure_modes": ("Failure cost by mode (12 m)", """SELECT replace(failure_mode, '_', ' ') AS failure_mode, count(*) AS failures,
  sum(downtime_hours) AS downtime_hours, sum(total_cost_usd) AS total_cost_usd
FROM failure_events WHERE failure_ts >= current_timestamp() - INTERVAL 365 DAYS GROUP BY ALL"""),
 "ds_mtbf": ("MTBF by asset type", """SELECT asset_type, sum(failures_12m) AS failures,
  sum(mtbf_hours * greatest(failures_12m, 1)) / greatest(sum(failures_12m), 1) AS mtbf_hours,
  avg(mttr_hours) AS mttr_hours, sum(unplanned_downtime_hours_12m) AS downtime_hours
FROM asset_reliability_12m GROUP BY asset_type"""),
 "ds_risk": ("Fleet risk (ML)", """SELECT asset_id, asset_name, line, risk_score, risk_tier, predicted_failure_mode,
  est_days_to_failure, downtime_cost_at_risk_usd, top_driver_1, last_pm_vendor, last_pm_lubricant
FROM asset_health_current"""),
 "ds_drift": ("Vibration vs baseline — Line 2 FANUC robots", """SELECT feature_date, asset_id, vib_mean AS vibration_mm_s, temp_mean AS temperature_c
FROM asset_health_features
WHERE asset_id IN ('RA-203','RA-207','RA-211','RA-214','RA-201') AND feature_date >= current_date() - INTERVAL 60 DAYS"""),
 "ds_pm_lube": ("Preventive maintenance by lubricant (60 d)", """SELECT w.work_order_id, w.asset_id, a.model, w.scheduled_ts, w.vendor, w.lubricant_used, w.notes,
  r.risk_score, r.risk_tier
FROM maintenance_work_orders w JOIN assets a USING (asset_id) LEFT JOIN asset_risk_scores r USING (asset_id)
WHERE w.work_type = 'Preventive' AND a.asset_type = 'Robot' AND w.scheduled_ts >= current_timestamp() - INTERVAL 60 DAYS"""),
 "ds_downtime_month": ("Unplanned downtime by month and line", """SELECT date_trunc('MONTH', f.failure_ts) AS month, a.line, sum(f.downtime_hours) AS downtime_hours, sum(f.total_cost_usd) AS cost_usd
FROM failure_events f JOIN assets a USING (asset_id) GROUP BY ALL"""),
}
def ds(name): d, q = DS[name]; return {"name": name, "displayName": d, "queryLines": [l + "\n" for l in q.split("\n")]}
def f(n, e=None): return {"name": n, "expression": e or f"`{n}`"}
def w(name, dsn, fields, spec, pos, disagg=True):
    return {"widget": {"name": name, "queries": [{"name": "main_query", "query": {"datasetName": dsn, "fields": fields, "disaggregated": disagg}}], "spec": spec}, "position": pos}
def text(name, lines, pos): return {"widget": {"name": name, "multilineTextboxSpec": {"lines": lines}}, "position": pos}
def counter(name, field, title, fmt, pos):
    return w(name, "ds_kpi", [f(field)], {"version": 2, "widgetType": "counter", "encodings": {"value": {"fieldName": field, "displayName": title, "format": fmt}}, "frame": {"showTitle": True, "title": title}}, pos)
PCT = {"type": "number-percent", "decimalPlaces": {"type": "max", "places": 1}}
USD = {"type": "number-currency", "currencyCode": "USD", "abbreviation": "compact", "decimalPlaces": {"type": "max", "places": 1}}
NUM = {"type": "number-plain", "abbreviation": "compact", "decimalPlaces": {"type": "max", "places": 0}}
def pos(x, y, wd, h): return {"x": x, "y": y, "width": wd, "height": h}

p1 = [
 text("p1_title", ["# TechRobotics Greenville Plant 2 — Reliability & OEE\n", "\n",
   "Plant-manager view of **OEE, unplanned downtime and MTBF**, with the ML failure-risk model's current fleet scoring. "
   "Line 2 (robotic assembly) OEE has slipped over the last two weeks: its bottleneck robot **RA-207** is running a J3-reducer drift "
   "and the line is starving behind it. The model scores RA-207 critical — the reliability team is booking the fix into Saturday's planned window."], pos(0, 0, 6, 3)),
 counter("kpi_l2_oee", "line2_oee_7d", "Line 2 OEE — last 7 days", PCT, pos(0, 3, 1, 3)),
 counter("kpi_l2_base", "line2_oee_baseline", "Line 2 OEE — prior baseline", PCT, pos(1, 3, 1, 3)),
 counter("kpi_downtime", "unplanned_downtime_h_30d", "Unplanned + minor-stop downtime (h, 30 d)", NUM, pos(2, 3, 1, 3)),
 counter("kpi_mtbf", "plant_mtbf_hours", "Plant MTBF (operating h / failure)", NUM, pos(3, 3, 1, 3)),
 counter("kpi_fail_cost", "failure_cost_12m", "Breakdown cost — last 12 months", USD, pos(4, 3, 1, 3)),
 counter("kpi_risk", "cost_at_risk_7d", "Downtime $ at risk next 7 d (ML)", USD, pos(5, 3, 1, 3)),
 w("oee_line", "ds_oee_weekly", [f("week"), f("line"), f("avg(oee)", "AVG(`oee`)")],
   {"version": 3, "widgetType": "line", "encodings": {"x": {"fieldName": "week", "scale": {"type": "temporal"}, "displayName": "Week"},
     "y": {"fieldName": "avg(oee)", "scale": {"type": "quantitative", "zeroBaseline": False}, "displayName": "OEE", "format": PCT},
     "color": {"fieldName": "line", "scale": {"type": "categorical"}, "displayName": "Line"}},
    "frame": {"showTitle": True, "title": "Weekly OEE by line — Line 2 breaks away from ~79% as RA-207 degrades"}}, pos(0, 6, 4, 7), False),
 w("mtbf_bar", "ds_mtbf", [f("asset_type"), f("sum(mtbf_hours)", "SUM(`mtbf_hours`)")],
   {"version": 3, "widgetType": "bar", "encodings": {"x": {"fieldName": "asset_type", "scale": {"type": "categorical", "sort": {"by": "y-reversed"}}, "displayName": "Asset type"},
     "y": {"fieldName": "sum(mtbf_hours)", "scale": {"type": "quantitative"}, "displayName": "MTBF (operating hours)"}},
    "frame": {"showTitle": True, "title": "MTBF by asset type (trailing 12 months)"}}, pos(4, 6, 2, 7), False),
 w("mode_bar", "ds_failure_modes", [f("failure_mode"), f("sum(total_cost_usd)", "SUM(`total_cost_usd`)")],
   {"version": 3, "widgetType": "bar", "encodings": {"y": {"fieldName": "failure_mode", "scale": {"type": "categorical", "sort": {"by": "x-reversed"}}, "displayName": "Failure mode"},
     "x": {"fieldName": "sum(total_cost_usd)", "scale": {"type": "quantitative"}, "displayName": "Breakdown cost ($)", "format": USD}},
    "frame": {"showTitle": True, "title": "What breakdowns cost us — by failure mode (12 months)"}}, pos(0, 13, 3, 7), False),
 w("dt_month", "ds_downtime_month", [f("month"), f("line"), f("sum(downtime_hours)", "SUM(`downtime_hours`)")],
   {"version": 3, "widgetType": "bar", "encodings": {"x": {"fieldName": "month", "scale": {"type": "temporal"}, "displayName": "Month"},
     "y": {"fieldName": "sum(downtime_hours)", "scale": {"type": "quantitative"}, "displayName": "Unplanned downtime (h)"},
     "color": {"fieldName": "line", "scale": {"type": "categorical"}, "displayName": "Line"}},
    "frame": {"showTitle": True, "title": "Unplanned breakdown hours by month and line"}}, pos(3, 13, 3, 7), False),
 w("risk_table", "ds_risk", [f(c) for c in ["asset_id", "asset_name", "line", "risk_score", "risk_tier", "predicted_failure_mode", "est_days_to_failure", "downtime_cost_at_risk_usd", "top_driver_1", "last_pm_vendor", "last_pm_lubricant"]],
   {"version": 1, "widgetType": "table", "encodings": {"columns": [
     {"fieldName": c, "displayName": d} for c, d in [("asset_id", "Asset"), ("asset_name", "Name"), ("line", "Line"), ("risk_score", "Risk (7-d %)"), ("risk_tier", "Tier"),
       ("predicted_failure_mode", "Predicted failure mode"), ("est_days_to_failure", "Est. days to failure"), ("downtime_cost_at_risk_usd", "$ at risk"),
       ("top_driver_1", "Top driver"), ("last_pm_vendor", "Last PM by"), ("last_pm_lubricant", "Lubricant")]]},
    "invisibleColumns": [], "allowHTMLByDefault": False, "itemsPerPage": 10,
    "frame": {"showTitle": True, "title": "Fleet failure risk — failure_risk_model@champion (sorted by risk)"}}, pos(0, 20, 6, 8)),
]
p2 = [
 text("p2_title", ["## Why RA-207? One maintenance event, three robots\n", "\n",
   "The J3-reducer drift on RA-207 began right after its quarterly grease PM. The same contractor greased **RA-211** and **RA-214** with the same "
   "non-OEM substitute (Mobilgrease XHP 222) while Vigo RE0 was backordered. RA-203 failed exactly this way six months ago (CAPA-0117). "
   "RA-201, greased in-house with RE0, is the control."], pos(0, 0, 6, 3)),
 w("drift_line", "ds_drift", [f("feature_date"), f("asset_id"), f("avg(vibration_mm_s)", "AVG(`vibration_mm_s`)")],
   {"version": 3, "widgetType": "line", "encodings": {"x": {"fieldName": "feature_date", "scale": {"type": "temporal"}, "displayName": "Day"},
     "y": {"fieldName": "avg(vibration_mm_s)", "scale": {"type": "quantitative"}, "displayName": "Vibration RMS (mm/s, 3-day avg)"},
     "color": {"fieldName": "asset_id", "scale": {"type": "categorical"}, "displayName": "Robot"}},
    "frame": {"showTitle": True, "title": "J3 vibration, last 60 days — RA-207 and RA-211 climb after the substitute-grease PM"}}, pos(0, 3, 6, 8), False),
 w("pm_table", "ds_pm_lube", [f(c) for c in ["work_order_id", "asset_id", "model", "scheduled_ts", "vendor", "lubricant_used", "risk_score", "risk_tier", "notes"]],
   {"version": 1, "widgetType": "table", "encodings": {"columns": [
     {"fieldName": c, "displayName": d} for c, d in [("work_order_id", "Work order"), ("asset_id", "Robot"), ("model", "Model"), ("scheduled_ts", "PM date"), ("vendor", "Vendor"),
       ("lubricant_used", "Lubricant"), ("risk_score", "Risk now"), ("risk_tier", "Tier"), ("notes", "Technician notes")]]},
    "invisibleColumns": [], "allowHTMLByDefault": False, "itemsPerPage": 10,
    "frame": {"showTitle": True, "title": "Robot preventive maintenance, last 60 days — who got the substitute grease?"}}, pos(0, 11, 6, 8)),
]
dash = {"datasets": [ds(n) for n in DS], "pages": [
  {"name": "plant", "displayName": "Plant manager — OEE & downtime", "layout": p1, "pageType": "PAGE_TYPE_CANVAS"},
  {"name": "rootcause", "displayName": "Reliability — root cause", "layout": p2, "pageType": "PAGE_TYPE_CANVAS"}],
  "uiSettings": {"theme": {"widgetHeaderAlignment": "ALIGNMENT_UNSET"}}}
json.dump(dash, open(OUT, "w"), indent=1)
# also dump queries for testing
json.dump({k: v[1] for k, v in DS.items()}, open("/tmp/mfg-predictive-maintenance/dash_queries.json", "w"))
print("ok")
