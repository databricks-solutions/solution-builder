"""
Westbrook DHS — SNAP / Medicaid eligibility determination: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, `pip install databricks-connect`,
    DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog public_sector --schema eligibility_copilot

Tables written (Delta, PK/FK RELY constraints + comments):
  counties                 8 counties (urban / suburban / rural) + caseworker FTE now vs a year ago
  caseworkers              eligibility workers per county + the state surge team
  households               one row per applying household
  applications             12 months of SNAP + Medicaid applications (~12k) — the fact table
  application_documents    synthetic OCR text of the verification documents on every OPEN application
  document_truth           generator ground truth for the planted document issues (eval only)
  program_rules            the eligibility rules the agent checks, with CFR + manual citations
  income_limits            FY2026 gross/net limits + SNAP max allotments by household size

THE PLANTED SIGNAL — the "Tamarack bottleneck":
  Tamarack County (rural) lost its paper mill ~150 days ago → application volume +60%,
  while the county office dropped from 7 to 4 caseworkers ~120 days ago. Rural applicants
  apply by mail far more often, arrive with missing verification documents, and every
  Request for Information (RFI) round-trip costs weeks. Result: Tamarack's 30-day
  timeliness collapses from ~85% to <40%, its backlog explodes, and "procedural" denials
  (failure to provide verification — likely-eligible people denied on paperwork) run ~3x
  the state average. Approval rates by race/ethnicity stay flat statewide — the equity
  gap is GEOGRAPHIC, not demographic.
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import types as T

SEED = 20260930
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
WINDOW_DAYS = 365
MILL_CLOSURE = AS_OF - timedelta(days=150)  # Tamarack Paper Co. closes its mill
STAFF_CUT = AS_OF - timedelta(days=120)     # Tamarack office: 7 → 4 caseworkers

# name, region_type, fte_now, fte_prior, population, broadband_pct, office_city, zip_prefix, volume_weight, first_touch_mean_days
COUNTIES = [
    ("Harbor", "urban", 62, 62, 820000, 94, "Port Harbor", "590", 0.30, 4.0),
    ("Capitol", "urban", 47, 48, 610000, 93, "Westbrook City", "591", 0.22, 4.5),
    ("Lakeview", "suburban", 21, 21, 260000, 90, "Lakeview", "592", 0.11, 5.0),
    ("Maple Grove", "suburban", 17, 17, 205000, 89, "Maple Grove", "593", 0.09, 5.0),
    ("Riverbend", "suburban", 15, 16, 180000, 87, "Riverbend", "594", 0.08, 5.5),
    ("Cedar Falls", "rural", 8, 8, 74000, 71, "Cedar Falls", "595", 0.055, 7.0),
    ("Tamarack", "rural", 4, 7, 88000, 62, "Tamarack", "596", 0.075, 6.5),
    ("Pine Ridge", "rural", 6, 6, 61000, 68, "Pine Ridge", "597", 0.055, 7.5),
]
COUNTY = {c[0]: c for c in COUNTIES}

# FY2026 (Oct 2025 – Sep 2026) SNAP gross (130% FPL) + net (100% FPL) monthly limits and max
# allotments (48 states + DC); Medicaid adult MAGI limit = 138% FPL (2025 guidelines).
INCOME_LIMITS = {
    # size: (snap_gross_130, snap_net_100, snap_max_allotment, medicaid_138)
    1: (1696, 1305, 298, 1800),
    2: (2292, 1763, 546, 2433),
    3: (2888, 2221, 785, 3065),
    4: (3483, 2680, 994, 3698),
    5: (4079, 3138, 1183, 4330),
    6: (4675, 3596, 1421, 4963),
    7: (5271, 4055, 1571, 5595),
    8: (5867, 4513, 1789, 6228),
}
SNAP_RESOURCE_LIMIT = 3000
SNAP_RESOURCE_LIMIT_ELDERLY = 4500
SNAP_STANDARD_DEDUCTION = {1: 209, 2: 209, 3: 209, 4: 223, 5: 261, 6: 299}

FIRST = [
    "Dana", "Maria", "James", "Aaliyah", "Robert", "Linh", "Tyler", "Fatima", "Jose", "Emily",
    "Marcus", "Sofia", "Daniel", "Keisha", "Anthony", "Hannah", "Luis", "Grace", "Kevin", "Ana",
    "Brandon", "Mei", "Jasmine", "Carlos", "Olivia", "Hamza", "Rachel", "Derek", "Rosa", "Ethan",
    "Destiny", "Miguel", "Laura", "Andre", "Chloe", "Samuel", "Nadia", "Cody", "Priya", "Wyatt",
    "Tanya", "Juan", "Brittany", "Omar", "Megan", "Dakota", "Yesenia", "Travis", "Amara", "Colton",
]
LAST = [
    "Whitfield", "Delgado", "Johnson", "Nguyen", "Miller", "Garcia", "Brooks", "Hassan", "Martinez",
    "Walker", "Reyes", "Thompson", "Carter", "Lopez", "Harris", "Bennett", "Ramirez", "Young",
    "Sullivan", "Tran", "Price", "Morales", "Jenkins", "Castillo", "Foster", "Ali", "Howard",
    "Ortiz", "Graham", "Flores", "Kowalski", "Begay", "Lindqvist", "Okafor", "Hughes", "Vasquez",
    "Parker", "Yazzie", "Hoffman", "Chen", "Russell", "Mendoza", "Coleman", "Sandoval", "Kim",
]
STREETS = [
    "Birch Ln", "Mill Rd", "Cedar St", "Main St", "Pine Hollow Rd", "Oak Ave", "River Rd",
    "Lakeshore Dr", "Elm St", "Maple Ave", "County Rd 12", "Harbor Blvd", "Depot St",
    "Ridge Rd", "Willow Ct", "School St", "2nd Ave", "Aspen Way", "Timber Ln", "Grange Rd",
]
EMPLOYERS = {
    "urban": ["Harbor Logistics LLC", "Capitol Health System", "QuickMart Stores", "Metro Transit Authority",
              "Bayside Hotel Group", "CleanPro Janitorial", "Westbrook Public Schools"],
    "suburban": ["Lakeview Senior Living", "Riverbend Distribution Center", "Grove Family Dental",
                 "HomeFix Hardware", "Sunrise Child Care", "Maple Grove Diner"],
    "rural": ["Cedar Falls Feed & Supply", "Pine Ridge Ranch Co.", "County Road Diner",
              "Ridgeline Timber Services", "Valley Grocery", "Tamarack Hardware"],
}


def pick(weights: dict):
    r = rng.random() * sum(weights.values())
    acc = 0.0
    for k, w in weights.items():
        acc += w
        if r <= acc:
            return k
    return list(weights)[-1]


def money(x: float) -> str:
    return f"${x:,.2f}"


# ─────────────────────────────────────────────────────────────────────────────
# Counties + caseworkers
# ─────────────────────────────────────────────────────────────────────────────


def build_counties():
    rows = []
    for (name, rtype, fte_now, fte_prior, pop, bb, city, _zp, _w, _ft) in COUNTIES:
        rows.append(dict(
            county_name=name, region_type=rtype, caseworker_fte=fte_now, caseworker_fte_prior_year=fte_prior,
            population=pop, broadband_access_pct=bb, office_city=city,
            notes=(f"Tamarack Paper Company mill closed {MILL_CLOSURE.isoformat()}; county office lost 3 of 7 "
                   f"eligibility workers {STAFF_CUT.isoformat()}") if name == "Tamarack" else None,
        ))
    return rows


def build_caseworkers():
    rows = []
    for (name, _rtype, fte_now, *_rest) in COUNTIES:
        for k in range(fte_now):
            rows.append(dict(caseworker_id=f"CW-{name[:3].upper()}-{k + 1:02d}",
                             caseworker_name=f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                             county_name=name, unit="County office", active=True))
    # The state's regional surge team, deployed to the Tamarack backlog — Keisha is our protagonist.
    for k, nm in enumerate(["Keisha Jackson", "Paul Romero", "Anita Shah"]):
        rows.append(dict(caseworker_id=f"CW-SURGE-{k + 1:02d}", caseworker_name=nm, county_name="Tamarack",
                         unit="State surge team", active=True))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Households + applications (the fact table)
# ─────────────────────────────────────────────────────────────────────────────


def county_weight(name: str, d: date) -> float:
    w = COUNTY[name][8]
    if name == "Tamarack" and d >= MILL_CLOSURE:
        w *= 1.6
    return w


def channel_for(rtype: str):
    if rtype == "urban":
        return pick({"online": 0.70, "in_person": 0.15, "phone": 0.10, "mail": 0.05})
    if rtype == "suburban":
        return pick({"online": 0.60, "in_person": 0.18, "phone": 0.10, "mail": 0.12})
    return pick({"online": 0.32, "in_person": 0.25, "phone": 0.06, "mail": 0.37})


def race_for(rtype: str):
    if rtype == "rural":
        return pick({"White": 0.66, "American Indian/Alaska Native": 0.12, "Hispanic/Latino": 0.12,
                     "Black": 0.04, "Asian": 0.02, "Declined to state": 0.04})
    return pick({"White": 0.46, "Black": 0.21, "Hispanic/Latino": 0.20, "Asian": 0.07,
                 "American Indian/Alaska Native": 0.02, "Declined to state": 0.04})


def build_households_and_applications(caseworkers):
    cw_by_county: dict[str, list[str]] = {}
    for c in caseworkers:
        if c["unit"] == "County office":
            cw_by_county.setdefault(c["county_name"], []).append(c["caseworker_id"])
    households, apps = [], []
    daily_base = 38.0
    app_seq, hh_seq = 100000, 500000
    for back in range(WINDOW_DAYS, -1, -1):
        d = AS_OF - timedelta(days=back)
        weekday_factor = 0.35 if d.weekday() >= 5 else 1.18
        for (name, rtype, *_rest) in COUNTIES:
            lam = daily_base * county_weight(name, d) * weekday_factor
            n = max(0, int(round(rng.gauss(lam, math.sqrt(max(lam, 1))))))
            for _ in range(n):
                hh_seq += 1
                app_seq += 1
                hh, app = make_application(app_seq, hh_seq, name, rtype, d, cw_by_county[name])
                households.append(hh)
                apps.append(app)
    return households, apps


def make_application(app_seq, hh_seq, county, rtype, submitted: date, county_cws, forced: dict | None = None):
    f = forced or {}
    size = f.get("size") or pick({1: .32, 2: .24, 3: .18, 4: .14, 5: .08, 6: .04})
    first, last = f.get("first") or rng.choice(FIRST), f.get("last") or rng.choice(LAST)
    age = f.get("age") or max(18, min(88, int(rng.gauss(41, 15))))
    elderly_disabled = f.get("elderly_disabled", age >= 60 or rng.random() < 0.08)
    lang = f.get("lang") or pick({"English": 0.82, "Spanish": 0.13, "Vietnamese": 0.02, "Somali": 0.015,
                                  "Navajo": 0.01 if rtype == "rural" else 0.0, "Other": 0.015})
    program = f.get("program") or ("SNAP" if rng.random() < 0.58 else "Medicaid")
    channel = f.get("channel") or channel_for(rtype)
    city, zp = COUNTY[county][6], COUNTY[county][7]
    address = f"{rng.randint(12, 4980)} {rng.choice(STREETS)}"
    zipcode = f"{zp}{rng.randint(10, 99)}"

    gross_limit, _net, max_allot, medicaid_limit = INCOME_LIMITS[min(size, 8)]
    limit = gross_limit if program == "SNAP" else medicaid_limit
    post_closure_tam = county == "Tamarack" and submitted >= MILL_CLOSURE
    if "income" in f:
        income = f["income"]
    elif rng.random() < (0.22 if post_closure_tam else 0.09):
        income = 0.0
    else:
        factor = max(0.05, rng.gauss(0.55 if post_closure_tam else 0.70, 0.33))
        income = round(limit * factor, 2)
    resources = f["resources"] if "resources" in f else round(min(rng.expovariate(1 / 850), 12000), 2)
    res_limit = SNAP_RESOURCE_LIMIT_ELDERLY if elderly_disabled else SNAP_RESOURCE_LIMIT
    expedited = bool(f["expedited"]) if "expedited" in f else (program == "SNAP" and income < 150 and resources <= 100)

    # ── process simulation ──────────────────────────────────────────────────
    tam_strained = county == "Tamarack" and submitted >= STAFF_CUT - timedelta(days=20)
    ft_mean = 21.0 if tam_strained else COUNTY[county][9]  # 4 workers + 60% more volume → 2+ week queue
    # Mandatory eligibility interview (7 CFR 273.2(e)) — scheduling wait scales with staffing.
    interview_wait = int(rng.gammavariate(3.0, (13.0 if tam_strained else 6.5 if rtype == "rural" else 5.5) / 3.0))
    first_touch = max(0, int(rng.gammavariate(2.0, ft_mean / 2.0)))
    p_missing = {"online": 0.17, "in_person": 0.12, "phone": 0.34, "mail": 0.46}[channel] + (0.12 if tam_strained else 0.0)
    missing_at_submission = f["missing"] if "missing" in f else rng.random() < p_missing
    rfi_count, rfi_delay = 0, 0
    if missing_at_submission:
        rfi_count = 1 + (1 if rng.random() < (0.45 if channel == "mail" else 0.25) else 0)
        per = 10 + (6 if channel == "mail" else 0) + (12 if tam_strained else 5 if rtype == "rural" else 2)
        rfi_delay = sum(max(3, int(rng.gauss(per, 3))) for _ in range(rfi_count))
    review = rng.randint(2, 6) + interview_wait
    processing_days = first_touch + review + rfi_delay
    if expedited:
        # Expedited SNAP must be decided in 7 days — most offices manage it, Tamarack's queue doesn't.
        tam_late = tam_strained and rng.random() >= 0.35
        processing_days = first_touch + review if tam_late else rng.randint(2, 7)
    determined = submitted + timedelta(days=processing_days)
    is_open = f.get("open", False) or determined > AS_OF

    p_proc_fail = 0.18 + (0.12 if channel == "mail" else 0) + (0.30 if tam_strained else 0)
    procedural = missing_at_submission and rng.random() < p_proc_fail

    determination = denial_reason = det_date = proc_days = None
    if is_open:
        status = "awaiting_verification" if (missing_at_submission and rng.random() < 0.7) else "pending_review"
    else:
        det_date, proc_days = determined, processing_days
        if rng.random() < 0.03:
            status, determination, denial_reason = "withdrawn", "WITHDRAWN", "applicant_withdrew"
        elif procedural:
            status, determination, denial_reason = "denied", "DENIED", "failure_to_provide_verification"
        elif income > limit:
            status, determination, denial_reason = "denied", "DENIED", "income_over_limit"
        elif program == "SNAP" and resources > res_limit and rng.random() < 0.8:
            status, determination, denial_reason = "denied", "DENIED", "resources_over_limit"
        elif rng.random() < 0.012:
            status, determination, denial_reason = "denied", "DENIED", "not_state_resident"
        else:
            status, determination = "approved", "APPROVED"

    benefit = None
    if determination == "APPROVED" and program == "SNAP":
        net = max(0.0, income * 0.8 - SNAP_STANDARD_DEDUCTION[min(size, 6)])
        benefit = float(max(24, round(max_allot - 0.3 * net)))

    first_touch_date = submitted + timedelta(days=first_touch)
    hh = dict(
        household_id=f"HH-{hh_seq}", head_first_name=first, head_last_name=last, head_age=age,
        household_size=size, children_under_18=max(0, min(size - 1, int(rng.gauss(size * 0.45, 0.8)))),
        elderly_or_disabled_member=bool(elderly_disabled), preferred_language=lang,
        race_ethnicity=f.get("race") or race_for(rtype), county_name=county, city=city,
        street_address=address, zip_code=zipcode, phone=f"(5{rng.randint(10, 99)}) 555-{rng.randint(1000, 9999)}",
    )
    app = dict(
        application_id=f"APP-{app_seq}", household_id=hh["household_id"], program=program, county_name=county,
        channel=channel, submitted_date=submitted, expedited_screening=expedited,
        reported_monthly_income=float(income), reported_liquid_resources=float(resources),
        citizenship_verified_electronically=bool(f["ssa_match"]) if "ssa_match" in f else rng.random() < 0.9,
        status=status, determination=determination, denial_reason=denial_reason,
        first_touch_date=first_touch_date if first_touch_date <= AS_OF else None,
        determination_date=det_date, processing_days=proc_days,
        days_open=(AS_OF - submitted).days if is_open else None, rfi_count=rfi_count,
        caseworker_id=f.get("caseworker_id") or rng.choice(county_cws), monthly_benefit_amount=benefit,
        _missing=missing_at_submission,
    )
    return hh, app


# ─────────────────────────────────────────────────────────────────────────────
# Hero cases (deterministic — the demo script walks through these)
# ─────────────────────────────────────────────────────────────────────────────

HERO_CASES = [
    # The mill layoff: a pre-layoff paystub says "over income", the layoff letter says $0 now,
    # and the household qualified for 7-day expedited service 31 days ago.
    dict(application_id="APP-240117", first="Dana", last="Whitfield", size=4, program="SNAP", channel="mail",
         days_ago=38, income=0.0, resources=60.0, expedited=True, lang="English", age=44, missing=False,
         caseworker_id="CW-SURGE-01", race="White", ssa_match=True,
         docs=["photo_id", "lease", "paystub_pre_layoff", "layoff_letter"]),
    # Spanish-preferring Medicaid applicant: no residency proof + a paystub that is too old → RFI in Spanish.
    dict(application_id="APP-240233", first="Maria", last="Delgado", size=3, program="Medicaid", channel="phone",
         days_ago=24, income=2140.0, resources=620.0, lang="Spanish", age=36, missing=True,
         caseworker_id="CW-SURGE-01", race="Hispanic/Latino", ssa_match=True,
         docs=["photo_id", "paystub_stale"]),
    # Over the gross income limit — a clean, well-documented denial with appeal rights.
    dict(application_id="APP-240358", first="Robert", last="Kowalski", size=2, program="SNAP", channel="online",
         days_ago=12, income=3310.0, resources=2100.0, lang="English", age=52, missing=False,
         caseworker_id="CW-SURGE-01", race="White", ssa_match=True,
         docs=["photo_id", "utility_bill", "paystub", "paystub", "bank_statement"]),
    # Clean approval, everything verified.
    dict(application_id="APP-240402", first="Aaliyah", last="Brooks", size=3, program="SNAP", channel="online",
         days_ago=9, income=1480.0, resources=310.0, lang="English", age=29, missing=False,
         caseworker_id="CW-SURGE-01", race="Black", ssa_match=True,
         docs=["photo_id", "lease", "paystub", "paystub", "bank_statement"]),
    # Expired ID + out-of-state lease → needs verification.
    dict(application_id="APP-240519", first="Tyler", last="Begay", size=1, program="SNAP", channel="in_person",
         days_ago=33, income=980.0, resources=55.0, lang="English", age=23, missing=True,
         caseworker_id="CW-SURGE-01", race="American Indian/Alaska Native", ssa_match=True,
         docs=["photo_id_expired", "lease_out_of_state", "paystub"]),
]


def add_hero_cases(households, apps):
    for i, h in enumerate(HERO_CASES):
        submitted = AS_OF - timedelta(days=h["days_ago"])
        hh, app = make_application(0, 900000 + i, "Tamarack", "rural", submitted, ["CW-TAM-01"], forced=dict(h, open=True))
        app.update(application_id=h["application_id"], status="awaiting_verification" if h["missing"] else "pending_review",
                   determination=None, denial_reason=None, determination_date=None, processing_days=None,
                   monthly_benefit_amount=None, days_open=h["days_ago"], rfi_count=0, first_touch_date=None,
                   _hero_docs=h["docs"])
        households.append(hh)
        apps.append(app)


# ─────────────────────────────────────────────────────────────────────────────
# Documents (synthetic OCR text) for the OPEN queue
# ─────────────────────────────────────────────────────────────────────────────

FREQ = {"weekly": 52 / 12, "biweekly": 26 / 12, "semimonthly": 2, "monthly": 1}


def paystub_text(name, employer, pay_date: date, monthly_income: float, freq: str):
    gross = round(monthly_income / FREQ[freq], 2)
    period_days = {"weekly": 7, "biweekly": 14, "semimonthly": 15, "monthly": 30}[freq]
    start, end = pay_date - timedelta(days=period_days + 4), pay_date - timedelta(days=5)
    rate = round(rng.uniform(14.5, 27.0), 2)
    hours = round(gross / rate, 1)
    ytd = round(gross * rng.randint(8, 30), 2)
    net = round(gross * rng.uniform(0.76, 0.86), 2)
    return (f"{employer.upper()}\nEARNINGS STATEMENT\n\nEmployee: {name}        Employee ID: {rng.randint(10000, 99999)}\n"
            f"Pay Period: {start:%m/%d/%Y} - {end:%m/%d/%Y}      Pay Date: {pay_date:%m/%d/%Y}\n"
            f"Pay Frequency: {freq.capitalize()}\n\nEARNINGS        HOURS     RATE      CURRENT       YTD\n"
            f"Regular         {hours:>6}    {rate:>6}    {money(gross):>10}   {money(ytd):>11}\n\n"
            f"GROSS PAY {money(gross)}\nFed Withholding {money(gross * 0.07)}   FICA {money(gross * 0.0765)}\n"
            f"NET PAY {money(net)}\n")


def id_text(name, dob: date, address, city, zipcode, exp: date):
    return (f"STATE OF WESTBROOK\nDEPARTMENT OF MOTOR VEHICLES\nDRIVER LICENSE / IDENTIFICATION CARD\n\n"
            f"DL NO. W{rng.randint(1000000, 9999999)}\nNAME: {name.upper()}\nDOB: {dob:%m/%d/%Y}\n"
            f"ADDRESS: {address.upper()}, {city.upper()}, WB {zipcode}\n"
            f"ISS: {(exp - timedelta(days=365 * 8)):%m/%d/%Y}   EXP: {exp:%m/%d/%Y}\nCLASS: C\n")


def lease_text(name, address, city, state, zipcode, rent, start: date):
    landlord = rng.choice(["Birchwood Property Mgmt", "R. & J. Lindqvist", "Northside Rentals LLC",
                           "Tamarack Housing Authority", "Harbor Point Apartments"])
    return (f"RESIDENTIAL LEASE AGREEMENT\n\nThis Lease is made on {start:%B %d, %Y} between {landlord} (\"Landlord\") "
            f"and {name} (\"Tenant\").\nPREMISES: {address}, {city}, {state} {zipcode}\nTERM: 12 months beginning "
            f"{start:%m/%d/%Y} and ending {(start + timedelta(days=365)):%m/%d/%Y}.\nMONTHLY RENT: {money(rent)} due on "
            f"the 1st of each month.\nUTILITIES: Tenant pays electric; Landlord pays water/sewer.\n\nTenant signature: {name}\n")


def utility_text(name, address, city, zipcode, bill_date: date):
    amt = round(rng.uniform(62, 240), 2)
    return (f"WESTBROOK POWER & LIGHT\nSTATEMENT DATE: {bill_date:%m/%d/%Y}\nACCOUNT: {rng.randint(100000000, 999999999)}\n"
            f"SERVICE FOR: {name.upper()}\nSERVICE ADDRESS: {address}, {city}, WB {zipcode}\n"
            f"Billing period {(bill_date - timedelta(days=31)):%m/%d} - {bill_date:%m/%d}  kWh used: {rng.randint(300, 1100)}\n"
            f"AMOUNT DUE: {money(amt)}   DUE BY {(bill_date + timedelta(days=21)):%m/%d/%Y}\n")


def bank_text(name, stmt_date: date, balance):
    bank = rng.choice(["Westbrook Community Credit Union", "First Harbor Bank", "Ridgeline Savings & Loan"])
    return (f"{bank.upper()}\nACCOUNT STATEMENT\nAccount holder: {name}\nStatement period ending {stmt_date:%m/%d/%Y}\n"
            f"Checking ****{rng.randint(1000, 9999)}\nBeginning balance {money(balance * rng.uniform(0.6, 1.6))}\n"
            f"Deposits {money(rng.uniform(200, 2400))}   Withdrawals {money(rng.uniform(200, 2400))}\n"
            f"ENDING BALANCE {money(balance)}\n")


def layoff_text(name, employer, end_date: date):
    return (f"{employer.upper()}\nHuman Resources Department\n\n{(end_date - timedelta(days=14)):%B %d, %Y}\n\n"
            f"Dear {name},\n\nAs announced, {employer} will permanently close its Tamarack mill. This letter is formal "
            f"notice that your employment will end on {end_date:%B %d, %Y}. Your final paycheck, including accrued "
            f"vacation, will be issued on {(end_date + timedelta(days=5)):%B %d, %Y}. No severance is payable. You "
            f"may be eligible for unemployment insurance and state assistance programs.\n\nSincerely,\nL. Harmon, HR Manager\n")


def no_income_text(name, signed: date):
    return (f"WESTBROOK DEPARTMENT OF HUMAN SERVICES\nSTATEMENT OF NO INCOME (Form DHS-2107)\n\n"
            f"I, {name}, state that no member of my household has received earned or unearned income in the "
            f"30 days before my application. I understand that I must report any new income within 10 days.\n\n"
            f"Signed: {name}      Date: {signed:%m/%d/%Y}\n")


def build_documents(households, apps):
    hh_by_id = {h["household_id"]: h for h in households}
    docs, truth = [], []
    seq = 7000000
    for a in apps:
        if a["status"] not in ("pending_review", "awaiting_verification"):
            continue
        hh = hh_by_id[a["household_id"]]
        name = f'{hh["head_first_name"]} {hh["head_last_name"]}'
        sub = a["submitted_date"]
        rtype = COUNTY[a["county_name"]][1]
        income = a["reported_monthly_income"]
        dob = AS_OF - timedelta(days=365 * hh["head_age"] + rng.randint(0, 364))
        employer = rng.choice(EMPLOYERS[rtype])
        freq = pick({"biweekly": 0.5, "weekly": 0.25, "semimonthly": 0.15, "monthly": 0.10})

        plan = a.get("_hero_docs")
        issues: list[str] = []
        if plan is None:
            plan = ["photo_id", "lease" if rng.random() < 0.6 else "utility_bill"]
            if income > 0:
                plan += ["paystub"] * (2 if freq in ("weekly", "biweekly") and rng.random() < 0.6 else 1)
            elif a["county_name"] == "Tamarack" and sub >= MILL_CLOSURE and rng.random() < 0.6:
                plan += ["paystub_pre_layoff", "layoff_letter"]
            else:
                plan.append("no_income_statement")
            if a["program"] == "SNAP" and rng.random() < 0.45:
                plan.append("bank_statement")
            if a["_missing"]:
                drop = pick({"income": 0.5, "residency": 0.3, "identity": 0.2})
                if drop == "income":
                    plan = [p for p in plan if not (p.startswith("paystub") or p in ("layoff_letter", "no_income_statement"))]
                elif drop == "residency":
                    plan = [p for p in plan if p not in ("lease", "utility_bill")]
                else:
                    plan = [p for p in plan if p != "photo_id"]
                issues.append(f"missing_{drop}")
            r = rng.random()
            if r < 0.08 and "paystub" in plan:
                plan[plan.index("paystub")] = "paystub_stale"
            elif r < 0.13 and "photo_id" in plan:
                plan[plan.index("photo_id")] = "photo_id_expired"
            elif r < 0.16 and "lease" in plan:
                plan[plan.index("lease")] = "lease_out_of_state"
        else:
            if "lease" not in plan and "utility_bill" not in plan and "lease_out_of_state" not in plan:
                issues.append("missing_residency")

        pay_idx = 0
        for kind in plan:
            seq += 1
            received = sub + timedelta(days=rng.randint(0, 2))
            if kind == "photo_id":
                dtype, text = "photo_id", id_text(name, dob, hh["street_address"], hh["city"], hh["zip_code"],
                                                  AS_OF + timedelta(days=rng.randint(200, 2500)))
            elif kind == "photo_id_expired":
                dtype, text = "photo_id", id_text(name, dob, hh["street_address"], hh["city"], hh["zip_code"],
                                                  sub - timedelta(days=rng.randint(40, 700)))
                issues.append("expired_id")
            elif kind == "lease":
                dtype, text = "lease", lease_text(name, hh["street_address"], hh["city"], "WB", hh["zip_code"],
                                                  round(rng.uniform(550, 1650), 0), sub - timedelta(days=rng.randint(30, 600)))
            elif kind == "lease_out_of_state":
                dtype, text = "lease", lease_text(name, f"{rng.randint(100, 999)} Garnet St", "Coeur d'Alene", "ID",
                                                  "83814", round(rng.uniform(700, 1300), 0), sub - timedelta(days=rng.randint(30, 400)))
                issues.append("out_of_state_address")
            elif kind == "utility_bill":
                dtype, text = "utility_bill", utility_text(name, hh["street_address"], hh["city"], hh["zip_code"],
                                                           sub - timedelta(days=rng.randint(3, 40)))
            elif kind == "paystub":
                dtype = "paystub"
                text = paystub_text(name, employer, sub - timedelta(days=3 + 14 * pay_idx + rng.randint(0, 4)), income, freq)
                pay_idx += 1
            elif kind == "paystub_stale":
                dtype = "paystub"
                text = paystub_text(name, employer, sub - timedelta(days=rng.randint(48, 85)), income, freq)
                issues.append("stale_paystub")
            elif kind == "paystub_pre_layoff":
                # Pre-layoff mill wages: well over the limit — the trap the agent must not fall into.
                dtype = "paystub"
                text = paystub_text(name, "Tamarack Paper Company", sub - timedelta(days=rng.randint(20, 26)),
                                    round(rng.uniform(3900, 4400), 2), "biweekly")
                issues.append("pre_layoff_paystub")
            elif kind == "layoff_letter":
                dtype, text = "employer_letter", layoff_text(name, "Tamarack Paper Company",
                                                             sub - timedelta(days=rng.randint(12, 16)))
            elif kind == "no_income_statement":
                dtype, text = "self_declaration", no_income_text(name, sub)
            elif kind == "bank_statement":
                dtype, text = "bank_statement", bank_text(name, sub - timedelta(days=rng.randint(3, 30)),
                                                          a["reported_liquid_resources"])
            else:
                continue
            docs.append(dict(document_id=f"DOC-{seq}", application_id=a["application_id"], doc_type=dtype,
                             received_date=received, file_name=f"{a['application_id']}_{dtype}_{seq}.pdf",
                             page_count=rng.randint(3, 6) if dtype == "lease" else 1, document_text=text))
        truth.append(dict(application_id=a["application_id"], planted_issues=",".join(issues) if issues else "none"))
    return docs, truth


# ─────────────────────────────────────────────────────────────────────────────
# Program rules
# ─────────────────────────────────────────────────────────────────────────────

PROGRAM_RULES = [
    # rule_id, program, order, category, rule_name, requirement, required_documents, cfr_citation, manual_section
    ("SNAP-ID", "SNAP", 1, "verification", "Identity verified",
     "Identity of the head of household must be verified with a current, unexpired document (photo ID, passport, or equivalent).",
     "photo_id", "7 CFR 273.2(f)(1)(vii)", "WDHS Manual §3.1"),
    ("SNAP-RES", "SNAP", 2, "verification", "Westbrook residency verified",
     "Household must live in Westbrook. Verify with a lease, rent receipt, or utility bill showing a Westbrook address.",
     "lease|utility_bill", "7 CFR 273.3; 7 CFR 273.2(f)(1)(vi)", "WDHS Manual §3.2"),
    ("SNAP-INC-VER", "SNAP", 3, "verification", "Gross income verified (last 30 days)",
     "Gross earned income must be verified with pay stubs covering the 30 days before the application date, or an employer letter. "
     "Terminated income is verified with a termination or layoff notice; no income is verified with a signed statement (DHS-2107).",
     "paystub|employer_letter|self_declaration", "7 CFR 273.2(f)(1)(i)", "WDHS Manual §3.3"),
    ("SNAP-GROSS", "SNAP", 4, "income", "Gross income at or below 130% FPL",
     "Countable gross monthly income must be at or below 130% of the federal poverty level for the household size. "
     "Income from a job that has ended is not anticipated income and is not counted.",
     "paystub|employer_letter|self_declaration", "7 CFR 273.9(a)(1); 7 CFR 273.10(c)", "WDHS Manual §4.1"),
    ("SNAP-RESOURCES", "SNAP", 5, "resources", "Countable resources within limit",
     "Countable liquid resources must not exceed $3,000 ($4,500 if a member is 60+ or disabled). Self-attestation is accepted unless questionable.",
     "bank_statement", "7 CFR 273.8(b)", "WDHS Manual §4.4"),
    ("SNAP-EXPEDITE", "SNAP", 6, "timeliness", "Expedited service screening",
     "Households with gross monthly income under $150 and liquid resources of $100 or less must receive benefits within 7 days of application.",
     "", "7 CFR 273.2(i)", "WDHS Manual §2.3"),
    ("MA-ID", "Medicaid", 1, "verification", "Identity verified",
     "Identity must be verified with a current photo ID or through electronic data sources.",
     "photo_id", "42 CFR 435.407", "WDHS Manual §7.2"),
    ("MA-RES", "Medicaid", 2, "verification", "Westbrook residency verified",
     "Applicant must be a Westbrook resident; verify with a lease, utility bill, or other residency document.",
     "lease|utility_bill", "42 CFR 435.403; 42 CFR 435.956(c)", "WDHS Manual §7.3"),
    ("MA-CIT", "Medicaid", 3, "verification", "Citizenship / immigration status verified",
     "Citizenship or satisfactory immigration status is verified electronically through the SSA/DHS federal data hub; otherwise documentary evidence is required.",
     "", "42 CFR 435.406; 42 CFR 435.956(a)", "WDHS Manual §7.4"),
    ("MA-INC-VER", "Medicaid", 4, "verification", "Income verified (last 30 days)",
     "Current monthly income must be verified with pay stubs from the 30 days before the application; self-attested income is accepted when within 10% of verified income.",
     "paystub|employer_letter|self_declaration", "42 CFR 435.948; 42 CFR 435.952", "WDHS Manual §7.5"),
    ("MA-MAGI", "Medicaid", 5, "income", "MAGI income at or below 138% FPL",
     "Modified adjusted gross income must be at or below 138% of the federal poverty level for the household size.",
     "paystub|employer_letter|self_declaration", "42 CFR 435.119; 42 CFR 435.603", "WDHS Manual §7.1"),
]


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
    ap.add_argument("--catalog", default="public_sector")
    ap.add_argument("--schema", default="eligibility_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Westbrook DHS — AI-enabled SNAP/Medicaid eligibility determination demo'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.policy_manual COMMENT 'WDHS eligibility policy manual - documents searched by the Genie agent'")
    for t in ["document_extractions", "application_documents", "document_truth", "applications", "households",
              "caseworkers", "counties", "program_rules", "income_limits"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    print(f"AS_OF={AS_OF} mill_closure={MILL_CLOSURE} staff_cut={STAFF_CUT}")
    counties = build_counties()
    caseworkers = build_caseworkers()
    households, apps = build_households_and_applications(caseworkers)
    add_hero_cases(households, apps)
    docs, truth = build_documents(households, apps)
    print(f"generated: {len(households)} households, {len(apps)} applications, {len(docs)} documents")

    write(spark, fqs, "counties", counties, T.StructType([
        S("county_name", T.StringType()), S("region_type", T.StringType()), S("caseworker_fte", T.IntegerType()),
        S("caseworker_fte_prior_year", T.IntegerType()), S("population", T.IntegerType()),
        S("broadband_access_pct", T.IntegerType()), S("office_city", T.StringType()), S("notes", T.StringType())]),
        "Westbrook counties served by DHS: region type (urban/suburban/rural), eligibility-worker FTE now vs a year ago, population.",
        pk="county_name")
    write(spark, fqs, "caseworkers", caseworkers, T.StructType([
        S("caseworker_id", T.StringType()), S("caseworker_name", T.StringType()), S("county_name", T.StringType()),
        S("unit", T.StringType()), S("active", T.BooleanType())]),
        "Eligibility workers. unit = County office, or the State surge team deployed to the Tamarack backlog.",
        pk="caseworker_id")
    write(spark, fqs, "households", households, T.StructType([
        S("household_id", T.StringType()), S("head_first_name", T.StringType()), S("head_last_name", T.StringType()),
        S("head_age", T.IntegerType()), S("household_size", T.IntegerType()), S("children_under_18", T.IntegerType()),
        S("elderly_or_disabled_member", T.BooleanType()), S("preferred_language", T.StringType()),
        S("race_ethnicity", T.StringType()), S("county_name", T.StringType()), S("city", T.StringType()),
        S("street_address", T.StringType()), S("zip_code", T.StringType()), S("phone", T.StringType())]),
        "Applying households (synthetic). race_ethnicity is self-reported for civil-rights reporting only — never used in determinations.",
        pk="household_id")
    write(spark, fqs, "applications", apps, T.StructType([
        S("application_id", T.StringType()), S("household_id", T.StringType()), S("program", T.StringType()),
        S("county_name", T.StringType()), S("channel", T.StringType()), S("submitted_date", T.DateType()),
        S("expedited_screening", T.BooleanType()), S("reported_monthly_income", T.DoubleType()),
        S("reported_liquid_resources", T.DoubleType()), S("citizenship_verified_electronically", T.BooleanType()),
        S("status", T.StringType()), S("determination", T.StringType()), S("denial_reason", T.StringType()),
        S("first_touch_date", T.DateType()), S("determination_date", T.DateType()), S("processing_days", T.IntegerType()),
        S("days_open", T.IntegerType()), S("rfi_count", T.IntegerType()), S("caseworker_id", T.StringType()),
        S("monthly_benefit_amount", T.DoubleType())]),
        "SNAP + Medicaid applications, last 12 months. status: pending_review | awaiting_verification | approved | denied | withdrawn. "
        "processing_days = submitted to determination (federal standard 30 days; 7 days for expedited SNAP). "
        "denial_reason failure_to_provide_verification = a procedural denial.",
        pk="application_id")
    write(spark, fqs, "application_documents", docs, T.StructType([
        S("document_id", T.StringType()), S("application_id", T.StringType()), S("doc_type", T.StringType()),
        S("received_date", T.DateType()), S("file_name", T.StringType()), S("page_count", T.IntegerType()),
        S("document_text", T.StringType())]),
        "Verification documents on every open application (OCR text of paystubs, IDs, leases, utility bills, bank statements, employer letters, no-income statements).",
        pk="document_id")
    write(spark, fqs, "document_truth", truth, T.StructType([
        S("application_id", T.StringType()), S("planted_issues", T.StringType())]),
        "Generator ground truth of the document issues planted in each open case — for evaluating the AI only, never shown to it.",
        pk="application_id")
    rule_cols = ["rule_id", "program", "rule_order", "category", "rule_name", "requirement", "required_documents",
                 "cfr_citation", "manual_section"]
    write(spark, fqs, "program_rules", [dict(zip(rule_cols, r)) for r in PROGRAM_RULES], T.StructType([
        S("rule_id", T.StringType()), S("program", T.StringType()), S("rule_order", T.IntegerType()),
        S("category", T.StringType()), S("rule_name", T.StringType()), S("requirement", T.StringType()),
        S("required_documents", T.StringType()), S("cfr_citation", T.StringType()), S("manual_section", T.StringType())]),
        "Eligibility rules the agent checks case by case, with the federal regulation and WDHS policy-manual section to cite.",
        pk="rule_id")
    write(spark, fqs, "income_limits", [
        dict(household_size=k, snap_gross_monthly_limit=float(v[0]), snap_net_monthly_limit=float(v[1]),
             snap_max_allotment=float(v[2]), medicaid_monthly_limit=float(v[3]),
             snap_resource_limit=float(SNAP_RESOURCE_LIMIT), snap_resource_limit_elderly_disabled=float(SNAP_RESOURCE_LIMIT_ELDERLY))
        for k, v in INCOME_LIMITS.items()], T.StructType([
        S("household_size", T.IntegerType()), S("snap_gross_monthly_limit", T.DoubleType()),
        S("snap_net_monthly_limit", T.DoubleType()), S("snap_max_allotment", T.DoubleType()),
        S("medicaid_monthly_limit", T.DoubleType()), S("snap_resource_limit", T.DoubleType()),
        S("snap_resource_limit_elderly_disabled", T.DoubleType())]),
        "FY2026 SNAP gross (130% FPL) / net (100% FPL) limits + max allotments, and Medicaid adult 138% FPL limits, by household size.",
        pk="household_size")

    for stmt in [
        f"ALTER TABLE {fqs}.applications ADD CONSTRAINT applications_household_fk FOREIGN KEY (household_id) REFERENCES {fqs}.households RELY",
        f"ALTER TABLE {fqs}.applications ADD CONSTRAINT applications_county_fk FOREIGN KEY (county_name) REFERENCES {fqs}.counties RELY",
        f"ALTER TABLE {fqs}.applications ADD CONSTRAINT applications_caseworker_fk FOREIGN KEY (caseworker_id) REFERENCES {fqs}.caseworkers RELY",
        f"ALTER TABLE {fqs}.application_documents ADD CONSTRAINT documents_application_fk FOREIGN KEY (application_id) REFERENCES {fqs}.applications RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
