"""
Brightwater Cycle Works — warranty cost optimization: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, `pip install databricks-connect`,
    DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog manufacturing --schema warranty_copilot

Tables written (Delta, PK/FK RELY constraints + comments):
  bike_models             4 e-bike models (hub-drive C3 / K2 / F1, mid-drive T5)
  suppliers               8 tier-1 suppliers with their supplier-quality-agreement terms
  supplier_lots           component lots received at the Reno plant (controllers, brakes, packs)
  dealers                 ~70 dealers in 7 US regions (with a wet-climate index)
  units                   ~48k bikes built Oct-2024 → last week: lot genealogy, firmware, sale, dealer
  warranty_claims         dealer warranty claims: coarse dealer labor code + FREE-TEXT technician notes + cost
  telemetry_fault_events  fault codes reported by connected bikes (E21 = controller moisture / Hall-signal loss …)
  supplier_chargebacks    quarterly supplier cost-recovery history (attributable vs submitted vs recovered)
  failure_mode_catalog    the failure-mode taxonomy ai_classify maps technician notes onto

THE PLANTED SIGNAL — "the wet-weather cut-out":
  On 2026-04-02 Hanlin Electronics (MC-48 hub-motor controller) filed PCN-0419: a cheaper, thinner
  silicone conformal coating, effective with lot HX-2605. Brightwater's SQE required a PPAP
  re-submission (humidity + salt-spray); it never arrived, yet lots HX-2605 → HX-2609 shipped.
  Bikes built with those controllers (C3 Commuter, K2 Cargo, F1 Fold — NOT the mid-drive T5, which
  uses a Kessler controller) fail an order of magnitude more often, mostly in wet regions (Pacific
  NW, Northeast, Southeast): water under the coating, corroded MOSFET / Hall-header pads, fault
  E21, "motor cuts out in the rain". Dealers file them under generic labor codes (ELEC-GEN / MOTOR /
  OTHER) — the pattern only appears once AI Functions classify the technician notes. Connected bikes
  report E21 weeks BEFORE the claim (the early warning). The OTA firmware 3.2.0 rolled out in May is
  a red herring (everyone got it; only the new lots fail).
  Secondary signals: display freeze after firmware 3.2.0 (Brightwater's own firmware — not
  chargeable) and a rear-caliper seep on Ardent lot AB-2603 (8D closed, cost recovered).
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import types as T

SEED = 20261001
rng = random.Random(SEED)


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


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────

AS_OF = date.today()
BUILD_START = date(2024, 10, 1)
FW32_RELEASE = date(2026, 5, 6)         # OTA firmware 3.2.0 (the red herring)
LABOR_RATE = 96.0                       # $/h, Brightwater dealer warranty labor rate
WARRANTY_MONTHS = 24

MODELS = [
    # model_id, name, segment, drive, msrp, share, weekly_km_mean
    ("C3", "Commuter C3", "urban commuter", "hub", 2399.0, 0.40, 62),
    ("K2", "Cargo K2", "family cargo", "hub", 3899.0, 0.20, 48),
    ("F1", "Fold F1", "folding", "hub", 1899.0, 0.15, 35),
    ("T5", "Trail T5", "e-MTB", "mid", 4599.0, 0.25, 55),
]

SUPPLIERS = [
    # supplier_id, name, country, commodity, sqa_id, sqa_signed, campaign_cost_recoverable, admin_fee_per_claim, scorecard
    ("SUP-HAN", "Hanlin Electronics Co.", "China (Dongguan)", "Hub-motor controller MC-48", "SQA-HAN-2024-07", "2024-07-15", True, 35.0, "B"),
    ("SUP-KES", "Kessler Drive Systems GmbH", "Germany (Schweinfurt)", "Hub motors, mid-drive unit, MC-60 controller, torque sensor", "SQA-KES-2023-11", "2023-11-02", True, 35.0, "A"),
    ("SUP-VOL", "Voltcell Energy", "South Korea (Cheongju)", "Battery packs BP-500, chargers, battery connectors", "SQA-VOL-2024-01", "2024-01-20", True, 35.0, "A"),
    ("SUP-ARD", "Ardent Brake Components", "Taiwan (Taichung)", "Hydraulic disc brakes", "SQA-ARD-2023-09", "2023-09-12", True, 35.0, "B"),
    ("SUP-MER", "Meridian Displays", "Taiwan (Hsinchu)", "Handlebar display / HMI hardware", "SQA-MER-2024-02", "2024-02-28", False, 35.0, "B"),
    ("SUP-TOR", "Torvik Frameworks", "Vietnam (Binh Duong)", "Aluminum frames + paint", "SQA-TOR-2023-06", "2023-06-30", False, 35.0, "A"),
    ("SUP-AXI", "Axis Drivetrain", "Japan (Osaka)", "Chains, cassettes, derailleurs", "SQA-AXI-2023-05", "2023-05-18", False, 35.0, "A"),
    ("SUP-BWC", "Brightwater Cycle Works (internal)", "USA (Reno, NV)", "Firmware / final assembly", None, None, False, 0.0, "-"),
]

# region, wet_index (0-1), dealer cities (city, state)
REGIONS = [
    ("Pacific Northwest", 1.00, [("Seattle", "WA"), ("Portland", "OR"), ("Tacoma", "WA"), ("Eugene", "OR"), ("Bellingham", "WA"), ("Vancouver", "WA"), ("Olympia", "WA"), ("Bend", "OR")]),
    ("Northeast", 0.70, [("Boston", "MA"), ("Brooklyn", "NY"), ("Burlington", "VT"), ("Portland", "ME"), ("Providence", "RI"), ("Hoboken", "NJ"), ("Philadelphia", "PA"), ("Hartford", "CT"), ("Albany", "NY")]),
    ("Southeast", 0.65, [("Atlanta", "GA"), ("Charlotte", "NC"), ("Asheville", "NC"), ("Tampa", "FL"), ("Charleston", "SC"), ("Richmond", "VA"), ("Nashville", "TN")]),
    ("Midwest", 0.40, [("Chicago", "IL"), ("Minneapolis", "MN"), ("Madison", "WI"), ("Ann Arbor", "MI"), ("Columbus", "OH"), ("St. Louis", "MO"), ("Milwaukee", "WI"), ("Des Moines", "IA")]),
    ("California", 0.18, [("San Francisco", "CA"), ("Oakland", "CA"), ("Los Angeles", "CA"), ("San Diego", "CA"), ("Sacramento", "CA"), ("Santa Cruz", "CA"), ("Pasadena", "CA"), ("San Jose", "CA"), ("Santa Barbara", "CA"), ("Davis", "CA")]),
    ("Mountain", 0.14, [("Denver", "CO"), ("Boulder", "CO"), ("Salt Lake City", "UT"), ("Boise", "ID"), ("Fort Collins", "CO"), ("Missoula", "MT"), ("Reno", "NV")]),
    ("Southwest & Texas", 0.10, [("Austin", "TX"), ("Phoenix", "AZ"), ("Tucson", "AZ"), ("Dallas", "TX"), ("Albuquerque", "NM"), ("Houston", "TX"), ("Las Vegas", "NV")]),
]
REGION_SHARE = {"Pacific Northwest": 0.16, "Northeast": 0.19, "Southeast": 0.12, "Midwest": 0.13,
                "California": 0.22, "Mountain": 0.09, "Southwest & Texas": 0.09}

DEALER_PREFIX = ["Cascade", "Summit", "Riverside", "Pedal", "Spoke & Hub", "Velo", "Harbor", "Lakeside", "Northgate",
                 "Crosstown", "Greenway", "Two Wheel", "Current", "Evergreen", "Trailhead", "Metro", "Boulevard",
                 "Switchback", "Tailwind", "Bridgeway"]
DEALER_SUFFIX = ["E-Bikes", "Cycles", "Bike Co.", "Electric Bikes", "Cyclery", "Bike Works", "E-Motion", "Bicycle Shop"]

TECH_FIRST = ["Jake", "Maria", "Devon", "Luis", "Sam", "Tyler", "Ana", "Chris", "Priya", "Marcus", "Kenji", "Olivia",
              "Ben", "Rosa", "Dmitri", "Aisha", "Noah", "Hana", "Eli", "Grace"]

# ── failure-mode taxonomy (generator truth; ai_classify re-derives it from the notes) ──
MODES = {
    "controller_water_ingress": dict(
        label="Motor controller water ingress / corrosion", component="Motor controller", chargeable=True,
        supplier={"hub": "SUP-HAN", "mid": "SUP-KES"}, hazard=0.0025, part=("MC-48", 312.0), part_mid=("MC-60", 348.0), labor=1.8,
        codes=[("ELEC-GEN", 0.52), ("MOTOR", 0.27), ("OTHER", 0.21)]),
    "controller_electrical_other": dict(
        label="Motor controller electronic failure (not water)", component="Motor controller", chargeable=True,
        supplier={"hub": "SUP-HAN", "mid": "SUP-KES"}, hazard=0.005, part=("MC-48", 312.0), part_mid=("MC-60", 348.0), labor=1.8,
        codes=[("ELEC-GEN", 0.55), ("MOTOR", 0.35), ("OTHER", 0.10)]),
    "hub_motor_bearing": dict(
        label="Hub motor bearing / gear noise", component="Hub motor", chargeable=True,
        supplier={"hub": "SUP-KES", "mid": None}, hazard=0.006, part=("HM-250", 186.0), labor=1.5,
        codes=[("MOTOR", 0.85), ("OTHER", 0.15)]),
    "mid_drive_fault": dict(
        label="Mid-drive unit fault", component="Mid-drive unit", chargeable=True,
        supplier={"hub": None, "mid": "SUP-KES"}, hazard=0.008, part=("MD-85", 520.0), labor=2.2,
        codes=[("MOTOR", 0.9), ("OTHER", 0.1)]),
    "torque_sensor_fault": dict(
        label="Torque / cadence sensor fault", component="Torque sensor", chargeable=True,
        supplier={"hub": "SUP-KES", "mid": "SUP-KES"}, hazard=0.005, part=("TS-3", 148.0), labor=2.0,
        codes=[("ELEC-GEN", 0.6), ("MOTOR", 0.3), ("OTHER", 0.1)]),
    "battery_bms_fault": dict(
        label="Battery pack BMS fault / won't charge", component="Battery pack", chargeable=True,
        supplier={"hub": "SUP-VOL", "mid": "SUP-VOL"}, hazard=0.011, part=("BP-500", 640.0), labor=1.0,
        codes=[("BATT", 0.9), ("ELEC-GEN", 0.1)]),
    "battery_connector_wear": dict(
        label="Battery connector / rail wear", component="Battery connector", chargeable=True,
        supplier={"hub": "SUP-VOL", "mid": "SUP-VOL"}, hazard=0.008, part=("BC-12", 42.0), labor=0.8,
        codes=[("BATT", 0.7), ("ELEC-GEN", 0.3)]),
    "charger_failure": dict(
        label="Charger failure", component="Charger", chargeable=True,
        supplier={"hub": "SUP-VOL", "mid": "SUP-VOL"}, hazard=0.007, part=("CH-4A", 79.0), labor=0.2,
        codes=[("CHARGER", 0.95), ("OTHER", 0.05)]),
    "brake_caliper_leak": dict(
        label="Hydraulic brake caliper seep / soft lever", component="Brake caliper", chargeable=True,
        supplier={"hub": "SUP-ARD", "mid": "SUP-ARD"}, hazard=0.004, part=("BR-HD2", 96.0), labor=1.2,
        codes=[("BRAKE", 0.95), ("OTHER", 0.05)]),
    "brake_pad_noise": dict(
        label="Brake pad wear / squeal", component="Brake pads", chargeable=False,
        supplier={"hub": None, "mid": None}, hazard=0.014, part=("BP-PAD", 24.0), labor=0.5,
        codes=[("BRAKE", 1.0)]),
    "display_freeze_firmware": dict(
        label="Display freeze / reboot (firmware)", component="Display / firmware", chargeable=False,
        supplier={"hub": "SUP-BWC", "mid": "SUP-BWC"}, hazard=0.004, part=("NONE", 0.0), labor=0.6,
        codes=[("DISPLAY", 0.7), ("ELEC-GEN", 0.2), ("OTHER", 0.1)]),
    "drivetrain_wear": dict(
        label="Chain / cassette / derailleur wear", component="Drivetrain", chargeable=False,
        supplier={"hub": None, "mid": None}, hazard=0.014, part=("DT-KIT", 65.0), labor=0.8,
        codes=[("DRIVE", 1.0)]),
    "frame_paint_cosmetic": dict(
        label="Frame paint / cosmetic defect", component="Frame", chargeable=True,
        supplier={"hub": "SUP-TOR", "mid": "SUP-TOR"}, hazard=0.003, part=("NONE", 0.0), labor=1.0,
        codes=[("FRAME", 0.9), ("OTHER", 0.1)]),
    "no_fault_found": dict(
        label="No fault found", component="None", chargeable=False,
        supplier={"hub": None, "mid": None}, hazard=0.010, part=("NONE", 0.0), labor=0.7,
        codes=[("OTHER", 0.5), ("ELEC-GEN", 0.3), ("MOTOR", 0.2)]),
}
ALWAYS_ON = ("brake_pad_noise", "drivetrain_wear", "no_fault_found")

SUSPECT_LOTS = {"HX-2605", "HX-2606", "HX-2607", "HX-2608", "HX-2609"}
CALIPER_LOT = "AB-2603"


def wchoice(pairs):
    r = rng.random() * sum(w for _, w in pairs)
    for v, w in pairs:
        r -= w
        if r <= 0:
            return v
    return pairs[-1][0]


def month_iter(start: date, end: date):
    d = date(start.year, start.month, 1)
    while d <= end:
        yield d
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def lot_code(prefix: str, d: date) -> str:
    return f"{prefix}-{d.strftime('%y%m')}"


# ─────────────────────────────────────────────────────────────────────────────
# Builders
# ─────────────────────────────────────────────────────────────────────────────

def build_dealers():
    dealers, used = [], set()
    n = 0
    for region, wet, cities in REGIONS:
        for city, st in cities:
            k = 1 if region not in ("California", "Pacific Northwest", "Northeast") else rng.choice([1, 1, 2])
            for _ in range(k):
                while True:
                    name = f"{rng.choice(DEALER_PREFIX)} {rng.choice(DEALER_SUFFIX)}"
                    if name not in used:
                        used.add(name)
                        break
                n += 1
                dealers.append(dict(dealer_id=f"D-{100 + n}", dealer_name=f"{name} ({city})", city=city, state=st,
                                    region=region, wet_climate_index=wet,
                                    tier=rng.choice(["Platinum", "Gold", "Gold", "Silver", "Silver", "Silver"])))
    hero = next(d for d in dealers if d["city"] == "Portland" and d["state"] == "OR")
    hero["dealer_name"] = "Cascade E-Bike Co. (Portland)"
    hero["tier"] = "Platinum"
    return dealers


def build_lots():
    lots = []
    for m in month_iter(date(2024, 9, 1), AS_OF):
        lid = lot_code("HX", m)
        pcn = lid in SUSPECT_LOTS
        lots.append(dict(lot_id=lid, supplier_id="SUP-HAN", part_number="MC-48", component="Motor controller",
                         production_start=m, production_end=m + timedelta(days=26), quantity=1700,
                         conformal_coating="SC-15 silicone, 25-35 µm (PCN-0419)" if pcn else "AC-220 acrylic, 50-75 µm (PPAP 2024)",
                         pcn_reference="PCN-0419" if pcn else None,
                         ppap_status="PPAP re-submission required — NOT received" if pcn else "Approved (PPAP L3, 2024-09-20)",
                         received_at_plant=m + timedelta(days=12 + rng.randint(0, 6))))
        lots.append(dict(lot_id=lot_code("KC", m), supplier_id="SUP-KES", part_number="MC-60", component="Motor controller",
                         production_start=m, production_end=m + timedelta(days=26), quantity=600,
                         conformal_coating="Fully potted, IP67", pcn_reference=None, ppap_status="Approved (PPAP L3, 2023-12-01)",
                         received_at_plant=m + timedelta(days=18)))
        lid = lot_code("AB", m)
        lots.append(dict(lot_id=lid, supplier_id="SUP-ARD", part_number="BR-HD2", component="Brake caliper",
                         production_start=m, production_end=m + timedelta(days=26), quantity=4400,
                         conformal_coating=None, pcn_reference=None,
                         ppap_status="Approved (PPAP L3) — 8D-ARD-0311 closed 2026-06-18, cost recovered" if lid == CALIPER_LOT else "Approved (PPAP L3)",
                         received_at_plant=m + timedelta(days=14)))
        lots.append(dict(lot_id=lot_code("VB", m), supplier_id="SUP-VOL", part_number="BP-500", component="Battery pack",
                         production_start=m, production_end=m + timedelta(days=26), quantity=2300,
                         conformal_coating=None, pcn_reference=None, ppap_status="Approved (PPAP L3)",
                         received_at_plant=m + timedelta(days=20)))
    return lots


def build_units(dealers):
    """~2,000 bikes a month from the Reno plant; controller lot = production month ~2-4 weeks before build."""
    dealers_by_region = {}
    for d in dealers:
        dealers_by_region.setdefault(d["region"], []).append(d)
    units = []
    seq = 0
    day = BUILD_START
    last_build = AS_OF - timedelta(days=4)
    first_lot = date(2024, 9, 1)
    while day <= last_build:
        if day.weekday() < 5:
            base = 80 + 18 * math.sin((day.timetuple().tm_yday - 60) / 365 * 2 * math.pi) + (day - BUILD_START).days * 0.012
            n = max(40, int(rng.gauss(base, 8)))
            for _ in range(n):
                seq += 1
                m = wchoice([(x, x[5]) for x in MODELS])
                model_id, drive = m[0], m[3]
                ctrl_month = max(first_lot, day - timedelta(days=rng.randint(14, 30)))
                ctrl_lot = lot_code("HX" if drive == "hub" else "KC", ctrl_month)
                brake_lot = lot_code("AB", max(first_lot, day - timedelta(days=rng.randint(10, 40))))
                batt_lot = lot_code("VB", max(first_lot, day - timedelta(days=rng.randint(15, 35))))
                region = wchoice(list(REGION_SHARE.items()))
                dealer = rng.choice(dealers_by_region[region])
                ship = day + timedelta(days=rng.randint(3, 9))
                sale = ship + timedelta(days=int(rng.expovariate(1 / 21)) + 2)
                sold = sale <= AS_OF - timedelta(days=1)
                connected = rng.random() < 0.71
                fw = "3.2.0" if (day >= FW32_RELEASE or connected) and AS_OF >= FW32_RELEASE else "3.1.4"
                units.append(dict(
                    serial=f"BW{model_id}-{seq:06d}", model_id=model_id, build_date=day, plant="Reno, NV",
                    controller_part="MC-48" if drive == "hub" else "MC-60", controller_lot=ctrl_lot,
                    controller_supplier_id="SUP-HAN" if drive == "hub" else "SUP-KES",
                    brake_lot=brake_lot, battery_lot=batt_lot, firmware_version=fw, connected=connected,
                    dealer_id=dealer["dealer_id"], region=region, ship_date=ship,
                    sale_date=sale if sold else None, sold=sold,
                    warranty_end=(date(sale.year + 2, sale.month, min(sale.day, 28)) if sold else None),
                    avg_weekly_km=round(max(8, rng.gauss(m[6], 16)), 1),
                    _drive=drive, _wet=dealer["wet_climate_index"]))
        day += timedelta(days=1)
    return units


HERO_NOTE = ("Customer (daily commuter, rides in the rain) says motor cuts out without warning on wet days, comes back "
             "after drying overnight. Display showed E21 twice. Pulled the MC-48 controller: moisture under the conformal "
             "coating, green corrosion on the phase MOSFET pads and the Hall sensor header. Coating looks thinner than the "
             "ones we saw last year and is peeling at the board edge. Controller label HX-2606. Replaced controller, "
             "dielectric grease on connectors, 20 min wet test ride OK. Third one like this this month.")

NOTES = {
    "controller_water_ingress": [
        "Rider reports assist cutting out in rain, E21 on display. Opened controller: water under coating, corrosion on MOSFET pads. Replaced MC-48 controller. Road test OK.",
        "Motor stops mid-ride after riding in wet weather, restarts when dry. Code E21 stored. White residue and green corrosion near Hall sensor header on controller board. Swapped controller.",
        "Customer: bike dies after washing it with a hose. Found condensation inside controller housing, coating peeling at board edge. New controller installed, sealed connectors.",
        "Intermittent loss of power on rainy commute, E21 then E07. Controller board corroded around phase wire solder joints. Replaced controller assy.",
        "No assist after storm ride. Controller housing had water inside, conformal coat thin / missing in spots. R&R controller, test OK.",
        "Assist drops out in drizzle, comes back later. Controller shows moisture ingress and corrosion. Replaced controller per tech line.",
        "Cut-outs when wet — 3rd visit. Found green corrosion under coating on controller PCB. Controller replaced, applied dielectric grease.",
        "Motor stutters then shuts off in rain. E21 x4 in log. Controller swapped, old unit had water marks on the board.",
        "Customer parks outside. Throttle + assist dead, display ok. Controller wet inside, corroded. Replaced.",
        "Power cutout under load in wet conditions. Diagnosed controller moisture, corrosion at Hall connector. New controller.",
    ],
    "controller_electrical_other": [
        "No assist, E07 overcurrent. Controller failed bench test, no signs of water. Replaced controller.",
        "Motor jerky at low speed, controller output phase dead. Replaced controller, test OK.",
        "Bike won't power assist, controller unresponsive. Board looks clean and dry, likely component failure. Swapped controller.",
        "Intermittent E07, burnt smell from controller. Replaced controller and checked motor phases — motor OK.",
        "Controller MOSFET failure after long hill climb, dry conditions. Replaced controller.",
    ],
    "hub_motor_bearing": [
        "Grinding noise from rear hub motor under load. Bearing worn. Replaced hub motor.",
        "Clicking from rear hub every revolution, internal gear noise. Replaced motor assy.",
        "Hub motor loud whine and play in axle. Replaced hub motor.",
    ],
    "mid_drive_fault": [
        "Mid-drive unit making knocking noise, loss of assist on climbs. Replaced drive unit.",
        "Drive unit error, no assist. Diagnostic tool shows internal fault. Replaced mid-drive.",
    ],
    "torque_sensor_fault": [
        "Assist kicks in late / surges. Torque sensor readings erratic in diag. Replaced sensor.",
        "Ghost pedaling assist when stopped. Recalibrated, fault persists, replaced torque sensor.",
        "No assist unless pedaling hard, cadence sensor signal dropping. Replaced sensor.",
    ],
    "battery_bms_fault": [
        "Battery will not charge, charger light stays green. BMS fault per diag tool. Replaced battery pack.",
        "Range dropped to 10 km, battery shuts off at 40%. Cell imbalance in BMS log. Replaced pack under warranty.",
        "Battery dead after storage, won't wake. BMS locked out. Replaced battery.",
    ],
    "battery_connector_wear": [
        "Power cuts on bumps, battery rail connector pins worn. Replaced connector.",
        "Intermittent shutdown over potholes, loose battery contacts. New battery connector + rail.",
    ],
    "charger_failure": [
        "Charger no output, fan not spinning. Replaced charger.",
        "Charger LED red, battery ok on shop charger. Replaced charger.",
    ],
    "brake_caliper_leak": [
        "Rear brake lever goes soft, fluid seeping at caliper piston seal. Replaced rear caliper and bled.",
        "Oil on rear rotor, caliper leaking. Replaced caliper, new pads, bled system.",
    ],
    "brake_pad_noise": [
        "Brakes squealing loudly, pads glazed. Replaced pads, sanded rotors.",
        "Front pads worn down early on cargo use. Replaced pads.",
    ],
    "display_freeze_firmware": [
        "Display freezes and reboots randomly since the app update. Reflashed display, updated firmware.",
        "Screen freezes on startup after OTA 3.2, bike still rides. Reflashed firmware.",
        "Display locks up, have to remove battery to reset. Firmware reflash fixed it.",
    ],
    "drivetrain_wear": [
        "Chain skipping, cassette worn at 1,900 km. Replaced chain and cassette.",
        "Shifting poor, derailleur hanger bent + worn chain. Replaced drivetrain parts.",
    ],
    "frame_paint_cosmetic": [
        "Paint bubbling near rear dropout on delivery. Touch-up / cosmetic claim.",
        "Clearcoat flaking on top tube. Cosmetic repair.",
    ],
    "no_fault_found": [
        "Customer reports weak assist. Could not reproduce, all diag tests pass. Updated settings, no parts.",
        "Rattle reported, test ride fine, tightened fender bolts. No fault found.",
        "Intermittent noise, could not replicate on road test. No fault found.",
    ],
}
FIRMWARE_BLAME = [" Customer thinks it started after the 3.2 app update.", " Customer asked if the OTA update caused it.", "", ""]
COMPLAINT = {
    "controller_water_ingress": ["Motor cuts out in the rain", "Loses power when wet", "Assist stops working after riding in rain", "Bike dies intermittently"],
    "controller_electrical_other": ["No assist", "Motor not working", "Error E07"],
    "hub_motor_bearing": ["Noise from back wheel", "Grinding from motor"],
    "mid_drive_fault": ["Motor knocking", "No assist on hills"],
    "torque_sensor_fault": ["Assist is jerky", "Assist delayed"],
    "battery_bms_fault": ["Battery won't charge", "Poor range"],
    "battery_connector_wear": ["Bike shuts off over bumps"],
    "charger_failure": ["Charger not working"],
    "brake_caliper_leak": ["Rear brake feels soft"],
    "brake_pad_noise": ["Brakes squeal"],
    "display_freeze_firmware": ["Display freezes", "Screen reboots"],
    "drivetrain_wear": ["Chain skipping", "Shifting problems"],
    "frame_paint_cosmetic": ["Paint defect"],
    "no_fault_found": ["Weak assist", "Rattle", "Strange noise"],
}


def hazard(mode: str, u: dict, t: date) -> float:
    """Annual hazard for this unit + failure mode, in the window starting at t."""
    m = MODES[mode]
    if m["supplier"].get(u["_drive"]) is None and mode not in ALWAYS_ON:
        return 0.0
    h = m["hazard"]
    if mode == "controller_water_ingress":
        h = (0.03 + 0.55 * u["_wet"]) if u["controller_lot"] in SUSPECT_LOTS else h * (0.5 + u["_wet"])
    elif mode == "display_freeze_firmware":
        if t >= FW32_RELEASE and u["firmware_version"] == "3.2.0":
            h = 0.015
    elif mode == "brake_caliper_leak":
        if u["brake_lot"] == CALIPER_LOT:
            h = 0.12
        if u["model_id"] == "K2":
            h *= 1.6
    elif mode == "hub_motor_bearing" and u["model_id"] == "K2":
        h *= 1.5
    elif mode in ("brake_pad_noise", "drivetrain_wear"):
        h *= u["avg_weekly_km"] / 55
    return h


def build_claims(units, dealers):
    dealer_by_id = {d["dealer_id"]: d for d in dealers}
    claims, events = [], []
    cid = 0
    hero_done = False
    for u in units:
        if not u["sold"]:
            continue
        start = u["sale_date"]
        for mode in MODES:
            fail = None
            windows = [(start, AS_OF)]
            if mode == "display_freeze_firmware" and start < FW32_RELEASE < AS_OF:
                windows = [(start, FW32_RELEASE), (FW32_RELEASE, AS_OF)]
            for a, b in windows:
                h = hazard(mode, u, a)
                days = (b - a).days
                if h <= 0 or days <= 0:
                    continue
                if rng.random() < 1 - math.exp(-h * days / 365):
                    if mode == "controller_water_ingress" and u["controller_lot"] in SUSPECT_LOTS:
                        fail = a + timedelta(days=min(days - 1, max(9, int(rng.gauss(0.55, 0.25) * days))))
                    else:
                        fail = a + timedelta(days=int(days * rng.random()))
                    break
            if not fail:
                continue
            claim_date = fail + timedelta(days=rng.randint(1, 9))
            if claim_date > AS_OF:
                continue
            m = MODES[mode]
            cid += 1
            part_no, part_cost = m["part_mid"] if (u["_drive"] == "mid" and m.get("part_mid")) else m["part"]
            if mode == "display_freeze_firmware" and rng.random() < 0.25:
                part_no, part_cost = "DSP-2", 118.0
            labor_h = round(max(0.2, rng.gauss(m["labor"], 0.25)), 1)
            labor_cost = round(labor_h * LABOR_RATE, 2)
            total = round(part_cost + labor_cost + (35.0 if rng.random() < 0.08 else 0.0), 2)
            status = "paid" if claim_date < AS_OF - timedelta(days=12) else "pending"
            if rng.random() < 0.035:
                status = "rejected"
            notes = rng.choice(NOTES[mode])
            if mode in ("controller_water_ingress", "display_freeze_firmware") and fail >= FW32_RELEASE:
                notes += rng.choice(FIRMWARE_BLAME)
            if mode == "controller_water_ingress" and rng.random() < 0.35:
                notes += f" Controller label {u['controller_lot']}."
            dealer = dealer_by_id[u["dealer_id"]]
            if (not hero_done and mode == "controller_water_ingress" and u["controller_lot"] == "HX-2606"
                    and dealer["dealer_name"].startswith("Cascade E-Bike") and claim_date >= AS_OF - timedelta(days=45)):
                notes, hero_done = HERO_NOTE, True
                status = "pending"
            odo = round(max(15, (fail - start).days / 7 * u["avg_weekly_km"] * rng.uniform(0.7, 1.2)), 0)
            claims.append(dict(
                claim_id=f"WC-{260000 + cid}", serial=u["serial"], model_id=u["model_id"], dealer_id=u["dealer_id"],
                region=u["region"], failure_date=fail, claim_date=claim_date, odometer_km=odo,
                days_in_service=(fail - start).days, customer_complaint=rng.choice(COMPLAINT[mode]),
                dealer_labor_code=wchoice(m["codes"]), part_number_replaced=part_no, part_cost=part_cost,
                labor_hours=labor_h, labor_cost=labor_cost, total_cost=total, claim_status=status,
                technician_name=f"{rng.choice(TECH_FIRST)} ({dealer['dealer_name'].split(' (')[0]})",
                technician_notes=notes,
                firmware_at_claim="3.2.0" if (fail >= FW32_RELEASE and u["firmware_version"] == "3.2.0") else "3.1.4",
                _mode=mode))
            # leading telemetry: E21 bursts before a water-ingress failure on connected bikes
            if mode == "controller_water_ingress" and u["connected"]:
                for _ in range(rng.randint(3, 8)):
                    ev = fail - timedelta(days=rng.randint(1, 35))
                    if ev >= start:
                        events.append((u["serial"], ev, "E21"))
                if rng.random() < 0.6:
                    events.append((u["serial"], fail, "E07"))
            if mode == "controller_electrical_other" and u["connected"]:
                events.append((u["serial"], fail - timedelta(days=rng.randint(0, 5)), "E07"))
            if mode == "torque_sensor_fault" and u["connected"]:
                events.append((u["serial"], fail - timedelta(days=rng.randint(0, 20)), "E30"))
            if mode == "battery_bms_fault" and u["connected"]:
                events.append((u["serial"], fail - timedelta(days=rng.randint(0, 10)), "E12"))
    return claims, events


def build_telemetry(units, claim_events):
    """Background fault codes + the planted E21 early warning on suspect-lot bikes that have NOT failed yet."""
    RATES = {"E07": 0.35, "E12": 0.8, "E30": 0.25, "E21": 0.12, "E04": 0.5}  # events / unit-year, background
    DESC = {"E04": "Low battery voltage warning", "E07": "Controller overcurrent", "E12": "Battery communication loss",
            "E21": "Controller moisture / Hall-signal loss", "E30": "Torque sensor out of range"}
    rows = list(claim_events)
    for u in units:
        if not u["connected"] or not u["sold"]:
            continue
        start = u["sale_date"]
        span = (AS_OF - start).days
        if span <= 0:
            continue
        yrs = span / 365
        for code, r in RATES.items():
            k = sum(1 for _ in range(12) if rng.random() < r * yrs / 12)
            for _ in range(k):
                rows.append((u["serial"], start + timedelta(days=rng.randint(0, span)), code))
        if u["controller_lot"] in SUSPECT_LOTS and rng.random() < 0.25 + 0.55 * u["_wet"]:
            lam = (2.5 + 9 * u["_wet"]) * yrs
            k = min(12, 1 + int(rng.expovariate(1 / max(0.05, lam))))
            for _ in range(k):
                rows.append((u["serial"], start + timedelta(days=int(span * math.sqrt(rng.random()))), "E21"))
    out = []
    for i, (serial, d, code) in enumerate(sorted(rows, key=lambda x: (x[1], x[0]))):
        if d > AS_OF:
            continue
        out.append(dict(event_id=f"EV-{i + 1:07d}", serial=serial, event_date=d, fault_code=code,
                        fault_description=DESC[code],
                        ambient_humidity_pct=float(min(100, max(10, round(rng.gauss(88 if code == "E21" else 55, 10))))),
                        riding_in_rain=bool((code == "E21" and rng.random() < 0.8) or rng.random() < 0.12)))
    return out


def build_chargebacks(claims, units):
    """Quarterly supplier cost-recovery history (Brightwater files for only part of what is chargeable)."""
    drive = {u["serial"]: u["_drive"] for u in units}
    submit_rate = {"SUP-VOL": 0.78, "SUP-ARD": 0.92, "SUP-KES": 0.55, "SUP-HAN": 0.10, "SUP-TOR": 0.60}
    accept_rate = {"SUP-VOL": 0.85, "SUP-ARD": 0.90, "SUP-KES": 0.80, "SUP-HAN": 0.70, "SUP-TOR": 0.75}
    agg = {}
    for c in claims:
        m = MODES[c["_mode"]]
        if not m["chargeable"] or c["claim_status"] == "rejected":
            continue
        sup = m["supplier"][drive[c["serial"]]]
        if not sup or sup == "SUP-BWC":
            continue
        q = f"{c['claim_date'].year}-Q{(c['claim_date'].month - 1) // 3 + 1}"
        a = agg.setdefault((sup, q), dict(n=0, cost=0.0))
        a["n"] += 1
        a["cost"] += c["total_cost"]
    rows = []
    cur_q = f"{AS_OF.year}-Q{(AS_OF.month - 1) // 3 + 1}"
    for (sup, q), a in sorted(agg.items()):
        pending = q == cur_q
        submitted = min(round(a["cost"] * submit_rate.get(sup, 0.5) * (0.35 if pending else 1.0) * rng.uniform(0.92, 1.05), 2), round(a["cost"], 2))
        recovered = 0.0 if pending else round(submitted * accept_rate.get(sup, 0.7) * rng.uniform(0.95, 1.03), 2)
        rows.append(dict(chargeback_id=f"CB-{sup[4:]}-{q}", supplier_id=sup, quarter=q,
                         supplier_attributable_claims=a["n"], supplier_attributable_cost=round(a["cost"], 2),
                         submitted_amount=submitted, recovered_amount=min(recovered, submitted),
                         status="open" if pending else "settled"))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────────────────────

S = T.StructField


def write(spark, fq_schema, name, rows, struct: T.StructType, comment, pk=None):
    fq = f"{fq_schema}.{name}"
    cols = [f.name for f in struct.fields]
    df = spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], struct)
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="warranty_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Brightwater Cycle Works — warranty cost optimization + quality root-cause demo'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.supplier_quality_docs COMMENT 'PPAP submissions, PCNs, supplier quality agreements, warranty + field-campaign procedures - documents searched by the Genie agent'")
    for t in ["claim_failure_modes", "telemetry_fault_events", "warranty_claims", "supplier_chargebacks", "units",
              "supplier_lots", "dealers", "suppliers", "bike_models", "failure_mode_catalog"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    print(f"AS_OF={AS_OF}")
    dealers = build_dealers()
    lots = build_lots()
    units = build_units(dealers)
    claims, claim_events = build_claims(units, dealers)
    telemetry = build_telemetry(units, claim_events)
    chargebacks = build_chargebacks(claims, units)
    print(f"generated: {len(units)} units, {len(claims)} claims, {len(telemetry)} telemetry events, {len(chargebacks)} chargeback rows")

    write(spark, fqs, "bike_models", [dict(model_id=m[0], model_name=m[1], segment=m[2], drive_type=m[3], msrp=m[4],
                                           warranty_months=WARRANTY_MONTHS,
                                           controller_part="MC-48 (Hanlin)" if m[3] == "hub" else "MC-60 (Kessler)") for m in MODELS],
          T.StructType([S("model_id", T.StringType()), S("model_name", T.StringType()), S("segment", T.StringType()),
                        S("drive_type", T.StringType()), S("msrp", T.DoubleType()), S("warranty_months", T.IntegerType()),
                        S("controller_part", T.StringType())]),
          "Brightwater e-bike models. drive_type hub = rear hub motor with the Hanlin MC-48 controller; mid = mid-drive with the Kessler MC-60 controller.",
          pk="model_id")
    write(spark, fqs, "suppliers", [dict(supplier_id=s[0], supplier_name=s[1], country=s[2], commodity=s[3],
                                         sqa_id=s[4], sqa_signed_date=date.fromisoformat(s[5]) if s[5] else None,
                                         campaign_cost_recoverable=s[6], admin_fee_per_claim=s[7], scorecard_grade=s[8]) for s in SUPPLIERS],
          T.StructType([S("supplier_id", T.StringType()), S("supplier_name", T.StringType()), S("country", T.StringType()),
                        S("commodity", T.StringType()), S("sqa_id", T.StringType()), S("sqa_signed_date", T.DateType()),
                        S("campaign_cost_recoverable", T.BooleanType()), S("admin_fee_per_claim", T.DoubleType()),
                        S("scorecard_grade", T.StringType())]),
          "Tier-1 suppliers with their Supplier Quality Agreement (SQA). SUP-BWC = Brightwater itself (firmware / assembly) — never chargeable.",
          pk="supplier_id")
    write(spark, fqs, "supplier_lots", lots, T.StructType([
        S("lot_id", T.StringType()), S("supplier_id", T.StringType()), S("part_number", T.StringType()), S("component", T.StringType()),
        S("production_start", T.DateType()), S("production_end", T.DateType()), S("quantity", T.IntegerType()),
        S("conformal_coating", T.StringType()), S("pcn_reference", T.StringType()), S("ppap_status", T.StringType()),
        S("received_at_plant", T.DateType())]),
        "Component lots received at the Reno plant. lot_id = <prefix>-<yymm> of production (HX = Hanlin MC-48 controller, KC = Kessler MC-60 controller, AB = Ardent brake caliper, VB = Voltcell battery). pcn_reference = supplier process change notification that applies to the lot.",
        pk="lot_id")
    write(spark, fqs, "dealers", dealers, T.StructType([
        S("dealer_id", T.StringType()), S("dealer_name", T.StringType()), S("city", T.StringType()), S("state", T.StringType()),
        S("region", T.StringType()), S("wet_climate_index", T.DoubleType()), S("tier", T.StringType())]),
        "Authorized Brightwater dealers (sell, service, file warranty claims). wet_climate_index 0-1 (1 = Pacific Northwest rain).",
        pk="dealer_id")
    write(spark, fqs, "units", units, T.StructType([
        S("serial", T.StringType()), S("model_id", T.StringType()), S("build_date", T.DateType()), S("plant", T.StringType()),
        S("controller_part", T.StringType()), S("controller_lot", T.StringType()), S("controller_supplier_id", T.StringType()),
        S("brake_lot", T.StringType()), S("battery_lot", T.StringType()), S("firmware_version", T.StringType()),
        S("connected", T.BooleanType()), S("dealer_id", T.StringType()), S("region", T.StringType()), S("ship_date", T.DateType()),
        S("sale_date", T.DateType()), S("sold", T.BooleanType()), S("warranty_end", T.DateType()), S("avg_weekly_km", T.DoubleType())]),
        "Every bike built at the Reno plant since Oct-2024, with component-lot genealogy (controller / brake / battery lot), current firmware, whether it reports telemetry (connected), dealer + region, sale date and 24-month warranty end. sold=false = still in dealer stock.",
        pk="serial")
    write(spark, fqs, "warranty_claims", claims, T.StructType([
        S("claim_id", T.StringType()), S("serial", T.StringType()), S("model_id", T.StringType()), S("dealer_id", T.StringType()),
        S("region", T.StringType()), S("failure_date", T.DateType()), S("claim_date", T.DateType()), S("odometer_km", T.DoubleType()),
        S("days_in_service", T.IntegerType()), S("customer_complaint", T.StringType()), S("dealer_labor_code", T.StringType()),
        S("part_number_replaced", T.StringType()), S("part_cost", T.DoubleType()), S("labor_hours", T.DoubleType()),
        S("labor_cost", T.DoubleType()), S("total_cost", T.DoubleType()), S("claim_status", T.StringType()),
        S("technician_name", T.StringType()), S("technician_notes", T.StringType()), S("firmware_at_claim", T.StringType())]),
        "Dealer warranty claims. dealer_labor_code is the coarse code the technician picks (ELEC-GEN / MOTOR / BATT / BRAKE / DISPLAY / DRIVE / CHARGER / FRAME / OTHER) and is unreliable; technician_notes is free text — classified into failure modes by ai_classify (see claim_failure_modes). total_cost = parts + labor ($96/h) + fees.",
        pk="claim_id")
    write(spark, fqs, "telemetry_fault_events", telemetry, T.StructType([
        S("event_id", T.StringType()), S("serial", T.StringType()), S("event_date", T.DateType()), S("fault_code", T.StringType()),
        S("fault_description", T.StringType()), S("ambient_humidity_pct", T.DoubleType()), S("riding_in_rain", T.BooleanType())]),
        "Fault codes reported over the air by connected bikes. E21 = controller moisture / Hall-signal loss (leading indicator of water ingress), E07 controller overcurrent, E12 battery comms loss, E30 torque sensor, E04 low voltage.",
        pk="event_id")
    write(spark, fqs, "supplier_chargebacks", chargebacks, T.StructType([
        S("chargeback_id", T.StringType()), S("supplier_id", T.StringType()), S("quarter", T.StringType()),
        S("supplier_attributable_claims", T.IntegerType()), S("supplier_attributable_cost", T.DoubleType()),
        S("submitted_amount", T.DoubleType()), S("recovered_amount", T.DoubleType()), S("status", T.StringType())]),
        "Quarterly supplier cost recovery: warranty cost attributable to the supplier's part, what Brightwater submitted as a chargeback, and what the supplier paid. Supplier recovery rate = recovered / attributable.",
        pk="chargeback_id")
    write(spark, fqs, "failure_mode_catalog", [dict(failure_mode=k, label=v["label"], component=v["component"],
                                                    supplier_attributable=v["chargeable"]) for k, v in MODES.items()],
          T.StructType([S("failure_mode", T.StringType()), S("label", T.StringType()), S("component", T.StringType()),
                        S("supplier_attributable", T.BooleanType())]),
          "Failure-mode taxonomy used by ai_classify over technician notes. supplier_attributable = eligible for a supplier chargeback under the SQA.",
          pk="failure_mode")

    for stmt in [
        f"ALTER TABLE {fqs}.units ADD CONSTRAINT units_model_fk FOREIGN KEY (model_id) REFERENCES {fqs}.bike_models RELY",
        f"ALTER TABLE {fqs}.units ADD CONSTRAINT units_dealer_fk FOREIGN KEY (dealer_id) REFERENCES {fqs}.dealers RELY",
        f"ALTER TABLE {fqs}.units ADD CONSTRAINT units_ctrl_lot_fk FOREIGN KEY (controller_lot) REFERENCES {fqs}.supplier_lots RELY",
        f"ALTER TABLE {fqs}.warranty_claims ADD CONSTRAINT claims_unit_fk FOREIGN KEY (serial) REFERENCES {fqs}.units RELY",
        f"ALTER TABLE {fqs}.warranty_claims ADD CONSTRAINT claims_dealer_fk FOREIGN KEY (dealer_id) REFERENCES {fqs}.dealers RELY",
        f"ALTER TABLE {fqs}.telemetry_fault_events ADD CONSTRAINT telemetry_unit_fk FOREIGN KEY (serial) REFERENCES {fqs}.units RELY",
        f"ALTER TABLE {fqs}.supplier_lots ADD CONSTRAINT lots_supplier_fk FOREIGN KEY (supplier_id) REFERENCES {fqs}.suppliers RELY",
        f"ALTER TABLE {fqs}.supplier_chargebacks ADD CONSTRAINT chargebacks_supplier_fk FOREIGN KEY (supplier_id) REFERENCES {fqs}.suppliers RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
