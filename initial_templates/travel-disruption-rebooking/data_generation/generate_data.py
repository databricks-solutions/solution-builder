"""
Aeralis Airways — IROPS disruption response & rebooking: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, `pip install databricks-connect`,
    DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog retail_consumer_goods --schema travel_disruption_copilot

Aeralis Airways is a FICTIONAL US network carrier (hub Chicago O'Hare); Lumen Air is its
FICTIONAL partner airline. Airports and regulations (EU261, UK261, US DOT) are real.

Tables written (Delta, PK/FK RELY constraints + comments):
  airports               airports in the network + whether EU261/UK261 applies to departures
  irops_events           14 months of irregular-operations events (history + Winter Storm Harlan)
  irops_history          ~40K historically disrupted passengers with outcome + cost + post-trip NPS survey
  flights                the Harlan day at ORD: the 36 cancelled flights + every alternate flight
  alternate_options      the re-accommodation options Ops Control protected for each cancelled flight
                         (own-metal later flights, Lumen Air partner seats, nearby airports, next day, D+2)
  passengers             the ~5,700 disrupted passengers of Winter Storm Harlan (loyalty tier, SSR codes,
                         onward long-haul connections, party / PNR, language, home vs away)
  autoprotect_rebookings what the legacy auto-rebooker ("AutoProtect", FIFO by booking date, own metal only)
                         did to every disrupted passenger at 05:10 CT
  passenger_messages     inbound SMS / app / social messages from disrupted passengers (for AI Functions)
  hotel_blocks           contracted distressed-passenger hotel rooms at ORD / FRA / LHR
  guardrails             the re-accommodation cost + service guardrails the desk agent enforces
  rebooking_plans        (empty) plan-level write-back from the IROPS desk app
  rebooking_decisions    (empty) passenger-level write-back of committed rebookings

THE PLANTED SIGNAL
  * Winter Storm Harlan, Fri 13 Feb 2026 (Presidents' Day weekend): ORD ground stop 05:40-12:30 CT →
    Aeralis cancels 36 flights touching ORD; ~5,700 passengers disrupted.
  * AutoProtect rebooks FIFO by booking date on own metal only: it ignores special-service requests
    (unaccompanied minors, wheelchairs, lap infants), onward long-haul connections, loyalty tier,
    the Lumen Air partner seats Ops protected, nearby airports — and it splits parties. Result: most
    passengers overnight, UMNR/PRM stranded, long-haul misconnects.
  * History: AutoProtect everywhere, except a Dec-Jan pilot of priority re-accommodation at the DEN
    desk (DESK_PRIORITY_PILOT) that re-accommodated far more passengers the same day, at LOWER cost per
    disrupted passenger and a much better NPS — the case for the agent.
  * Hero flight AE 1418 ORD→SFO 09:55 (178 pax): 3 unaccompanied minors, 7 wheelchair passengers,
    14 passengers connecting at SFO to Lumen Air long-haul flights to Tokyo and Sydney, a passenger
    flying to his mother's funeral, a Spanish-speaking mother with a lap infant.
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, datetime, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import types as T

SEED = 20260213
rng = random.Random(SEED)

EVENT_ID = "EVT-HARLAN-ORD"
EVENT_DATE = date(2026, 2, 13)
D0 = datetime(2026, 2, 13)
CANCEL_TS = datetime(2026, 2, 13, 4, 50)       # Ops Control cancels the morning bank
AUTOPROTECT_TS = datetime(2026, 2, 13, 5, 10)  # the legacy auto-rebooker runs
HOTEL_RATE_ORD = 139.0


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


def S(name, typ):
    return T.StructField(name, typ, True)


def pick(weights: dict):
    r = rng.random() * sum(weights.values())
    for k, w in weights.items():
        r -= w
        if r <= 0:
            return k
    return k


def at(day_offset: int, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return D0 + timedelta(days=day_offset, hours=h, minutes=m)


# ─────────────────────────────────────────────────────────────────────────────
# Network
# ─────────────────────────────────────────────────────────────────────────────
# code: (city, name, country, region, tz offset vs Chicago (CT) in Feb, eu_uk_261)
AIRPORTS = {
    "ORD": ("Chicago", "O'Hare International", "US", "Midwest", 0, None),
    "LGA": ("New York", "LaGuardia", "US", "Northeast", 1, None),
    "EWR": ("Newark", "Newark Liberty International", "US", "Northeast", 1, None),
    "BOS": ("Boston", "Logan International", "US", "Northeast", 1, None),
    "DCA": ("Washington", "Reagan National", "US", "Northeast", 1, None),
    "IAD": ("Washington", "Dulles International", "US", "Northeast", 1, None),
    "ATL": ("Atlanta", "Hartsfield-Jackson", "US", "Southeast", 1, None),
    "MIA": ("Miami", "Miami International", "US", "Southeast", 1, None),
    "MCO": ("Orlando", "Orlando International", "US", "Southeast", 1, None),
    "FLL": ("Fort Lauderdale", "Fort Lauderdale-Hollywood", "US", "Southeast", 1, None),
    "TPA": ("Tampa", "Tampa International", "US", "Southeast", 1, None),
    "LAX": ("Los Angeles", "Los Angeles International", "US", "West", -2, None),
    "BUR": ("Burbank", "Hollywood Burbank", "US", "West", -2, None),
    "SFO": ("San Francisco", "San Francisco International", "US", "West", -2, None),
    "OAK": ("Oakland", "Oakland International", "US", "West", -2, None),
    "SEA": ("Seattle", "Seattle-Tacoma International", "US", "West", -2, None),
    "PDX": ("Portland", "Portland International", "US", "West", -2, None),
    "SAN": ("San Diego", "San Diego International", "US", "West", -2, None),
    "LAS": ("Las Vegas", "Harry Reid International", "US", "West", -2, None),
    "PHX": ("Phoenix", "Sky Harbor International", "US", "Mountain", -1, None),
    "DEN": ("Denver", "Denver International", "US", "Mountain", -1, None),
    "SLC": ("Salt Lake City", "Salt Lake City International", "US", "Mountain", -1, None),
    "DFW": ("Dallas", "Dallas/Fort Worth International", "US", "South", 0, None),
    "DAL": ("Dallas", "Dallas Love Field", "US", "South", 0, None),
    "AUS": ("Austin", "Austin-Bergstrom International", "US", "South", 0, None),
    "IAH": ("Houston", "George Bush Intercontinental", "US", "South", 0, None),
    "MSY": ("New Orleans", "Louis Armstrong International", "US", "South", 0, None),
    "MSP": ("Minneapolis", "Minneapolis-St Paul International", "US", "Midwest", 0, None),
    "DTW": ("Detroit", "Detroit Metropolitan", "US", "Midwest", 1, None),
    "CLE": ("Cleveland", "Cleveland Hopkins", "US", "Midwest", 1, None),
    "PIT": ("Pittsburgh", "Pittsburgh International", "US", "Northeast", 1, None),
    "BNA": ("Nashville", "Nashville International", "US", "South", 0, None),
    "RDU": ("Raleigh-Durham", "Raleigh-Durham International", "US", "Southeast", 1, None),
    "STL": ("St. Louis", "St. Louis Lambert", "US", "Midwest", 0, None),
    "MCI": ("Kansas City", "Kansas City International", "US", "Midwest", 0, None),
    "FRA": ("Frankfurt", "Frankfurt am Main", "DE", "Europe", 7, "EU261"),
    "LHR": ("London", "Heathrow", "GB", "Europe", 6, "UK261"),
    "NRT": ("Tokyo", "Narita International", "JP", "Asia-Pacific", 15, None),
    "SYD": ("Sydney", "Kingsford Smith", "AU", "Asia-Pacific", 17, None),
    "HNL": ("Honolulu", "Daniel K. Inouye International", "US", "Asia-Pacific", -4, None),
    "GRU": ("Sao Paulo", "Guarulhos International", "BR", "Latin America", 3, None),
    "ICN": ("Seoul", "Incheon International", "KR", "Asia-Pacific", 15, None),
}

# Cancelled ORD departures: (flight no, dest, dep CT, block minutes, aircraft, seats, partner market, nearby alt)
CANCELLED_DEPS = [
    ("AE 1418", "SFO", "09:55", 280, "A321neo", 190, True, "OAK"),
    ("AE 1102", "LGA", "06:10", 130, "B737-900", 179, True, "EWR"),
    ("AE 1106", "BOS", "07:30", 140, "A320", 150, True, None),
    ("AE 1210", "DCA", "06:45", 115, "A320", 150, True, "IAD"),
    ("AE 1302", "ATL", "08:05", 120, "B737-800", 166, True, None),
    ("AE 1330", "MIA", "07:15", 190, "B737-900", 179, True, "FLL"),
    ("AE 1344", "MCO", "09:20", 170, "B737-800", 166, False, None),
    ("AE 1360", "FLL", "10:40", 175, "A321", 190, False, None),
    ("AE 1370", "TPA", "11:15", 160, "A320", 150, False, None),
    ("AE 1404", "LAX", "07:00", 275, "A321neo", 190, True, "BUR"),
    ("AE 1410", "LAX", "11:50", 275, "B737-900", 179, True, "BUR"),
    ("AE 1432", "SEA", "08:30", 265, "B737-900", 179, True, None),
    ("AE 1440", "PDX", "10:10", 270, "A320", 150, False, None),
    ("AE 1452", "SAN", "06:55", 270, "A320", 150, False, None),
    ("AE 1460", "LAS", "09:05", 230, "B737-800", 166, True, None),
    ("AE 1470", "PHX", "07:40", 230, "A320", 150, False, None),
    ("AE 1502", "DEN", "06:20", 155, "B737-900", 179, True, None),
    ("AE 1510", "DEN", "10:25", 155, "A321", 190, True, None),
    ("AE 1520", "SLC", "08:45", 185, "A320", 150, False, None),
    ("AE 1540", "DFW", "07:10", 150, "B737-800", 166, True, "DAL"),
    ("AE 1548", "AUS", "11:30", 160, "A320", 150, False, None),
    ("AE 1556", "IAH", "09:35", 160, "B737-800", 166, True, None),
    ("AE 1570", "MSY", "08:15", 140, "E175", 76, False, None),
    ("AE 1602", "MSP", "06:35", 90, "E175", 76, False, None),
    ("AE 1610", "MSP", "10:50", 90, "A320", 150, False, None),
    ("AE 1620", "DTW", "07:25", 90, "E175", 76, False, None),
    ("AE 1630", "CLE", "08:40", 85, "E175", 76, False, None),
    ("AE 1640", "PIT", "09:50", 90, "E175", 76, False, None),
    ("AE 1650", "BNA", "11:05", 90, "E175", 76, False, None),
    ("AE 1660", "RDU", "07:50", 115, "A320", 150, False, None),
    ("AE 1670", "STL", "10:15", 75, "E175", 76, False, None),
    ("AE 1680", "MCI", "06:05", 95, "E175", 76, False, None),
    ("AE 96", "FRA", "17:55", 490, "B787-9", 290, True, None),
    ("AE 98", "LHR", "18:40", 455, "B787-9", 290, True, None),
]
# Cancelled INBOUND long-haul (passengers are still in Europe): (flight no, origin, dep local, block, aircraft, seats)
CANCELLED_INBOUND = [
    ("AE 97", "FRA", "10:30", 580, "B787-9", 290),
    ("AE 99", "LHR", "11:40", 535, "B787-9", 290),
]

# Onward long-haul partner connections at the destination: dest → [(flight label, to, dep local HH:MM)]
ONWARD = {
    "SFO": [("LU 881", "NRT", "21:15"), ("LU 861", "SYD", "20:50")],
    "LAX": [("LU 7", "SYD", "22:30"), ("LU 853", "HNL", "19:40")],
    "SEA": [("LU 21", "ICN", "20:10")],
    "MIA": [("LU 945", "GRU", "22:50")],
    "BOS": [("LU 110", "LHR", "21:40")],
}
MCT_INTL_MIN = 75  # minimum connecting time to an onward international flight

HOTELS = [
    ("H-ORD-1", "ORD", "Rosemont Lakeside Hotel", 60, 8, 139.0, 10),
    ("H-ORD-2", "ORD", "O'Hare Gateway Suites", 45, 6, 159.0, 8),
    ("H-ORD-3", "ORD", "Des Plaines Park Inn", 80, 4, 119.0, 25),
    ("H-FRA-1", "FRA", "Frankfurt Airport Lindenhof Hotel", 120, 10, 165.0, 12),
    ("H-LHR-1", "LHR", "Heathrow Bath Road Hotel", 90, 8, 172.0, 15),
]

GUARDRAILS = [
    ("G1", "Partner seat cost cap (domestic)", 350.0, "USD per seat",
     "Maximum interline cost per seat on a Lumen Air partner flight for a domestic re-accommodation."),
    ("G1L", "Partner seat cost cap (long-haul)", 700.0, "USD per seat",
     "Maximum interline cost per seat on a partner long-haul re-accommodation."),
    ("G2", "Auto-approve partner spend per flight", 6000.0, "USD per cancelled flight",
     "A re-accommodation plan whose partner spend exceeds this needs the IROPS Duty Manager's approval before it is committed."),
    ("G3", "Unaccompanied minors never overnight", 1.0, "rule",
     "A UMNR is re-accommodated the same day on own metal (Lumen Air accepts UMNR only aged 8+ on nonstops) or returned to the guardian — never left overnight."),
    ("G4", "Keep parties together", 1.0, "rule", "All passengers on one PNR are re-accommodated on the same option."),
    ("G5", "Hotel eligibility (uncontrollable)", 1.0, "rule",
     "Weather is uncontrollable: a free hotel room from the block only for Gold/Platinum/Diamond, passengers needing special assistance (PRM), passengers travelling with a lap infant, and EU261/UK261 flights. Other passengers away from home get the distressed-passenger rate; local residents none."),
    ("G6", "EU261 / UK261 rerouting", 1.0, "rule",
     "Flights departing the EU/UK: reroute at the earliest opportunity including partner airlines; exempt from G1/G2 (logged). Care (meals, hotel) is owed even in extraordinary circumstances."),
    ("G7", "Meal voucher", 15.0, "USD per passenger per 3 hours of delay", "Aeralis customer commitment, any cause."),
    ("G8", "Nearby-airport option", 1.0, "rule",
     "A nearby-airport alternate (e.g. OAK for SFO) only for passengers whose trip ends there — not for onward connections, UMNR or WCHC."),
    ("G9", "Hotel block rate", HOTEL_RATE_ORD, "USD per room night (ORD average)", "Contracted distressed-passenger block rate."),
    ("G10", "Misconnect reprotection cost", 570.0, "USD per passenger",
     "Average cost when a passenger misses an onward long-haul connection: reissue on a later long-haul + hotel at the connecting city."),
]

FIRST = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William",
         "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Chris", "Karen", "Daniel", "Nancy",
         "Matthew", "Lisa", "Anthony", "Betty", "Mark", "Sandra", "Steven", "Ashley", "Andrew", "Emily", "Joshua",
         "Michelle", "Kevin", "Amanda", "Brian", "Melissa", "Ethan", "Olivia", "Noah", "Emma", "Liam", "Ava", "Aisha",
         "Omar", "Priya", "Arjun", "Wei", "Mei", "Hannah", "Grace", "Tyler", "Nia", "Jamal", "Rachel", "Samuel", "Zoe"]
LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson", "Taylor", "Thomas",
        "Moore", "Martin", "Jackson", "Thompson", "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young",
        "Allen", "King", "Wright", "Scott", "Hill", "Green", "Adams", "Baker", "Nelson", "Carter", "Mitchell", "Patel",
        "Kim", "Nguyen", "Chen", "Shah", "Kowalski", "Novak", "Sullivan", "Murphy", "Rivera", "Brooks", "Foster", "Hayes"]
FIRST_ES = ["Sofia", "Mateo", "Valentina", "Santiago", "Camila", "Diego", "Lucia", "Javier", "Isabella", "Carlos", "Elena", "Miguel"]
LAST_ES = ["Garcia", "Martinez", "Lopez", "Hernandez", "Gonzalez", "Perez", "Sanchez", "Ramirez", "Torres", "Flores", "Morales"]
FIRST_DE = ["Lukas", "Anna", "Felix", "Lena", "Jonas", "Marie", "Maximilian", "Sophie", "Paul", "Laura", "Tobias", "Katrin"]
LAST_DE = ["Muller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann", "Schulz", "Koch"]
FIRST_JA = ["Haruto", "Yui", "Sota", "Hina", "Ren", "Aoi", "Kenta", "Sakura", "Takeshi", "Emi"]
LAST_JA = ["Sato", "Suzuki", "Takahashi", "Tanaka", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato"]

SPANISH_MARKETS = {"MIA", "FLL", "SAN", "LAX", "AUS", "IAH", "MCO"}
PREMIUM_MARKETS = {"SFO", "LAX", "BOS", "LGA", "DCA", "FRA", "LHR", "SEA"}


# ─────────────────────────────────────────────────────────────────────────────
# Flights + protected alternates
# ─────────────────────────────────────────────────────────────────────────────

def build_flights_and_options():
    flights, options = [], []
    fid = lambda no, d: f"{no.replace(' ', '')}-{(EVENT_DATE + timedelta(days=d)).strftime('%m%d')}"

    def add_flight(no, carrier, origin, dest, dep: datetime, block, aircraft, seats, status, reason=None, booked=None,
                   delay=0, reg=None):
        arr = dep + timedelta(minutes=block + 60 * (AIRPORTS[dest][4] - AIRPORTS[origin][4]))
        fl = dict(flight_id=fid(no, (dep.date() - EVENT_DATE).days), event_id=EVENT_ID, carrier_code=carrier,
                  carrier_name="Aeralis Airways" if carrier == "AE" else "Lumen Air (partner)", flight_number=no,
                  origin=origin, destination=dest, sched_dep_local=dep, sched_arr_local=arr, block_minutes=block,
                  aircraft_type=aircraft, seats=seats, pax_booked=booked, status=status, delay_minutes=delay,
                  cancel_reason=reason, cancelled_at=CANCEL_TS if status == "CANCELLED" else None,
                  eu_uk_261=AIRPORTS[origin][5])
        flights.append(fl)
        return fl

    def add_opt(cf, rank, otype, fl, seats, cost, partner, same_day, umnr_ok, nearby=False, legs=None):
        delay_h = round((fl["sched_arr_local"] - cf["sched_arr_local"]).total_seconds() / 3600, 2)
        options.append(dict(
            option_id=f"{cf['flight_id']}-O{rank}", disrupted_flight_id=cf["flight_id"], option_rank=rank, option_type=otype,
            carrier_code=fl["carrier_code"], flight_label=legs or f"{fl['flight_number']} {fl['origin']}→{fl['destination']}",
            alt_flight_id=fl["flight_id"], depart_local=fl["sched_dep_local"], arrive_local=fl["sched_arr_local"],
            arrival_airport=fl["destination"], seats_protected=seats, cost_per_seat_usd=float(cost), is_partner=partner,
            same_day=same_day, nearby_airport=nearby, accepts_umnr=umnr_ok, arrival_delay_hours=delay_h))

    reasons = ["Winter Storm Harlan — ORD ground stop / de-icing (weather)",
               "Winter Storm Harlan — aircraft and crew out of position (weather)"]

    for (no, dest, dep, block, ac, seats, partner, nearby) in CANCELLED_DEPS:
        hero = no == "AE 1418"
        booked = 178 if hero else min(seats, round(seats * rng.uniform(0.86, 0.97)))
        cf = add_flight(no, "AE", "ORD", dest, at(0, dep), block, ac, seats, "CANCELLED",
                        reasons[0] if at(0, dep).hour < 12 else reasons[1], booked)
        base_no = int(no.split()[1])
        rank = 1
        if hero:
            plan = [("OWN_SAME_DAY", "AE 1420", "14:20", 24, 0, False, True, 0, None),
                    ("PARTNER_SAME_DAY", "LU 2231", "15:05", 38, 265, True, True, 0, None),
                    ("NEARBY_AIRPORT", "LU 2235", "16:30", 22, 240, True, False, 0, "OAK"),
                    ("OWN_SAME_DAY", "AE 1424", "18:45", 19, 0, False, True, 0, None),
                    ("OWN_NEXT_DAY", "AE 1402", "07:05", 41, 0, False, True, 1, None),
                    ("OWN_NEXT_DAY", "AE 1406", "10:30", 36, 0, False, True, 1, None),
                    ("OWN_D2", "AE 1418", "09:55", 999, 0, False, True, 2, None)]
            for (otype, ano, adep, aseats, cost, is_p, umnr_ok, d, alt_dest) in plan:
                carrier = "LU" if ano.startswith("LU") else "AE"
                fl = add_flight(ano, carrier, "ORD", alt_dest or dest, at(d, adep), block + (10 if alt_dest else 0),
                                "A320" if carrier == "LU" else ac, 150 if carrier == "LU" else seats,
                                "DELAYED" if (d == 0 and carrier == "AE") else "SCHEDULED",
                                booked=None, delay=40 if (d == 0 and carrier == "AE" and adep == "14:20") else 0)
                add_opt(cf, rank, otype, fl, aseats, cost, is_p, d == 0, umnr_ok, bool(alt_dest))
                rank += 1
            continue

        n = booked
        long_haul = dest in ("FRA", "LHR")
        # own same-day later flights (after the 12:30 re-opening)
        own_same = round(n * rng.uniform(0.16, 0.24))
        if long_haul:
            own_same = 0
        later = sorted(rng.sample(["13:40", "14:30", "15:15", "16:10", "17:25", "18:50", "19:40", "20:30"], 2))
        splits = [own_same] if seats < 100 else [round(own_same * 0.55), own_same - round(own_same * 0.55)]
        for i, s in enumerate(splits):
            if s <= 0:
                continue
            fl = add_flight(f"AE {2000 + base_no % 1000 + 2 * (i + 1)}", "AE", "ORD", dest, at(0, later[i]), block, ac, seats,
                            "DELAYED" if i == 0 else "SCHEDULED", delay=rng.choice([25, 40, 55]) if i == 0 else 0)
            add_opt(cf, rank, "OWN_SAME_DAY", fl, s, 0, False, True, True)
            rank += 1
        if partner:
            ps = round(n * rng.uniform(0.12, 0.2))
            pdep = rng.choice(["14:05", "15:20", "16:45", "17:55"]) if not long_haul else "16:20"
            if long_haul:  # via Newark on Lumen Air, same evening
                lno = "LU 64" if dest == "FRA" else "LU 110"
                fl = add_flight(f"{lno}", "LU", "ORD", dest, at(0, pdep), block + 150, "A330-300", 280, "SCHEDULED")
                add_opt(cf, rank, "PARTNER_SAME_DAY", fl, ps, rng.choice([610, 640, 675]), True, True, False,
                        legs=f"LU 402 ORD→EWR + {lno} EWR→{dest}")
            else:
                fl = add_flight(f"LU {2000 + base_no % 1000 + 11}", "LU", "ORD", dest, at(0, pdep), block, "A320", 150, "SCHEDULED")
                add_opt(cf, rank, "PARTNER_SAME_DAY", fl, ps, rng.choice([185, 210, 235, 255, 290, 320]), True, True, True)
            rank += 1
        if nearby:
            ns = round(n * rng.uniform(0.06, 0.1))
            fl = add_flight(f"LU {2500 + base_no % 1000 + 3}", "LU", "ORD", nearby, at(0, rng.choice(["15:40", "17:10"])),
                            block + 5, "A320", 150, "SCHEDULED")
            add_opt(cf, rank, "NEARBY_AIRPORT", fl, ns, rng.choice([180, 205, 240]), True, True, False, nearby=True)
            rank += 1
        # next day own
        nd = round(n * rng.uniform(0.40, 0.5))
        for i, t in enumerate(sorted(rng.sample(["06:30", "07:15", "08:40", "10:05", "12:20"], 2))):
            s = round(nd * (0.55 if i == 0 else 0.45))
            fl = add_flight(f"AE {2000 + base_no % 1000 + 1 + 2 * i}" if not long_haul else no, "AE", "ORD", dest,
                            at(1, t if not long_haul else dep), block, ac, seats, "SCHEDULED")
            add_opt(cf, rank, "OWN_NEXT_DAY", fl, s, 0, False, False, True)
            rank += 1
            if long_haul:
                break
        fl = add_flight(no, "AE", "ORD", dest, at(2, dep), block, ac, seats, "SCHEDULED")
        add_opt(cf, rank, "OWN_D2", fl, 999, 0, False, False, True)

    for (no, origin, dep, block, ac, seats) in CANCELLED_INBOUND:
        booked = round(seats * rng.uniform(0.9, 0.96))
        cf = add_flight(no, "AE", origin, "ORD", at(0, dep), block, ac, seats, "CANCELLED",
                        "Winter Storm Harlan — ORD closed to arrivals, aircraft held at hub (weather)", booked)
        rank = 1
        lno = "LU 63" if origin == "FRA" else "LU 111"
        fl = add_flight(lno, "LU", origin, "EWR", at(0, "13:15"), 530, "A330-300", 280, "SCHEDULED")
        conn = dict(fl)
        conn["sched_arr_local"] = at(0, "19:55")
        conn["destination"] = "ORD"
        add_opt(cf, rank, "PARTNER_SAME_DAY", conn, round(booked * 0.14), rng.choice([610, 655]), True, True, False,
                legs=f"{lno} {origin}→EWR + LU 419 EWR→ORD")
        rank += 1
        fl = add_flight(no, "AE", origin, "ORD", at(1, dep), block, ac, seats, "SCHEDULED")
        add_opt(cf, rank, "OWN_NEXT_DAY", fl, round(booked * 0.38), 0, False, False, True)
        rank += 1
        fl = add_flight(no, "AE", origin, "ORD", at(2, dep), block, ac, seats, "SCHEDULED")
        add_opt(cf, rank, "OWN_D2", fl, 999, 0, False, False, True)

    # a few operating afternoon flights for context (not disrupted)
    for (no, dest, dep, block) in [("AE 1188", "LGA", "13:05", 130), ("AE 1450", "SFO", "12:55", 280),
                                   ("AE 1512", "DEN", "13:30", 155), ("AE 1302A", "ATL", "14:10", 120)]:
        add_flight(no, "AE", "ORD", dest, at(0, dep), block, "A320", 150, "DELAYED", delay=rng.choice([35, 50, 70]), booked=148)

    # dedupe flights (an alternate can be referenced twice)
    seen, uniq = set(), []
    for f in flights:
        if f["flight_id"] in seen:
            continue
        seen.add(f["flight_id"])
        uniq.append(f)
    return uniq, options


# ─────────────────────────────────────────────────────────────────────────────
# Passengers
# ─────────────────────────────────────────────────────────────────────────────

def name_for(lang):
    if lang == "Spanish":
        return rng.choice(FIRST_ES), rng.choice(LAST_ES)
    if lang == "German":
        return rng.choice(FIRST_DE), rng.choice(LAST_DE)
    if lang == "Japanese":
        return rng.choice(FIRST_JA), rng.choice(LAST_JA)
    return rng.choice(FIRST), rng.choice(LAST)


PNR_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_pnrs = set()


def new_pnr():
    while True:
        p = "".join(rng.choice(PNR_CHARS) for _ in range(6))
        if p not in _pnrs:
            _pnrs.add(p)
            return p


TIER_W = {"Member": 60, "Silver": 15, "Gold": 12, "Platinum": 8.5, "Diamond": 4.5}


def build_passengers(flights):
    by_id = {f["flight_id"]: f for f in flights}
    cancelled = [f for f in flights if f["status"] == "CANCELLED"]
    pax = []
    seq = [0]

    def add(cf, pnr, first, last, age, tier, cabin, brand, fare, booked_days, origin_type, home, lang, channel,
            ssr="", onward=None, party=1):
        seq[0] += 1
        dest = cf["destination"]
        onward_label, onward_to, onward_dep = (None, None, None)
        if onward:
            onward_label, onward_to, hhmm = onward
            onward_dep = datetime.combine(EVENT_DATE, datetime.min.time()) + timedelta(hours=int(hhmm[:2]), minutes=int(hhmm[3:]))
        pax.append(dict(
            pax_id=f"PX{seq[0]:05d}", pnr=pnr, disrupted_flight_id=cf["flight_id"], first_name=first, last_name=last,
            age=age, loyalty_tier=tier, cabin=cabin, fare_brand=brand, fare_paid_usd=float(fare),
            booking_date=EVENT_DATE - timedelta(days=booked_days), origin_type=origin_type,
            away_from_home=origin_type != "LOCAL", home_city=home, final_destination=onward_to or dest,
            onward_flight=f"{onward_label} {dest}→{onward_to}" if onward else None, onward_dep_local=onward_dep,
            onward_long_haul=bool(onward), ssr_codes=ssr, party_size=party, preferred_language=lang,
            contact_channel=channel, phone_last4=f"{rng.randint(0, 9999):04d}",
            eu_uk_261=cf["eu_uk_261"]))

    for cf in cancelled:
        dest, origin = cf["destination"], cf["origin"]
        inbound = origin != "ORD"
        n = cf["pax_booked"]
        hero = cf["flight_number"] == "AE 1418"
        placed = 0
        if hero:
            placed += add_hero_passengers(cf, add)
        while placed < n:
            size = min(n - placed, pick({1: 55, 2: 25, 3: 9, 4: 8, 5: 3}))
            pnr = new_pnr()
            if inbound:
                lang = "German" if origin == "FRA" and rng.random() < 0.45 else "English"
                origin_type = "LOCAL" if rng.random() < 0.35 else "VISITOR"  # LOCAL = lives in Europe, trip starts there
                home = AIRPORTS[origin][0] if origin_type == "LOCAL" else "Chicago"
            else:
                lang = "Spanish" if dest in SPANISH_MARKETS and rng.random() < 0.15 else (
                    "German" if dest == "FRA" and rng.random() < 0.35 else "English")
                origin_type = pick({"LOCAL": 42, "VISITOR": 30, "CONNECTING": 28})
                home = "Chicago" if origin_type == "LOCAL" else (AIRPORTS[dest][0] if origin_type == "VISITOR"
                                                                 else rng.choice(["Toronto", "Detroit", "Milwaukee", "Cincinnati", "Montreal", "Des Moines", "Madison", "Grand Rapids"]))
            prem = dest in PREMIUM_MARKETS or origin in PREMIUM_MARKETS
            tier = pick({**TIER_W, "Platinum": 11 if prem else 8.5, "Diamond": 6 if prem else 4.5})
            onward = None
            if not inbound and not hero and dest in ONWARD and rng.random() < 0.07:
                onward = rng.choice(ONWARD[dest])
                if onward[1] in ("NRT", "ICN") and rng.random() < 0.5:
                    lang = "Japanese" if onward[1] == "NRT" else lang
            booked_days = rng.choice([rng.randint(1, 14), rng.randint(10, 60), rng.randint(40, 130)])
            channel = pick({"SMS": 55, "Email": 25, "App push": 20})
            cabin_roll = rng.random()
            tier_rank = list(TIER_W).index(tier)
            if cabin_roll < 0.04 + 0.06 * tier_rank:
                cabin, brand = ("Business" if cf["seats"] > 250 else "First"), ("Business" if cf["seats"] > 250 else "First")
            elif cabin_roll < 0.2 + 0.05 * tier_rank:
                cabin, brand = "Economy", "Comfort+"
            elif rng.random() < 0.26:
                cabin, brand = "Economy", "Basic"
            else:
                cabin, brand = "Economy", "Main"
            base_fare = {"First": 620, "Business": 3400, "Comfort+": 310, "Main": 240, "Basic": 150}[brand]
            if cf["seats"] > 250 and brand not in ("Business",):
                base_fare *= 3.6
            infant_pnr = size >= 2 and rng.random() < 0.08
            for k in range(size):
                if k == 0 or rng.random() < 0.4:
                    first, last = name_for(lang)
                else:
                    first = name_for(lang)[0]
                age = rng.randint(24, 72) if k == 0 else (rng.randint(3, 17) if size >= 3 and k >= 2 else rng.randint(20, 75))
                ssr = []
                if age >= 66 and rng.random() < 0.16:
                    ssr.append("WCHR")
                elif rng.random() < 0.004:
                    ssr.append("WCHC")
                elif rng.random() < 0.004:
                    ssr.append(rng.choice(["BLND", "DEAF", "MEDA"]))
                if k == 0 and infant_pnr:
                    ssr.append("INFT")
                if rng.random() < 0.008:
                    ssr.append("PETC")
                if size == 1 and rng.random() < 0.012 and not inbound and not hero:
                    age = rng.randint(7, 14)
                    ssr = ["UMNR"]
                    tier = "Member"
                    origin_type, home = "LOCAL", "Chicago"
                    onward = None
                add(cf, pnr, first, last, age, tier if k == 0 else rng.choice([tier, "Member"]), cabin, brand,
                    round(base_fare * rng.uniform(0.75, 1.35)), booked_days, origin_type, home, lang, channel,
                    ",".join(ssr), onward, size)
            placed += size
    return pax


def add_hero_passengers(cf, add):
    """The named passengers on AE 1418 ORD→SFO the demo walks through. Returns the count added."""
    n0 = 0
    rows = [
        # pnr, first, last, age, tier, cabin, brand, fare, booked_days_ago, origin, home, lang, channel, ssr, onward
        ("MCHN9Q", "Maya", "Chen", 9, "Member", "Economy", "Main", 289, 12, "LOCAL", "Chicago", "English", "SMS", "UMNR", None),
        ("LMRT4K", "Leo", "Martins", 12, "Member", "Economy", "Main", 264, 18, "LOCAL", "Chicago", "English", "SMS", "UMNR", None),
        ("ABRK7C", "Ava", "Brooks", 13, "Member", "Economy", "Main", 241, 96, "LOCAL", "Chicago", "English", "Email", "UMNR", None),
        ("WHTK2R", "Harold", "Whitaker", 81, "Gold", "Economy", "Comfort+", 402, 6, "VISITOR", "San Francisco", "English", "SMS", "WCHR", None),
        ("WHTK2R", "June", "Whitaker", 78, "Gold", "Economy", "Comfort+", 402, 6, "VISITOR", "San Francisco", "English", "SMS", "WCHR", None),
        ("KWTN8D", "Kenji", "Watanabe", 52, "Diamond", "First", "First", 1180, 4, "CONNECTING", "Tokyo", "Japanese", "App push", "", ("LU 881", "NRT", "21:15")),
        ("KWTN8D", "Aiko", "Watanabe", 49, "Diamond", "First", "First", 1180, 4, "CONNECTING", "Tokyo", "Japanese", "App push", "", ("LU 881", "NRT", "21:15")),
        ("PNRS5Y", "Priya", "Nair", 41, "Platinum", "Economy", "Comfort+", 455, 3, "CONNECTING", "Sydney", "English", "App push", "", ("LU 861", "SYD", "20:50")),
        ("DOKF3M", "Daniel", "Okafor", 37, "Member", "Economy", "Main", 318, 2, "VISITOR", "Oakland", "English", "SMS", "", None),
        ("SRMZ6P", "Sofia", "Ramirez", 31, "Silver", "Economy", "Main", 226, 9, "CONNECTING", "San Jose", "Spanish", "SMS", "INFT", None),
        ("SRMZ6P", "Mateo", "Ramirez", 6, "Silver", "Economy", "Main", 226, 9, "CONNECTING", "San Jose", "Spanish", "SMS", "", None),
        ("RHLE2W", "Robert", "Hale", 67, "Member", "Economy", "Main", 251, 21, "VISITOR", "San Francisco", "English", "Email", "WCHC", None),
        ("RGLD4N", "Ruth", "Goldberg", 84, "Platinum", "First", "First", 890, 11, "VISITOR", "San Francisco", "English", "SMS", "WCHR", None),
        ("RGLD4N", "Naomi", "Goldberg", 55, "Platinum", "First", "First", 890, 11, "VISITOR", "San Francisco", "English", "SMS", "", None),
        ("TPHM9B", "Thi", "Pham", 70, "Member", "Economy", "Main", 233, 8, "VISITOR", "San Francisco", "English", "SMS", "WCHR", None),
    ]
    # 9 more onward long-haul connectors (Tokyo / Sydney) booked late → AutoProtect overnights them
    extra = [("Haruto", "Sato", "Japanese", ("LU 881", "NRT", "21:15"), "Gold"), ("Yui", "Tanaka", "Japanese", ("LU 881", "NRT", "21:15"), "Member"),
             ("Ren", "Ito", "Japanese", ("LU 881", "NRT", "21:15"), "Silver"), ("Emi", "Kato", "Japanese", ("LU 881", "NRT", "21:15"), "Member"),
             ("Takeshi", "Suzuki", "Japanese", ("LU 881", "NRT", "21:15"), "Platinum"), ("Liam", "Walker", "English", ("LU 861", "SYD", "20:50"), "Member"),
             ("Zoe", "Foster", "English", ("LU 861", "SYD", "20:50"), "Gold"), ("Noah", "Hayes", "English", ("LU 861", "SYD", "20:50"), "Member"),
             ("Grace", "Kim", "English", ("LU 881", "NRT", "21:15"), "Silver")]
    party = {}
    for r in rows:
        party[r[0]] = party.get(r[0], 0) + 1
    for r in rows:
        pnr, first, last, age, tier, cabin, brand, fare, bd, ot, home, lang, ch, ssr, onward = r
        _pnrs.add(pnr)
        add(cf, pnr, first, last, age, tier, cabin, brand, fare, bd, ot, home, lang, ch, ssr, onward, party[pnr])
        n0 += 1
    for (first, last, lang, onward, tier) in extra:
        add(cf, new_pnr(), first, last, rng.randint(26, 64), tier, "Economy", "Main", rng.randint(260, 420),
            rng.randint(1, 8), "CONNECTING", "Tokyo" if onward[1] == "NRT" else "Sydney", lang, "App push", "", onward, 1)
        n0 += 1
    return n0


# ─────────────────────────────────────────────────────────────────────────────
# AutoProtect — the legacy auto-rebooker (FIFO by booking date, own metal only)
# ─────────────────────────────────────────────────────────────────────────────

def run_autoprotect(pax, options):
    by_flight = {}
    for o in options:
        by_flight.setdefault(o["disrupted_flight_id"], []).append(o)
    remaining = {o["option_id"]: o["seats_protected"] for o in options}
    out = []
    pax_by_flight = {}
    for p in pax:
        pax_by_flight.setdefault(p["disrupted_flight_id"], []).append(p)
    for fid, plist in pax_by_flight.items():
        own = sorted([o for o in by_flight[fid] if not o["is_partner"]], key=lambda o: o["depart_local"])
        placed_pnr = {}
        for p in sorted(plist, key=lambda x: (x["booking_date"], x["pax_id"])):
            opt = next(o for o in own if remaining[o["option_id"]] > 0)
            remaining[opt["option_id"]] -= 1
            placed_pnr.setdefault(p["pnr"], set()).add(opt["option_id"])
            misconnect = False
            if p["onward_long_haul"]:
                misconnect = (not opt["same_day"]) or (
                    opt["arrive_local"] + timedelta(minutes=MCT_INTL_MIN) > p["onward_dep_local"])
            out.append(dict(pax_id=p["pax_id"], disrupted_flight_id=fid, option_id=opt["option_id"],
                            new_flight_label=opt["flight_label"], arrive_local=opt["arrive_local"],
                            arrival_delay_hours=opt["arrival_delay_hours"], same_day=opt["same_day"],
                            overnight=not opt["same_day"], nights=0 if opt["same_day"] else (1 if opt["option_type"] == "OWN_NEXT_DAY" else 2),
                            misconnect=misconnect, party_split=False, rebooked_at=AUTOPROTECT_TS))
    by_pax = {r["pax_id"]: r for r in out}
    pnr_members = {}
    for p in pax:
        pnr_members.setdefault(p["pnr"], []).append(p["pax_id"])
    for pnr, ids in pnr_members.items():
        if len({by_pax[i]["option_id"] for i in ids}) > 1:
            for i in ids:
                by_pax[i]["party_split"] = True
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Passenger messages (for AI Functions)
# ─────────────────────────────────────────────────────────────────────────────

MSG_TEMPLATES = {
    "rebook": ["Flight {fl} got cancelled. Can you get me on anything to {city} today? Any airline is fine.",
               "Just got the cancellation text for {fl}. What are my options to get to {city} tonight?",
               "You moved me to {new}. Is there nothing earlier? I have work first thing tomorrow."],
    "refund": ["If you can't get me out today I just want my money back for {fl}. How do I get a refund?",
               "Cancel my trip. I'm not flying tomorrow. I want a full refund to my card, not a voucher."],
    "hotel": ["I'm stuck at O'Hare with no hotel. {fl} cancelled and the new flight is tomorrow. Are you covering a room?",
              "Do I get a hotel voucher? I don't live in Chicago and my rebooked flight is tomorrow morning."],
    "connection": ["I have a connection in {city} on {onward} tonight. If I miss it the whole trip is ruined. Please help.",
                   "My {onward} connection leaves {city} tonight - the rebooking you gave me misses it completely."],
    "complaint": ["This is ridiculous. Third time this winter. {fl} cancelled and nobody at the desk can tell me anything.",
                  "Two hours in line at the service desk and your app still shows nothing. Terrible handling of this storm.",
                  "You split my family across two different days. Unacceptable."],
    "assistance": ["My father uses a wheelchair and was on {fl}. The rebooking is for tomorrow - he cannot sleep in the terminal.",
                   "I'm travelling with a baby, {fl} is cancelled. Is there a family room or a way to get us out today?"],
    "praise": ["Thanks to the gate agent at B12 who helped us with {fl}. Very kind under pressure.",
               "Got the rebooking text quickly, appreciate it. Hope the crews stay safe."],
    "baggage": ["My checked bag was already loaded for {fl}. Where is it now? I need my medication in it."],
}
MSG_ES = ["Cancelaron el vuelo {fl}. Viajo con mi bebé y necesitamos llegar hoy. ¿Qué opciones hay?",
          "Me cambiaron para mañana. No vivo en Chicago, ¿me dan hotel?"]
MSG_DE = ["Flug {fl} wurde gestrichen. Welche Rechte habe ich nach der EU-Verordnung 261? Bekomme ich ein Hotel?",
          "Ich muss morgen in Chicago sein. Gibt es eine Umbuchung über Newark heute noch?"]


def build_messages(pax, flights, autoprotect):
    by_f = {f["flight_id"]: f for f in flights}
    ap = {r["pax_id"]: r for r in autoprotect}
    msgs, seq = [], [0]

    def add(p, text, minutes, channel=None):
        seq[0] += 1
        msgs.append(dict(message_id=f"MSG{seq[0]:05d}", pax_id=p["pax_id"], pnr=p["pnr"],
                         disrupted_flight_id=p["disrupted_flight_id"],
                         received_ts=AUTOPROTECT_TS + timedelta(minutes=minutes),
                         channel=channel or rng.choice(["SMS", "App chat", "X (Twitter)", "Web chat"]), message_text=text))

    hero = {p["first_name"] + " " + p["last_name"]: p for p in pax if p["disrupted_flight_id"] == "AE1418-0213"}

    def when(name):
        r = ap[hero[name]["pax_id"]]
        return "tonight" if r["same_day"] else ("tomorrow" if r["nights"] == 1 else "Sunday")

    add(hero["Maya Chen"], f"My daughter Maya Chen (9) is booked on AE1418 as an unaccompanied minor to her dad in San Francisco. "
        f"Your text says she's now on a flight {when('Maya Chen')}. She cannot stay overnight at the airport - what happens to her? Please call me.", 22, "SMS")
    add(hero["Daniel Okafor"], f"AE1418 cancelled. I am flying to my mother's funeral - it is tomorrow at 10:00 in Oakland. "
        f"You rebooked me {when('Daniel Okafor')}. I have to be there tonight, I'll take any seat on any airline, OAK is fine.", 31, "App chat")
    add(hero["Kenji Watanabe"], f"We are connecting in SFO to LU 881 to Tokyo tonight (Diamond, 2 passengers, KWTN8D). "
        f"Your rebooking lands {when('Kenji Watanabe')} and misses the Tokyo flight. Please protect the connection.", 26, "App chat")
    add(hero["Sofia Ramirez"], "Cancelaron el vuelo AE1418. Viajo sola con mi bebé de 8 meses y mi hijo de 6 años. "
        "Nos cambiaron a otro día y no tenemos dónde dormir. ¿Nos pueden ayudar?", 40, "SMS")
    add(hero["Harold Whitaker"], f"My wife and I both need wheelchairs. We were on AE1418 and are now booked {when('Harold Whitaker')}. "
        "We are 81 and 78 - we cannot spend the night at O'Hare. Please help.", 35, "SMS")
    add(hero["Priya Nair"], f"Platinum member, connecting SFO to Sydney on LU 861 tonight for a client meeting Monday. "
        f"The rebooking you gave me ({when('Priya Nair')}) misses it. Need a seat that makes the connection.", 28, "App chat")
    add(hero["Ruth Goldberg"], "My mother is 84 and uses a wheelchair. We're sitting in a crowded gate area. Is there anything today?", 44, "Web chat")

    for p in pax:
        if p["disrupted_flight_id"] == "AE1418-0213" and p["first_name"] + " " + p["last_name"] in hero and \
                p["first_name"] in ("Maya", "Daniel", "Kenji", "Sofia", "Harold", "Priya", "Ruth"):
            continue
        r = rng.random()
        rate = 0.24 if ap[p["pax_id"]]["overnight"] else 0.1
        if r > rate:
            continue
        cf = by_f[p["disrupted_flight_id"]]
        city = AIRPORTS[cf["destination"]][0]
        fl = cf["flight_number"].replace(" ", "")
        if p["preferred_language"] == "Spanish" and rng.random() < 0.7:
            text = rng.choice(MSG_ES).format(fl=fl)
        elif p["preferred_language"] == "German" and rng.random() < 0.7:
            text = rng.choice(MSG_DE).format(fl=fl)
        else:
            intents = {"rebook": 30, "refund": 10, "hotel": 14 if ap[p["pax_id"]]["overnight"] else 3, "complaint": 18,
                       "praise": 5, "baggage": 4,
                       "connection": 25 if p["onward_long_haul"] else 0,
                       "assistance": 30 if any(s in p["ssr_codes"] for s in ("WCHR", "WCHC", "INFT")) else 0}
            intent = pick(intents)
            text = rng.choice(MSG_TEMPLATES[intent]).format(
                fl=fl, city=city, new=f"{ap[p['pax_id']]['new_flight_label']} on {ap[p['pax_id']]['arrive_local']:%A}",
                onward=p["onward_flight"] or "my connection")
        add(p, text, rng.randint(15, 320))
    return msgs


# ─────────────────────────────────────────────────────────────────────────────
# 14 months of IROPS history (with the DEN pilot)
# ─────────────────────────────────────────────────────────────────────────────

def sigmoid(x):
    return 1 / (1 + math.exp(-x))


def detractor_logit(f):
    """Ground-truth post-disruption detractor propensity (the ML model learns this)."""
    x = (-1.55 + 0.055 * f["arrival_delay_hours"] + 0.75 * f["overnight"] - 0.85 * f["overnight"] * f["hotel_provided"]
         + 1.05 * f["misconnect"] + 0.8 * f["party_split"] + 0.7 * f["overnight"] * f["special_assistance"]
         + 0.45 * f["overnight"] * (f["tier_rank"] >= 2) - 0.55 * f["proactive_notice"] + 0.15 * f["away_from_home"])
    return x


HISTORY_EVENTS = [
    # (date, hub, name, cause, controllable, pax, method)
    ("2025-01-09", "ORD", "Lake-effect snow", "Weather", False, 2600, "AUTOPROTECT"),
    ("2025-02-18", "DEN", "Blizzard", "Weather", False, 3100, "AUTOPROTECT"),
    ("2025-03-06", "BOS", "Nor'easter", "Weather", False, 1900, "AUTOPROTECT"),
    ("2025-04-15", "ORD", "Crew scheduling system outage", "IT outage", True, 2200, "AUTOPROTECT"),
    ("2025-05-22", "DEN", "Hail / thunderstorms", "Weather", False, 1500, "AUTOPROTECT"),
    ("2025-06-19", "ORD", "Thunderstorm ground stop", "Weather", False, 2800, "AUTOPROTECT"),
    ("2025-07-08", "BOS", "ATC staffing program", "ATC", False, 1300, "AUTOPROTECT"),
    ("2025-07-24", "ORD", "Thunderstorms", "Weather", False, 2400, "AUTOPROTECT"),
    ("2025-08-14", "DEN", "Aircraft maintenance cascade", "Maintenance", True, 1100, "AUTOPROTECT"),
    ("2025-09-11", "ORD", "Fuel-farm outage", "Airport", False, 1600, "AUTOPROTECT"),
    ("2025-10-23", "BOS", "Early nor'easter", "Weather", False, 1400, "AUTOPROTECT"),
    ("2025-11-26", "ORD", "Thanksgiving fog + ATC", "Weather", False, 2900, "AUTOPROTECT"),
    ("2025-12-05", "DEN", "Winter storm", "Weather", False, 2700, "DESK_PRIORITY_PILOT"),
    ("2025-12-19", "ORD", "Pre-holiday snow", "Weather", False, 3000, "AUTOPROTECT"),
    ("2026-01-08", "DEN", "Blizzard", "Weather", False, 2500, "DESK_PRIORITY_PILOT"),
    ("2026-01-16", "BOS", "Winter storm", "Weather", False, 1700, "AUTOPROTECT"),
    ("2026-01-28", "DEN", "Upslope snow", "Weather", False, 1900, "DESK_PRIORITY_PILOT"),
    ("2026-02-03", "ORD", "Freezing rain", "Weather", False, 2100, "AUTOPROTECT"),
]


def build_history():
    events, rows = [], []
    for i, (d, hub, nm, cause, ctrl, n, method) in enumerate(HISTORY_EVENTS):
        eid = f"EVT-{d}-{hub}"
        dd = date.fromisoformat(d)
        events.append(dict(event_id=eid, event_name=f"{nm} at {hub}", hub=hub, event_date=dd, cause_category=cause,
                           controllable=ctrl, handling_method=method, flights_cancelled=round(n / 150),
                           pax_disrupted=n, is_current=False))
        pilot = method == "DESK_PRIORITY_PILOT"
        for k in range(n):
            tier = pick(TIER_W)
            tier_rank = list(TIER_W).index(tier)
            ssr = rng.random() < 0.045
            umnr = rng.random() < 0.006
            away = rng.random() < 0.58
            onward = rng.random() < 0.06
            infant = rng.random() < 0.03
            party = pick({1: 55, 2: 25, 3: 12, 4: 8})
            priority = umnr or ssr or infant or onward or tier_rank >= 3
            # same-day probability by method; the pilot prioritises the vulnerable + connections
            if pilot:
                p_same = 0.9 if priority else (0.64 if away else 0.5)
                p_split = 0.01
                proactive = rng.random() < 0.88
            else:
                p_same = 0.44 if not ctrl else 0.5
                p_split = 0.17 if party > 1 else 0.0
                proactive = rng.random() < 0.35
            same_day = rng.random() < p_same
            overnight = not same_day
            delay = rng.uniform(3.5, 9) if same_day else rng.uniform(16, 44 if not pilot else 30)
            misconnect = onward and (overnight or rng.random() < (0.12 if pilot else 0.45))
            entitled = tier_rank >= 2 or ssr or infant or umnr or ctrl
            hotel = overnight and away and (entitled or (pilot and rng.random() < 0.1))
            partner = same_day and rng.random() < (0.22 if pilot else 0.0)
            split = rng.random() < p_split
            rebook_cost = (rng.uniform(180, 300) if partner else 0) + (570 if misconnect else 0)
            care_cost = (HOTEL_RATE_ORD * (1 if delay < 30 else 2) / max(1, min(party, 3)) if hotel else 0) + 15 * math.floor(delay / 3) * 0.7
            comp = (150 if (overnight and tier_rank >= 2 and rng.random() < (0.5 if not pilot else 0.2)) else 0) + (
                100 if split else 0) + (75 if ctrl and overnight else 0)
            f = dict(arrival_delay_hours=delay, overnight=int(overnight), hotel_provided=int(hotel), misconnect=int(misconnect),
                     party_split=int(split), special_assistance=int(ssr or umnr or infant), tier_rank=tier_rank,
                     proactive_notice=int(proactive), away_from_home=int(away))
            p_det = sigmoid(detractor_logit(f))
            responded = rng.random() < 0.31
            nps = None
            if responded:
                if rng.random() < p_det:
                    nps = rng.choice([0, 1, 2, 3, 4, 5, 6])
                else:
                    nps = rng.choice([7, 8]) if rng.random() < (0.55 if not pilot else 0.42) else rng.choice([9, 10])
            rows.append(dict(
                history_pax_id=f"H{i:02d}-{k:05d}", event_id=eid, event_date=dd, hub=hub, cause_category=cause,
                controllable=ctrl, handling_method=method, loyalty_tier=tier, tier_rank=tier_rank,
                special_assistance=bool(ssr), unaccompanied_minor=umnr, lap_infant=infant, away_from_home=away,
                onward_long_haul=onward, party_size=party, proactive_notice=proactive,
                same_day_reaccommodated=same_day, overnight=overnight, hotel_provided=hotel, partner_rebooked=partner,
                party_split=split, misconnect=bool(misconnect), arrival_delay_hours=round(delay, 1),
                rebooking_cost_usd=round(rebook_cost, 2), care_cost_usd=round(care_cost, 2),
                compensation_usd=float(comp), total_cost_usd=round(rebook_cost + care_cost + comp, 2),
                nps_score=nps, detractor=None if nps is None else nps <= 6, promoter=None if nps is None else nps >= 9))
    events.append(dict(event_id=EVENT_ID, event_name="Winter Storm Harlan at ORD", hub="ORD", event_date=EVENT_DATE,
                       cause_category="Weather", controllable=False, handling_method="AUTOPROTECT (desk re-plan in progress)",
                       flights_cancelled=len(CANCELLED_DEPS) + len(CANCELLED_INBOUND), pax_disrupted=None, is_current=True))
    return events, rows


# ─────────────────────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────────────────────

def write(spark, fqs, name, rows, struct: T.StructType, comment, pk=None):
    fq = f"{fqs}.{name}"
    cols = [f.name for f in struct.fields]
    df = spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], struct)
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


Str, Int, Dbl, Bool, Dt, Ts = T.StringType(), T.IntegerType(), T.DoubleType(), T.BooleanType(), T.DateType(), T.TimestampNTZType()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="retail_consumer_goods")
    ap.add_argument("--schema", default="travel_disruption_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Aeralis Airways (fictional) — IROPS disruption response & rebooking demo'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.policy_docs COMMENT 'Aeralis IROPS policy, fare rules, EU261/UK261 + US DOT guides - documents searched by the Genie agent'")
    for t in ["passenger_messages", "autoprotect_rebookings", "passengers", "alternate_options", "flights", "irops_history",
              "irops_events", "hotel_blocks", "guardrails", "airports"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    flights, options = build_flights_and_options()
    pax = build_passengers(flights)
    autoprotect = run_autoprotect(pax, options)
    msgs = build_messages(pax, flights, autoprotect)
    events, history = build_history()
    for f in flights:
        if f["status"] == "CANCELLED":
            f["pax_booked"] = sum(1 for p in pax if p["disrupted_flight_id"] == f["flight_id"])
    events[-1]["pax_disrupted"] = len(pax)

    hero = [r for r in autoprotect if r["disrupted_flight_id"] == "AE1418-0213"]
    print(f"generated: {len(flights)} flights, {len(options)} options, {len(pax)} pax, {len(msgs)} messages, {len(history)} history rows")
    print(f"AutoProtect overall: same-day {sum(r['same_day'] for r in autoprotect)}/{len(autoprotect)}, "
          f"misconnects {sum(r['misconnect'] for r in autoprotect)}, split {sum(r['party_split'] for r in autoprotect)}")
    print(f"AutoProtect AE1418: same-day {sum(r['same_day'] for r in hero)}/{len(hero)}, D+2 {sum(r['nights'] == 2 for r in hero)}, "
          f"misconnects {sum(r['misconnect'] for r in hero)}")

    write(spark, fqs, "airports", [dict(airport_code=k, city=v[0], airport_name=v[1], country=v[2], region=v[3],
                                        tz_offset_vs_chicago=v[4], passenger_rights_regime=v[5]) for k, v in AIRPORTS.items()],
          T.StructType([S("airport_code", Str), S("city", Str), S("airport_name", Str), S("country", Str), S("region", Str),
                        S("tz_offset_vs_chicago", Int), S("passenger_rights_regime", Str)]),
          "Airports in the Aeralis network. passenger_rights_regime = EU261 / UK261 when departures from that airport are covered.",
          pk="airport_code")
    write(spark, fqs, "irops_events", events, T.StructType([
        S("event_id", Str), S("event_name", Str), S("hub", Str), S("event_date", Dt), S("cause_category", Str),
        S("controllable", Bool), S("handling_method", Str), S("flights_cancelled", Int), S("pax_disrupted", Int),
        S("is_current", Bool)]),
        "Irregular-operations (IROPS) events, Jan 2025 - Feb 2026. handling_method = AUTOPROTECT (legacy FIFO auto-rebooker) or "
        "DESK_PRIORITY_PILOT (priority re-accommodation pilot at the DEN desk, Dec 2025 - Jan 2026). is_current = Winter Storm Harlan.",
        pk="event_id")
    write(spark, fqs, "irops_history", history, T.StructType([
        S("history_pax_id", Str), S("event_id", Str), S("event_date", Dt), S("hub", Str), S("cause_category", Str),
        S("controllable", Bool), S("handling_method", Str), S("loyalty_tier", Str), S("tier_rank", Int),
        S("special_assistance", Bool), S("unaccompanied_minor", Bool), S("lap_infant", Bool), S("away_from_home", Bool),
        S("onward_long_haul", Bool), S("party_size", Int), S("proactive_notice", Bool), S("same_day_reaccommodated", Bool),
        S("overnight", Bool), S("hotel_provided", Bool), S("partner_rebooked", Bool), S("party_split", Bool),
        S("misconnect", Bool), S("arrival_delay_hours", Dbl), S("rebooking_cost_usd", Dbl), S("care_cost_usd", Dbl),
        S("compensation_usd", Dbl), S("total_cost_usd", Dbl), S("nps_score", Int), S("detractor", Bool), S("promoter", Bool)]),
        "One row per passenger disrupted by a past IROPS event, with how they were re-accommodated, cost to Aeralis "
        "(rebooking + care + compensation) and the post-trip NPS survey (nps_score null = no response). "
        "NPS = % promoters (9-10) - % detractors (0-6) among respondents. misconnect = missed an onward long-haul connection.",
        pk="history_pax_id")
    write(spark, fqs, "flights", flights, T.StructType([
        S("flight_id", Str), S("event_id", Str), S("carrier_code", Str), S("carrier_name", Str), S("flight_number", Str),
        S("origin", Str), S("destination", Str), S("sched_dep_local", Ts), S("sched_arr_local", Ts), S("block_minutes", Int),
        S("aircraft_type", Str), S("seats", Int), S("pax_booked", Int), S("status", Str), S("delay_minutes", Int),
        S("cancel_reason", Str), S("cancelled_at", Ts), S("eu_uk_261", Str)]),
        "Winter Storm Harlan (13-15 Feb 2026): the cancelled Aeralis flights at ORD plus every alternate flight "
        "(own metal and Lumen Air partner). Times are LOCAL at origin/destination. eu_uk_261 = regime covering the flight (departs EU/UK).",
        pk="flight_id")
    write(spark, fqs, "alternate_options", options, T.StructType([
        S("option_id", Str), S("disrupted_flight_id", Str), S("option_rank", Int), S("option_type", Str), S("carrier_code", Str),
        S("flight_label", Str), S("alt_flight_id", Str), S("depart_local", Ts), S("arrive_local", Ts), S("arrival_airport", Str),
        S("seats_protected", Int), S("cost_per_seat_usd", Dbl), S("is_partner", Bool), S("same_day", Bool),
        S("nearby_airport", Bool), S("accepts_umnr", Bool), S("arrival_delay_hours", Dbl)]),
        "Seats Ops Control protected for each cancelled flight: OWN_SAME_DAY, PARTNER_SAME_DAY (Lumen Air, interline cost per seat), "
        "NEARBY_AIRPORT, OWN_NEXT_DAY, OWN_D2 (999 = unconstrained). arrival_delay_hours vs the cancelled flight's scheduled arrival.",
        pk="option_id")
    write(spark, fqs, "passengers", pax, T.StructType([
        S("pax_id", Str), S("pnr", Str), S("disrupted_flight_id", Str), S("first_name", Str), S("last_name", Str), S("age", Int),
        S("loyalty_tier", Str), S("cabin", Str), S("fare_brand", Str), S("fare_paid_usd", Dbl), S("booking_date", Dt),
        S("origin_type", Str), S("away_from_home", Bool), S("home_city", Str), S("final_destination", Str), S("onward_flight", Str),
        S("onward_dep_local", Ts), S("onward_long_haul", Bool), S("ssr_codes", Str), S("party_size", Int),
        S("preferred_language", Str), S("contact_channel", Str), S("phone_last4", Str), S("eu_uk_261", Str)]),
        "Passengers disrupted by Winter Storm Harlan. ssr_codes: UMNR unaccompanied minor, WCHR/WCHC wheelchair, BLND/DEAF/MEDA assistance, "
        "INFT travelling with a lap infant, PETC pet in cabin. origin_type LOCAL (lives in the origin city) / VISITOR (going home) / "
        "CONNECTING (connected at ORD). onward_* = an onward long-haul partner connection at the destination.",
        pk="pax_id")
    write(spark, fqs, "autoprotect_rebookings", autoprotect, T.StructType([
        S("pax_id", Str), S("disrupted_flight_id", Str), S("option_id", Str), S("new_flight_label", Str), S("arrive_local", Ts),
        S("arrival_delay_hours", Dbl), S("same_day", Bool), S("overnight", Bool), S("nights", Int), S("misconnect", Bool),
        S("party_split", Bool), S("rebooked_at", Ts)]),
        "What the legacy auto-rebooker (AutoProtect) did at 05:10 CT: FIFO by booking date, own-metal options only, ignores SSR, "
        "tier, onward connections and parties. Seats are HELD (not yet ticketed) — the IROPS desk can re-plan.",
        pk="pax_id")
    write(spark, fqs, "passenger_messages", msgs, T.StructType([
        S("message_id", Str), S("pax_id", Str), S("pnr", Str), S("disrupted_flight_id", Str), S("received_ts", Ts),
        S("channel", Str), S("message_text", Str)]),
        "Inbound messages from Harlan-disrupted passengers (SMS, app chat, web chat, social). Classified by AI Functions into message_insights.",
        pk="message_id")
    write(spark, fqs, "hotel_blocks", [dict(zip(["hotel_id", "airport_code", "hotel_name", "rooms_available", "accessible_rooms",
                                                 "rate_usd", "shuttle_minutes"], h)) for h in HOTELS],
          T.StructType([S("hotel_id", Str), S("airport_code", Str), S("hotel_name", Str), S("rooms_available", Int),
                        S("accessible_rooms", Int), S("rate_usd", Dbl), S("shuttle_minutes", Int)]),
          "Contracted distressed-passenger hotel room blocks for the Harlan night (13 Feb) at ORD, FRA and LHR.", pk="hotel_id")
    write(spark, fqs, "guardrails", [dict(zip(["rule_id", "rule_name", "value", "unit", "description"], g)) for g in GUARDRAILS],
          T.StructType([S("rule_id", Str), S("rule_name", Str), S("value", Dbl), S("unit", Str), S("description", Str)]),
          "Re-accommodation cost and service guardrails the IROPS desk agent enforces (Aeralis IROPS policy).", pk="rule_id")

    # write-back targets (created empty; the IROPS desk app appends)
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {fqs}.rebooking_plans (
        plan_id STRING, disrupted_flight_id STRING, flight_number STRING, status STRING, pax_count INT,
        same_day_count INT, overnight_count INT, protected_priority_count INT, misconnects INT, partner_spend_usd DOUBLE,
        hotel_rooms INT, total_cost_usd DOUBLE, cost_per_pax_usd DOUBLE, predicted_detractor_rate DOUBLE,
        autoprotect_same_day_count INT, autoprotect_total_cost_usd DOUBLE, requires_approval BOOLEAN,
        drafted_by STRING, approved_by STRING, approval_note STRING, committed_at TIMESTAMP)
        COMMENT 'Write-back from the IROPS desk app: one row per committed re-accommodation plan (after Duty Manager approval).'""")
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {fqs}.rebooking_decisions (
        decision_id STRING, plan_id STRING, pax_id STRING, pnr STRING, disrupted_flight_id STRING, option_id STRING,
        new_flight_label STRING, arrive_local TIMESTAMP_NTZ, same_day BOOLEAN, overnight BOOLEAN, hotel_id STRING,
        priority_tier STRING, reason STRING, cost_usd DOUBLE, handling_method STRING, committed_by STRING, committed_at TIMESTAMP)
        COMMENT 'Write-back from the IROPS desk app: one row per passenger rebooking committed by the desk (handling_method = DESK_AGENT).'""")

    for stmt in [
        f"ALTER TABLE {fqs}.irops_history ADD CONSTRAINT history_event_fk FOREIGN KEY (event_id) REFERENCES {fqs}.irops_events RELY",
        f"ALTER TABLE {fqs}.flights ADD CONSTRAINT flights_event_fk FOREIGN KEY (event_id) REFERENCES {fqs}.irops_events RELY",
        f"ALTER TABLE {fqs}.alternate_options ADD CONSTRAINT options_flight_fk FOREIGN KEY (disrupted_flight_id) REFERENCES {fqs}.flights RELY",
        f"ALTER TABLE {fqs}.passengers ADD CONSTRAINT pax_flight_fk FOREIGN KEY (disrupted_flight_id) REFERENCES {fqs}.flights RELY",
        f"ALTER TABLE {fqs}.autoprotect_rebookings ADD CONSTRAINT ap_pax_fk FOREIGN KEY (pax_id) REFERENCES {fqs}.passengers RELY",
        f"ALTER TABLE {fqs}.autoprotect_rebookings ADD CONSTRAINT ap_option_fk FOREIGN KEY (option_id) REFERENCES {fqs}.alternate_options RELY",
        f"ALTER TABLE {fqs}.passenger_messages ADD CONSTRAINT msg_pax_fk FOREIGN KEY (pax_id) REFERENCES {fqs}.passengers RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
