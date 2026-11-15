"""
Halcyon Wireless (fictional Mountain-West regional carrier) — NOC copilot: synthetic network telemetry.

Self-contained plain Python file:
  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv), DATABRICKS_CONFIG_PROFILE=<profile>

    python generate_data.py --catalog telecommunications --schema network_ops_copilot

Writes two things:

1. Reference + history Delta tables (every *_ts column is Mountain local time):
     cell_sites              500 cell sites in 5 markets, each homed on one aggregation router
     transport_nodes         2 core routers, 14 aggregation routers, 1 microwave hub
     transport_links         backhaul links (primary / secondary fiber paths, microwave), with their route
     enterprise_site_coverage enterprise accounts, their SLA tier and the sites that serve them
     field_technicians       field workforce (skills, base, on shift, ETA to each market)
     planned_activity        maintenance windows, local events, 811 excavation notices, weather, utility outages
     trouble_tickets         12 months of closed NOC trouble tickets (MTTR, root cause, resolution notes)
     care_contacts_daily     customer-care contacts about the network, per site per day

2. RAW streaming telemetry landed as gzipped JSON in the UC volume <schema>.raw_telemetry —
   the Lakeflow Spark Declarative Pipeline (src/pipeline/*.sql) ingests it bronze → silver → gold:
     raw_telemetry/ran_kpis/   hourly per-cell RAN KPIs (1,500 cells x 28 days)
     raw_telemetry/alarms/     alarm events (cell sites + transport)
     raw_telemetry/optics/     15-minute optical / interface counters of every backhaul port

THE PLANTED SIGNALS (relative to the day the job runs, "D-0"; NOW = D-0 08:40):
  * Alarm storm. D-0 05:55:12 a contractor boring under W 38th Ave cuts the PRIMARY fiber of aggregation
    router AGG-DEN-04 (LNK-0407; LOS on BOTH ends = span cut). Traffic fails over to the SECONDARY path
    (LNK-0408, xe-0/1/1) — whose optic has been losing light for 12 days (-7.8 dBm → -21.6 dBm; "Rx power
    low" minor warnings on D-3, D-2, D-1 and D-0 00:15 were auto-acknowledged and never ticketed). Under
    full load it throws CRC errors and BFD drops at 05:57:40: AGG-DEN-04 is isolated. 64 of its 68 cell
    sites go down (the 4 with microwave backup to AGG-DEN-03 survive) → 457 alarms in ~8 minutes.
    Fastest restore = clean / replace the backup optic at the Wheat Ridge hut (~1 h), not the splice (~5 h).
  * Slow burn. Cell BLD-047-B (Boulder, US-36 / Table Mesa) dropped-call rate creeps from 0.55% to ~2.6% over
    21 days while VSWR climbs 1.25 → 1.86 (vendor alarm threshold 2.0) — no alarm ever fires; care
    complaints rise. Only the KPI anomaly model (src/ml/train_anomaly.py) sees it.
  * Decoys: DEN-205 (stadium) congestion on D-1 evening = a 55,000-seat concert (planned_activity); FTC-019
    outage 01:12-01:46 = a planned software upgrade window; PUE-007 microwave fade 02:21-02:44 = a severe
    thunderstorm warning; COS-042 on battery since 04:10 (utility outage, battery < 50% at 07:41 — real,
    needs a generator); DEN-221-A rising uplink interference (external source).
"""
from __future__ import annotations

import argparse
import math
import random
import os
import time
from datetime import date, datetime, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql import types as T

# Naive datetimes are Mountain local time; pin the Python process to UTC so Spark stores them verbatim
# (the Spark session is UTC on Databricks) — identical whether run as a job or via Databricks Connect.
os.environ["TZ"] = "UTC"
time.tzset()

SEED = 20260929
rng = random.Random(SEED)
AS_OF = date.today()
NOW = datetime(AS_OF.year, AS_OF.month, AS_OF.day, 8, 40)
KPI_DAYS = 28
OPTICS_DAYS = 14
STORM_TS = datetime(AS_OF.year, AS_OF.month, AS_OF.day, 5, 55, 12)
ISOLATED_TS = datetime(AS_OF.year, AS_OF.month, AS_OF.day, 5, 57, 40)


def D(n: int) -> date:
    return AS_OF - timedelta(days=n)


def ts(day: date, hh: int, mm: int, ss: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mm, ss)


def get_spark() -> SparkSession:
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
# Topology
# ─────────────────────────────────────────────────────────────────────────────
MARKETS = {  # market code -> (market name, centre lat, lon, city list)
    "DEN": ("Denver Metro", 39.74, -104.99, ["Denver", "Lakewood", "Wheat Ridge", "Arvada", "Aurora", "Englewood", "Westminster"]),
    "BLD": ("Boulder", 40.01, -105.27, ["Boulder", "Louisville", "Superior", "Lafayette"]),
    "FTC": ("Fort Collins", 40.58, -105.08, ["Fort Collins", "Loveland", "Windsor"]),
    "COS": ("Colorado Springs", 38.83, -104.82, ["Colorado Springs", "Fountain", "Monument"]),
    "PUE": ("Pueblo", 38.25, -104.61, ["Pueblo", "Pueblo West"]),
}
# aggregation router -> (market, first site #, last site #, hut / CO name)
AGG = {
    "AGG-DEN-01": ("DEN", 1, 40, "Englewood CO"),
    "AGG-DEN-02": ("DEN", 41, 80, "Aurora Hut 2"),
    "AGG-DEN-03": ("DEN", 81, 120, "Arvada Hut"),
    "AGG-DEN-04": ("DEN", 121, 188, "Wheat Ridge Hut"),
    "AGG-DEN-05": ("DEN", 189, 224, "Stadium District CO"),
    "AGG-DEN-06": ("DEN", 225, 260, "Westminster Hut"),
    "AGG-BLD-01": ("BLD", 1, 30, "Boulder CO"),
    "AGG-BLD-02": ("BLD", 31, 60, "Superior Hut"),
    "AGG-FTC-01": ("FTC", 1, 30, "Fort Collins CO"),
    "AGG-FTC-02": ("FTC", 31, 60, "Loveland Hut"),
    "AGG-COS-01": ("COS", 1, 30, "Colorado Springs CO"),
    "AGG-COS-02": ("COS", 31, 60, "Fountain Hut"),
    "AGG-COS-03": ("COS", 61, 90, "Monument Hut"),
    "AGG-PUE-01": ("PUE", 1, 30, "Pueblo CO"),
}
STORM_ROUTER = "AGG-DEN-04"
SURVIVORS = {"DEN-133", "DEN-147", "DEN-162", "DEN-179"}  # fiber + microwave backup to AGG-DEN-03
SLOW_CELL, SLOW_SITE = "BLD-047-B", "BLD-047"
STADIUM, INTERF_CELL, INTERF_SITE = "DEN-205", "DEN-221-A", "DEN-221"
POWER_SITE, MAINT_SITE, MW_SITE = "COS-042", "FTC-019", "PUE-007"
SPECIAL_NAMES = {
    "BLD-047": "Table Mesa / US-36", "DEN-205": "Stadium District (Mile High Arena)", "DEN-221": "Federal Blvd & 52nd",
    "COS-042": "Fountain Mesa Rd", "FTC-019": "Harmony Rd & Timberline", "PUE-007": "Pueblo West Ridge",
    "DEN-150": "Front Range Regional Hospital campus", "DEN-151": "Lutheran Pkwy", "DEN-166": "Jefferson Emergency Comms Center",
    "DEN-127": "Wheat Ridge Town Center", "DEN-138": "Kipling & I-70", "DEN-171": "Sloan's Lake", "DEN-184": "Olde Town Arvada",
}
STREETS = ["Colfax Ave", "Kipling St", "Wadsworth Blvd", "Federal Blvd", "Sheridan Blvd", "Alameda Ave", "Evans Ave", "Hampden Ave",
           "Broadway", "Santa Fe Dr", "Quebec St", "Havana St", "Peoria St", "Tower Rd", "88th Ave", "120th Ave", "Main St",
           "College Ave", "Academy Blvd", "Powers Blvd", "Northern Ave", "Baseline Rd", "Arapahoe Rd", "Iris Ave", "Harmony Rd"]
VENDORS = ["Ericsson", "Ericsson", "Nokia", "Samsung"]


def build_sites():
    sites = []
    for agg, (mkt, lo, hi, _) in AGG.items():
        mname, lat0, lon0, cities = MARKETS[mkt]
        for n in range(lo, hi + 1):
            sid = f"{mkt}-{n:03d}"
            r = random.Random(sid)
            backhaul = "fiber+microwave" if sid in SURVIVORS else ("microwave" if (mkt == "PUE" and n % 3 == 1) or sid == MW_SITE else "fiber")
            mw_node = "AGG-DEN-03" if sid in SURVIVORS else ("MW-PUE-HUB" if backhaul == "microwave" else None)
            subs = int(r.uniform(650, 1650) * (1.25 if mkt == "DEN" else 1.0))
            crit = {"DEN-150": "Hospital", "DEN-166": "911 PSAP (backup)", "DEN-205": "Stadium", "COS-042": None}.get(sid)
            if sid == STADIUM:
                subs = 2400
            if sid == SLOW_SITE:
                subs = 3400
            if sid == "DEN-150":
                subs = 1900
            sites.append(dict(
                site_id=sid, site_name=SPECIAL_NAMES.get(sid, f"{r.choice(STREETS)} {r.choice(['North', 'South', 'East', 'West', 'Central'])}"),
                market=mname, city=r.choice(cities), latitude=round(lat0 + r.uniform(-0.16, 0.16), 5), longitude=round(lon0 + r.uniform(-0.2, 0.2), 5),
                site_type="small_cell" if r.random() < 0.08 else "macro", structure=r.choice(["monopole", "lattice tower", "rooftop", "water tower"]),
                technology="LTE + 5G NR" if r.random() < 0.7 else "LTE", ran_vendor=r.choice(VENDORS),
                agg_router_id=agg, backhaul_type=backhaul, microwave_backup_node=mw_node, subscribers_served=subs,
                critical_facility=crit, battery_runtime_hours=round(r.uniform(4, 8), 1), has_generator=(r.random() < 0.35 and sid != POWER_SITE),
                vswr_alarm_threshold=2.0))
    return sites


def build_transport():
    nodes = [
        dict(node_id="CORE-DEN-01", node_type="core_router", market="Denver Metro", location="Denver Tech Center CO", vendor="Juniper", model="PTX10008", mgmt_ip="10.40.0.1"),
        dict(node_id="CORE-DEN-02", node_type="core_router", market="Denver Metro", location="Downtown Denver CO (Champa St)", vendor="Juniper", model="PTX10008", mgmt_ip="10.40.0.2"),
        dict(node_id="MW-PUE-HUB", node_type="microwave_hub", market="Pueblo", location="Pueblo Hill hub", vendor="Aviat", model="WTM 4800", mgmt_ip="10.46.9.1"),
    ]
    links = []
    for i, (agg, (mkt, lo, hi, hut)) in enumerate(AGG.items(), start=1):
        nodes.append(dict(node_id=agg, node_type="aggregation_router", market=MARKETS[mkt][0], location=hut, vendor="Juniper", model="MX204",
                          mgmt_ip=f"10.41.{i}.1"))
        k = f"{i:02d}"
        route_p = {"AGG-DEN-04": "Wheat Ridge Hut → W 38th Ave → Sheridan Blvd → I-25 → Denver Tech Center CO (aerial + buried, 14.2 km)"}.get(agg, f"{hut} → Denver Tech Center CO (buried)")
        route_s = {"AGG-DEN-04": "Wheat Ridge Hut → I-70 frontage → Downtown Denver CO (buried, diverse path, 11.8 km)"}.get(agg, f"{hut} → Downtown Denver CO (buried, diverse)")
        links.append(dict(link_id=f"LNK-{k}07", a_node=agg, a_interface="xe-0/1/0", z_node="CORE-DEN-01", z_interface=f"xe-2/0/{i % 8}",
                          link_type="fiber", role="primary", capacity_gbps=10, span_km=round(random.Random(agg).uniform(8, 60), 1) if agg != STORM_ROUTER else 14.2, route=route_p))
        links.append(dict(link_id=f"LNK-{k}08", a_node=agg, a_interface="xe-0/1/1", z_node="CORE-DEN-02", z_interface=f"xe-1/0/{i % 8}",
                          link_type="fiber", role="secondary", capacity_gbps=10, span_km=round(random.Random(agg + "s").uniform(8, 60), 1) if agg != STORM_ROUTER else 11.8, route=route_s))
    # AGG-DEN-04 is router #4 → its links are LNK-0407 (primary) and LNK-0408 (secondary)
    links.append(dict(link_id="MW-DEN-03-A", a_node="AGG-DEN-03", a_interface="ge-0/0/9", z_node="DEN-133,DEN-147,DEN-162,DEN-179", z_interface="mw",
                      link_type="microwave", role="backup", capacity_gbps=1, span_km=6.5, route="Arvada Hut microwave backup ring to 4 Wheat Ridge sites"))
    return nodes, links


ENTERPRISE = [  # account, sla tier, restore SLA hours, monthly recurring revenue, sites
    ("ENT-1001", "Front Range Regional Hospital", "platinum", 4, 186000, ["DEN-150", "DEN-151", "DEN-152"]),
    ("ENT-1002", "Mile High Metro Transit", "gold", 8, 94000, ["DEN-127", "DEN-138", "DEN-171", "DEN-199", "DEN-230"]),
    ("ENT-1003", "Wheat Ridge Unified Schools", "silver", 24, 21000, ["DEN-129", "DEN-141", "DEN-158"]),
    ("ENT-1004", "Summit Logistics Park", "gold", 8, 57000, ["DEN-176", "DEN-181", "DEN-044"]),
    ("ENT-1005", "Jefferson Emergency Communications", "platinum", 4, 38000, ["DEN-166"]),
    ("ENT-1006", "Aspen Grove Data Center", "gold", 8, 71000, ["DEN-012", "DEN-018"]),
    ("ENT-1007", "Flatirons University", "gold", 8, 64000, ["BLD-012", "BLD-047", "BLD-051"]),
    ("ENT-1008", "Pikes Peak Medical Group", "platinum", 4, 88000, ["COS-011", "COS-042"]),
    ("ENT-1009", "Poudre Valley Credit Union", "silver", 24, 12000, ["FTC-019", "FTC-022"]),
    ("ENT-1010", "Arkansas Valley Farms Co-op", "silver", 24, 8000, ["PUE-004", "PUE-007"]),
]

TECHS = [  # id, name, skill, base market, on shift, certifications
    ("FT-114", "Ray Delgado", "fiber_splicing", "Denver Metro", True, "OSP splicing crew 3 lead; OTDR"),
    ("FT-115", "Marisol Vega", "fiber_splicing", "Denver Metro", True, "OSP splicing crew 3; OTDR"),
    ("FT-121", "Priya Natarajan", "transport", "Denver Metro", True, "Juniper JNCIP; optics & fiber inspection"),
    ("FT-122", "Ben Okafor", "transport", "Denver Metro", False, "Juniper JNCIA"),
    ("FT-130", "Tom Brandt", "power", "Denver Metro", True, "Generator & DC plant"),
    ("FT-131", "Lena Park", "rf_tower", "Denver Metro", True, "Tower climb (ANSI/ASSP A10.48); RF sweep; spectrum analyzer"),
    ("FT-132", "Andre Silva", "rf_tower", "Denver Metro", True, "Tower climb (ANSI/ASSP A10.48); PIM/VSWR sweep"),
    ("FT-140", "Grace Holloway", "generalist", "Denver Metro", True, "Site maintenance"),
    ("FT-207", "Cole Brennan", "rf_tower", "Boulder", True, "Tower climb (ANSI/ASSP A10.48); line sweep (VSWR/DTF)"),
    ("FT-208", "Nadia Farouk", "rf_tower", "Boulder", True, "Tower climb (ANSI/ASSP A10.48)"),
    ("FT-210", "Evan Liu", "transport", "Boulder", False, "Optics"),
    ("FT-305", "Hector Ramos", "generalist", "Fort Collins", True, "Site maintenance"),
    ("FT-306", "Julia Brandt", "rf_tower", "Fort Collins", False, "Tower climb"),
    ("FT-402", "Marcus Webb", "power", "Colorado Springs", True, "Generator & DC plant; portable generator trailer G-7"),
    ("FT-403", "Aisha Coleman", "generalist", "Colorado Springs", True, "Site maintenance"),
    ("FT-405", "Dmitri Volkov", "rf_tower", "Colorado Springs", True, "Tower climb"),
    ("FT-501", "Rosa Jimenez", "microwave", "Pueblo", True, "Microwave alignment"),
    ("FT-502", "Kyle Stone", "generalist", "Pueblo", False, "Site maintenance"),
]
ETA_MIN = {  # base market -> market -> drive minutes
    "Denver Metro": {"Denver Metro": 25, "Boulder": 40, "Fort Collins": 75, "Colorado Springs": 80, "Pueblo": 120},
    "Boulder": {"Denver Metro": 40, "Boulder": 20, "Fort Collins": 55, "Colorado Springs": 110, "Pueblo": 150},
    "Fort Collins": {"Denver Metro": 70, "Boulder": 55, "Fort Collins": 20, "Colorado Springs": 140, "Pueblo": 180},
    "Colorado Springs": {"Denver Metro": 80, "Boulder": 110, "Fort Collins": 140, "Colorado Springs": 20, "Pueblo": 50},
    "Pueblo": {"Denver Metro": 120, "Boulder": 150, "Fort Collins": 180, "Colorado Springs": 50, "Pueblo": 20},
}


def build_planned():
    rows = [
        dict(activity_id="CO811-262710455", activity_type="third_party_excavation", market="Denver Metro", site_ids=None, node_ids=None,
             location="W 38th Ave & Sheridan Blvd, Wheat Ridge", start_ts=ts(D(0), 5, 30), end_ts=ts(D(0), 15, 0),
             description="811 locate ticket: Front Range Utility Contractors — horizontal directional boring for a water main under W 38th Ave. "
                         "Halcyon buried fiber marked 'in conflict zone' (route LNK-0407)."),
        dict(activity_id="CR-88213", activity_type="maintenance_window", market="Fort Collins", site_ids="FTC-019", node_ids=None,
             location="Harmony Rd & Timberline", start_ts=ts(D(0), 1, 0), end_ts=ts(D(0), 3, 0),
             description="Planned baseband software upgrade 23.Q4 → 24.Q2 on FTC-019 (all sectors). Expected outage up to 45 min. Approved by RAN change board."),
        dict(activity_id="EVT-2291", activity_type="local_event", market="Denver Metro", site_ids="DEN-205,DEN-206,DEN-207", node_ids=None,
             location="Mile High Arena, Stadium District", start_ts=ts(D(1), 17, 30), end_ts=ts(D(1), 23, 30),
             description="Concert, 55,000 attendees. Capacity plan: COW-3 (cell on wheels) deployed, temporary carrier added on DEN-205. Expect congestion 19:00-23:00."),
        dict(activity_id="NWS-PUE-0928", activity_type="weather_advisory", market="Pueblo", site_ids=None, node_ids="MW-PUE-HUB",
             location="Pueblo County", start_ts=ts(D(0), 1, 50), end_ts=ts(D(0), 3, 30),
             description="National Weather Service severe thunderstorm warning: heavy rain (2 in/h), hail. Microwave rain fade expected on 18/23 GHz links."),
        dict(activity_id="UTIL-CSU-55410", activity_type="utility_outage", market="Colorado Springs", site_ids="COS-042", node_ids=None,
             location="Fountain Mesa Rd", start_ts=ts(D(0), 4, 5), end_ts=ts(D(0), 13, 0),
             description="Utility-reported outage (transformer failure), estimated restoration 13:00. Site COS-042 has no fixed generator."),
    ]
    for k in range(9):  # routine, unrelated maintenance
        d = D(rng.randint(2, 20))
        s = f"{rng.choice(['DEN', 'COS', 'FTC', 'BLD'])}-{rng.randint(1, 30):03d}"
        rows.append(dict(activity_id=f"CR-{88100 + k}", activity_type="maintenance_window", market={"DEN": "Denver Metro", "COS": "Colorado Springs", "FTC": "Fort Collins", "BLD": "Boulder"}[s[:3]],
                         site_ids=s, node_ids=None, location="", start_ts=ts(d, 1, 0), end_ts=ts(d, 4, 0), description="Routine RAN parameter / software maintenance."))
    return rows


# Historical trouble tickets — resolution notes feed ai_classify (src/pipeline gold / queue task).
TT_CATS = [  # category, share, team, mttr median h, note templates
    ("fiber_cut", 0.09, "OSP / fiber", 5.8, [
        "Backhoe dig-in on {road}; both ends LOS. Splice crew restored {n} fibers. {warn}",
        "Fiber span cut by third-party boring near {road}, 811 ticket was open. Emergency splice. {warn}"]),
    ("optics_degradation", 0.07, "Transport", 2.1, [
        "Rx power drifted to {dbm} dBm on {port}; dirty connector cleaned and SFP+ replaced. {warn}",
        "CRC errors under load on {port}; optic at end of life, replaced. {warn}"]),
    ("power", 0.21, "Power / field ops", 3.4, [
        "Utility outage; site ran on batteries {h} h; portable generator dispatched. {warn}",
        "Rectifier module failure, batteries depleted, site dropped. Rectifier replaced. {warn}"]),
    ("rf_hardware", 0.18, "RAN field ops", 9.5, [
        "High VSWR on sector {sec}; water ingress in jumper at antenna, jumper replaced after climb. {warn}",
        "RRU failure on sector {sec}; unit swapped. {warn}"]),
    ("software", 0.14, "RAN engineering", 1.6, [
        "Baseband process crash after parameter push; rolled back. {warn}",
        "Cell lock after failed upgrade; re-applied package. {warn}"]),
    ("interference", 0.06, "RF engineering", 30.0, [
        "Uplink interference {dbm} dBm traced to a faulty signal booster at a nearby business; owner notified. {warn}",
        "External interference hunt with spectrum analyzer, source: illegal jammer in vehicle. {warn}"]),
    ("microwave", 0.08, "Transport", 1.2, [
        "Microwave rain fade during storm, link recovered without intervention. {warn}",
        "Microwave dish misaligned by high wind, realigned. {warn}"]),
    ("planned_work_overrun", 0.07, "Change management", 1.9, [
        "Maintenance window overran; alarms expected, no customer tickets. {warn}",
        "Upgrade took longer than the approved window, site back after reboot. {warn}"]),
    ("congestion", 0.10, "RF engineering", 4.0, [
        "Event traffic exceeded capacity; COW deployed for next event. {warn}",
        "Sustained PRB utilization > 90% at busy hour; capacity carrier added. {warn}"]),
]
WARN_YES = ["Minor warnings had been raised {d} days earlier and were auto-acknowledged without a ticket.",
            "Low-level alarms were present for {d} days before the outage but never escalated.",
            "Early-warning threshold crossed {d} days prior; no one acted on it."]
WARN_NO = ["No prior warning.", "Sudden failure, no precursor alarms.", ""]


def build_tickets():
    out, n = [], 0
    for cat, share, team, mttr, notes in TT_CATS:
        for _ in range(int(1300 * share)):
            n += 1
            d = AS_OF - timedelta(days=rng.randint(3, 365))
            opened = ts(d, rng.randint(0, 23), rng.randint(0, 59))
            m = max(0.3, rng.lognormvariate(math.log(mttr), 0.45))
            mkt = rng.choices(list(MARKETS), weights=[52, 12, 12, 18, 6])[0]
            agg = rng.choice([a for a, v in AGG.items() if v[0] == mkt])
            lo, hi = AGG[agg][1], AGG[agg][2]
            transport = cat in ("fiber_cut", "optics_degradation", "microwave")
            sites_aff = rng.randint(3, 40) if transport and rng.random() < 0.6 else 1
            warned = cat in ("fiber_cut", "optics_degradation", "power", "rf_hardware") and rng.random() < {"optics_degradation": 0.62, "rf_hardware": 0.48, "power": 0.3, "fiber_cut": 0.18}[cat]
            if cat == "fiber_cut" and sites_aff > 10 and warned:
                m *= 1.4  # dual-path events (backup already degraded) take longer
            warn = rng.choice(WARN_YES).format(d=rng.randint(2, 14)) if warned else rng.choice(WARN_NO)
            note = rng.choice(notes).format(road=rng.choice(STREETS), n=rng.choice([24, 48, 96, 144]), dbm=round(rng.uniform(-23, -17), 1),
                                            port=rng.choice(["xe-0/1/0", "xe-0/1/1", "et-0/0/2"]), h=round(rng.uniform(2, 7), 1), sec=rng.choice("ABC"), warn=warn).strip()
            dup = sites_aff if (transport and sites_aff > 5 and d < AS_OF - timedelta(days=120)) else 0  # pre-correlation era: one ticket per site
            out.append(dict(ticket_id=f"TT-{d.year}-{40000 + n:05d}", category=cat, priority="P1" if sites_aff >= 20 else ("P2" if sites_aff > 1 or cat == "power" else rng.choice(["P2", "P3", "P3", "P4"])),
                            market=MARKETS[mkt][0], site_id=f"{mkt}-{rng.randint(lo, hi):03d}" if sites_aff == 1 else None, node_id=agg if transport else None,
                            opened_ts=opened, restored_ts=opened + timedelta(hours=m), closed_ts=opened + timedelta(hours=m + rng.uniform(0.5, 30)),
                            mttr_hours=round(m, 2), sites_affected=sites_aff, subscribers_affected=int(sites_aff * rng.uniform(700, 1500)),
                            alarms_correlated=sites_aff * rng.randint(4, 8), duplicate_tickets_opened=dup, assigned_team=team,
                            resolution_notes=note))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Alarms
# ─────────────────────────────────────────────────────────────────────────────
ALARM_COLS = [("alarm_id", "string"), ("raised_ts", "string"), ("cleared_ts", "string"), ("node_type", "string"), ("node_id", "string"),
              ("site_id", "string"), ("cell_id", "string"), ("interface", "string"), ("alarm_code", "string"), ("alarm_name", "string"),
              ("severity", "string"), ("probable_cause", "string"), ("acknowledged_by", "string"), ("additional_text", "string")]
BG_ALARMS = [  # code, name, severity, cause, duration min range
    ("ENV-TEMP-HI", "Cabinet temperature high", "minor", "Environmental", (10, 90)),
    ("ENV-DOOR", "Cabinet door open", "warning", "Environmental", (5, 40)),
    ("RAN-RET-COMM", "RET communication fault", "minor", "Equipment", (2, 30)),
    ("RAN-CLK-DRIFT", "Clock drift above threshold", "minor", "Timing", (1, 15)),
    ("RAN-FAN", "Fan speed degraded", "minor", "Equipment", (20, 240)),
    ("RAN-IMBAL", "Cell traffic load imbalance", "warning", "Performance", (15, 120)),
    ("TRN-LINK-FLAP", "Interface flap (auto-recovered)", "minor", "Transport", (1, 4)),
    ("PWR-RECT-MINOR", "Rectifier module minor fault", "minor", "Power", (30, 300)),
]
SITE_STORM_ALARMS = [  # code, name, severity, cause, per-cell?
    ("TRN-CSR-BFD", "Cell site router BFD session down", "major", "Transport", False),
    ("RAN-S1-DOWN", "S1 link down (MME unreachable)", "critical", "Transport", False),
    ("RAN-X2-DOWN", "X2 link down", "major", "Transport", False),
    ("SYNC-PTP-LOSS", "PTP synchronization loss", "major", "Timing", False),
    ("RAN-CELL-UNAVAIL", "Cell unavailable", "critical", "Service", True),
]


def fmt(t: datetime | None) -> str | None:
    return t.strftime("%Y-%m-%d %H:%M:%S") if t else None


def build_alarms(sites):
    rows = []
    aid = [700000]

    def add(raised, cleared, node_type, node_id, code, name, sev, cause, site_id=None, cell_id=None, iface=None, ack=None, text=None):
        aid[0] += 1
        rows.append(dict(alarm_id=f"ALM-{aid[0]}", raised_ts=fmt(raised), cleared_ts=fmt(cleared), node_type=node_type, node_id=node_id, site_id=site_id,
                         cell_id=cell_id, interface=iface, alarm_code=code, alarm_name=name, severity=sev, probable_cause=cause,
                         acknowledged_by=ack, additional_text=text))

    # background: ~130 minor / warning alarms a day, all auto-clear (never in the incident queue)
    site_ids = [s["site_id"] for s in sites]
    storm_sites = {s["site_id"] for s in sites if s["agg_router_id"] == STORM_ROUTER}
    start = datetime.combine(D(KPI_DAYS - 1), datetime.min.time())
    t = start
    while t < NOW - timedelta(minutes=20):
        t += timedelta(minutes=rng.expovariate(1 / 11))
        code, name, sev, cause, (a, b) = rng.choice(BG_ALARMS)
        sid = rng.choice(site_ids)
        if t > NOW - timedelta(minutes=5):
            break
        if sid in (SLOW_SITE, INTERF_SITE) or (sid in storm_sites and t > STORM_TS - timedelta(minutes=30)):
            continue
        cl = t + timedelta(minutes=rng.uniform(a, b))
        add(t, cl if cl < NOW else None, "cell_site", sid, code, name, sev, cause, site_id=sid, ack=rng.choice([None, "noc-tier1 (auto-ack)"]))
    # background transport flaps on routers (minor, auto-recovered) — none on AGG-DEN-04 xe-0/1/1 (its story is below)
    for _ in range(60):
        t = start + timedelta(minutes=rng.uniform(0, (NOW - start).total_seconds() / 60 - 600))
        agg = rng.choice(list(AGG))
        add(t, t + timedelta(minutes=rng.uniform(1, 3)), "aggregation_router", agg, "TRN-LINK-FLAP", "Interface flap (auto-recovered)", "minor", "Transport",
            iface=rng.choice(["ge-0/0/3", "ge-0/0/5", "xe-0/1/0"]), ack="noc-tier1 (auto-ack)")

    # the ignored early warnings: AGG-DEN-04 xe-0/1/1 losing light (threshold -18 dBm)
    for d, hh, mm, dur, dbm in [(3, 13, 5, 35, -18.1), (2, 9, 10, 112, -19.2), (1, 7, 22, 260, -20.4), (0, 0, 15, None, -21.3)]:
        r = ts(D(d), hh, mm)
        add(r, r + timedelta(minutes=dur) if dur else None, "aggregation_router", STORM_ROUTER, "OPT-RX-LOW", "Optical Rx power low (warning threshold -18 dBm)",
            "minor", "Transport", iface="xe-0/1/1", ack="noc-tier1 (auto-ack)", text=f"LNK-0408 secondary path to CORE-DEN-02; rx {dbm} dBm")

    # ── the storm ──
    s = STORM_TS
    add(s, None, "aggregation_router", STORM_ROUTER, "OPT-LOS", "Loss of signal (LOS)", "critical", "Transport", iface="xe-0/1/0", text="LNK-0407 primary path to CORE-DEN-01; rx -40.0 dBm")
    add(s, None, "core_router", "CORE-DEN-01", "OPT-LOS", "Loss of signal (LOS)", "critical", "Transport", iface="xe-2/0/4", text="LNK-0407 far end (AGG-DEN-04); rx -40.0 dBm")
    add(s + timedelta(seconds=1), None, "aggregation_router", STORM_ROUTER, "TRN-LAG-MEMBER", "LAG ae1 member down", "major", "Transport", iface="xe-0/1/0", text="ae1 1/2 members up")
    add(s + timedelta(seconds=2), None, "aggregation_router", STORM_ROUTER, "TRN-BGP-DOWN", "BGP neighbor down", "major", "Transport", text="neighbor 10.40.0.1 (CORE-DEN-01)")
    add(s + timedelta(seconds=53), None, "aggregation_router", STORM_ROUTER, "TRN-CRC-HIGH", "Interface CRC error rate high", "major", "Transport", iface="xe-0/1/1",
        text="LNK-0408 carrying full load after failover; 1.9e-4 errored frames")
    i = ISOLATED_TS
    add(i, None, "aggregation_router", STORM_ROUTER, "TRN-BFD-DOWN", "BFD session down", "critical", "Transport", iface="xe-0/1/1", text="to CORE-DEN-02; LNK-0408 rx -21.6 dBm, 184k CRC errors in 2 min under failover load")
    add(i + timedelta(seconds=1), None, "aggregation_router", STORM_ROUTER, "TRN-LAG-DOWN", "LAG ae1 down (0/2 members up)", "critical", "Transport", iface="ae1")
    add(i + timedelta(seconds=3), None, "core_router", "CORE-DEN-02", "TRN-BGP-DOWN", "BGP neighbor down", "major", "Transport", text="neighbor AGG-DEN-04 (10.41.4.1)")
    add(i + timedelta(seconds=5), None, "aggregation_router", STORM_ROUTER, "TRN-NODE-ISOLATED", "Node unreachable from NMS", "critical", "Transport", text="management plane lost")
    victims = [x for x in sites if x["agg_router_id"] == STORM_ROUTER and x["site_id"] not in SURVIVORS]
    for k, site in enumerate(victims):
        t0 = i + timedelta(seconds=4 + k * 5 + rng.uniform(0, 4))
        for code, name, sev, cause, per_cell in SITE_STORM_ALARMS:
            for sec in ("ABC" if per_cell else [None]):
                add(t0 + timedelta(seconds=rng.uniform(0, 40)), None, "cell_site", site["site_id"], code, name, sev, cause,
                    site_id=site["site_id"], cell_id=f"{site['site_id']}-{sec}" if sec else None)

    # ── decoys / other incidents ──
    add(ts(D(0), 1, 12, 4), ts(D(0), 1, 46, 30), "cell_site", MAINT_SITE, "RAN-SW-UPG", "Software upgrade in progress", "warning", "Maintenance", site_id=MAINT_SITE, text="CR-88213")
    for sec in "ABC":
        add(ts(D(0), 1, 12, 30), ts(D(0), 1, 46, 10), "cell_site", MAINT_SITE, "RAN-CELL-UNAVAIL", "Cell unavailable", "critical", "Service", site_id=MAINT_SITE, cell_id=f"{MAINT_SITE}-{sec}")
    add(ts(D(0), 2, 21, 40), ts(D(0), 2, 44, 5), "cell_site", MW_SITE, "MW-RSL-LOW", "Microwave RSL below threshold", "major", "Transport", site_id=MW_SITE, text="RSL -71 dBm (threshold -65)")
    add(ts(D(0), 2, 26, 12), ts(D(0), 2, 39, 50), "cell_site", MW_SITE, "MW-LINK-DOWN", "Microwave link down", "critical", "Transport", site_id=MW_SITE, text="to MW-PUE-HUB")
    add(ts(D(0), 2, 26, 30), ts(D(0), 2, 40, 20), "cell_site", MW_SITE, "RAN-S1-DOWN", "S1 link down (MME unreachable)", "critical", "Transport", site_id=MW_SITE)
    add(ts(D(0), 4, 10, 22), None, "cell_site", POWER_SITE, "PWR-AC-FAIL", "AC mains failure", "major", "Power", site_id=POWER_SITE)
    add(ts(D(0), 4, 10, 30), None, "cell_site", POWER_SITE, "PWR-ON-BATT", "Rectifier plant on battery", "major", "Power", site_id=POWER_SITE, text="runtime estimate 4.4 h at current load")
    add(ts(D(0), 7, 41, 5), None, "cell_site", POWER_SITE, "PWR-BATT-LOW", "Battery capacity below 50%", "critical", "Power", site_id=POWER_SITE, text="48% remaining, 51.2 V")
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# RAN KPIs (Spark-native, hash-based deterministic noise)
# ─────────────────────────────────────────────────────────────────────────────
PROFILE = [0.18, 0.12, 0.09, 0.08, 0.09, 0.16, 0.33, 0.55, 0.70, 0.74, 0.78, 0.82,
           0.86, 0.84, 0.82, 0.84, 0.90, 0.97, 1.00, 0.96, 0.86, 0.70, 0.50, 0.30]


def u(*cols, salt: str):
    """Deterministic uniform [0,1) from a hash of the given columns."""
    return (F.abs(F.xxhash64(*cols, F.lit(salt))) % 1000003) / F.lit(1000003.0)


def build_kpis(spark, sites):
    start = datetime.combine(D(KPI_DAYS - 1), datetime.min.time())
    n_hours = int((NOW.replace(minute=0) - start).total_seconds() // 3600) + 1
    cells = spark.createDataFrame(
        [(s["site_id"], sec, f"{s['site_id']}-{sec}", s["subscribers_served"], s["site_id"] in SURVIVORS, s["agg_router_id"]) for s in sites for sec in "ABC"],
        "site_id string, sector string, cell_id string, subs int, survivor boolean, agg string")
    hours = spark.range(n_hours).withColumn("ts", F.lit(start) + F.make_interval(F.lit(0), F.lit(0), F.lit(0), F.lit(0), F.col("id").cast("int")))
    df = cells.crossJoin(hours.select("ts"))
    prof = F.element_at(F.array(*[F.lit(p) for p in PROFILE]), F.hour("ts") + 1)
    day_idx = F.datediff(F.to_date("ts"), F.lit(D(0)))  # 0 = D-0, negative = past
    c = F.col
    base_drop = 0.35 + 0.45 * u(c("cell_id"), salt="bd")
    base_rrc = 99.2 + 0.55 * u(c("cell_id"), salt="br")
    base_sinr = 8 + 8 * u(c("cell_id"), salt="bs")
    base_rsrp = -97 + 11 * u(c("cell_id"), salt="bp")
    base_vswr = 1.15 + 0.2 * u(c("cell_id"), salt="bv")
    base_ul = -110 + 5 * u(c("cell_id"), salt="bu")
    base_prb = 28 + 30 * u(c("cell_id"), salt="bb")
    n1, n2, n3, n4, n5, n6 = (u(c("cell_id"), c("ts"), salt=f"n{k}") for k in range(1, 7))

    # planted: slow burn on BLD-047-B (21 days)
    k = F.greatest(F.lit(0.0), (day_idx + 21 + F.hour("ts") / 24.0) / 21.0)
    slow = c("cell_id") == SLOW_CELL
    # planted: DEN-221-A uplink interference ramp (6 days)
    ki = F.greatest(F.lit(0.0), (day_idx + 6 + F.hour("ts") / 24.0) / 6.0)
    interf = c("cell_id") == INTERF_CELL
    # planted: stadium concert D-1 19:00-23:00
    event = (c("site_id") == STADIUM) & (day_idx == -1) & (F.hour("ts").between(19, 23))
    # planted: storm (D-0, from 05:57), maintenance (FTC-019 01:00 hour), microwave fade (PUE-007 02:00 hour)
    storm_down = (c("agg") == STORM_ROUTER) & (~c("survivor")) & (day_idx == 0) & (F.hour("ts") >= 6)
    storm_part = (c("agg") == STORM_ROUTER) & (~c("survivor")) & (day_idx == 0) & (F.hour("ts") == 5)
    maint = (c("site_id") == MAINT_SITE) & (day_idx == 0) & (F.hour("ts") == 1)
    mw = (c("site_id") == MW_SITE) & (day_idx == 0) & (F.hour("ts") == 2)

    avail = (F.when(storm_down, 0.0).when(storm_part, 95.0).when(maint, 43.0).when(mw, 77.0)
             .otherwise(F.when(n6 < 0.002, 96.5).otherwise(100.0)))
    users = c("subs") / 3.0 * prof * (0.9 + 0.2 * n1) * F.when(event, 4.2).otherwise(1.0)
    calls = F.round(users * 0.42 * (0.9 + 0.2 * n2) * avail / 100.0)
    drop = (base_drop * (0.85 + 0.3 * n3)
            + F.when(slow, 2.05 * F.pow(F.least(k, F.lit(1.0)), 1.3)).otherwise(0.0)
            + F.when(interf, 0.75 * F.least(ki, F.lit(1.0))).otherwise(0.0)
            + F.when(event, 0.9).otherwise(0.0))
    rrc = (base_rrc - 0.25 * n4 - F.when(slow, 1.2 * F.least(k, F.lit(1.0))).otherwise(0.0)
           - F.when(interf, 1.8 * F.least(ki, F.lit(1.0))).otherwise(0.0) - F.when(event, 6.1).otherwise(0.0))
    sinr = base_sinr + 1.2 * (n5 - 0.5) - F.when(slow, 2.6 * F.least(k, F.lit(1.0))).otherwise(0.0) - F.when(interf, 3.4 * F.least(ki, F.lit(1.0))).otherwise(0.0) - F.when(event, 2.5).otherwise(0.0)
    vswr = base_vswr + 0.03 * n4 + F.when(slow, 0.61 * F.least(k, F.lit(1.0))).otherwise(0.0)
    ul = base_ul + 1.5 * (n1 - 0.5) + F.when(interf, 12.0 * F.least(ki, F.lit(1.0))).otherwise(0.0) + F.when(event, 3.0).otherwise(0.0)
    prb = F.least(F.lit(99.0), base_prb * prof * 1.6 * (0.9 + 0.2 * n5) * F.when(event, 2.1).otherwise(1.0))
    down = storm_down
    df = df.select(
        "cell_id", "site_id", "sector", F.date_format("ts", "yyyy-MM-dd HH:mm:ss").alias("ts"),
        F.round(avail, 2).alias("availability_pct"),
        calls.cast("int").alias("voice_calls"),
        F.round(calls * drop / 100.0).cast("int").alias("dropped_calls"),
        F.when(down, None).otherwise(F.round(drop, 3)).alias("drop_call_rate_pct"),
        F.when(down, None).otherwise(F.round(F.least(rrc, F.lit(100.0)), 3)).alias("rrc_setup_success_pct"),
        F.when(down, None).otherwise(F.round(sinr, 2)).alias("avg_sinr_db"),
        F.when(down, None).otherwise(F.round(base_rsrp + 2 * (n2 - 0.5), 1)).alias("avg_rsrp_dbm"),
        F.when(down, None).otherwise(F.round(vswr, 3)).alias("vswr"),
        F.when(down, None).otherwise(F.round(ul, 1)).alias("ul_interference_dbm"),
        F.round(prb * avail / 100.0, 1).alias("prb_utilization_pct"),
        F.round(users * 0.035 * (0.8 + 0.4 * n6) * avail / 100.0, 2).alias("data_volume_gb"),
        F.round(users * avail / 100.0).cast("int").alias("active_users"),
    )
    return df


def build_optics(spark):
    start = datetime.combine(D(OPTICS_DAYS - 1), datetime.min.time())
    n = int((NOW - start).total_seconds() // 900) + 1
    ports = []
    for i, agg in enumerate(AGG, start=1):
        k = f"{i:02d}"
        ports += [(agg, "xe-0/1/0", f"LNK-{k}07", "primary"), (agg, "xe-0/1/1", f"LNK-{k}08", "secondary"),
                  ("CORE-DEN-01", f"xe-2/0/{i % 8}", f"LNK-{k}07", "primary_far_end"), ("CORE-DEN-02", f"xe-1/0/{i % 8}", f"LNK-{k}08", "secondary_far_end")]
    p = spark.createDataFrame(ports, "node_id string, interface string, link_id string, role string")
    t = spark.range(n).withColumn("ts", F.lit(start) + F.make_interval(F.lit(0), F.lit(0), F.lit(0), F.lit(0), F.lit(0), (F.col("id") * 15).cast("int")))
    df = p.crossJoin(t.select("ts"))
    c = F.col
    base_rx = -9.5 + 4 * u(c("node_id"), c("interface"), salt="rx")
    noise = 0.3 * (u(c("node_id"), c("interface"), c("ts"), salt="rn") - 0.5)
    storm_p = c("link_id") == "LNK-0407"
    storm_s = c("link_id") == "LNK-0408"
    storm_s_near = storm_s & (c("node_id") == STORM_ROUTER)
    after_cut = c("ts") >= F.lit(STORM_TS)
    after_iso = c("ts") >= F.lit(ISOLATED_TS)
    degr_start = datetime.combine(D(12), datetime.min.time())
    frac = (F.unix_timestamp("ts") - F.unix_timestamp(F.lit(degr_start))) / F.lit((STORM_TS - degr_start).total_seconds())
    frac = F.least(F.lit(1.0), F.greatest(F.lit(0.0), frac))
    # primary: span cut → no light on BOTH ends. secondary: light still there but marginal (-21.6 dBm at the
    # router end) — the port went down on CRC errors / BFD timeouts under failover load, not on loss of light.
    rx = (F.when(storm_p & after_cut, -40.0)
          .when(storm_s_near, -7.8 + (-13.8) * F.pow(frac, 1.6) + noise)
          .otherwise(base_rx + noise))
    hour = F.hour("ts")
    prof = F.element_at(F.array(*[F.lit(x) for x in PROFILE]), hour + 1)
    util_base = F.when(c("role").startswith("primary"), 38 * prof + 4).otherwise(3.0)
    util = (F.when((storm_p | storm_s) & after_iso, 0.0).when(storm_p & after_cut, 0.0).when(storm_s & after_cut, 96.5).otherwise(util_base * (0.9 + 0.2 * (noise + 0.15) / 0.3)))
    crc = (F.when(storm_s & after_cut & ~after_iso, 184000).when(storm_s_near & (frac > 0.75), F.round(40 * frac * frac)).otherwise(0))
    status = F.when((storm_p & after_cut) | (storm_s & after_iso), "down").otherwise("up")
    return df.select("node_id", "interface", "link_id", F.date_format("ts", "yyyy-MM-dd HH:mm:ss").alias("ts"),
                     F.round(rx, 2).alias("rx_power_dbm"), F.round(F.when(status == "down", F.lit(-2.1)).otherwise(-2.4 + noise), 2).alias("tx_power_dbm"),
                     F.round(util, 1).alias("utilization_pct"), crc.cast("long").alias("crc_errors"), status.alias("oper_status"))


def build_care(sites):
    rows = []
    for s in sites:
        r = random.Random(s["site_id"] + "care")
        base = s["subscribers_served"] / 1400
        for d in range(KPI_DAYS):
            day = D(d)
            n = int(r.random() * 2.2 * base)
            dc = int(r.random() * 1.2 * base)
            if s["site_id"] == SLOW_SITE and d <= 16:
                dc += int((17 - d) * 0.55) + r.randint(0, 1)
                n += dc
            if s["agg_router_id"] == STORM_ROUTER and s["site_id"] not in SURVIVORS and d == 0:
                n += r.randint(3, 9)
            if s["site_id"] == STADIUM and d == 1:
                n += 11
            rows.append(dict(site_id=s["site_id"], day=day, network_complaints=n, dropped_call_complaints=dc))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
def write(spark, fqs, name, df, comment, pk=None):
    fq = f"{fqs}.{name}"
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {spark.table(fq).count():,} rows")


def rows_df(spark, rows, ddl):
    cols = [c.strip().split(" ")[0] for c in ddl.split(",")]
    return spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], ddl)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="telecommunications")
    ap.add_argument("--schema", default="network_ops_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Halcyon Wireless NOC copilot demo (synthetic network telemetry)'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.raw_telemetry COMMENT 'Landing zone for streaming RAN KPIs, alarms and optics counters (JSON) — ingested by the SDP pipeline'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.noc_runbooks COMMENT 'NOC runbooks - documents searched by the Genie agent'")
    raw = f"/Volumes/{args.catalog}/{args.schema}/raw_telemetry"
    print(f"AS_OF={AS_OF} NOW={NOW}")

    sites = build_sites()
    nodes, links = build_transport()
    write(spark, fqs, "cell_sites", rows_df(spark, sites,
          "site_id string, site_name string, market string, city string, latitude double, longitude double, site_type string, structure string, "
          "technology string, ran_vendor string, agg_router_id string, backhaul_type string, microwave_backup_node string, subscribers_served int, "
          "critical_facility string, battery_runtime_hours double, has_generator boolean, vswr_alarm_threshold double"),
          "Halcyon Wireless cell sites (3 sectors A/B/C each). agg_router_id = the aggregation router the site backhauls through; "
          "backhaul_type fiber | fiber+microwave (has a microwave backup path via microwave_backup_node) | microwave.", pk="site_id")
    write(spark, fqs, "transport_nodes", rows_df(spark, nodes, "node_id string, node_type string, market string, location string, vendor string, model string, mgmt_ip string"),
          "Transport / IP backhaul nodes: core routers, aggregation routers (each serves 30-68 cell sites) and a microwave hub.", pk="node_id")
    write(spark, fqs, "transport_links", rows_df(spark, links,
          "link_id string, a_node string, a_interface string, z_node string, z_interface string, link_type string, role string, capacity_gbps int, span_km double, route string"),
          "Backhaul links. Every aggregation router has a PRIMARY fiber (xe-0/1/0 → CORE-DEN-01) and a diverse SECONDARY fiber (xe-0/1/1 → CORE-DEN-02) in LAG ae1. route = the physical path.",
          pk="link_id")
    ent = [dict(account_id=a, account_name=n, sla_tier=t, restore_sla_hours=h, mrr_usd=m, site_id=s) for a, n, t, h, m, ss in ENTERPRISE for s in ss]
    write(spark, fqs, "enterprise_site_coverage", rows_df(spark, ent, "account_id string, account_name string, sla_tier string, restore_sla_hours int, mrr_usd int, site_id string"),
          "Enterprise accounts and the cell sites that serve them. restore_sla_hours = contractual restoration time; platinum accounts must be notified within 30 minutes of an outage.")
    techs = [dict(tech_id=t, name=n, skill=s, base_market=m, on_shift=o, certifications=c, **{f"eta_min_{k.split()[0].lower()}": v for k, v in ETA_MIN[m].items()})
             for t, n, s, m, o, c in TECHS]
    write(spark, fqs, "field_technicians", rows_df(spark, techs,
          "tech_id string, name string, skill string, base_market string, on_shift boolean, certifications string, eta_min_denver int, eta_min_boulder int, "
          "eta_min_fort int, eta_min_colorado int, eta_min_pueblo int"),
          "Field workforce. skill: fiber_splicing | transport | rf_tower | power | microwave | generalist. eta_min_<market> = drive time from base to that market "
          "(denver = Denver Metro, fort = Fort Collins, colorado = Colorado Springs).", pk="tech_id")
    write(spark, fqs, "planned_activity", rows_df(spark, build_planned(),
          "activity_id string, activity_type string, market string, site_ids string, node_ids string, location string, start_ts timestamp, end_ts timestamp, description string"),
          "Planned work and known external activity: maintenance_window | local_event | third_party_excavation (811 locate tickets) | weather_advisory | utility_outage. "
          "site_ids / node_ids are comma-separated.", pk="activity_id")
    write(spark, fqs, "trouble_tickets", rows_df(spark, build_tickets(),
          "ticket_id string, category string, priority string, market string, site_id string, node_id string, opened_ts timestamp, restored_ts timestamp, closed_ts timestamp, "
          "mttr_hours double, sites_affected int, subscribers_affected int, alarms_correlated int, duplicate_tickets_opened int, assigned_team string, resolution_notes string"),
          "Closed NOC trouble tickets, last 12 months. MTTR = restored_ts - opened_ts (mttr_hours). duplicate_tickets_opened = extra per-site tickets opened for the same root cause "
          "before alarm correlation. resolution_notes = free text from the resolving engineer.", pk="ticket_id")
    write(spark, fqs, "care_contacts_daily", rows_df(spark, build_care(sites), "site_id string, day date, network_complaints int, dropped_call_complaints int"),
          "Customer-care contacts about network quality, attributed to the serving cell site, per day.")

    # ── raw streaming telemetry → volume (gzipped JSON), consumed by the SDP pipeline ──
    kpis = build_kpis(spark, sites)
    # a few corrupt records so the silver expectations have something to drop
    bad = spark.createDataFrame([(None, "DEN-001", "A", fmt(NOW - timedelta(hours=3)), 100.0), ("DEN-002-A", "DEN-002", "A", fmt(NOW - timedelta(hours=3)), -5.0),
                                 ("BLD-003-C", "BLD-003", "C", fmt(NOW - timedelta(hours=4)), 180.0)],
                                "cell_id string, site_id string, sector string, ts string, availability_pct double")
    kpis = kpis.unionByName(bad, allowMissingColumns=True)
    kpis.repartition(24).write.mode("overwrite").option("compression", "gzip").json(f"{raw}/ran_kpis")
    alarms = build_alarms(sites)
    spark.createDataFrame([tuple(a.get(c) for c, _ in ALARM_COLS) for a in alarms], ", ".join(f"{c} {t}" for c, t in ALARM_COLS)) \
        .repartition(4).write.mode("overwrite").option("compression", "gzip").json(f"{raw}/alarms")
    build_optics(spark).repartition(8).write.mode("overwrite").option("compression", "gzip").json(f"{raw}/optics")
    print(f"  raw telemetry landed in {raw}: {len(alarms):,} alarms")
    print("done.")


if __name__ == "__main__":
    main()
