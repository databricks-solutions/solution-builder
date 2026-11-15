"""
Corvane Motion Systems — S&OP supply planning: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, `pip install databricks-connect`,
    DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog manufacturing --schema supply_planning_copilot

All dates are relative to AS_OF = the Monday of the week the generator runs, so a fresh
run always tells the same story "from today".

Tables written (Delta, PK constraints RELY + comments):
  plants                3 plants: Dayton OH (servo gearmotors), Monterrey MX (gearboxes + the sunset
                        SG-300 line), Wroclaw PL (linear actuators + EU servo)
  products              10 finished SKUs with list price + lifecycle (SG-300 sunset in May)
  components            14 purchased components (castings, stators, encoders, bearings, boards …)
  bom                   single-level bill of materials (sku → component, qty_per)
  suppliers             12 suppliers incl. the qualified alternate foundry for HX-220
  sourcing              supplier × component × plant lanes: role (primary/alternate), price,
                        contract lead time, capacity, air-expedite offer
  transfer_lanes        inter-plant transfer lanes (transit days, cost per truck/unit)
  demand_history        104 weeks of weekly orders vs shipped units per SKU × plant (fill rate)
  customer_orders       open customer orders for the next 9 weeks (who gets hurt by a stock-out)
  inventory_on_hand     today's component inventory per plant + safety-stock policy + last movement
  purchase_orders       52 weeks of received POs (supplier on-time history) + every open PO with
                        promised vs revised ETA
  logistics_events      port / lane disruptions (the Yantian congestion)
  supplier_messages     raw supplier + forwarder emails (read by ai_extract in src/ai/)
  sop_plan_decisions    EMPTY — the app writes every booked mitigation plan here (write-back)

THE PLANTED SIGNAL — "the fix is sitting in Monterrey":
  1. Demand: SG-400 servo gearmotor orders at Dayton are up ~46% since June (warehouse-automation
     wins, e.g. Atlas Warehouse Robotics). AI_FORECAST (src/gold) carries that forward.
  2. Supply: a berth closure / congestion at the Port of Yantian (event 15 days ago) pushed the three
     in-transit POs of HX-220 gear-housing castings from Nanhai Precision Castings (sole source for
     Dayton) back by 18-25 days. Nanhai's on-time delivery collapses in the last month.
  3. BOM explosion: every Dayton servo (SG-250 / SG-400 / SG-600) needs one HX-220 → Dayton's HX-220
     balance goes negative in week 2 and stays short for two weeks (~1,000 housings ≈ $2M of servo
     revenue, named customer orders included); below safety stock for 6 weeks.
  4. Inventory optimization: Monterrey holds 2,600 HX-220 housings (plus ST-30 stators and EN-17
     encoders) left over from the SG-300 line it sunset in May — no demand, sitting in the excess &
     obsolete (E&O) report. A 5-day truck transfer costs ~$14K and fixes the stock-out; air-expediting
     costs ~$74K; the qualified alternate foundry (Ridgeline, 21 days) arrives a week too late alone.
  5. A smaller second exposure: Kessler's EN-17 encoder allocation cut (70%) leaves Wroclaw short in
     week 9 — again coverable from Monterrey's obsolete encoders.
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, datetime, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import types as T

SEED = 20261005
rng = random.Random(SEED)

_today = date.today()
AS_OF = _today - timedelta(days=_today.weekday())  # Monday of the current week
HIST_WEEKS = 104
SURGE_START = AS_OF - timedelta(weeks=16)          # SG-400 demand ramps from here
SG300_SUNSET = AS_OF - timedelta(weeks=21)         # Monterrey stops building SG-300
YANTIAN_EVENT = AS_OF - timedelta(days=15)


def get_spark() -> SparkSession:
    """Ambient session on Databricks; Databricks Connect (serverless) locally."""
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession  # type: ignore

        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


def d(days: int) -> date:
    return AS_OF + timedelta(days=days)


# ─────────────────────────────────────────────────────────────────────────────
# Master data
# ─────────────────────────────────────────────────────────────────────────────

PLANTS = [
    dict(plant_id="DAY", plant_name="Dayton", city="Dayton", state_region="Ohio", country="United States", region="North America",
         latitude=39.7589, longitude=-84.1916, focus="Servo gearmotors (SG-250/400/600) + motion controllers"),
    dict(plant_id="MTY", plant_name="Monterrey", city="Apodaca", state_region="Nuevo Leon", country="Mexico", region="North America",
         latitude=25.7806, longitude=-100.1880, focus="Planetary gearboxes (PG-60/90/120); SG-300 line sunset in May"),
    dict(plant_id="WRO", plant_name="Wroclaw", city="Wroclaw", state_region="Lower Silesia", country="Poland", region="Europe",
         latitude=51.1079, longitude=17.0385, focus="Linear actuators (LA-50/90) + EU servo gearmotors + controllers"),
]

PRODUCTS = [
    # sku, name, family, list_price, unit_cost, lifecycle
    ("SG-250", "SG-250 Servo Gearmotor 250 W", "Servo Gearmotors", 1450.0, 905.0, "Active"),
    ("SG-400", "SG-400 Servo Gearmotor 400 W", "Servo Gearmotors", 1980.0, 1190.0, "Active"),
    ("SG-600", "SG-600 Servo Gearmotor 600 W (integrated drive)", "Servo Gearmotors", 2640.0, 1610.0, "Active"),
    ("SG-300", "SG-300 Servo Gearmotor 300 W (legacy)", "Servo Gearmotors", 1690.0, 1080.0, "Sunset"),
    ("PG-60", "PG-60 Planetary Gearbox", "Planetary Gearboxes", 620.0, 360.0, "Active"),
    ("PG-90", "PG-90 Planetary Gearbox", "Planetary Gearboxes", 840.0, 488.0, "Active"),
    ("PG-120", "PG-120 Planetary Gearbox", "Planetary Gearboxes", 1120.0, 655.0, "Active"),
    ("LA-50", "LA-50 Linear Actuator", "Linear Actuators", 910.0, 540.0, "Active"),
    ("LA-90", "LA-90 Linear Actuator (absolute feedback)", "Linear Actuators", 1280.0, 760.0, "Active"),
    ("MC-10", "MC-10 Motion Controller", "Motion Controllers", 760.0, 410.0, "Active"),
]

# base weekly demand per (sku, plant); SG-400@DAY surges +46% from SURGE_START
DEMAND_BASE = {
    ("SG-250", "DAY"): 180, ("SG-400", "DAY"): 255, ("SG-600", "DAY"): 108, ("MC-10", "DAY"): 140,
    ("SG-300", "MTY"): 150, ("PG-60", "MTY"): 300, ("PG-90", "MTY"): 220, ("PG-120", "MTY"): 140,
    ("SG-250", "WRO"): 90, ("LA-50", "WRO"): 160, ("LA-90", "WRO"): 120, ("MC-10", "WRO"): 70,
}
SURGE = 1.46

COMPONENTS = [
    # id, name, category, standard_cost, abc_class
    ("HX-220", "HX-220 gear housing casting (ductile iron)", "Castings", 142.0, "A"),
    ("HX-310", "HX-310 gearbox housing (die-cast aluminium)", "Castings", 64.0, "A"),
    ("HX-LA", "HX-LA actuator extrusion", "Extrusions", 38.0, "B"),
    ("ST-40", "ST-40 servo stator assembly", "Motor parts", 96.0, "A"),
    ("ST-30", "ST-30 servo stator assembly (legacy SG-300)", "Motor parts", 88.0, "C"),
    ("EN-17", "EN-17 17-bit absolute encoder", "Electronics", 58.0, "A"),
    ("GS-12", "GS-12 helical gear set", "Gearing", 71.0, "A"),
    ("PG-SET", "PG-SET planetary gear stage", "Gearing", 54.0, "A"),
    ("BR-6205", "BR-6205 deep-groove ball bearing", "Bearings", 4.8, "C"),
    ("SL-45", "SL-45 shaft seal", "Seals", 1.9, "C"),
    ("PCB-MC", "PCB-MC motion controller board", "Electronics", 118.0, "A"),
    ("LS-12", "LS-12 ball screw assembly", "Linear parts", 83.0, "B"),
    ("MT-LA", "MT-LA actuator motor", "Motor parts", 67.0, "B"),
    ("CB-08", "CB-08 cable harness", "Wiring", 9.5, "C"),
]
COMP = {c[0]: c for c in COMPONENTS}

_SERVO = [("HX-220", 1), ("ST-40", 1), ("EN-17", 1), ("GS-12", 1), ("BR-6205", 2), ("SL-45", 1), ("CB-08", 1)]
BOM = {
    "SG-250": _SERVO,
    "SG-400": _SERVO,
    "SG-600": _SERVO + [("PCB-MC", 1)],
    "SG-300": [("HX-220", 1), ("ST-30", 1), ("EN-17", 1), ("GS-12", 1), ("BR-6205", 2), ("SL-45", 1), ("CB-08", 1)],
    "PG-60": [("HX-310", 1), ("PG-SET", 1), ("BR-6205", 2), ("SL-45", 1)],
    "PG-90": [("HX-310", 1), ("PG-SET", 1), ("BR-6205", 2), ("SL-45", 1)],
    "PG-120": [("HX-310", 1), ("PG-SET", 2), ("BR-6205", 2), ("SL-45", 1)],
    "LA-50": [("HX-LA", 1), ("LS-12", 1), ("MT-LA", 1), ("BR-6205", 2), ("CB-08", 1)],
    "LA-90": [("HX-LA", 1), ("LS-12", 1), ("MT-LA", 1), ("EN-17", 1), ("BR-6205", 2), ("CB-08", 1)],
    "MC-10": [("PCB-MC", 1), ("CB-08", 1)],
}

SUPPLIERS = [
    # id, name, city, country, origin_port, tier
    ("SUP-NAN", "Nanhai Precision Castings", "Foshan", "China", "Yantian (Shenzhen)", "Strategic"),
    ("SUP-RDG", "Ridgeline Foundry", "Mansfield, OH", "United States", None, "Qualified alternate"),
    ("SUP-OPL", "Opole Iron Works", "Opole", "Poland", None, "Preferred"),
    ("SUP-KES", "Kessler Sensorik GmbH", "Nuremberg", "Germany", None, "Strategic"),
    ("SUP-TAI", "Taiyo Bearing Co.", "Osaka", "Japan", "Osaka", "Preferred"),
    ("SUP-VOL", "Voltara Motor Components", "Guadalajara", "Mexico", None, "Preferred"),
    ("SUP-BRL", "Brightline Electronics", "Penang", "Malaysia", "Penang", "Preferred"),
    ("SUP-GRX", "Gerax Gear Works", "Brno", "Czechia", None, "Preferred"),
    ("SUP-SEA", "Sealtech Polymers", "Akron, OH", "United States", None, "Approved"),
    ("SUP-VIS", "Vistula Linear", "Krakow", "Poland", None, "Preferred"),
    ("SUP-CBL", "Cablecraft de Juarez", "Ciudad Juarez", "Mexico", None, "Approved"),
    ("SUP-ALC", "Alcora Die Casting", "Saltillo", "Mexico", None, "Approved"),
]

# sourcing lanes: (supplier, component, plant, role, unit_price, lead_days, mode, lane, monthly_capacity,
#                  moq, air_cost_per_unit, air_lead_days, air_max_units, qualification)
SOURCING = [
    ("SUP-NAN", "HX-220", "DAY", "primary", 142.0, 56, "Ocean + rail", "Yantian -> Long Beach -> rail Columbus -> Dayton", 6000, 1400, 74.0, 12, 1000, "Qualified (sole source until 2026)"),
    ("SUP-RDG", "HX-220", "DAY", "alternate", 183.0, 21, "Truck", "Mansfield OH -> Dayton", 1200, 400, None, None, None, "Qualified - PPAP Level 3 approved; max 40% share first 6 months"),
    ("SUP-OPL", "HX-220", "WRO", "primary", 151.0, 28, "Truck", "Opole -> Wroclaw", 1500, 300, None, None, None, "Qualified"),
    ("SUP-NAN", "HX-310", "MTY", "primary", 64.0, 52, "Ocean + truck", "Yantian -> Manzanillo -> Monterrey", 5000, 1000, 31.0, 11, 800, "Qualified"),
    ("SUP-ALC", "HX-310", "MTY", "alternate", 77.0, 18, "Truck", "Saltillo -> Monterrey", 1500, 300, None, None, None, "Qualified"),
    ("SUP-VIS", "HX-LA", "WRO", "primary", 38.0, 21, "Truck", "Krakow -> Wroclaw", 2000, 200, None, None, None, "Qualified"),
    ("SUP-VOL", "ST-40", "DAY", "primary", 96.0, 24, "Truck", "Guadalajara -> Dayton", 4000, 300, 9.0, 5, 600, "Qualified"),
    ("SUP-VOL", "ST-40", "WRO", "primary", 99.0, 42, "Ocean + truck", "Veracruz -> Gdansk -> Wroclaw", 4000, 300, 22.0, 8, 400, "Qualified"),
    ("SUP-VOL", "ST-30", "MTY", "primary", 88.0, 14, "Truck", "Guadalajara -> Monterrey", 2000, 200, None, None, None, "Qualified (SG-300 last-time-buy)"),
    ("SUP-KES", "EN-17", "DAY", "primary", 58.0, 35, "Air + truck", "Nuremberg -> Frankfurt -> Cincinnati -> Dayton", 3000, 300, 6.0, 6, 300, "Qualified (sole source)"),
    ("SUP-KES", "EN-17", "WRO", "primary", 56.0, 21, "Truck", "Nuremberg -> Wroclaw", 3000, 300, 3.0, 5, 150, "Qualified (sole source)"),
    ("SUP-KES", "EN-17", "MTY", "primary", 58.0, 35, "Air + truck", "Nuremberg -> Monterrey", 3000, 300, None, None, None, "Qualified (SG-300 only)"),
    ("SUP-GRX", "GS-12", "DAY", "primary", 71.0, 42, "Ocean + truck", "Bremerhaven -> Baltimore -> Dayton", 3000, 400, 18.0, 9, 500, "Qualified"),
    ("SUP-GRX", "GS-12", "WRO", "primary", 69.0, 10, "Truck", "Brno -> Wroclaw", 3000, 200, None, None, None, "Qualified"),
    ("SUP-GRX", "GS-12", "MTY", "primary", 71.0, 45, "Ocean + truck", "Bremerhaven -> Altamira -> Monterrey", 3000, 200, None, None, None, "Qualified"),
    ("SUP-GRX", "PG-SET", "MTY", "primary", 54.0, 45, "Ocean + truck", "Bremerhaven -> Altamira -> Monterrey", 4000, 500, 14.0, 9, 600, "Qualified"),
    ("SUP-TAI", "BR-6205", "DAY", "primary", 4.8, 38, "Ocean + truck", "Osaka -> Long Beach -> Dayton", 40000, 2000, 1.2, 7, 4000, "Qualified"),
    ("SUP-TAI", "BR-6205", "MTY", "primary", 4.8, 40, "Ocean + truck", "Osaka -> Manzanillo -> Monterrey", 40000, 2000, 1.2, 7, 4000, "Qualified"),
    ("SUP-TAI", "BR-6205", "WRO", "primary", 4.9, 44, "Ocean + truck", "Osaka -> Gdansk -> Wroclaw", 40000, 2000, 1.3, 8, 4000, "Qualified"),
    ("SUP-SEA", "SL-45", "DAY", "primary", 1.9, 10, "Truck", "Akron -> Dayton", 30000, 1000, None, None, None, "Qualified"),
    ("SUP-SEA", "SL-45", "MTY", "primary", 2.0, 14, "Truck", "Akron -> Monterrey", 30000, 1000, None, None, None, "Qualified"),
    ("SUP-SEA", "SL-45", "WRO", "primary", 2.1, 30, "Ocean + truck", "Baltimore -> Gdansk -> Wroclaw", 30000, 1000, None, None, None, "Qualified"),
    ("SUP-BRL", "PCB-MC", "DAY", "primary", 118.0, 49, "Air + truck", "Penang -> Chicago -> Dayton", 2500, 200, 4.0, 7, 300, "Qualified (sole source)"),
    ("SUP-BRL", "PCB-MC", "WRO", "primary", 118.0, 45, "Air + truck", "Penang -> Frankfurt -> Wroclaw", 2500, 200, 4.0, 7, 200, "Qualified (sole source)"),
    ("SUP-VIS", "LS-12", "WRO", "primary", 83.0, 21, "Truck", "Krakow -> Wroclaw", 2000, 200, None, None, None, "Qualified"),
    ("SUP-VOL", "MT-LA", "WRO", "primary", 67.0, 42, "Ocean + truck", "Veracruz -> Gdansk -> Wroclaw", 2000, 200, 16.0, 8, 300, "Qualified"),
    ("SUP-CBL", "CB-08", "DAY", "primary", 9.5, 12, "Truck", "Juarez -> Dayton", 20000, 500, None, None, None, "Qualified"),
    ("SUP-CBL", "CB-08", "MTY", "primary", 9.2, 5, "Truck", "Juarez -> Monterrey", 20000, 500, None, None, None, "Qualified"),
    ("SUP-CBL", "CB-08", "WRO", "primary", 9.9, 40, "Ocean + truck", "Veracruz -> Gdansk -> Wroclaw", 20000, 500, None, None, None, "Qualified"),
]

# one-time pattern/setup charge on the first order from an alternate source
SETUP_COST = {"SUP-RDG": 6500.0, "SUP-ALC": 4000.0}

TRANSFER_LANES = [
    # from, to, mode, transit_days, cost_per_shipment, units_per_shipment(housing-equivalent), handling_per_unit
    ("MTY", "DAY", "Truck (USMCA, bonded)", 5, 2900.0, 800, 2.40),
    ("DAY", "MTY", "Truck (USMCA, bonded)", 5, 2900.0, 800, 2.40),
    ("MTY", "WRO", "Air freight", 6, 3800.0, 1200, 3.10),
    ("DAY", "WRO", "Air freight", 5, 4200.0, 1200, 3.10),
    ("WRO", "DAY", "Air freight", 5, 4200.0, 1200, 3.10),
    ("WRO", "MTY", "Air freight", 6, 3800.0, 1200, 3.10),
]

CUSTOMERS = [
    # name, tier, plants
    ("Atlas Warehouse Robotics", "A", ["DAY"]),
    ("Northgate Packaging Systems", "A", ["DAY", "WRO"]),
    ("Orbital Semiconductor Tools", "A", ["DAY"]),
    ("Helix Cold-Chain Automation", "B", ["DAY", "MTY"]),
    ("Pinecrest Food Machinery", "B", ["DAY", "MTY"]),
    ("Keel & Mast Marine Systems", "C", ["DAY"]),
    ("Brandt Intralogistik", "A", ["WRO"]),
    ("Vistar Medical Devices", "B", ["WRO", "DAY"]),
    ("Sierra Conveyor Group", "B", ["MTY"]),
    ("Alpenlift Hoist AG", "C", ["WRO"]),
    ("Cobalt Printing Equipment", "C", ["MTY", "DAY"]),
]


# ─────────────────────────────────────────────────────────────────────────────
# Demand
# ─────────────────────────────────────────────────────────────────────────────

def demand_multiplier(sku: str, plant: str, wk: date) -> float:
    if sku == "SG-300" and wk >= SG300_SUNSET:
        return 0.0
    m = 1.0
    if sku == "SG-300":  # slow decline into the sunset
        weeks_to_sunset = (SG300_SUNSET - wk).days / 7
        if weeks_to_sunset < 20:
            m *= 0.55 + 0.45 * weeks_to_sunset / 20
    if (sku, plant) == ("SG-400", "DAY") and wk >= SURGE_START:
        ramp = min(1.0, ((wk - SURGE_START).days / 7 + 1) / 4)
        m *= 1 + (SURGE - 1) * ramp
    # mild demand growth over two years (+4%/yr) + seasonality + holiday dip
    m *= 1 + 0.04 * ((wk - AS_OF).days / 365)
    woy = wk.isocalendar()[1]
    m *= 1 + 0.05 * math.sin(2 * math.pi * (woy - 12) / 52)
    if woy in (52, 53, 1):
        m *= 0.7
    return m


def build_demand():
    rows = []
    for (sku, plant), base in DEMAND_BASE.items():
        price = next(p[3] for p in PRODUCTS if p[0] == sku)
        for i in range(HIST_WEEKS, 0, -1):
            wk = AS_OF - timedelta(weeks=i)
            mult = demand_multiplier(sku, plant, wk)
            units = max(0, int(round(base * mult * rng.gauss(1.0, 0.055)))) if mult > 0 else 0
            # fill rate: ~98% normally; SG-400 Dayton finished goods can't keep up with the surge
            fr = min(1.0, rng.gauss(0.985, 0.008))
            if (sku, plant) == ("SG-400", "DAY") and wk >= SURGE_START + timedelta(weeks=2):
                fr = min(1.0, rng.gauss(0.915, 0.015))
            elif plant == "DAY" and sku in ("SG-250", "SG-600") and wk >= AS_OF - timedelta(weeks=3):
                fr = min(1.0, rng.gauss(0.955, 0.01))
            elif (sku, plant) == ("LA-90", "WRO") and wk >= AS_OF - timedelta(weeks=10):
                fr = min(1.0, rng.gauss(0.965, 0.01))
            shipped = int(round(units * fr))
            lines = max(1, int(round(units / rng.uniform(14, 22)))) if units else 0
            lines_full = int(round(lines * min(1.0, fr + rng.uniform(-0.02, 0.0)))) if lines else 0
            rows.append(dict(week_start=wk, plant_id=plant, sku=sku, units_ordered=units, units_shipped=shipped,
                             order_value=round(units * price, 2), shipped_value=round(shipped * price, 2),
                             order_lines=lines, lines_shipped_complete=lines_full))
    return rows


def recent_weekly_requirement():
    """Approximate forward component requirement per (component, plant) = post-surge demand × BOM."""
    req = {}
    for (sku, plant), base in DEMAND_BASE.items():
        if sku == "SG-300":
            continue
        units = base * (SURGE if (sku, plant) == ("SG-400", "DAY") else 1.0)
        for comp, q in BOM[sku]:
            req[(comp, plant)] = req.get((comp, plant), 0) + units * q
    return req


# ─────────────────────────────────────────────────────────────────────────────
# Inventory + purchase orders
# ─────────────────────────────────────────────────────────────────────────────

_po_seq = [44000]


def next_po() -> str:
    _po_seq[0] += rng.randint(3, 9)
    return f"PO-{_po_seq[0]}"


def build_inventory_and_pos():
    req = recent_weekly_requirement()
    lanes = {(s[1], s[2]): s for s in SOURCING if s[3] == "primary"}
    inv, pos = [], []

    def add_inv(comp, plant, on_hand, ss_weeks, ss_units, last_receipt, last_issue):
        cost = COMP[comp][3]
        inv.append(dict(snapshot_date=AS_OF, plant_id=plant, component_id=comp, on_hand_units=int(on_hand),
                        safety_stock_weeks=float(ss_weeks), safety_stock_units=int(ss_units),
                        unit_cost=cost, inventory_value=round(on_hand * cost, 2),
                        last_receipt_date=last_receipt, last_issue_date=last_issue,
                        storage_location=f"{plant}-RM-{rng.randint(1, 4):02d}"))

    def add_po(comp, plant, qty, promised_days, revised_days=None, status="OPEN", delay_reason=None,
               vessel=None, received_days=None, order_days=None):
        lane = lanes[(comp, plant)]
        sup, price, lead = lane[0], lane[4], lane[5]
        promised = d(promised_days)
        order_date = d(order_days) if order_days is not None else min(promised - timedelta(days=lead), AS_OF - timedelta(days=rng.randint(2, 9)))
        revised = d(revised_days) if revised_days is not None else promised
        received = d(received_days) if received_days is not None else None
        pos.append(dict(po_number=next_po(), supplier_id=sup, component_id=comp, plant_id=plant,
                        order_date=order_date, quantity=int(qty), unit_price=price,
                        po_value=round(qty * price, 2), promised_date=promised, revised_eta=revised,
                        received_date=received, status=status,
                        delay_days=(revised - promised).days if status != "RECEIVED" else (received - promised).days,
                        delay_reason=delay_reason, ship_mode=lane[6], lane=lane[7], vessel=vessel))
        return pos[-1]

    # ── received history (52 weeks) → supplier on-time performance ─────────────
    for (comp, plant), lane in lanes.items():
        r = req.get((comp, plant), 0)
        if (comp, plant) in (("ST-30", "MTY"), ("EN-17", "MTY")):
            r = 150  # SG-300 history (pre-sunset)
        if r <= 0 and comp != "HX-220":
            continue
        if (comp, plant) == ("HX-220", "MTY"):
            continue  # MTY's HX-220 came via last-time-buy lots (below)
        interval = 14 if lane[5] > 20 else 7
        day = -364
        while day < -7:
            qty = int(round(r * interval / 7 * rng.uniform(0.9, 1.1) / 10) * 10) or 10
            late = 0
            p_on_time = 0.93
            if lane[0] == "SUP-NAN":
                p_on_time = 0.90 if day < -35 else 0.15
            elif lane[0] == "SUP-KES":
                p_on_time = 0.92 if day < -60 else 0.7
            elif lane[0] == "SUP-BRL":
                p_on_time = 0.88
            if rng.random() > p_on_time:
                late = rng.randint(2, 6) if lane[0] != "SUP-NAN" or day < -35 else rng.randint(12, 21)
            recv = day + late
            if recv < 0:
                if plant == "MTY" and comp in ("ST-30", "EN-17") and d(day) > SG300_SUNSET:
                    day += interval
                    continue
                add_po(comp, plant, qty, day, status="RECEIVED", received_days=recv,
                       delay_reason=("Port congestion - Yantian" if late > 10 and lane[0] == "SUP-NAN" else ("Carrier delay" if late else None)))
            day += interval

    # ── HX-220 @ Dayton — THE hero exposure ────────────────────────────────────
    add_inv("HX-220", "DAY", 1650, 2, 1320, d(-9), d(-1))
    reason = "Port congestion - Yantian berth closure (typhoon + backlog); vessel rolled"
    add_po("HX-220", "DAY", 1800, 8, 33, "IN_TRANSIT", reason, "MV Jade Horizon", order_days=-48)
    add_po("HX-220", "DAY", 1800, 22, 40, "IN_TRANSIT", reason, "MV Pearl Meridian", order_days=-34)
    add_po("HX-220", "DAY", 1400, 36, 54, "IN_TRANSIT", reason, "MV Coral Tide", order_days=-20)
    add_po("HX-220", "DAY", 1400, 57, 57, "OPEN", None, None, order_days=-6)
    add_po("HX-220", "DAY", 1400, 71, 71, "OPEN", None, None, order_days=-4)
    add_po("HX-220", "DAY", 1400, 85, 85, "OPEN", None, None, order_days=-2)

    # HX-220 @ Monterrey — leftover from the sunset SG-300 line (E&O)
    add_inv("HX-220", "MTY", 2600, 0, 0, SG300_SUNSET - timedelta(days=40), SG300_SUNSET - timedelta(days=3))
    add_inv("ST-30", "MTY", 1850, 0, 0, SG300_SUNSET - timedelta(days=30), SG300_SUNSET - timedelta(days=3))
    add_inv("EN-17", "MTY", 900, 0, 0, SG300_SUNSET - timedelta(days=25), SG300_SUNSET - timedelta(days=3))
    add_inv("GS-12", "MTY", 610, 0, 0, SG300_SUNSET - timedelta(days=35), SG300_SUNSET - timedelta(days=3))
    add_inv("CB-08", "MTY", 820, 0, 0, SG300_SUNSET - timedelta(days=20), SG300_SUNSET - timedelta(days=3))

    # ── EN-17 @ Wroclaw — Kessler allocation cut (second exposure) ─────────────
    add_inv("EN-17", "WRO", 520, 1.5, 315, d(-12), d(-1))
    alloc = "Supplier allocation - Kessler ASIC shortage, 70% of ordered quantity"
    for promised, qty in ((4, 440), (25, 440), (46, 440), (67, 630), (88, 630)):
        add_po("EN-17", "WRO", qty, promised, promised, "OPEN", alloc if qty < 630 else None)

    # ── everything else: healthy coverage, regular POs ─────────────────────────
    special = {("HX-220", "DAY"), ("HX-220", "MTY"), ("EN-17", "WRO"), ("ST-30", "MTY"), ("EN-17", "MTY"),
               ("GS-12", "MTY"), ("CB-08", "MTY")}
    for (comp, plant), r in sorted(req.items()):
        if (comp, plant) in special:
            continue
        lane = lanes[(comp, plant)]
        ss_w = 2.0 if COMP[comp][4] == "A" else 1.5
        cover = rng.uniform(4.6, 5.6)
        excess = False
        if (comp, plant) == ("PG-SET", "MTY"):
            cover, excess = 34.0, True   # over-bought ahead of a price increase → excess
        if (comp, plant) == ("LS-12", "WRO"):
            cover, excess = 31.0, True
        on_hand = int(round(r * cover / 10) * 10)
        add_inv(comp, plant, on_hand, ss_w, int(round(r * ss_w)), d(-rng.randint(2, 12)), d(-rng.randint(0, 2)))
        interval = 14
        first = rng.randint(7, 13) if not excess else 150
        day = first
        while day <= 91:
            qty = int(round(r * interval / 7 * rng.uniform(1.04, 1.08) / 10) * 10)
            revised = day
            reason = None
            if (comp, plant) == ("PCB-MC", "DAY") and 20 <= day <= 50:
                revised, reason = day + 10, "Supplier lead time +10 days (Penang board fab capacity)"
            if (comp, plant) == ("HX-310", "MTY") and day < 45:
                revised, reason = day + 19, "Port congestion - Yantian berth closure; vessel rolled"
            add_po(comp, plant, qty, day, revised, "IN_TRANSIT" if day - lane[5] < 0 else "OPEN", reason)
            day += interval
    # HX-220 @ Wroclaw from Opole (not affected by Yantian)
    return inv, pos


# ─────────────────────────────────────────────────────────────────────────────
# Customer orders, logistics events, supplier messages
# ─────────────────────────────────────────────────────────────────────────────

def build_customer_orders():
    rows, n = [], 0
    for (sku, plant), base in DEMAND_BASE.items():
        if sku == "SG-300":
            continue
        price = next(p[3] for p in PRODUCTS if p[0] == sku)
        weekly = base * (SURGE if (sku, plant) == ("SG-400", "DAY") else 1.0)
        custs = [c for c in CUSTOMERS if plant in c[2]]
        for w in range(0, 9):
            firm = weekly * (0.92 - 0.07 * w)  # firm backlog thins out further out
            left = firm
            while left > 25:
                c = rng.choice(custs)
                qty = int(min(left, rng.choice([40, 60, 80, 120, 160, 220])))
                if (sku, plant, w) == ("SG-400", "DAY", 2) and not any(r["customer_name"] == "Atlas Warehouse Robotics" and r["sku"] == "SG-400" and r["week"] == 2 for r in rows):
                    c, qty = CUSTOMERS[0], 420
                left -= qty
                n += 1
                ship = d(7 * w + rng.randint(0, 4))
                rows.append(dict(order_id=f"SO-{81000 + n}", customer_name=c[0], customer_tier=c[1], plant_id=plant,
                                 sku=sku, quantity=qty, unit_price=price, order_value=round(qty * price, 2),
                                 order_date=ship - timedelta(days=rng.randint(20, 70)), requested_ship_date=ship,
                                 status="OPEN", week=w))
    for r in rows:
        r.pop("week")
    return rows


def build_logistics_events():
    return [
        dict(event_id="LE-2611", event_date=YANTIAN_EVENT, location="Port of Yantian (Shenzhen), China", event_type="Port congestion",
             severity="High", est_delay_days=21, affected_lanes="Yantian -> Long Beach; Yantian -> Manzanillo",
             description="Typhoon-related berth closure followed by yard congestion; carriers rolling bookings 2-3 sailings."),
        dict(event_id="LE-2598", event_date=AS_OF - timedelta(days=41), location="Port of Long Beach, USA", event_type="Labor slowdown",
             severity="Low", est_delay_days=3, affected_lanes="Asia -> Long Beach", description="Two-shift slowdown, resolved in 4 days."),
        dict(event_id="LE-2573", event_date=AS_OF - timedelta(days=97), location="Gdansk, Poland", event_type="Weather",
             severity="Low", est_delay_days=2, affected_lanes="Veracruz -> Gdansk", description="Storm closure, 36 hours."),
        dict(event_id="LE-2540", event_date=AS_OF - timedelta(days=160), location="Laredo border crossing", event_type="Border congestion",
             severity="Medium", est_delay_days=4, affected_lanes="Monterrey <-> Dayton", description="Inspection backlog at the World Trade Bridge."),
        dict(event_id="LE-2615", event_date=AS_OF - timedelta(days=8), location="Kessler Sensorik, Nuremberg", event_type="Supplier allocation",
             severity="Medium", est_delay_days=0, affected_lanes="EN-17 all plants",
             description="Encoder ASIC shortage; Kessler allocating 70% of ordered EN-17 quantity through November."),
    ]


def build_messages(pos):
    def po_of(comp, plant, status=None):
        return [p for p in pos if p["component_id"] == comp and p["plant_id"] == plant and (status is None or p["status"] == status)]
    hx = [p for p in po_of("HX-220", "DAY") if p["status"] == "IN_TRANSIT"]
    nxt = [p for p in po_of("HX-220", "DAY") if p["status"] == "OPEN"][0]
    en = po_of("EN-17", "WRO", "OPEN")[:3]
    fmt = lambda x: x.strftime("%B %d, %Y").replace(" 0", " ")
    msgs = [
        (YANTIAN_EVENT + timedelta(days=1), "ops.alerts@pacificcrest-logistics.example", "Pacific Crest Logistics",
         "ADVISORY FA-0914: Yantian berth closure - Corvane bookings rolled",
         f"""Dear Corvane Motion Systems logistics team,

Following the typhoon-related berth closure at Yantian International Container Terminals and the resulting yard backlog, carriers are rolling export bookings by two to three sailings. The following Corvane shipments from Nanhai Precision Castings (HX-220 gear housing castings, destination Dayton OH via Long Beach and rail) are affected:

  - {hx[0]['po_number']}  {hx[0]['quantity']:,} pcs  vessel {hx[0]['vessel']}   original ETA Dayton {fmt(hx[0]['promised_date'])}  -> revised ETA {fmt(hx[0]['revised_eta'])}
  - {hx[1]['po_number']}  {hx[1]['quantity']:,} pcs  vessel {hx[1]['vessel']}  original ETA Dayton {fmt(hx[1]['promised_date'])}  -> revised ETA {fmt(hx[1]['revised_eta'])}
  - {hx[2]['po_number']}  {hx[2]['quantity']:,} pcs  vessel {hx[2]['vessel']}       original ETA Dayton {fmt(hx[2]['promised_date'])}  -> revised ETA {fmt(hx[2]['revised_eta'])}

Average added transit time is 18 to 25 days. We do not expect the backlog to clear before the end of next month. Air freight capacity out of Shenzhen is available at a premium; please contact your account manager.

Regards,
Mei Lin Zhao
Ocean Operations, Pacific Crest Logistics"""),
        (YANTIAN_EVENT + timedelta(days=3), "export@nanhai-castings.example", "Nanhai Precision Castings",
         f"RE: HX-220 supply - {nxt['po_number']} production status and air option",
         f"""Hello Corvane purchasing,

Production of {nxt['po_number']} ({nxt['quantity']:,} pcs HX-220) is on schedule. Because of the Yantian situation we can offer to air-freight up to 1,000 pieces from this lot. Air freight Shenzhen to Dayton adds USD 74 per piece and the pieces would arrive in about 12 days from your confirmation. The balance of the lot would follow by ocean on the original schedule.

We apologize for the delays on the in-transit containers; they are outside our control.

Best regards,
Chen Wei, Export Sales, Nanhai Precision Castings"""),
        (AS_OF - timedelta(days=8), "allocation@kessler-sensorik.example", "Kessler Sensorik GmbH",
         "Allocation notice - EN-17 absolute encoders, October-November",
         f"""Dear customer,

Due to a shortage of the encoder ASIC from our semiconductor partner, Kessler will allocate 70% of ordered quantities of the EN-17 17-bit absolute encoder for deliveries in October and November. For Corvane Motion Systems Wroclaw this affects {', '.join(p['po_number'] for p in en)}, each reduced from 630 to 440 units. Delivery dates are unchanged. We expect full allocation to resume in December.

Kind regards,
Jonas Weber, Key Account Management"""),
        (AS_OF - timedelta(days=6), "sales@ridgeline-foundry.example", "Ridgeline Foundry",
         "HX-220 capacity available - 3-week lead time",
         """Hi Corvane team,

Following the PPAP Level 3 approval of our HX-220 gear housing earlier this year, we can confirm open capacity of up to 1,200 pieces per month starting immediately. Lead time from PO to delivery at Dayton is 21 days. Unit price USD 183.00, plus a one-time USD 6,500 pattern and setup charge for the first order. Minimum order 400 pieces.

Thanks,
Dana Kowalczyk, Ridgeline Foundry, Mansfield OH"""),
        (AS_OF - timedelta(days=11), "planning@brightline-electronics.example", "Brightline Electronics",
         "Lead time update - PCB-MC motion controller boards",
         """Dear Corvane planning,

Due to high utilization of our SMT lines in Penang, lead time for the PCB-MC board increases by 10 days for orders shipping in the next six weeks. Quantities are confirmed.

Regards, Brightline Electronics Customer Service"""),
        (AS_OF - timedelta(days=5), "logistics@taiyo-bearing.example", "Taiyo Bearing Co.",
         "Shipment confirmation - BR-6205",
         "Your BR-6205 shipments for Dayton, Monterrey and Wroclaw sailed as planned from Osaka. No changes to ETA. Taiyo Bearing Co."),
        (AS_OF - timedelta(days=14), "pricing@gerax.example", "Gerax Gear Works",
         "Price adjustment notice - PG-SET planetary stages",
         "Effective the first of next quarter, the price of the PG-SET planetary gear stage increases by 4.5% due to alloy steel surcharges. Orders placed before then are held at current prices. Gerax Gear Works, Brno."),
        (AS_OF - timedelta(days=3), "cs@sealtech.example", "Sealtech Polymers",
         "Order acknowledgement - SL-45 shaft seals",
         "We acknowledge your SL-45 orders for all three plants. Deliveries on schedule. Sealtech Polymers, Akron OH."),
        (AS_OF - timedelta(days=2), "ops.alerts@pacificcrest-logistics.example", "Pacific Crest Logistics",
         "UPDATE FA-0914: Yantian backlog - HX-310 Monterrey shipment also rolled",
         "Further to advisory FA-0914, the Nanhai HX-310 shipment to Monterrey via Manzanillo was rolled one sailing (about 19 days). Monterrey coverage on HX-310 should absorb this. Pacific Crest Logistics."),
        (AS_OF - timedelta(days=20), "export@voltara.example", "Voltara Motor Components",
         "ST-40 stator deliveries - Q4 plan confirmed",
         "Voltara confirms the Q4 delivery plan for ST-40 stators to Dayton and Wroclaw. No constraints. Voltara Motor Components, Guadalajara."),
        (AS_OF - timedelta(days=1), "export@nanhai-castings.example", "Nanhai Precision Castings",
         "Air freight offer valid until end of week",
         "Reminder: the air-freight offer for up to 1,000 pcs HX-220 at USD 74/pc is valid until Friday. Please confirm if Corvane wishes to proceed. Chen Wei, Nanhai Precision Castings."),
        (AS_OF - timedelta(days=9), "cs@cablecraft.example", "Cablecraft de Juarez",
         "CB-08 harness - delivery confirmation",
         "CB-08 cable harness deliveries for October are confirmed for all plants. Cablecraft de Juarez."),
    ]
    out = []
    for i, (ts, sender, org, subj, body) in enumerate(msgs, 1):
        out.append(dict(message_id=f"MSG-{2600 + i}", received_ts=datetime.combine(ts, datetime.min.time()) + timedelta(hours=8 + i % 9, minutes=i * 7 % 60),
                        sender_email=sender, sender_org=org, subject=subj, body=body))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────────────────────

S = T.StructField
STR, INT, DBL, DT, TS, BOOL = T.StringType(), T.IntegerType(), T.DoubleType(), T.DateType(), T.TimestampType(), T.BooleanType()


def write(spark, fqs, name, rows, fields, comment, pk=None):
    struct = T.StructType([S(n, t) for n, t in fields])
    cols = [n for n, _ in fields]
    df = spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], struct)
    fq = f"{fqs}.{name}"
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        for c in pk.split(","):
            spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {c.strip()} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="supply_planning_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Corvane Motion Systems - S&OP supply planning copilot demo'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.supply_policy COMMENT 'Corvane supply planning policy manual - documents searched by the Genie agent'")
    print(f"AS_OF={AS_OF} surge_start={SURGE_START} sg300_sunset={SG300_SUNSET} yantian={YANTIAN_EVENT}")

    demand = build_demand()
    inv, pos = build_inventory_and_pos()
    orders = build_customer_orders()
    events = build_logistics_events()
    msgs = build_messages(pos)

    write(spark, fqs, "plants", PLANTS, [("plant_id", STR), ("plant_name", STR), ("city", STR), ("state_region", STR),
          ("country", STR), ("region", STR), ("latitude", DBL), ("longitude", DBL), ("focus", STR)],
          "Corvane Motion Systems plants. DAY = Dayton OH, MTY = Monterrey MX, WRO = Wroclaw PL.", pk="plant_id")
    write(spark, fqs, "products", [dict(sku=p[0], product_name=p[1], product_family=p[2], list_price=p[3], unit_cost=p[4],
          lifecycle_status=p[5], sunset_date=SG300_SUNSET if p[5] == "Sunset" else None) for p in PRODUCTS],
          [("sku", STR), ("product_name", STR), ("product_family", STR), ("list_price", DBL), ("unit_cost", DBL),
           ("lifecycle_status", STR), ("sunset_date", DT)],
          "Finished goods (SKUs). lifecycle_status Sunset = no longer built (SG-300 sunset at Monterrey).", pk="sku")
    write(spark, fqs, "components", [dict(component_id=c[0], component_name=c[1], category=c[2], standard_cost=c[3], abc_class=c[4]) for c in COMPONENTS],
          [("component_id", STR), ("component_name", STR), ("category", STR), ("standard_cost", DBL), ("abc_class", STR)],
          "Purchased components. abc_class A = high value / critical (2-week safety stock policy).", pk="component_id")
    write(spark, fqs, "bom", [dict(sku=s, component_id=c, qty_per=float(q)) for s, lst in BOM.items() for c, q in lst],
          [("sku", STR), ("component_id", STR), ("qty_per", DBL)],
          "Single-level bill of materials: units of component per finished unit. HX-220 housing is shared by every SG servo.", pk="sku,component_id")
    write(spark, fqs, "suppliers", [dict(supplier_id=s[0], supplier_name=s[1], city=s[2], country=s[3], origin_port=s[4], supplier_tier=s[5]) for s in SUPPLIERS],
          [("supplier_id", STR), ("supplier_name", STR), ("city", STR), ("country", STR), ("origin_port", STR), ("supplier_tier", STR)],
          "Suppliers. Nanhai Precision Castings ships HX-220 castings from the Port of Yantian; Ridgeline Foundry is the qualified alternate.", pk="supplier_id")
    write(spark, fqs, "sourcing", [dict(supplier_id=s[0], component_id=s[1], plant_id=s[2], role=s[3], unit_price=s[4],
          contract_lead_time_days=s[5], ship_mode=s[6], lane=s[7], monthly_capacity_units=s[8], min_order_qty=s[9],
          air_expedite_cost_per_unit=s[10], air_expedite_lead_days=s[11], air_expedite_max_units=s[12],
          first_order_setup_cost=SETUP_COST.get(s[0], 0.0), qualification=s[13]) for s in SOURCING],
          [("supplier_id", STR), ("component_id", STR), ("plant_id", STR), ("role", STR), ("unit_price", DBL),
           ("contract_lead_time_days", INT), ("ship_mode", STR), ("lane", STR), ("monthly_capacity_units", INT), ("min_order_qty", INT),
           ("air_expedite_cost_per_unit", DBL), ("air_expedite_lead_days", INT), ("air_expedite_max_units", INT),
           ("first_order_setup_cost", DBL), ("qualification", STR)],
          "Sourcing lanes: supplier x component x plant. role primary/alternate, contract lead time, capacity, and the supplier's air-expedite offer (premium per unit).",
          pk="supplier_id,component_id,plant_id")
    write(spark, fqs, "transfer_lanes", [dict(from_plant_id=t[0], to_plant_id=t[1], ship_mode=t[2], transit_days=t[3],
          cost_per_shipment=t[4], units_per_shipment=t[5], handling_cost_per_unit=t[6]) for t in TRANSFER_LANES],
          [("from_plant_id", STR), ("to_plant_id", STR), ("ship_mode", STR), ("transit_days", INT), ("cost_per_shipment", DBL),
           ("units_per_shipment", INT), ("handling_cost_per_unit", DBL)],
          "Inter-plant transfer lanes for re-allocating inventory (transit days incl. customs; cost per truck/air shipment + per-unit handling).",
          pk="from_plant_id,to_plant_id")
    write(spark, fqs, "demand_history", demand, [("week_start", DT), ("plant_id", STR), ("sku", STR), ("units_ordered", INT),
          ("units_shipped", INT), ("order_value", DBL), ("shipped_value", DBL), ("order_lines", INT), ("lines_shipped_complete", INT)],
          "Weekly customer demand actuals per SKU x plant (104 weeks, week_start = Monday). fill rate = units_shipped / units_ordered.",
          pk="week_start,plant_id,sku")
    write(spark, fqs, "customer_orders", orders, [("order_id", STR), ("customer_name", STR), ("customer_tier", STR), ("plant_id", STR),
          ("sku", STR), ("quantity", INT), ("unit_price", DBL), ("order_value", DBL), ("order_date", DT),
          ("requested_ship_date", DT), ("status", STR)],
          "Open customer orders (firm backlog) for the next 9 weeks. customer_tier A = strategic accounts (allocated first in a shortage).", pk="order_id")
    write(spark, fqs, "inventory_on_hand", inv, [("snapshot_date", DT), ("plant_id", STR), ("component_id", STR), ("on_hand_units", INT),
          ("safety_stock_weeks", DBL), ("safety_stock_units", INT), ("unit_cost", DBL), ("inventory_value", DBL),
          ("last_receipt_date", DT), ("last_issue_date", DT), ("storage_location", STR)],
          "Component inventory per plant as of snapshot_date (today) with the safety-stock policy and last receipt/issue dates (used for excess & obsolete).",
          pk="plant_id,component_id")
    write(spark, fqs, "purchase_orders", pos, [("po_number", STR), ("supplier_id", STR), ("component_id", STR), ("plant_id", STR),
          ("order_date", DT), ("quantity", INT), ("unit_price", DBL), ("po_value", DBL), ("promised_date", DT), ("revised_eta", DT),
          ("received_date", DT), ("status", STR), ("delay_days", INT), ("delay_reason", STR), ("ship_mode", STR), ("lane", STR), ("vessel", STR)],
          "Purchase orders: 52 weeks RECEIVED (on-time history: received_date vs promised_date) + OPEN / IN_TRANSIT with revised_eta. delay_days = revised_eta (or received_date) - promised_date.",
          pk="po_number")
    write(spark, fqs, "logistics_events", events, [("event_id", STR), ("event_date", DT), ("location", STR), ("event_type", STR),
          ("severity", STR), ("est_delay_days", INT), ("affected_lanes", STR), ("description", STR)],
          "Port, lane and supplier disruption events.", pk="event_id")
    write(spark, fqs, "supplier_messages", msgs, [("message_id", STR), ("received_ts", TS), ("sender_email", STR), ("sender_org", STR),
          ("subject", STR), ("body", STR)],
          "Raw supplier and freight-forwarder emails (unstructured). src/ai/extract_signals.py reads them with ai_extract.", pk="message_id")

    spark.sql(f"DROP TABLE IF EXISTS {fqs}.sop_plan_decisions")
    spark.sql(f"""
      CREATE TABLE {fqs}.sop_plan_decisions (
        plan_id STRING NOT NULL, exposure_id STRING, component_id STRING, plant_id STRING,
        actions STRING COMMENT 'JSON array of the booked mitigation actions',
        action_summary STRING, plan_cost DOUBLE, revenue_protected DOUBLE, units_short_before INT, units_short_after INT,
        booked_by STRING, booked_at TIMESTAMP, rationale STRING, source STRING,
        CONSTRAINT sop_plan_decisions_pk PRIMARY KEY (plan_id) RELY)
      COMMENT 'Mitigation plans booked from the Supply Planning Copilot app (write-back from Lakebase). One row per booked plan.'
    """)
    print("  created sop_plan_decisions (empty)")


if __name__ == "__main__":
    main()
