"""
TechRobotics Industries — Predictive Maintenance Control Room: synthetic data.

Self-contained generator (plain .py). Writes the RAW + SILVER layer of the demo
as Delta tables into <catalog>.<schema>:

  assets                   48 production assets on 3 lines + utilities (the fleet)
  sensor_readings          hourly telemetry, 365 days x 48 assets (~420K rows)
  maintenance_work_orders  2 years of PM / corrective / inspection work orders
  failure_events           historical breakdowns with downtime + cost
  production_daily         per-asset daily production counts (-> OEE)
  spare_parts              MRO storeroom + regional DC inventory
  maintenance_windows      upcoming planned-downtime windows (booking targets)
  technicians              maintenance crew + certifications

PLANTED SIGNAL (what the demo uncovers):
  * Three Line-2 FANUC robots (RA-207, RA-211, RA-214) received their quarterly
    reducer-grease PM from the same contractor (Carolina Industrial Services)
    with a NON-SPEC substitute grease (Mobilgrease XHP 222, EP2) because the OEM
    grease (Vigo RE0) was backordered.
  * RA-207 (the Line-2 bottleneck, $12.8K/hr) now shows a 16-day J3-reducer
    vibration + temperature drift -> the ML model scores it as critical.
    RA-211 is drifting more slowly (elevated). RA-214 was greased 5 days ago and
    is not drifting YET -> the model misses it; maintenance history catches it.
  * The exact same pattern destroyed RA-203's J3 reducer ~6 months ago
    (14.2 h unplanned downtime) and a CAPA was issued. The manuals say RE0
    only. The fix is a planned grease purge + reducer inspection in the Saturday
    window -> cost avoided vs another unplanned failure.
  * Secondary: CNC-108 coolant pressure is decaying (filter clog) -> medium risk.

Usage:
  python generate_data.py --catalog manufacturing --schema predictive_maintenance_copilot
On Databricks the ambient SparkSession is used; locally Databricks Connect
(serverless) is used. `--local-out DIR` writes parquet instead (for testing).
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

SEED = 42
HISTORY_DAYS = 365
SHIFT_START, SHIFT_END = 6, 22  # two production shifts, 06:00-22:00

CONTRACTOR = "Carolina Industrial Services"
SUBSTITUTE_GREASE = "Mobilgrease XHP 222 (EP2, substitute)"
OEM_GREASE = "Vigo RE0 (OEM spec)"

# type -> baseline vib mm/s, temp C, current A, pressure bar, speed rpm, ideal cycle sec
TYPE_BASE = {
    "Robot":       dict(vib=1.6, temp=46.0, cur=11.5, pres=6.2, rpm=1450, cycle=42.0),
    "CNC":         dict(vib=2.1, temp=41.0, cur=22.0, pres=4.6, rpm=8200, cycle=180.0),
    "Servo Press": dict(vib=2.8, temp=52.0, cur=38.0, pres=210.0, rpm=60, cycle=12.0),
    "Test Stand":  dict(vib=0.9, temp=35.0, cur=6.0, pres=3.0, rpm=900, cycle=90.0),
    "Compressor":  dict(vib=3.2, temp=78.0, cur=64.0, pres=8.6, rpm=2950, cycle=None),
}

# type -> [(mode, component, precursor-days range | None, downtime-h range, signature)]
FAILURE_MODES = {
    "Robot": [
        ("reducer_bearing_wear", "J3 RV reducer", (10, 18), (9, 16), "vib_temp"),
        ("servo_motor_overheat", "J2 servo motor", (5, 9), (4, 8), "temp_current"),
        ("cable_harness_fault", "J6 dress pack", None, (2, 5), None),
    ],
    "CNC": [
        ("spindle_bearing_wear", "Spindle bearing", (8, 14), (10, 20), "vib_temp"),
        ("coolant_pump_failure", "Coolant pump", (6, 12), (3, 6), "pressure_drop"),
        ("tool_changer_jam", "ATC arm", None, (1, 3), None),
    ],
    "Servo Press": [
        ("hydraulic_seal_leak", "Overload hydraulic seal", (7, 12), (5, 9), "pressure_drop"),
        ("crank_bearing_wear", "Crank bearing", (10, 16), (12, 22), "vib_temp"),
    ],
    "Test Stand": [("sensor_fault", "Load cell", None, (1, 2), None)],
    "Compressor": [("discharge_valve_failure", "Discharge valve", (5, 9), (3, 6), "temp_current")],
}

ROOT_CAUSES = {
    "reducer_bearing_wear": "Reducer bearing wear — grease film degradation under high duty cycle.",
    "servo_motor_overheat": "Servo motor winding overheat — blocked fan filter, elevated duty.",
    "cable_harness_fault": "Dress-pack cable fatigue at J6 — intermittent encoder signal.",
    "spindle_bearing_wear": "Spindle bearing preload loss — contamination via worn labyrinth seal.",
    "coolant_pump_failure": "Coolant pump cavitation — clogged suction filter, chip packing.",
    "tool_changer_jam": "ATC gripper misalignment after crash — re-taught.",
    "hydraulic_seal_leak": "Overload-protection hydraulic seal extrusion — pressure decay.",
    "crank_bearing_wear": "Crank bearing wear — lubrication starvation (clogged line).",
    "sensor_fault": "Load-cell drift — recalibrated / replaced.",
    "discharge_valve_failure": "Discharge valve plate fatigue — high discharge temperature.",
}


def build_assets() -> pd.DataFrame:
    rows = []
    rng = np.random.default_rng(SEED)

    def add(aid, name, typ, mfr, model, line, cell, crit, cost, bottleneck=False):
        rows.append(dict(
            asset_id=aid, asset_name=name, asset_type=typ, manufacturer=mfr, model=model,
            line=line, cell=cell, criticality=crit, is_bottleneck=bottleneck,
            downtime_cost_per_hour=float(cost),
            install_date=(datetime(2026, 1, 1) - timedelta(days=int(rng.integers(500, 3200)))).date(),
            ideal_cycle_time_sec=TYPE_BASE[typ]["cycle"],
            plant="Greenville, SC — Plant 2",
        ))

    cnc_models = [("Haas", "UMC-750"), ("DMG MORI", "NLX 2500"), ("Okuma", "GENOS M560-V")]
    for i in range(14):
        mfr, model = cnc_models[i % 3]
        n = 101 + i
        add(f"CNC-{n}", f"Machining Center {n}", "CNC", mfr, model, "Line 1 — Precision Machining",
            f"Cell {1 + i // 4}", "A" if i in (3, 7) else "B", 3800 + 250 * (i % 5))
    robot_models = [("FANUC", "M-20iD/25"), ("FANUC", "M-20iD/25"), ("FANUC", "R-2000iC/165F"), ("ABB", "IRB 6700")]
    for i in range(16):
        n = 201 + i
        mfr, model = robot_models[i % 4]
        if n in (203, 207, 211, 214):  # the grease-story robots are all M-20iD
            mfr, model = "FANUC", "M-20iD/25"
        bottleneck = n == 207
        cost = 12800 if bottleneck else (6400 if n in (203, 211) else 3900 + 300 * (i % 4))
        role = {203: "Gearbox press-fit", 207: "Actuator weld + press-fit", 211: "Housing weld",
                214: "Final assembly"}.get(n, ["Pick & place", "Spot weld", "Screw-drive", "Palletize"][i % 4])
        add(f"RA-{n}", f"Robot {n} · {role}", "Robot", mfr, model, "Line 2 — Robotic Assembly",
            f"Cell {n - 200}", "A" if n in (203, 207, 211) else "B", cost, bottleneck)
    for i in range(8):
        n = 301 + i
        add(f"SP-{n}", f"Servo Press {n}", "Servo Press", "AIDA" if i % 2 else "Schuler",
            "NS2-1500" if i % 2 else "MSD 400", "Line 3 — Press & Test", f"Cell {1 + i // 2}", "B",
            4200 + 200 * (i % 3))
    for i in range(4):
        n = 309 + i
        add(f"TS-{n}", f"End-of-line Test Stand {n}", "Test Stand", "Burke Porter", "EOL-A2",
            "Line 3 — Press & Test", "Test bay", "C", 1800)
    for i in range(6):
        n = i + 1
        add(f"CMP-0{n}", f"Air Compressor {n}", "Compressor", "Atlas Copco", "GA 75 VSD+", "Utilities",
            "Compressor room", "B" if n <= 2 else "C", 2200)
    return pd.DataFrame(rows)


def plan_failures(assets: pd.DataFrame, now: datetime, rng) -> list[dict]:
    fails = [dict(
        asset_id="RA-203", mode="reducer_bearing_wear", component="J3 RV reducer",
        ts=now - timedelta(days=182) + timedelta(hours=3), precursor=17, downtime=14.2, sig="vib_temp",
        root_cause=("J3 RV reducer bearing spalling. Grease sample: lithium-complex EP2 grease mixed with "
                    "residual Vigo RE0 — incompatible thickeners, film breakdown under high-duty weld cycle. "
                    "Non-spec grease applied at the previous quarterly PM (contractor). CAPA-0117 issued: "
                    "FANUC reducers — Vigo RE0 ONLY, no substitutes."),
        scrap=220)]
    weights = {"Robot": 0.34, "CNC": 0.34, "Servo Press": 0.18, "Test Stand": 0.05, "Compressor": 0.09}
    types = list(weights)
    probs = np.array([weights[t] for t in types])
    probs /= probs.sum()
    used = [("RA-203", 182)]
    tries = 0
    while len(fails) < 30 and tries < 1000:
        tries += 1
        typ = str(rng.choice(types, p=probs))
        cand = assets[assets.asset_type == typ]
        a = cand.iloc[int(rng.integers(0, len(cand)))]
        if a.asset_id in ("RA-207", "RA-211", "RA-214", "CNC-108"):
            continue  # keep the planted-signal assets clean historically
        day = int(rng.integers(40, 340))
        if any(u[0] == a.asset_id and abs(u[1] - day) < 60 for u in used):
            continue
        modes = FAILURE_MODES[typ]
        mp = np.array([1.0 if m[2] else 0.35 for m in modes])  # most breakdowns have a sensor precursor
        mode, comp, pre, dt, sig = modes[int(rng.choice(len(modes), p=mp / mp.sum()))]
        used.append((a.asset_id, day))
        fails.append(dict(
            asset_id=a.asset_id, mode=mode, component=comp,
            ts=now - timedelta(days=day) + timedelta(hours=int(rng.integers(-10, 4))),
            precursor=int(rng.integers(pre[0], pre[1] + 1)) if pre else 0,
            downtime=round(float(rng.uniform(*dt)), 1), sig=sig, root_cause=ROOT_CAUSES[mode],
            scrap=int(rng.integers(0, 120))))
    return fails


def current_drifts(now: datetime) -> list[dict]:
    """In-flight degradations (the planted signal). precursor = virtual days to failure."""
    return [
        dict(asset_id="RA-207", sig="vib_temp", start=now - timedelta(days=16), precursor=19, strength=1.0),
        dict(asset_id="RA-211", sig="vib_temp", start=now - timedelta(days=15), precursor=32, strength=0.85),
        dict(asset_id="RA-214", sig="vib_temp", start=now - timedelta(days=4), precursor=34, strength=0.8),
        dict(asset_id="CNC-108", sig="pressure_drop", start=now - timedelta(days=8), precursor=18, strength=0.75),
    ]


def build_telemetry(assets, fails, drifts, now, rng) -> pd.DataFrame:
    start = now - timedelta(days=HISTORY_DAYS)
    ts = pd.date_range(start, now - timedelta(hours=1), freq="h")
    H = len(ts)
    hours = ts.hour.values
    running = (hours >= SHIFT_START) & (hours < SHIFT_END)
    t_days = (ts - start).total_seconds().values / 86400.0
    frames = []
    for _, a in assets.iterrows():
        b = TYPE_BASE[a.asset_type]
        k = rng.normal(1.0, 0.06)
        vib = b["vib"] * k + rng.normal(0, b["vib"] * 0.06, H)
        temp = b["temp"] + rng.normal(0, 1.2, H) + 2.0 * np.sin(2 * np.pi * (t_days - 100) / 365.0)
        cur = b["cur"] * rng.normal(1.0, 0.04) + rng.normal(0, b["cur"] * 0.03, H)
        pres = b["pres"] * rng.normal(1.0, 0.02) + rng.normal(0, b["pres"] * 0.015, H)
        rpm = b["rpm"] * rng.normal(1.0, 0.03) + rng.normal(0, b["rpm"] * 0.02, H)
        load = np.clip(rng.normal(72, 6, H), 30, 100)
        state = np.where(running, "RUNNING", "IDLE").astype(object)

        def apply(sig, p, mask, s=1.0):
            n = int(mask.sum())
            if sig == "vib_temp":
                vib[mask] += s * 3.6 * b["vib"] / 1.6 * p ** 1.7 + rng.normal(0, 0.12, n) * p
                temp[mask] += s * 16.0 * p ** 1.5
                cur[mask] += s * b["cur"] * 0.09 * p
            elif sig == "temp_current":
                temp[mask] += s * 18.0 * p ** 1.4
                cur[mask] += s * b["cur"] * 0.22 * p ** 1.3
                vib[mask] += s * 0.4 * p
            elif sig == "pressure_drop":
                pres[mask] -= s * b["pres"] * 0.34 * p ** 1.3
                temp[mask] += s * 6.0 * p
                vib[mask] += s * 0.5 * p

        for f in [f for f in fails if f["asset_id"] == a.asset_id]:
            fts = pd.Timestamp(f["ts"])
            if f["precursor"] > 0 and f["sig"]:
                s0 = fts - pd.Timedelta(days=f["precursor"])
                m = (ts >= s0) & (ts < fts)
                p = np.asarray((ts[m] - s0) / (fts - s0), dtype=float)
                apply(f["sig"], p, m)
            down = (ts >= fts) & (ts < fts + pd.Timedelta(hours=f["downtime"]))
            state[down] = "DOWN"
        # benign excursions (fixture change, heat wave, sensor re-mount...) that do NOT end in a
        # failure — the real-world false-alarm noise a threshold rule trips on and the model must learn.
        if a.asset_id not in ("RA-207", "RA-211", "RA-214", "CNC-108"):
            for _ in range(int(rng.integers(0, 4))):
                d0 = int(rng.integers(20, HISTORY_DAYS - 25))
                s0 = start + timedelta(days=d0)
                m = (ts >= s0) & (ts < s0 + timedelta(days=int(rng.integers(2, 8))))
                sig = ["vib_temp", "temp_current", "pressure_drop"][int(rng.integers(0, 3))]
                apply(sig, np.full(int(m.sum()), float(rng.uniform(0.25, 0.6))), m)
        for d in [d for d in drifts if d["asset_id"] == a.asset_id]:
            s0 = pd.Timestamp(d["start"])
            end = s0 + pd.Timedelta(days=d["precursor"])
            m = ts >= s0
            p = np.asarray((ts[m] - s0) / (end - s0), dtype=float)
            apply(d["sig"], p, m, d["strength"])

        idle = state == "IDLE"
        down = state == "DOWN"
        vib = np.where(idle, vib * 0.18, np.where(down, 0.0, vib))
        cur = np.where(idle, cur * 0.12, np.where(down, 0.0, cur))
        temp = np.where(idle | down, temp - (temp - 24.0) * 0.55, temp)
        rpm = np.where(idle | down, 0.0, rpm)
        load = np.where(idle | down, 0.0, load)
        frames.append(pd.DataFrame(dict(
            asset_id=a.asset_id, reading_ts=ts, machine_state=state.astype(str),
            vibration_rms_mm_s=np.round(np.clip(vib, 0, None), 3),
            temperature_c=np.round(temp, 2), motor_current_a=np.round(np.clip(cur, 0, None), 2),
            pressure_bar=np.round(np.clip(pres, 0, None), 2), speed_rpm=np.round(rpm, 0),
            load_pct=np.round(load, 1))))
    return pd.concat(frames, ignore_index=True)


PM_SPEC = {
    "Robot": (91, "Quarterly reducer grease replacement J1-J6 + backlash check", 3.5, "Reducer grease"),
    "CNC": (60, "Spindle PM: coolant filter change, way-lube, spindle runout check", 2.5, "Coolant suction filter"),
    "Servo Press": (90, "Press PM: hydraulic overload system check, crank lube", 4.0, "Hydraulic filter element"),
    "Test Stand": (120, "Calibration + fixture inspection", 1.5, None),
    "Compressor": (120, "Compressor service: oil, separator, valve inspection", 3.0, "Oil separator kit"),
}
IN_HOUSE_TECHS = ["Luis Ramirez (T-01)", "Aisha Grant (T-02)", "Ben Whitaker (T-03)", "Priya Nair (T-04)",
                  "Tom Kowalski (T-05)", "Jen Park (T-06)"]


def build_work_orders(assets, fails, now, rng) -> pd.DataFrame:
    rows = []
    seq = [20000]

    def wo(**kw):
        seq[0] += 1
        rows.append(dict(work_order_id=f"WO-{seq[0]}", **kw))

    start = now - timedelta(days=730)
    forced = {"RA-207": now - timedelta(days=17), "RA-211": now - timedelta(days=16),
              "RA-214": now - timedelta(days=5), "RA-203": now - timedelta(days=199)}
    for _, a in assets.iterrows():
        interval, desc, hrs, part = PM_SPEC[a.asset_type]
        d = start + timedelta(days=int(rng.integers(0, interval)))
        pms = []
        while d < now - timedelta(days=1):
            pms.append(d)
            d += timedelta(days=interval + int(rng.integers(-4, 5)))
        if a.asset_id in forced:
            fdt = forced[a.asset_id]
            pms = [p for p in pms if abs((p - fdt).days) > 45] + [fdt]
        for p in sorted(pms):
            p = p.replace(hour=int(rng.integers(6, 10)), minute=0, second=0, microsecond=0)
            is_batch = a.asset_id in forced and p.date() == forced[a.asset_id].date()
            vendor = CONTRACTOR if (is_batch or rng.random() < 0.15) else "In-house"
            lub, parts = None, part
            notes = "Completed per PM checklist. No abnormal findings."
            if a.asset_type == "Robot":
                lub = OEM_GREASE if a.manufacturer == "FANUC" else "Kyodo Yushi TMO 150 (OEM spec)"
                parts = "Vigo RE0 grease 16 kg" if a.manufacturer == "FANUC" else "TMO 150 gear oil"
                if is_batch:
                    lub, parts = SUBSTITUTE_GREASE, "Mobilgrease XHP 222 18 kg"
                    notes = ("Vigo RE0 backordered at stores (PO-88412). Substituted Mobilgrease XHP 222 per "
                             "on-site lead to stay on PM schedule. Purged approx. 80% of old grease. "
                             "Backlash J1-J6 within spec.")
                    if a.asset_id == "RA-203":
                        notes = ("Vigo RE0 short at stores — used Mobilgrease XHP 222 as substitute. "
                                 "Purged approx. 75% of old grease.")
            wo(asset_id=a.asset_id, work_type="Preventive", priority="P3",
               opened_ts=p - timedelta(days=7), scheduled_ts=p, completed_ts=p + timedelta(hours=hrs),
               status="Completed", vendor=vendor,
               technician=("CIS crew — D. Hollis" if vendor == CONTRACTOR else IN_HOUSE_TECHS[int(rng.integers(0, 6))]),
               description=desc, lubricant_used=lub, parts_used=parts,
               labor_hours=round(hrs + float(rng.normal(0, 0.3)), 1),
               cost_usd=round(float(rng.normal(620, 90)) + (380 if vendor == CONTRACTOR else 0), 2),
               notes=notes, failure_id=None)
        for _ in range(int(rng.integers(1, 4))):
            p = (now - timedelta(days=int(rng.integers(20, 700)))).replace(hour=10, minute=0, second=0, microsecond=0)
            wo(asset_id=a.asset_id, work_type="Inspection", priority="P4", opened_ts=p, scheduled_ts=p,
               completed_ts=p + timedelta(hours=1), status="Completed", vendor="In-house",
               technician=IN_HOUSE_TECHS[int(rng.integers(0, 6))],
               description="Route-based condition inspection (ultrasound + thermal)", lubricant_used=None,
               parts_used=None, labor_hours=1.0, cost_usd=95.0, notes="No actionable findings.", failure_id=None)
    for f in fails:
        wo(asset_id=f["asset_id"], work_type="Corrective (breakdown)", priority="P1",
           opened_ts=f["ts"], scheduled_ts=f["ts"], completed_ts=f["ts"] + timedelta(hours=f["downtime"]),
           status="Completed", vendor="In-house", technician=IN_HOUSE_TECHS[int(rng.integers(0, 6))],
           description=f"Breakdown repair — {f['component']} ({f['mode'].replace('_', ' ')})",
           lubricant_used=OEM_GREASE if f["asset_id"].startswith("RA") else None,
           parts_used=f["component"] + " replacement", labor_hours=round(f["downtime"] * 1.6, 1),
           cost_usd=round(4200 + f["downtime"] * 900 + float(rng.normal(0, 400)), 2),
           notes=f["root_cause"], failure_id=f["failure_id"])
    return pd.DataFrame(rows).sort_values("scheduled_ts").reset_index(drop=True)


def build_failures(assets, fails) -> pd.DataFrame:
    cost = assets.set_index("asset_id")["downtime_cost_per_hour"]
    rows = []
    for f in fails:
        lost = f["downtime"] * cost[f["asset_id"]]
        repair = 4200 + f["downtime"] * 900
        rows.append(dict(
            failure_id=f["failure_id"], asset_id=f["asset_id"], failure_ts=f["ts"],
            failure_mode=f["mode"], component=f["component"], downtime_hours=f["downtime"],
            scrap_units=f["scrap"], lost_production_cost_usd=round(lost, 2),
            repair_cost_usd=round(repair, 2), total_cost_usd=round(lost + repair + f["scrap"] * 38, 2),
            had_sensor_precursor=bool(f["precursor"] > 0), root_cause=f["root_cause"]))
    return pd.DataFrame(rows).sort_values("failure_ts").reset_index(drop=True)


def build_production(assets, telemetry, wos, rng) -> pd.DataFrame:
    prod_assets = assets[assets.asset_type != "Compressor"]
    t = telemetry[telemetry.asset_id.isin(prod_assets.asset_id)]
    t = t[(t.reading_ts.dt.hour >= SHIFT_START) & (t.reading_ts.dt.hour < SHIFT_END)].copy()
    t["d"] = t.reading_ts.dt.normalize()
    t["is_down"] = (t.machine_state == "DOWN").astype(int)
    g = t.groupby(["asset_id", "d"]).agg(down_h=("is_down", "sum"), vib=("vibration_rms_mm_s", "mean")).reset_index()
    pm = wos[wos.work_type == "Preventive"].copy()
    pm["d"] = pd.to_datetime(pm.scheduled_ts).dt.normalize()
    pm_min = pm.groupby(["asset_id", "d"]).labor_hours.sum().mul(60).rename("pm_min").reset_index()
    g = g.merge(pm_min, on=["asset_id", "d"], how="left").fillna({"pm_min": 0.0})
    base = prod_assets.set_index("asset_id")
    planned = 960.0
    micro = rng.gamma(2.0, 9.0, len(g))          # minor stops, jams, waiting on material
    changeover = rng.gamma(3.0, 16.0, len(g))    # setups / changeovers (availability loss)
    unplanned = np.minimum(g.down_h.values * 60.0 + micro + changeover, planned)
    planned_dt = np.minimum(g.pm_min.values, planned - unplanned)
    run = np.clip(planned - unplanned - planned_dt, 0, None)
    typ = base.loc[g.asset_id, "asset_type"].values
    vib_base = np.array([TYPE_BASE[x]["vib"] for x in typ])
    stress = np.clip(g.vib.values / vib_base - 1.25, 0, 3)  # degradation slows cycles + hurts quality
    # RA-207 is the Line-2 bottleneck: when it slows (speed override for alarms), the whole line starves.
    bn = g[g.asset_id == "RA-207"].set_index("d").vib / TYPE_BASE["Robot"]["vib"]
    bn_stress = np.clip(g.d.map(bn).fillna(1.0).values - 1.25, 0, 3)
    line2 = base.loc[g.asset_id, "line"].values == "Line 2 — Robotic Assembly"
    stress = np.where(line2, np.maximum(stress, 0.7 * bn_stress), stress)
    perf = np.clip(rng.normal(0.87, 0.03, len(g)) - 0.07 * stress, 0.55, 0.99)
    qual = np.clip(rng.normal(0.978, 0.006, len(g)) - 0.015 * stress, 0.85, 0.999)
    cycle = base.loc[g.asset_id, "ideal_cycle_time_sec"].values.astype(float)
    total = np.floor(run * 60.0 / cycle * perf)
    good = np.floor(total * qual)
    return pd.DataFrame(dict(
        production_date=g.d.dt.date, asset_id=g.asset_id.values, line=base.loc[g.asset_id, "line"].values,
        planned_production_min=planned, planned_downtime_min=np.round(planned_dt, 1),
        unplanned_downtime_min=np.round(unplanned, 1), run_time_min=np.round(run, 1),
        ideal_cycle_time_sec=cycle, total_units=total.astype(int), good_units=good.astype(int)))


def build_spare_parts() -> pd.DataFrame:
    P = [
        ("A97L-0218-0412#J3", "RV reducer assembly J3 — FANUC M-20iD", "FANUC M-20iD/25", 1, 2, 18450.0, 21, "Critical spare"),
        ("A97L-0218-0412#J2", "RV reducer assembly J2 — FANUC M-20iD", "FANUC M-20iD/25", 1, 1, 19200.0, 21, "Critical spare"),
        ("A98L-0040-0174", "Vigo RE0 reducer grease, 16 kg pail", "FANUC M-20iD/25; FANUC R-2000iC/165F", 0, 6, 1180.0, 2, "Lubricant"),
        ("A98L-0040-0174-S", "Vigo RE0 reducer grease, 2.5 kg cartridge set", "FANUC M-20iD/25", 0, 14, 265.0, 2, "Lubricant"),
        ("MOB-XHP222-18", "Mobilgrease XHP 222, 18 kg (NOT approved for FANUC reducers)", "General plant use", 9, 0, 240.0, 3, "Lubricant"),
        ("A290-7221-X521", "J3 reducer oil-seal kit — M-20iD", "FANUC M-20iD/25", 4, 10, 310.0, 5, "Seal kit"),
        ("A06B-0268-B605", "AC servo motor aiF 12/4000 (J2/J3)", "FANUC M-20iD/25", 1, 2, 6900.0, 14, "Critical spare"),
        ("A660-2007-T364", "J6 dress-pack cable harness", "FANUC M-20iD/25", 2, 4, 1850.0, 10, "Cable"),
        ("3HAC057541-001", "Gearbox axis 2 — ABB IRB 6700", "ABB IRB 6700", 1, 1, 21400.0, 28, "Critical spare"),
        ("3HAC042766-001", "Kyodo Yushi TMO 150 gear oil 20 L", "ABB IRB 6700", 3, 2, 390.0, 4, "Lubricant"),
        ("HAAS-93-3308", "Spindle cartridge bearing set — UMC-750", "Haas UMC-750", 1, 2, 7400.0, 12, "Critical spare"),
        ("HAAS-93-1000547", "Coolant suction filter element", "Haas UMC-750; DMG MORI NLX 2500; Okuma GENOS M560-V", 12, 20, 68.0, 3, "Filter"),
        ("HAAS-30-12890", "Coolant pump 1 HP", "Haas UMC-750; DMG MORI NLX 2500", 1, 1, 1450.0, 7, "Pump"),
        ("DMG-SPN-2500-B", "Main spindle bearing kit — NLX 2500", "DMG MORI NLX 2500", 0, 1, 9800.0, 18, "Critical spare"),
        ("OKU-ATC-560", "ATC gripper finger set — GENOS", "Okuma GENOS M560-V", 3, 3, 520.0, 6, "Wear part"),
        ("AIDA-OLP-1500", "Hydraulic overload seal kit — NS2-1500", "AIDA NS2-1500", 2, 3, 1340.0, 9, "Seal kit"),
        ("SCH-CRB-400", "Crank bearing set — MSD 400", "Schuler MSD 400", 1, 1, 11800.0, 25, "Critical spare"),
        ("PRS-HF-10", "Hydraulic filter element 10 um", "AIDA NS2-1500; Schuler MSD 400", 16, 12, 92.0, 3, "Filter"),
        ("BP-LC-2K", "Load cell 2 kN — EOL test stand", "Burke Porter EOL-A2", 2, 2, 980.0, 8, "Sensor"),
        ("AC-2906-0561", "Oil separator + filter kit — GA 75", "Atlas Copco GA 75 VSD+", 3, 2, 640.0, 5, "Service kit"),
        ("AC-1604-4000", "Discharge valve assembly — GA 75", "Atlas Copco GA 75 VSD+", 1, 1, 2100.0, 10, "Valve"),
        ("VIB-ACC-100", "Wireless vibration + temperature sensor (spare)", "All", 6, 0, 410.0, 5, "Sensor"),
    ]
    return pd.DataFrame([dict(part_number=p[0], description=p[1], compatible_models=p[2],
                              plant_on_hand_qty=p[3], regional_dc_qty=p[4], unit_cost_usd=p[5],
                              supplier_lead_time_days=p[6], part_class=p[7],
                              storeroom_location="Greenville MRO crib" if p[3] else "Charlotte Regional DC",
                              regional_dc_transfer_days=1) for p in P])


def build_windows(now: datetime) -> pd.DataFrame:
    rows = []
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for w in range(3):
        for line, dow, h0, dur in [("Line 2 — Robotic Assembly", 5, 6, 8),       # Saturday
                                   ("Line 1 — Precision Machining", 6, 6, 8),    # Sunday
                                   ("Line 3 — Press & Test", 2, 22, 6)]:          # Wednesday night
            # next occurrence strictly after today (a same-weekday run must not yield two windows 7 days out)
            days_ahead = ((dow - today.weekday()) % 7 or 7) + 7 * w
            s = today + timedelta(days=days_ahead, hours=h0)
            rows.append(dict(window_id=f"MW-{s:%y%m%d}-L{line[5]}", line=line, start_ts=s,
                             end_ts=s + timedelta(hours=dur), window_type="Planned maintenance window",
                             capacity_hours=float(dur * 2), notes=f"Line scheduled down — zero production impact. 2 crews x {dur} h = {dur * 2} crew-hours"))
    return pd.DataFrame(rows).sort_values("start_ts").reset_index(drop=True)


def build_technicians() -> pd.DataFrame:
    T = [("T-01", "Luis Ramirez", "Day", "Robotics technician", "FANUC R-30iB maintenance; reducer replacement", 58.0),
         ("T-02", "Aisha Grant", "Day", "Mechanical", "Vibration analyst Cat II; laser alignment", 61.0),
         ("T-03", "Ben Whitaker", "Night", "Electrical", "Servo drives; NFPA 70E", 57.0),
         ("T-04", "Priya Nair", "Day", "Reliability engineer", "CMRP; lubrication MLA II", 72.0),
         ("T-05", "Tom Kowalski", "Weekend", "Robotics technician", "FANUC R-30iB maintenance; ABB IRC5", 60.0),
         ("T-06", "Jen Park", "Night", "Machine tool", "Haas / Okuma spindle service", 59.0)]
    return pd.DataFrame([dict(technician_id=t[0], name=t[1], shift=t[2], craft=t[3], certifications=t[4],
                              hourly_rate_usd=t[5]) for t in T])


def generate(now: datetime | None = None) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(SEED)
    now = now or datetime.now().replace(minute=0, second=0, microsecond=0)
    assets = build_assets()
    fails = sorted(plan_failures(assets, now, rng), key=lambda f: f["ts"])
    for i, f in enumerate(fails):
        f["failure_id"] = f"F-{2400 + i}"
    telem = build_telemetry(assets, fails, current_drifts(now), now, rng)
    wos = build_work_orders(assets, fails, now, rng)
    return dict(
        assets=assets, sensor_readings=telem, maintenance_work_orders=wos,
        failure_events=build_failures(assets, fails), production_daily=build_production(assets, telem, wos, rng),
        spare_parts=build_spare_parts(), maintenance_windows=build_windows(now), technicians=build_technicians())


COMMENTS = {
    "assets": "Production asset registry (48 assets, Greenville Plant 2) incl. downtime cost per hour and bottleneck flag.",
    "sensor_readings": "Hourly condition-monitoring telemetry per asset: vibration RMS mm/s, temperature C, motor current A, pressure bar, speed rpm, load pct. 365 days.",
    "maintenance_work_orders": "CMMS work-order history (preventive, corrective, inspection) incl. vendor, lubricant used and technician notes.",
    "failure_events": "Historical unplanned breakdowns with downtime hours, lost production cost and root cause.",
    "production_daily": "Per-asset daily production accounting (planned/unplanned downtime, run time, total + good units) used for OEE.",
    "spare_parts": "MRO spare-parts inventory at the Greenville crib and the Charlotte regional DC.",
    "maintenance_windows": "Upcoming planned-downtime windows per line (booking targets with zero production impact).",
    "technicians": "Maintenance crew roster with crafts and certifications.",
}
PKS = {"assets": "asset_id", "maintenance_work_orders": "work_order_id", "failure_events": "failure_id",
       "spare_parts": "part_number", "maintenance_windows": "window_id", "technicians": "technician_id"}


def get_spark():
    try:
        from pyspark.sql import SparkSession
        s = SparkSession.getActiveSession()
        if s is not None:
            return s
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except ImportError:
        from pyspark.sql import SparkSession
        return SparkSession.builder.getOrCreate()


def write_spark(data: dict[str, pd.DataFrame], catalog: str, schema: str) -> None:
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}`")

    def fq(t):
        return f"`{catalog}`.`{schema}`.`{t}`"

    for name, pdf in data.items():
        spark.sql(f"DROP TABLE IF EXISTS {fq(name)}")
        spark.createDataFrame(pdf).write.mode("overwrite").saveAsTable(fq(name))
        spark.sql(f"COMMENT ON TABLE {fq(name)} IS '{COMMENTS[name]}'")
        print(f"  wrote {catalog}.{schema}.{name}: {len(pdf):,} rows")
    for t, pk in PKS.items():
        spark.sql(f"ALTER TABLE {fq(t)} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq(t)} ADD CONSTRAINT {t}_pk PRIMARY KEY ({pk}) RELY")
    for t in ("sensor_readings", "maintenance_work_orders", "failure_events", "production_daily"):
        spark.sql(f"ALTER TABLE {fq(t)} ADD CONSTRAINT {t}_asset_fk FOREIGN KEY (asset_id) "
                  f"REFERENCES {fq('assets')} (asset_id)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="predictive_maintenance_copilot")
    ap.add_argument("--local-out", default=None, help="write parquet here instead of Delta (testing)")
    args, _ = ap.parse_known_args()
    data = generate()
    for k, v in data.items():
        print(f"{k}: {len(v):,}")
    if args.local_out:
        import os
        os.makedirs(args.local_out, exist_ok=True)
        for k, v in data.items():
            v.to_parquet(f"{args.local_out}/{k}.parquet", index=False)
        return
    write_spark(data, args.catalog, args.schema)


if __name__ == "__main__":
    main()
