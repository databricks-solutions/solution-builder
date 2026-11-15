#!/usr/bin/env python
"""
Grid Operations Copilot — self-contained data generation + gold build.

STORY — "Tomorrow at 6 PM, T-104 goes over its nameplate":
Midwest Regional Electric Cooperative (MREC) runs a 6-substation / 12-transformer /
40-feeder distribution network serving ~150k customers. It is Tuesday 21 July 2026,
14:00, day two of a heat wave. The weather service forecasts 103°F for tomorrow.
The temperature-aware load-forecast model (trained below, per transformer, on a
year of SCADA history + weather) projects that ONE asset — power transformer T-104
at North Ridge substation (1987 vintage, 25 MVA) — goes over nameplate tomorrow
evening with a winding hot-spot well above the 110°C design limit. Its dissolved-gas
readings (ethylene / acetylene) have been climbing for six months, so its health index
is already "Poor". It serves 14,200 customers incl. Mercy Regional Hospital and two
county cooling centers. Last August the same bank tripped on over-temperature (9,800
customers, 5+ hours). A decoy, T-109 at Riverside, runs hot but is healthy.

Three relief options are costed for each at-risk transformer (relief_options +
hourly profiles in relief_option_hourly):
  1. Demand response  — C&I curtailment + smart-thermostat event
  2. Feeder switching — transfer a feeder through a normally-open tie switch
  3. DER dispatch     — community battery + smart-inverter solar

Tables (all in <catalog>.<schema>):
  substations, transformers, feeders, critical_facilities, dr_enrollments,
  der_assets, tie_switches, weather_hourly, feeder_load_hourly,
  transformer_telemetry_hourly, dga_readings, outage_events, reliability_monthly,
  transformer_load_forecast, transformer_health, relief_options,
  relief_option_hourly, operator_actions (write-back, starts empty)

Runs two ways (plain .py, NOT a notebook):
  • On Databricks (DAB spark_python_task) — ambient SparkSession; --catalog/--schema.
  • Locally — Databricks Connect serverless (Python 3.12 venv):
      uv venv --python 3.12 .venv && . .venv/bin/activate
      uv pip install "databricks-connect>=16.4,<17.4" numpy pandas
      DATABRICKS_CONFIG_PROFILE=<your-profile> python generate_data.py \
          --catalog energy_utilities --schema grid_operations_copilot
  • `--dry-run` builds every frame and prints the planted signal without Spark.

Everything is generated with numpy/pandas (deterministic seed) and written with
spark.createDataFrame — no UDFs, so client/server Python versions don't matter.
"""
import argparse
import datetime as dt
import math
import os

import numpy as np
import pandas as pd

_p = argparse.ArgumentParser(add_help=False)
_p.add_argument("--catalog")
_p.add_argument("--schema")
_p.add_argument("--dry-run", action="store_true")
_cli, _ = _p.parse_known_args()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "energy_utilities")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "grid_operations_copilot")
FQ = f"`{CATALOG}`.`{SCHEMA}`"

rng = np.random.default_rng(20260721)

# ---------------------------------------------------------------------------
# Temporal anchors — the demo is pinned to a fixed "now" so the story is stable.
# ---------------------------------------------------------------------------
NOW = pd.Timestamp("2026-07-21 14:00:00")          # local time (CDT), last SCADA scan
HIST_START = NOW - pd.Timedelta(hours=8759)          # one year of hourly history
FC_HOURS = 48
HIST_IDX = pd.date_range(HIST_START, NOW, freq="h")
FC_IDX = pd.date_range(NOW + pd.Timedelta(hours=1), periods=FC_HOURS, freq="h")
ALL_IDX = HIST_IDX.append(FC_IDX)
TOMORROW = (NOW + pd.Timedelta(days=1)).normalize()

# ---------------------------------------------------------------------------
# Network topology
# ---------------------------------------------------------------------------
SUBSTATIONS = [
    # id, name, county, lat, lon, weather offset °F
    ("LV", "Lakeview",         "Hamilton", 42.012, -93.702, -0.6),
    ("NR", "North Ridge",      "Hamilton", 42.184, -93.598,  1.4),
    ("CF", "Cedar Falls Road", "Story",    42.061, -93.451,  0.3),
    ("OH", "Oak Hollow",       "Boone",    41.936, -93.884, -0.2),
    ("RS", "Riverside",        "Story",    41.874, -93.566,  0.8),
    ("PJ", "Prairie Junction", "Marshall", 42.021, -93.214, -0.9),
]

# transformer_id, substation, nameplate MVA, install year, manufacturer,
# target history-peak loading (calibration), annual organic load growth
TRANSFORMERS = [
    ("T-101", "LV", 33.6, 2011, "ABB",            0.74, 0.012),
    ("T-102", "LV", 33.6, 2011, "ABB",            0.69, 0.010),
    ("T-103", "NR", 28.0, 2004, "Siemens",        0.71, 0.018),
    ("T-104", "NR", 25.0, 1987, "GE",             0.975, 0.0),   # growth = data-center step + EV
    ("T-105", "CF", 28.0, 1998, "Westinghouse",   0.72, 0.011),
    ("T-106", "CF", 28.0, 2016, "Hitachi Energy", 0.78, 0.012),
    ("T-107", "OH", 22.4, 2019, "Hitachi Energy", 0.63, 0.008),
    ("T-108", "OH", 22.4, 1994, "GE",             0.66, 0.006),
    ("T-109", "RS", 33.6, 2014, "Siemens",        0.915, 0.015),  # decoy — hot but healthy
    ("T-110", "RS", 33.6, 2014, "Siemens",        0.70, 0.012),
    ("T-111", "PJ", 28.0, 2008, "ABB",            0.67, 0.009),
    ("T-112", "PJ", 28.0, 2001, "Westinghouse",   0.61, 0.007),
]
FEEDER_CODES = {
    "T-101": ["LV-01", "LV-02", "LV-03", "LV-04"], "T-102": ["LV-05", "LV-06", "LV-07"],
    "T-103": ["NR-09", "NR-10", "NR-11"],          "T-104": ["NR-12", "NR-13", "NR-14"],
    "T-105": ["CF-01", "CF-02", "CF-04", "CF-05"], "T-106": ["CF-03", "CF-06", "CF-07"],
    "T-107": ["OH-01", "OH-02", "OH-03"],          "T-108": ["OH-04", "OH-05", "OH-06"],
    "T-109": ["RS-01", "RS-02", "RS-03", "RS-04"], "T-110": ["RS-05", "RS-06", "RS-07", "RS-08"],
    "T-111": ["PJ-01", "PJ-02", "PJ-03"],          "T-112": ["PJ-04", "PJ-05", "PJ-06"],
}
STORY_CUSTOMERS = {"NR-12": 4300, "NR-13": 5600, "NR-14": 4300}

sub_df = pd.DataFrame(SUBSTATIONS, columns=["substation_id", "substation_name", "county",
                                            "latitude", "longitude", "_wx_offset"])
SUB_NAME = dict(zip(sub_df.substation_id, sub_df.substation_name))

feeder_rows = []
for tx_id, sub, *_ in TRANSFORMERS:
    for code in FEEDER_CODES[tx_id]:
        res_share = float(np.clip(rng.normal(0.62, 0.15), 0.25, 0.9))
        if code == "NR-13":
            res_share = 0.48         # hospital + data center feeder
        if code in ("NR-12", "NR-14"):
            res_share = 0.72
        customers = STORY_CUSTOMERS.get(code, int(rng.integers(2600, 4700)))
        feeder_rows.append(dict(
            feeder_id=code, transformer_id=tx_id, substation_id=sub,
            residential_share=round(res_share, 2),
            customers_total=customers,
            customers_residential=int(customers * (0.86 + 0.1 * res_share)),
            circuit_miles=round(float(rng.uniform(9, 38)), 1),
            voltage_kv=12.47,
            # T-104's feeders: older housing stock + heat pumps → steeper A/C response
            cooling_sensitivity=round(float(rng.uniform(0.85, 1.15)) * (0.6 + 0.8 * res_share)
                                      * (1.2 if tx_id == "T-104" else 1.0), 3),
        ))
feed_df = pd.DataFrame(feeder_rows)
feed_df["customers_commercial_industrial"] = feed_df.customers_total - feed_df.customers_residential
feeder_to_tx = dict(zip(feed_df.feeder_id, feed_df.transformer_id))

tx_df = pd.DataFrame(TRANSFORMERS, columns=["transformer_id", "substation_id", "nameplate_mva",
                                            "install_year", "manufacturer", "_target_peak", "_growth"])
tx_df["emergency_mva"] = (tx_df.nameplate_mva * 1.2).round(1)
tx_df["age_years"] = 2026 - tx_df.install_year
tx_df["replacement_cost_usd"] = (tx_df.nameplate_mva * 72000 + 380000).round(-3)
tx_df["replacement_lead_time_weeks"] = np.where(tx_df.nameplate_mva > 30, 78, 64)
tx_df["cooling_class"] = "ONAN/ONAF"
tx_df["bank_name"] = tx_df.substation_id.map(SUB_NAME) + " bank " + \
    (tx_df.groupby("substation_id").cumcount() + 1).astype(str)
TXI = tx_df.set_index("transformer_id")

# ---------------------------------------------------------------------------
# Weather — one station per substation, hourly, history + 48h NWS-style forecast
# ---------------------------------------------------------------------------
doy = ALL_IDX.dayofyear.values
hour_all = ALL_IDX.hour.values
seasonal = 50 + 27 * np.cos(2 * np.pi * (doy - 200) / 365.25)
diurnal = (9 + 3 * np.cos(2 * np.pi * (doy - 200) / 365.25)) * np.cos(2 * np.pi * (hour_all - 16) / 24)
e = rng.normal(0, 0.55, len(ALL_IDX))
noise = np.zeros(len(ALL_IDX))
for i in range(1, len(ALL_IDX)):
    noise[i] = 0.985 * noise[i - 1] + e[i]
base_temp = seasonal + diurnal + noise

def pin_days(highs: dict, lows: dict):
    for d, hi in highs.items():
        lo = lows[d]
        m = ALL_IDX.normalize() == pd.Timestamp(d)
        h = ALL_IDX[m].hour.values
        shape = (np.cos(2 * np.pi * (h - 16.5) / 24) + 1) / 2
        base_temp[m] = lo + (hi - lo) * shape + rng.normal(0, 0.4, m.sum())

# Last August's heat wave (the T-104 trip on the 14th) and this week's.
pin_days({"2025-08-11": 92, "2025-08-12": 96, "2025-08-13": 99, "2025-08-14": 101, "2025-08-15": 95},
         {"2025-08-11": 71, "2025-08-12": 74, "2025-08-13": 77, "2025-08-14": 79, "2025-08-15": 75})
pin_days({"2026-07-18": 88, "2026-07-19": 91, "2026-07-20": 96, "2026-07-21": 98,
          "2026-07-22": 103, "2026-07-23": 99},
         {"2026-07-18": 68, "2026-07-19": 71, "2026-07-20": 75, "2026-07-21": 78,
          "2026-07-22": 81, "2026-07-23": 79})

wx_rows = []
for s in SUBSTATIONS:
    sid, off = s[0], s[5]
    t = base_temp + off + rng.normal(0, 0.35, len(ALL_IDX))
    hum = np.clip(62 - 0.55 * (t - 70) + rng.normal(0, 6, len(t)), 18, 98)
    wind = np.clip(rng.gamma(2.2, 3.4, len(t)), 0, 38)
    ghi = np.clip(np.sin(np.pi * (hour_all - 6) / 14), 0, None) * \
        (650 + 350 * np.cos(2 * np.pi * (doy - 172) / 365.25)) * rng.uniform(0.55, 1.0, len(t))
    wx_rows.append(pd.DataFrame(dict(
        substation_id=sid, observed_at=ALL_IDX, temperature_f=t.round(1),
        heat_index_f=(t + np.clip((hum - 40) * 0.012 * np.clip(t - 80, 0, None), 0, None)).round(1),
        humidity_pct=hum.round(0), wind_mph=wind.round(1), solar_ghi_wm2=ghi.round(0),
        is_forecast=ALL_IDX > NOW,
        source=np.where(ALL_IDX > NOW, "NWS gridded forecast", "Station observation"),
    )))
wx_df = pd.concat(wx_rows, ignore_index=True)
wx_pivot = wx_df.pivot(index="observed_at", columns="substation_id", values="temperature_f")

# ---------------------------------------------------------------------------
# Feeder load — class-mix daily shapes x temperature response x growth
# ---------------------------------------------------------------------------
H = hour_all
DOW = ALL_IDX.dayofweek.values
res_shape = 0.72 + 0.2 * np.exp(-((H - 7.5) ** 2) / 6) + 0.55 * np.exp(-((H - 18.5) ** 2) / 9)
com_shape = (0.62 + 0.5 * np.exp(-((H - 14) ** 2) / 18)) * (1 - 0.28 * (DOW >= 5))
years_from_start = (ALL_IDX - HIST_START).total_seconds().values / 3600 / 8760

# Ridgeline Data Center (on NR-13) energised in phases from Feb 2026: +4.0 MW flat 24x7.
dc_load_mw = np.interp((ALL_IDX - pd.Timestamp("2026-01-01")).total_seconds().values / 86400,
                       [0, 35, 60, 120, 200, 400], [0.0, 0.0, 1.4, 2.6, 4.0, 4.0])

feeder_load = {}
for f in feed_df.itertuples():
    T = wx_pivot[f.substation_id].reindex(ALL_IDX).values
    cdh = np.clip(T - 68, 0, None)
    hdh = np.clip(45 - T, 0, None)
    cool = f.cooling_sensitivity * (0.028 * cdh + 0.00042 * cdh ** 2)
    shape = f.residential_share * res_shape + (1 - f.residential_share) * com_shape
    size_mw = f.customers_total * rng.uniform(0.00085, 0.00115)
    growth = 1 + TXI.loc[f.transformer_id, "_growth"] * years_from_start
    if f.transformer_id == "T-104":
        growth = 1 + 0.035 * years_from_start       # EV + heat-pump adoption on top of the DC
    mw = size_mw * shape * (1 + cool + 0.006 * hdh) * growth * (1 + rng.normal(0, 0.025, len(ALL_IDX)))
    if f.feeder_id == "NR-13":
        mw = mw + dc_load_mw * (1 + rng.normal(0, 0.01, len(ALL_IDX)))
    feeder_load[f.feeder_id] = mw

PF = 0.95
hist_mask = ALL_IDX <= NOW
fc_mask = ~hist_mask
for tx in tx_df.itertuples():
    feeders = [k for k, v in feeder_to_tx.items() if v == tx.transformer_id]
    total_mva = sum(feeder_load[k] for k in feeders) / PF
    scale = TXI.loc[tx.transformer_id, "_target_peak"] * tx.nameplate_mva / total_mva[hist_mask].max()
    for k in feeders:
        feeder_load[k] = feeder_load[k] * scale
# NOTE: feeder_load over the forecast horizon is never published — the model below
# forecasts from history + forecast weather only.

fl_rows = []
for f in feed_df.itertuples():
    mw = feeder_load[f.feeder_id][hist_mask]
    pf_arr = np.clip(0.955 - 0.02 * (mw / mw.max()) + rng.normal(0, 0.004, len(mw)), 0.9, 0.99)
    fl_rows.append(pd.DataFrame(dict(
        feeder_id=f.feeder_id, transformer_id=f.transformer_id, substation_id=f.substation_id,
        reading_at=HIST_IDX, load_mw=mw.round(3), load_mvar=(mw * np.tan(np.arccos(pf_arr))).round(3),
        power_factor=pf_arr.round(3),
        voltage_pu=np.clip(1.02 - 0.035 * mw / mw.max() + rng.normal(0, 0.003, len(mw)), 0.94, 1.05).round(3),
    )))
fl_df = pd.concat(fl_rows, ignore_index=True)
feed_df["peak_load_mw_12m"] = feed_df.feeder_id.map(fl_df.groupby("feeder_id").load_mw.max().round(2))

# ---------------------------------------------------------------------------
# Transformer thermal model (IEEE C57.91 steady-state rises + top-oil time constant)
# ---------------------------------------------------------------------------
R_LOSS, N_EXP, M_EXP = 4.5, 0.8, 0.8
D_TO_R, D_H_R, TAU_TO = 55.0, 25.0, 3.0
AGE_PENALTY = {"T-104": 0.045, "T-108": 0.01, "T-105": 0.005}   # sludge / degraded cooling

def f_to_c(x):
    return (np.asarray(x) - 32) * 5 / 9

def thermal(k, amb_c, init_rise=None, age_penalty=0.0):
    ult = D_TO_R * ((k ** 2 * R_LOSS + 1) / (R_LOSS + 1)) ** N_EXP
    rise = np.zeros_like(k)
    r = ult[0] if init_rise is None else init_rise
    a = 1 - math.exp(-1 / TAU_TO)
    for i in range(len(k)):
        r = r + (ult[i] - r) * a
        rise[i] = r
    top = amb_c + rise * (1 + age_penalty)
    hs = top + D_H_R * k ** (2 * M_EXP) * (1 + age_penalty)
    faa = np.exp(15000 / 383 - 15000 / (hs + 273))
    return top, hs, faa, rise

tt_rows, last_rise = [], {}
for tx in tx_df.itertuples():
    feeders = [k for k, v in feeder_to_tx.items() if v == tx.transformer_id]
    mva = sum(feeder_load[k] for k in feeders)[hist_mask] / PF
    k = mva / tx.nameplate_mva
    amb = f_to_c(wx_pivot[tx.substation_id].reindex(HIST_IDX).values)
    top, hs, faa, rise = thermal(k, amb, age_penalty=AGE_PENALTY.get(tx.transformer_id, 0))
    last_rise[tx.transformer_id] = rise[-1]
    tt_rows.append(pd.DataFrame(dict(
        transformer_id=tx.transformer_id, substation_id=tx.substation_id, reading_at=HIST_IDX,
        load_mva=mva.round(3), loading_pct=(k * 100).round(1), ambient_c=amb.round(1),
        top_oil_c=(top + rng.normal(0, 0.4, len(k))).round(1),
        hot_spot_c=(hs + rng.normal(0, 0.5, len(k))).round(1),
        aging_factor=faa.round(3),
    )))
tt_df = pd.concat(tt_rows, ignore_index=True)

# ---------------------------------------------------------------------------
# Load forecast model — per transformer, weighted ridge regression.
# Features: hour-of-day one-hot, weekend, cooling/heating degree terms (+ evening
# interaction for the A/C peak), trend, scheduled data-center MW.
# Trained on 12 months of SCADA history; scored on the 48 h weather forecast.
# ---------------------------------------------------------------------------
def design(idx, temp_f, dc_mw):
    hr = idx.hour.values
    wk = (idx.dayofweek.values >= 5).astype(float)[:, None]
    cdh = np.clip(temp_f - 68, 0, None)[:, None]
    hdh = np.clip(45 - temp_f, 0, None)[:, None]
    eve = ((hr >= 15) & (hr <= 21)).astype(float)[:, None]
    trend = ((idx - HIST_START).total_seconds().values / 3600 / 8760)[:, None]
    return np.hstack([np.eye(24)[hr], wk, cdh, cdh ** 2, cdh * eve, cdh ** 2 * eve, hdh, trend, dc_mw[:, None]])

fc_rows, model_rows = [], []
for tx in tx_df.itertuples():
    feeders = [k for k, v in feeder_to_tx.items() if v == tx.transformer_id]
    y = (sum(feeder_load[k] for k in feeders) / PF)[hist_mask]
    temp = wx_pivot[tx.substation_id].reindex(ALL_IDX).values
    dc = dc_load_mw if tx.transformer_id == "T-104" else np.zeros(len(ALL_IDX))
    Xh = design(HIST_IDX, temp[hist_mask], dc[hist_mask])
    Xf = design(FC_IDX, temp[fc_mask], dc[fc_mask])
    w = np.exp(((HIST_IDX - NOW).total_seconds().values / 86400) / 120)
    beta = np.linalg.solve(Xh.T @ (Xh * w[:, None]) + 1e-3 * np.eye(Xh.shape[1]), Xh.T @ (w * y))
    fit = Xh @ beta
    resid = y - fit
    recent = HIST_IDX > NOW - pd.Timedelta(days=60)
    sigma = float(np.sqrt(np.mean(resid[recent] ** 2)))
    mape = float(np.mean(np.abs(resid[recent]) / y[recent]) * 100)
    yhat = Xf @ beta + (y[-1] - fit[-1]) * np.exp(-np.arange(FC_HOURS) / 6)
    k = yhat / tx.nameplate_mva
    amb = f_to_c(temp[fc_mask])
    top, hs, faa, _ = thermal(k, amb, init_rise=last_rise[tx.transformer_id],
                              age_penalty=AGE_PENALTY.get(tx.transformer_id, 0))
    band = 1.2816 * sigma * np.sqrt(1 + np.arange(FC_HOURS) / 24)
    fc_rows.append(pd.DataFrame(dict(
        transformer_id=tx.transformer_id, substation_id=tx.substation_id,
        forecast_for=FC_IDX, forecast_made_at=NOW, horizon_hours=np.arange(1, FC_HOURS + 1),
        forecast_temp_f=temp[fc_mask].round(1),
        forecast_mva=yhat.round(3), forecast_mva_p10=(yhat - band).round(3), forecast_mva_p90=(yhat + band).round(3),
        nameplate_mva=tx.nameplate_mva, emergency_mva=round(tx.nameplate_mva * 1.2, 1),
        forecast_loading_pct=(k * 100).round(1),
        forecast_top_oil_c=top.round(1), forecast_hot_spot_c=hs.round(1), forecast_aging_factor=faa.round(2),
        model_name="grid_ops_load_forecast (weighted ridge: hour x weather x trend)",
    )))
    model_rows.append(dict(transformer_id=tx.transformer_id, mape_60d=round(mape, 2), sigma_mva=round(sigma, 3)))
fc_df = pd.concat(fc_rows, ignore_index=True)
model_df = pd.DataFrame(model_rows).set_index("transformer_id")

# ---------------------------------------------------------------------------
# Dissolved-gas analysis (monthly lab samples, 24 months)
# ---------------------------------------------------------------------------
dga_rows = []
months = pd.date_range((NOW - pd.DateOffset(months=23)).replace(day=1), NOW, freq="MS") + pd.Timedelta(days=9)
for tx in tx_df.itertuples():
    base = 1 + tx.age_years / 40
    for i, d in enumerate(months):
        c2h4 = rng.normal(8, 2) * base
        c2h2 = max(0.0, rng.normal(0.3, 0.2))
        h2 = rng.normal(45, 10) * base
        ch4 = rng.normal(22, 5) * base
        co = rng.normal(220, 40) * base
        moisture = rng.normal(9, 1.5) + tx.age_years * 0.25
        if tx.transformer_id == "T-104":
            ramp = max(0, i - (len(months) - 9)) / 8          # accelerating over the last 8 months
            c2h4 = 30 + 150 * ramp ** 1.6 + rng.normal(0, 4)
            c2h2 = 0.6 + 3.4 * ramp ** 1.8
            h2 = 95 + 80 * ramp
            ch4 = 60 + 90 * ramp
            co = 520 + 260 * ramp
            moisture = 24 + 6 * ramp
        if tx.transformer_id == "T-108":
            c2h4 *= 1.8
            moisture += 4
        c2h6 = rng.normal(15, 4) * base
        tdcg = h2 + ch4 + c2h2 + c2h4 + c2h6 + co
        dga_rows.append(dict(
            transformer_id=tx.transformer_id, sample_date=d.date(),
            hydrogen_ppm=round(h2, 1), methane_ppm=round(ch4, 1), ethane_ppm=round(c2h6, 1),
            ethylene_ppm=round(c2h4, 1), acetylene_ppm=round(c2h2, 2), carbon_monoxide_ppm=round(co, 0),
            tdcg_ppm=round(tdcg, 0), moisture_ppm=round(moisture, 1),
            ieee_c57104_status=("Condition 3" if tdcg > 1920 or c2h2 > 3 else
                                "Condition 2" if tdcg > 720 or c2h4 > 100 or c2h2 > 1.5 else "Condition 1"),
            lab="Midwest Transformer Diagnostics",
        ))
dga_df = pd.DataFrame(dga_rows)

# ---------------------------------------------------------------------------
# Outage events (12 months) → SAIDI / SAIFI / CAIDI
# ---------------------------------------------------------------------------
TOTAL_CUSTOMERS = int(feed_df.customers_total.sum())
CAUSES = ["Vegetation", "Weather - wind/lightning", "Equipment failure", "Animal contact",
          "Vehicle / dig-in", "Overload / thermal", "Unknown"]
CAUSE_P = np.array([0.27, 0.23, 0.19, 0.12, 0.06, 0.03, 0.10])
DEVICES = ["Fuse", "Recloser", "Sectionalizer", "Feeder breaker"]
out_rows = []
ev_times = np.sort(rng.uniform(0, 8759, 620))
for i, hrs in enumerate(ev_times):
    t = (HIST_START + pd.Timedelta(hours=float(hrs))).floor("min")
    p = CAUSE_P.copy()
    if t.month in (6, 7, 8):
        p[2] *= 1.4
        p[5] *= 2.5
    p /= p.sum()
    cause = str(rng.choice(CAUSES, p=p))
    f = feed_df.iloc[int(rng.integers(len(feed_df)))]
    if f.substation_id == "NR" and rng.random() < 0.3:
        cause = "Equipment failure"
    device = str(rng.choice(DEVICES, p=[0.66, 0.2, 0.1, 0.04]))
    frac = {"Fuse": rng.uniform(0.01, 0.04), "Recloser": rng.uniform(0.05, 0.2),
            "Sectionalizer": rng.uniform(0.05, 0.18), "Feeder breaker": rng.uniform(0.6, 1.0)}[device]
    ci = max(1, int(f.customers_total * frac))
    dur = float(np.clip(rng.lognormal(math.log(80), 0.6), 6, 900)) * (1.3 if cause.startswith("Weather") else 1)
    out_rows.append(dict(
        outage_id=f"OUT-{t:%y%m}-{i:04d}", feeder_id=f.feeder_id, transformer_id=f.transformer_id,
        substation_id=f.substation_id, started_at=t, restored_at=t + pd.Timedelta(minutes=dur),
        duration_minutes=round(dur, 0), customers_interrupted=ci,
        customer_minutes_interrupted=round(ci * dur, 0), cause=cause, protective_device=device,
    ))
t0 = pd.Timestamp("2025-08-14 18:42:00")   # the T-104 over-temperature trip everybody remembers
for fid, ci, dur in [("NR-12", 3100, 318), ("NR-13", 4100, 331), ("NR-14", 2600, 296)]:
    out_rows.append(dict(
        outage_id=f"OUT-2508-T104-{fid}", feeder_id=fid, transformer_id="T-104", substation_id="NR",
        started_at=t0, restored_at=t0 + pd.Timedelta(minutes=dur), duration_minutes=float(dur),
        customers_interrupted=ci, customer_minutes_interrupted=float(ci * dur),
        cause="Overload / thermal", protective_device="Transformer overtemp relay (49)",
    ))
out_df = pd.DataFrame(out_rows).sort_values("started_at").reset_index(drop=True)

m_start = out_df.started_at.dt.to_period("M").dt.to_timestamp()
rel_df = out_df.assign(month_start=m_start).groupby("month_start").agg(
    outage_events=("outage_id", "count"),
    customers_interrupted=("customers_interrupted", "sum"),
    customer_minutes_interrupted=("customer_minutes_interrupted", "sum")).reset_index()
rel_df["customers_served"] = TOTAL_CUSTOMERS
rel_df["saidi_minutes"] = (rel_df.customer_minutes_interrupted / TOTAL_CUSTOMERS).round(2)
rel_df["saifi"] = (rel_df.customers_interrupted / TOTAL_CUSTOMERS).round(4)
rel_df["caidi_minutes"] = (rel_df.customer_minutes_interrupted / rel_df.customers_interrupted).round(1)
rel_df["saidi_target_minutes"] = round(125 / 12, 2)
rel_df["saifi_target"] = round(1.10 / 12, 4)
rel_df["month_start"] = rel_df.month_start.dt.date

# ---------------------------------------------------------------------------
# Critical facilities, DR enrollments, DER assets, tie switches
# ---------------------------------------------------------------------------
crit_df = pd.DataFrame([
    ("CF-0001", "Mercy Regional Hospital", "Hospital", "NR-13", 3.1, True),
    ("CF-0002", "North Ridge Water Treatment Plant", "Water / wastewater", "NR-12", 1.2, True),
    ("CF-0003", "Hamilton County Cooling Center (Public Library)", "Cooling center", "NR-14", 0.2, False),
    ("CF-0004", "North Ridge Community Center (Cooling Center)", "Cooling center", "NR-12", 0.15, False),
    ("CF-0005", "Maple Grove Senior Living", "Senior living", "NR-14", 0.4, False),
    ("CF-0006", "Ridgeline Data Center", "Data center", "NR-13", 2.4, True),
    ("CF-0007", "Story County Medical Center", "Hospital", "RS-02", 2.6, True),
    ("CF-0008", "Lakeview Fire Station 3", "Emergency services", "LV-02", 0.05, True),
    ("CF-0009", "Oak Hollow Pumping Station", "Water / wastewater", "OH-04", 0.6, True),
    ("CF-0010", "Prairie Junction 911 Dispatch", "Emergency services", "PJ-01", 0.1, True),
    ("CF-0011", "Cedar Falls Dialysis Clinic", "Medical", "CF-03", 0.3, False),
    ("CF-0012", "Riverside Cooling Center (High School)", "Cooling center", "RS-05", 0.3, False),
], columns=["facility_id", "facility_name", "facility_type", "feeder_id", "peak_demand_mw", "has_backup_generation"])
crit_df["transformer_id"] = crit_df.feeder_id.map(feeder_to_tx)

DR_NAMED = {
    "NR-13": [("Ridgeline Data Center", "Data center", 1400, "Transfer to on-site backup generation"),
              ("Hamilton Cold Storage", "Cold storage", 650, "Pre-cool + compressor shed")],
    "NR-12": [("Prairie Plastics", "Manufacturing", 900, "Shift extrusion line to night"),
              ("North Ridge Ag Co-op Grain Dryers", "Agriculture", 380, "Load shed")],
    "NR-14": [("Heartland Logistics DC", "Warehouse", 420, "HVAC setback"),
              ("Hamilton Community College", "Education", 260, "HVAC setback")],
}
dr_rows = []
for f in feed_df.itertuples():
    lst = DR_NAMED.get(f.feeder_id) or [
        (f"{f.feeder_id} C&I account {j + 1}", str(rng.choice(["Retail", "Office", "Manufacturing"])),
         int(rng.integers(120, 520)), "HVAC setback") for j in range(int(rng.integers(0, 3)))]
    for name, seg, kw, strat in lst:
        dr_rows.append(dict(program="C&I Emergency Demand Response", feeder_id=f.feeder_id, participant=name,
                            segment=seg, enrolled_devices=1, committed_kw=float(kw), expected_performance=0.88,
                            incentive_usd_per_kwh=0.85, curtailment_strategy=strat))
    share = 0.19 if f.transformer_id == "T-104" else float(rng.uniform(0.12, 0.2))
    therm = int(f.customers_residential * share)
    dr_rows.append(dict(program="Smart Thermostat Peak Savers", feeder_id=f.feeder_id,
                        participant=f"{therm:,} residential thermostats", segment="Residential",
                        enrolled_devices=therm, committed_kw=float(round(therm * 0.85)), expected_performance=0.72,
                        incentive_usd_per_kwh=0.55, curtailment_strategy="4°F setback, pre-cool 13:00-15:00"))
dr_df = pd.DataFrame(dr_rows)
dr_df.insert(0, "enrollment_id", [f"DR-{i:04d}" for i in range(1, len(dr_df) + 1)])
dr_df["transformer_id"] = dr_df.feeder_id.map(feeder_to_tx)

der_df = pd.DataFrame([
    ("DER-01", "North Ridge Community Battery", "Battery storage", "NR-14", 2.5, 5.0),
    ("DER-02", "North Ridge Solar Garden", "Solar PV (smart inverter)", "NR-12", 3.5, None),
    ("DER-03", "Riverside Solar + Storage", "Battery storage", "RS-03", 2.0, 4.0),
    ("DER-04", "Prairie Junction Wind Tie", "Wind", "PJ-02", 6.0, None),
], columns=["der_id", "der_name", "der_type", "feeder_id", "capacity_mw", "energy_mwh"])
der_df["transformer_id"] = der_df.feeder_id.map(feeder_to_tx)

tie_df = pd.DataFrame([
    ("TS-417", "NR-14", "CF-03", 5.6, "Closed-transition (no interruption)"),
    ("TS-422", "NR-12", "NR-10", 2.1, "Open-transition (momentary)"),
    ("TS-305", "RS-03", "RS-06", 4.0, "Closed-transition (no interruption)"),
    ("TS-118", "LV-03", "OH-02", 3.2, "Open-transition (momentary)"),
], columns=["tie_switch_id", "from_feeder_id", "to_feeder_id", "max_transfer_mw", "transfer_type"])
tie_df["from_transformer_id"] = tie_df.from_feeder_id.map(feeder_to_tx)
tie_df["to_transformer_id"] = tie_df.to_feeder_id.map(feeder_to_tx)

# ---------------------------------------------------------------------------
# Transformer health index (age + DGA + moisture + loading history)
# ---------------------------------------------------------------------------
dga_sorted = dga_df.sort_values("sample_date")
latest_dga = dga_sorted.groupby("transformer_id").tail(1).set_index("transformer_id")
prev_dga = dga_sorted.groupby("transformer_id").nth(-7).set_index("transformer_id")
hist_peak = tt_df.groupby("transformer_id").loading_pct.max()
hs_hours = tt_df[tt_df.hot_spot_c > 110].groupby("transformer_id").size()
fc_peak = fc_df.loc[fc_df.groupby("transformer_id").forecast_mva.idxmax()].set_index("transformer_id")
fc_over = fc_df[fc_df.forecast_loading_pct > 100].groupby("transformer_id").size()
cust_by_tx = feed_df.groupby("transformer_id").customers_total.sum()
crit_by_tx = crit_df.groupby("transformer_id").facility_name.apply(lambda s: "; ".join(s))
now_tt = tt_df[tt_df.reading_at == NOW].set_index("transformer_id")

health_rows = []
for tx in tx_df.itertuples():
    d = latest_dga.loc[tx.transformer_id]
    age_score = max(0, 100 - tx.age_years * 1.6)
    gas_score = max(0, 100 - d.ethylene_ppm * 0.35 - d.acetylene_ppm * 9 - max(0, d.tdcg_ppm - 400) * 0.03)
    moist_score = max(0, 100 - max(0, d.moisture_ppm - 10) * 3)
    load_score = max(0, 100 - max(0, hist_peak[tx.transformer_id] - 70) * 1.5)
    hi = 0.3 * age_score + 0.4 * gas_score + 0.15 * moist_score + 0.15 * load_score
    tier = "Poor" if hi < 45 else "Fair" if hi < 65 else "Good" if hi < 85 else "Very good"
    fp = fc_peak.loc[tx.transformer_id]
    z = -7.5 + 0.1 * max(0, fp.forecast_hot_spot_c - 90) + (60 - hi) * 0.06
    p_fail = 1 / (1 + math.exp(-z))
    risk = ("CRITICAL" if fp.forecast_loading_pct > 100 and hi < 45 else
            "HIGH" if fp.forecast_loading_pct > 100 or (fp.forecast_loading_pct > 90 and hi < 55) else
            "WATCH" if fp.forecast_loading_pct > 88 else "NORMAL")
    drivers = []
    if fp.forecast_loading_pct > 100:
        drivers.append(f"forecast {fp.forecast_loading_pct:.0f}% of nameplate at {fp.forecast_for:%a %H:%M}")
    elif fp.forecast_loading_pct > 88:
        drivers.append(f"forecast {fp.forecast_loading_pct:.0f}% of nameplate (within rating)")
    if d.ethylene_ppm > 100 or d.acetylene_ppm > 1.5:
        drivers.append(f"DGA: ethylene {d.ethylene_ppm:.0f} ppm (was {prev_dga.loc[tx.transformer_id].ethylene_ppm:.0f} "
                       f"six months ago), acetylene {d.acetylene_ppm:.1f} ppm")
    if tx.age_years >= 35:
        drivers.append(f"{tx.age_years} years old ({tx.install_year} {tx.manufacturer})")
    if tx.transformer_id == "T-104":
        drivers.append("tripped on over-temperature 14 Aug 2025 (9,800 customers, 5+ h)")
    health_rows.append(dict(
        transformer_id=tx.transformer_id, substation_id=tx.substation_id,
        substation_name=SUB_NAME[tx.substation_id], nameplate_mva=tx.nameplate_mva, age_years=int(tx.age_years),
        health_index=round(hi, 1), health_tier=tier,
        latest_dga_date=d.sample_date, ethylene_ppm=float(d.ethylene_ppm), acetylene_ppm=float(d.acetylene_ppm),
        tdcg_ppm=float(d.tdcg_ppm), moisture_ppm=float(d.moisture_ppm), dga_status=d.ieee_c57104_status,
        load_now_mva=float(now_tt.loc[tx.transformer_id].load_mva),
        loading_now_pct=float(now_tt.loc[tx.transformer_id].loading_pct),
        hot_spot_now_c=float(now_tt.loc[tx.transformer_id].hot_spot_c),
        peak_loading_12m_pct=float(hist_peak[tx.transformer_id]),
        hours_hot_spot_over_110c_12m=int(hs_hours.get(tx.transformer_id, 0)),
        forecast_peak_mva=float(fp.forecast_mva), forecast_peak_pct=float(fp.forecast_loading_pct),
        forecast_peak_at=fp.forecast_for, forecast_peak_hot_spot_c=float(fp.forecast_hot_spot_c),
        forecast_peak_aging_factor=float(fp.forecast_aging_factor),
        forecast_hours_over_nameplate=int(fc_over.get(tx.transformer_id, 0)),
        failure_probability_48h=round(p_fail, 3),
        customers_served=int(cust_by_tx[tx.transformer_id]),
        critical_facilities=crit_by_tx.get(tx.transformer_id, ""),
        replacement_cost_usd=float(tx.replacement_cost_usd),
        replacement_lead_time_weeks=int(tx.replacement_lead_time_weeks),
        overload_risk=risk, risk_drivers="; ".join(drivers),
        forecast_mape_60d_pct=float(model_df.loc[tx.transformer_id, "mape_60d"]),
    ))
health_df = pd.DataFrame(health_rows)

# ---------------------------------------------------------------------------
# Relief options — for every transformer whose forecast peak exceeds 95%
# ---------------------------------------------------------------------------
opt_rows, prof_rows = [], []
for h in health_df[health_df.forecast_peak_pct > 95].itertuples():
    tx_id = h.transformer_id
    rating = float(TXI.loc[tx_id, "nameplate_mva"])
    fc = fc_df[fc_df.transformer_id == tx_id].reset_index(drop=True)
    hours = fc.forecast_for.dt.hour.values
    tmrw = (fc.forecast_for.dt.normalize() == TOMORROW).values
    base = fc.forecast_mva.values
    amb = f_to_c(fc.forecast_temp_f.values)
    feeders_tx = feed_df[feed_df.transformer_id == tx_id].feeder_id.tolist()
    ap = AGE_PENALTY.get(tx_id, 0)
    options = []

    # 1) Demand-response event 15:00-20:00 tomorrow
    dr = dr_df[dr_df.transformer_id == tx_id]
    ci = dr[dr.program.str.startswith("C&I")]
    th = dr[dr.program.str.startswith("Smart")]
    dr_mw = float((dr.committed_kw * dr.expected_performance).sum() / 1000)
    win = tmrw & (hours >= 15) & (hours <= 20)
    relief = np.where(win, dr_mw / PF, 0.0)
    cost = float(sum(r.committed_kw * r.expected_performance * win.sum() * r.incentive_usd_per_kwh for r in dr.itertuples()))
    options.append(dict(
        option_type="Demand response", option_name="C&I emergency DR + Smart Thermostat Peak Savers event",
        description=f"Call a 15:00-20:00 event on {', '.join(feeders_tx)}: {len(ci)} C&I accounts"
                    + (" (incl. Ridgeline Data Center moving to backup generation)" if tx_id == "T-104" else "")
                    + f" + {int(th.enrolled_devices.sum()):,} smart thermostats with a 4°F setback.",
        relief=relief, cost=round(cost, -2), customers=int(len(ci) + th.enrolled_devices.sum()), impact_w=0.15,
        impact="Voluntary curtailment — no customer interruptions", tte=120,
        n1="N-1 redundancy preserved", path="DR portal / DERMS event, 2 h notice", side_tx=None, side_mva=None))

    # 2) Feeder switching through the largest tie switch
    tie = tie_df[tie_df.from_transformer_id == tx_id].sort_values("max_transfer_mw", ascending=False)
    if len(tie):
        t = tie.iloc[0]
        fl = feeder_load[t.from_feeder_id][fc_mask]
        moved = np.minimum(fl, t.max_transfer_mw)
        relief = np.where(tmrw & (hours >= 12) & (hours <= 22), moved / PF, 0.0)
        to_fc = fc_df[fc_df.transformer_id == t.to_transformer_id].forecast_mva.values + relief
        to_rating = float(TXI.loc[t.to_transformer_id, "nameplate_mva"])
        cust = int(feed_df.set_index("feeder_id").loc[t.from_feeder_id, "customers_total"])
        options.append(dict(
            option_type="Feeder switching",
            option_name=f"Transfer {t.from_feeder_id} to {t.to_feeder_id} via tie switch {t.tie_switch_id}",
            description=f"{t.transfer_type} of feeder {t.from_feeder_id} ({cust:,} customers) onto {t.to_feeder_id} "
                        f"(transformer {t.to_transformer_id}) from 12:00 to 22:00 tomorrow; 2-person switching crew.",
            relief=relief, cost=1800.0, customers=cust, impact_w=1.0,
            impact=f"{cust:,} customers lose their backup path; {t.to_transformer_id} peaks at "
                   f"{to_fc.max() / to_rating * 100:.0f}% of nameplate",
            tte=90, n1=f"N-1 lost for {t.from_feeder_id} and {t.to_feeder_id}",
            path="Field switching order (SCADA-confirmed)", side_tx=t.to_transformer_id, side_mva=float(to_fc.max())))

    # 3) DER dispatch (battery + smart-inverter solar)
    bat = der_df[(der_df.transformer_id == tx_id) & (der_df.der_type == "Battery storage")]
    if len(bat):
        b = bat.iloc[0]
        prof = np.zeros(FC_HOURS)
        eve = np.where(tmrw & (hours >= 16) & (hours <= 19))[0]
        prof[eve] = min(b.capacity_mw, b.energy_mwh / len(eve))
        sol = der_df[(der_df.transformer_id == tx_id) & der_df.der_type.str.startswith("Solar")].capacity_mw.sum()
        prof = prof + np.where(tmrw & (hours >= 13) & (hours <= 16), 0.35 * sol, 0.0)   # solar fades by 17:00
        options.append(dict(
            option_type="DER dispatch", option_name=f"Discharge {b.der_name}" + (" + smart-inverter solar" if sol else ""),
            description=f"Discharge the {b.capacity_mw:.0f} MW / {b.energy_mwh:.0f} MWh battery 16:00-20:00"
                        + (" and cancel the scheduled solar-garden curtailment (inverters to max export)." if sol else "."),
            relief=prof / PF, cost=4200.0, customers=0, impact_w=0.0,
            impact="No customer impact — but the battery is empty before the 20:00 shoulder", tte=5,
            n1="N-1 redundancy preserved", path="DERMS dispatch, immediate", side_tx=None, side_mva=None))

    _, base_hs, _, _ = thermal(base / rating, amb, init_rise=last_rise[tx_id], age_penalty=ap)
    for i, o in enumerate(options):
        post = base - o["relief"]
        k = post / rating
        _, hs, faa, _ = thermal(k, amb, init_rise=last_rise[tx_id], age_penalty=ap)
        over_np, over_hs, pk = int((k > 1.0).sum()), int((hs > 110).sum()), int(np.argmax(post))
        thermal_risk = min(100.0, max(0.0, (hs.max() - 95) * 3.2) + over_np * 6)
        side_pct = None if o["side_mva"] is None else o["side_mva"] / float(TXI.loc[o["side_tx"], "nameplate_mva"]) * 100
        side_pen = 0 if side_pct is None else max(0, side_pct - 85) * 3 + 25       # losing N-1 is never free
        if side_pct is not None:   # the overload moves to the receiving transformer
            thermal_risk = max(thermal_risk, min(100.0, max(0.0, (side_pct - 90) * 4)))
        o_id = f"{tx_id}-OPT{i + 1}"
        opt_rows.append(dict(
            option_id=o_id, transformer_id=tx_id, option_type=o["option_type"], option_name=o["option_name"],
            description=o["description"],
            relief_at_peak_mva=round(float(o["relief"][int(np.argmax(base))]), 2),
            max_relief_mva=round(float(o["relief"].max()), 2),
            estimated_cost_usd=float(o["cost"]), customers_affected=int(o["customers"]),
            customer_impact=o["impact"], time_to_effect_minutes=int(o["tte"]),
            n1_redundancy=o["n1"], execution_path=o["path"],
            baseline_peak_pct=round(float(base.max() / rating * 100), 1),
            post_peak_mva=round(float(post.max()), 2), post_peak_pct=round(float(post.max() / rating * 100), 1),
            post_peak_at=fc.forecast_for.iloc[pk], post_hot_spot_c=round(float(hs.max()), 1),
            post_hours_over_nameplate=over_np, post_hours_hot_spot_over_110c=over_hs,
            post_aging_factor=round(float(faa.max()), 2),
            clears_overload=bool(over_np == 0 and hs.max() <= 120),
            residual_thermal_risk=round(thermal_risk, 0),
            side_effect_transformer_id=o["side_tx"],
            side_effect_peak_pct=None if side_pct is None else round(side_pct, 1),
            composite_risk_score=round(0.6 * thermal_risk + 0.15 * min(100, o["cost"] / 300)
                                       + 0.1 * min(100, o["customers"] * o["impact_w"] / 80)
                                       + 0.15 * min(100, side_pen), 1),
        ))
        prof_rows.append(pd.DataFrame(dict(
            option_id=o_id, transformer_id=tx_id, forecast_for=fc.forecast_for,
            baseline_mva=base.round(3), relief_mva=o["relief"].round(3), post_action_mva=post.round(3),
            nameplate_mva=rating, baseline_loading_pct=(base / rating * 100).round(1),
            post_loading_pct=(k * 100).round(1),
            baseline_hot_spot_c=base_hs.round(1), post_hot_spot_c=hs.round(1),
        )))
opt_df = pd.DataFrame(opt_rows)
opt_df["recommended_rank"] = opt_df.groupby("transformer_id").composite_risk_score.rank(method="first").astype(int)
prof_df = pd.concat(prof_rows, ignore_index=True)

# ---------------------------------------------------------------------------
# Checks — print the planted signal
# ---------------------------------------------------------------------------
pd.set_option("display.width", 250)
print("customers served:", TOTAL_CUSTOMERS, "feeders:", len(feed_df))
print(health_df[["transformer_id", "loading_now_pct", "peak_loading_12m_pct", "forecast_peak_pct", "forecast_peak_at",
                 "forecast_peak_hot_spot_c", "forecast_hours_over_nameplate", "health_index", "health_tier",
                 "overload_risk", "failure_probability_48h", "customers_served"]].to_string())
print(opt_df[["option_id", "option_type", "relief_at_peak_mva", "estimated_cost_usd", "customers_affected",
              "post_peak_pct", "post_hot_spot_c", "clears_overload", "side_effect_peak_pct",
              "composite_risk_score", "recommended_rank"]].to_string())
print("SAIDI 12m:", round(rel_df.saidi_minutes.sum(), 1), "SAIFI 12m:", round(rel_df.saifi.sum(), 3))
print(model_df.to_string())

if _cli.dry_run:
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# Write to Unity Catalog
# ---------------------------------------------------------------------------
from pyspark.sql import SparkSession  # noqa: E402

spark = SparkSession.getActiveSession()
if spark is None:
    from databricks.connect import DatabricksSession
    spark = DatabricksSession.builder.profile(os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")) \
        .serverless(True).getOrCreate()

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


def save(pdf: pd.DataFrame, name: str, comment: str, col_comments: dict | None = None):
    pdf = pdf[[c for c in pdf.columns if not c.startswith("_")]].copy()
    spark.createDataFrame(pdf).write.mode("overwrite").option("overwriteSchema", "true") \
        .saveAsTable(f"{FQ}.`{name}`")
    spark.sql(f"COMMENT ON TABLE {FQ}.`{name}` IS :c", args={"c": comment})
    for col, txt in (col_comments or {}).items():
        spark.sql(f"ALTER TABLE {FQ}.`{name}` ALTER COLUMN `{col}` COMMENT :c", args={"c": txt})
    print(f"  wrote {name}: {len(pdf):,} rows")


save(sub_df, "substations", "Distribution substations of Midwest Regional Electric Cooperative (MREC).")
save(tx_df, "transformers",
     "Substation power transformers (banks): nameplate + 2-4 h emergency rating, age, replacement cost and lead time.",
     {"nameplate_mva": "Top (ONAF) nameplate rating in MVA. Loading % = load MVA / nameplate_mva.",
      "emergency_mva": "Short-term (2-4 h) emergency rating, 120% of nameplate."})
save(feed_df, "feeders", "12.47 kV distribution feeders, the transformer that serves each, customer counts and class mix.")
save(crit_df, "critical_facilities", "Critical customers (hospitals, water, cooling centers, emergency services) by feeder.")
save(dr_df, "dr_enrollments", "Demand-response enrollments by feeder (C&I emergency DR, Smart Thermostat Peak Savers).",
     {"committed_kw": "Contracted curtailment in kW; expected relief = committed_kw * expected_performance."})
save(der_df, "der_assets", "Utility-dispatchable distributed energy resources (batteries, smart-inverter solar, wind).")
save(tie_df, "tie_switches", "Normally-open tie switches that can transfer load between feeders.")
save(wx_df, "weather_hourly", "Hourly weather per substation station: 12 months of observations + 48 h NWS gridded forecast (is_forecast = true).")
save(fl_df, "feeder_load_hourly", "Hourly SCADA feeder-head readings (MW, MVAr, power factor, voltage) for the last 12 months.")
save(tt_df, "transformer_telemetry_hourly",
     "Hourly transformer telemetry: load MVA, loading % of nameplate, ambient, top-oil and winding hot-spot temperature (°C), IEEE C57.91 aging acceleration factor.",
     {"hot_spot_c": "Winding hot-spot temperature, °C. Design limit 110°C, emergency 120°C.",
      "aging_factor": "IEEE C57.91 aging acceleration factor (1.0 = normal insulation life consumption at 110°C hot-spot)."})
save(dga_df, "dga_readings", "Monthly dissolved-gas-in-oil lab results per transformer with IEEE C57.104 condition.")
save(out_df, "outage_events", "Sustained outage events (12 months) with cause, device, customers interrupted and customer-minutes interrupted (CMI).")
save(rel_df, "reliability_monthly", "Monthly IEEE 1366 reliability indices: SAIDI (minutes), SAIFI, CAIDI vs monthly target.",
     {"saidi_minutes": "System Average Interruption Duration Index for the month = CMI / customers served. Annual SAIDI = SUM over months.",
      "saifi": "System Average Interruption Frequency Index for the month = customers interrupted / customers served. Annual SAIFI = SUM over months."})
save(fc_df, "transformer_load_forecast",
     "48-hour hourly load + thermal forecast per transformer from the temperature-aware load forecast model (made 2026-07-21 14:00).",
     {"forecast_loading_pct": "Forecast load as % of nameplate. > 100% = overload.",
      "forecast_hot_spot_c": "Forecast winding hot-spot °C (IEEE C57.91 with top-oil time constant)."})
save(health_df, "transformer_health",
     "Gold: one row per transformer — health index (age, DGA, moisture, loading), current state, tomorrow's forecast peak, overload risk tier, customers and critical facilities served.",
     {"overload_risk": "CRITICAL = forecast over nameplate AND poor health; HIGH = over nameplate; WATCH = > 88%; NORMAL otherwise.",
      "health_index": "0-100 asset health index (higher is healthier). Poor < 45, Fair < 65, Good < 85."})
save(opt_df, "relief_options",
     "Gold: costed load-relief options for every transformer forecast above 95% — demand response, feeder switching, DER dispatch — with post-action peak, hot-spot, cost, customers affected and a composite risk score (lower = better).",
     {"composite_risk_score": "0.6 x residual thermal risk (incl. the receiving transformer) + 0.15 x cost + 0.1 x customer impact (voluntary DR participants weighted 0.15) + 0.15 x N-1 / side-effect penalty. Lower is better.",
      "recommended_rank": "1 = recommended option for that transformer (lowest composite_risk_score)."})
save(prof_df, "relief_option_hourly", "Hourly baseline vs post-action forecast (MVA, loading %, hot-spot) for each relief option.")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.`operator_actions` (
  action_id STRING, logged_at TIMESTAMP, transformer_id STRING, option_id STRING,
  option_type STRING, option_name STRING, operator STRING, rationale STRING,
  expected_peak_pct DOUBLE, expected_hot_spot_c DOUBLE, estimated_cost_usd DOUBLE,
  customers_affected INT, status STRING, source STRING
) COMMENT 'Write-back: relief actions approved by control-room operators in the Grid Ops Copilot app.'
""")
print("  created operator_actions (empty)")
print("done.")
