"""
Tidewell Specialty Insurance — commercial P&C underwriting copilot: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema> and renders the broker
submission packets (application / statement of values / loss run PDFs) into the submission_docs volume.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless, env with `reportlab`): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv with databricks-connect + reportlab)

    python generate_data.py --catalog financial_services --schema commercial_underwriting_copilot

Tidewell Specialty Insurance is a FICTIONAL US middle-market commercial property & casualty carrier.
Every insured, broker, carrier and person below is fictional. US states and cities are real.

Tables written (Delta, PK/FK RELY constraints + comments):
  brokers              the 36 wholesale / retail brokers that send Tidewell business (tier, hit ratio drivers)
  policies             ~2,700 commercial property/package policies (eff. Jul-2023 → Jun-2026), underwriting
                       characteristics at bind (segment, state, construction, roof age, sprinklers, TIV, prior losses)
  policy_quarters      earned premium per policy per calendar quarter (2024-Q3 → 2026-Q2)
  claims               ~6,000 claims (loss date, peril, incurred) — the book's loss experience
  submission_history   ~4,600 historical submissions with their outcome (bound / quoted-not-bound / declined)
  submission_inbox     the 24 broker submissions waiting in the underwriting queue today (Mon 28 Sep 2026):
                       email metadata only — the facts live in the attached PDFs
  submission_documents one row per attached PDF (application, SOV, loss run) → /Volumes/.../submission_docs
  appetite_rules       the machine-readable appetite + authority rules the triage and the workbench enforce
  rating_factors       the property rating plan (base rates and modifiers) the pricing engine uses
  uw_decisions         (empty) write-back of the underwriter's quote / decline decisions from the app

THE PLANTED SIGNAL
  * Portfolio: the book runs a steady ~55-60% loss ratio — except HABITATIONAL risks in the HAIL BELT
    (TX, OK, KS, NE, CO). Their loss ratio climbs from ~60% (2024-Q3) to ~110% (2026-Q2), driven by hail and
    wind on buildings with roofs older than 15 years (~165% in 2026-Q2) while newer roofs stay ~70%.
    → Tidewell issued Appetite Bulletin TSI-UW-B-2026-07 (eff. 1 Jul 2026): no hail-belt habitational
    location with a roof older than 15 years without a CUO exception.
  * Queue: SUB-26-0417 Lone Star Residential Partners LP (Halvorsen & Pike, 4 apartment communities in
    Dallas-Fort Worth, TIV $38.6M) LOOKS clean: the application says roofs 2019, sprinklered, joisted masonry,
    one $18,400 loss in five years. The ML model scores it LOW on those facts. The documents disagree:
    the SOV shows location 3, Cedar Hollow Apartments (Arlington TX) — frame, built 1984, unsprinklered,
    roof 2004 (22 years) — and the loss run shows two hail/wind claims there ($212,600 in 2024, $96,300 open
    in 2025) plus a GL claim: 4 losses, $369,300. Cedar Hollow is out of appetite under the bulletin.
  * Contrast: SUB-26-0422 Brazos Valley Cold Storage (in appetite, within authority → quote) and
    SUB-26-0409 Gulf Breeze Motor Lodge (Tier-1 coastal Florida wind → decline).
"""
from __future__ import annotations

import argparse
import math
import os
import random
from datetime import date, datetime, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import types as T

SEED = 20260928
rng = random.Random(SEED)

TODAY = date(2026, 9, 28)
WIN_START = date(2024, 7, 1)
WIN_END = date(2026, 6, 30)
QUARTERS = ["2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]
HAIL_BELT = {"TX", "OK", "KS", "NE", "CO"}


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


def pick(weights: dict):
    r = rng.random() * sum(weights.values())
    for k, w in weights.items():
        r -= w
        if r <= 0:
            return k
    return k


def quarter_of(d: date) -> str:
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def quarter_bounds(q: str) -> tuple[date, date]:
    y, n = int(q[:4]), int(q[-1])
    start = date(y, 3 * (n - 1) + 1, 1)
    end = date(y + (n == 4), (3 * n) % 12 + 1, 1) - timedelta(days=1)
    return start, end


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────

SEGMENTS = {
    # code: (label, share of book, base loss ratio, class descriptions)
    "HAB": ("Habitational", 0.24, 0.58, ["Apartments - garden style", "Apartments - mid-rise", "Condominium association"]),
    "RET": ("Retail & Restaurants", 0.18, 0.55, ["Strip retail center", "Full-service restaurant", "Grocery store"]),
    "MFG": ("Light Manufacturing", 0.16, 0.60, ["Metal fabrication", "Plastics molding", "Food processing"]),
    "WHS": ("Warehouse & Distribution", 0.16, 0.52, ["Dry storage warehouse", "Cold storage", "Distribution center"]),
    "OFF": ("Office & Professional", 0.16, 0.44, ["Office building", "Medical office", "Flex office"]),
    "HOS": ("Hospitality", 0.10, 0.62, ["Limited-service hotel", "Motel", "Extended-stay hotel"]),
}

STATES = {
    # state: (weight, cities)
    "TX": (0.22, ["Dallas", "Fort Worth", "Plano", "Arlington", "Austin", "San Antonio", "Houston", "Waco", "Frisco"]),
    "OK": (0.06, ["Oklahoma City", "Tulsa", "Norman"]),
    "KS": (0.04, ["Wichita", "Overland Park", "Topeka"]),
    "NE": (0.03, ["Omaha", "Lincoln"]),
    "CO": (0.07, ["Denver", "Colorado Springs", "Aurora"]),
    "GA": (0.08, ["Atlanta", "Savannah", "Macon"]),
    "NC": (0.07, ["Charlotte", "Raleigh", "Greensboro"]),
    "TN": (0.07, ["Nashville", "Memphis", "Knoxville"]),
    "AZ": (0.07, ["Phoenix", "Tucson", "Mesa"]),
    "IL": (0.08, ["Chicago", "Naperville", "Peoria"]),
    "OH": (0.08, ["Columbus", "Cleveland", "Cincinnati"]),
    "PA": (0.07, ["Pittsburgh", "Philadelphia", "Allentown"]),
    "FL": (0.06, ["Orlando", "Tampa", "Jacksonville"]),
}

CONSTRUCTIONS = ["Frame", "Joisted masonry", "Masonry non-combustible", "Fire resistive"]
PERIL_SEVERITY = {"Hail": 52000, "Wind": 38000, "Fire": 88000, "Water damage": 17000, "Theft / vandalism": 8000,
                  "Liability - premises": 24000, "Equipment breakdown": 28000}

UNDERWRITERS = ["Dana Whitfield", "Luis Carranza", "Megan Tolliver", "Arjun Mehta", "Sofia Lindqvist", "Grant Okafor"]

BROKER_NAMES = [
    ("Halvorsen & Pike Insurance Services", "Dallas", "TX", "Premier"),
    ("Brightwater Risk Partners", "Atlanta", "GA", "Premier"),
    ("Copperline Brokerage", "Denver", "CO", "Premier"),
    ("Keel & Marrow Insurance", "Chicago", "IL", "Premier"),
    ("Sablewood Commercial", "Houston", "TX", "Premier"),
    ("Tessaract Insurance Group", "Phoenix", "AZ", "Premier"),
    ("Northgate Risk Advisors", "Columbus", "OH", "Preferred"),
    ("Plainsview Insurance Agency", "Oklahoma City", "OK", "Preferred"),
    ("Redfern & Cole", "Nashville", "TN", "Preferred"),
    ("Blue Heron Brokerage", "Charlotte", "NC", "Preferred"),
    ("Ironbridge Insurance Services", "Pittsburgh", "PA", "Preferred"),
    ("Wexford Hale Partners", "Austin", "TX", "Preferred"),
    ("Cardinal Crest Insurance", "Wichita", "KS", "Preferred"),
    ("Lanternpoint Risk", "Tampa", "FL", "Preferred"),
    ("Meridale Insurance Brokers", "Omaha", "NE", "Preferred"),
    ("Stonecrop Agency", "San Antonio", "TX", "Preferred"),
    ("Fairlight Commercial Insurance", "Raleigh", "NC", "Standard"),
    ("Harrow Street Insurance", "Philadelphia", "PA", "Standard"),
    ("Quillfield Insurance Agency", "Tulsa", "OK", "Standard"),
    ("Juniper Ridge Brokerage", "Colorado Springs", "CO", "Standard"),
    ("Oakhurst Insurance Partners", "Memphis", "TN", "Standard"),
    ("Silverpine Risk Services", "Tucson", "AZ", "Standard"),
    ("Driftwood Insurance Group", "Jacksonville", "FL", "Standard"),
    ("Ambergate Agency", "Cleveland", "OH", "Standard"),
    ("Kestrel Commercial Lines", "Plano", "TX", "Standard"),
    ("Moorland Insurance", "Peoria", "IL", "Standard"),
    ("Pennant Risk Partners", "Savannah", "GA", "Standard"),
    ("Cobalt Bay Brokerage", "Orlando", "FL", "Standard"),
    ("Thistle & Vane Insurance", "Knoxville", "TN", "Standard"),
    ("Granite Row Agency", "Lincoln", "NE", "Standard"),
    ("Westbrook Plains Insurance", "Topeka", "KS", "Standard"),
    ("Larkspur Insurance Services", "Mesa", "AZ", "Standard"),
    ("Hollins & Yard", "Allentown", "PA", "Standard"),
    ("Ravenstone Brokerage", "Greensboro", "NC", "Standard"),
    ("Verity Lane Insurance", "Naperville", "IL", "Standard"),
    ("Coldspring Agency", "Aurora", "CO", "Standard"),
]

NAME_A = ["Summit", "Cedar", "Riverbend", "Pioneer", "Blue Ridge", "Heritage", "Prairie", "Lakeshore", "Granite", "Redstone",
          "Magnolia", "Canyon", "Harbor", "Stonebridge", "Willow", "Ironwood", "Maple", "Sierra", "Liberty", "Crescent",
          "Silver Creek", "Aspen", "Brookside", "Frontier", "Cypress", "Northfield", "Eagle", "Timberline", "Bayview", "Oak Hollow"]
NAME_B = {
    "HAB": ["Residential", "Apartment Communities", "Living", "Housing Partners", "Property Holdings"],
    "RET": ["Market", "Retail Center", "Kitchen & Bar", "Foods", "Shops"],
    "MFG": ["Fabrication", "Manufacturing", "Industries", "Plastics", "Components"],
    "WHS": ["Logistics", "Distribution", "Storage", "Warehousing", "Freight Center"],
    "OFF": ["Office Partners", "Medical Plaza", "Professional Center", "Commons", "Business Park"],
    "HOS": ["Inn & Suites", "Hotel Group", "Lodge", "Hospitality", "Suites"],
}
SUFFIX = ["LLC", "LP", "Inc.", "Holdings LLC", "Partners LLC"]


def company(seg: str) -> str:
    name = f"{rng.choice(NAME_A)} {rng.choice(NAME_B[seg])} {rng.choice(SUFFIX)}"
    return name.replace("Holdings Holdings", "Holdings").replace("Partners Partners", "Partners")


# ─────────────────────────────────────────────────────────────────────────────
# Rating plan (shared with the app's pricing engine through rating_factors)
# ─────────────────────────────────────────────────────────────────────────────

RATING = [
    # factor_type, factor_key, value, description, doc_ref
    ("base_rate", "Frame", 0.34, "Base property rate per $100 TIV — frame", "TSI-RATE-03 §2.1"),
    ("base_rate", "Joisted masonry", 0.25, "Base property rate per $100 TIV — joisted masonry", "TSI-RATE-03 §2.1"),
    ("base_rate", "Masonry non-combustible", 0.20, "Base property rate per $100 TIV — masonry non-combustible", "TSI-RATE-03 §2.1"),
    ("base_rate", "Fire resistive", 0.15, "Base property rate per $100 TIV — fire resistive", "TSI-RATE-03 §2.1"),
    ("segment", "HAB", 1.10, "Habitational occupancy factor", "TSI-RATE-03 §2.2"),
    ("segment", "RET", 1.00, "Retail & restaurants occupancy factor", "TSI-RATE-03 §2.2"),
    ("segment", "MFG", 1.15, "Light manufacturing occupancy factor", "TSI-RATE-03 §2.2"),
    ("segment", "WHS", 0.95, "Warehouse & distribution occupancy factor", "TSI-RATE-03 §2.2"),
    ("segment", "OFF", 0.85, "Office & professional occupancy factor", "TSI-RATE-03 §2.2"),
    ("segment", "HOS", 1.20, "Hospitality occupancy factor", "TSI-RATE-03 §2.2"),
    ("territory", "HAIL_BELT", 1.25, "Hail-belt states TX OK KS NE CO", "TSI-RATE-03 §2.3"),
    ("territory", "FL", 1.45, "Florida (non-coastal)", "TSI-RATE-03 §2.3"),
    ("territory", "OTHER", 1.00, "All other states", "TSI-RATE-03 §2.3"),
    ("roof_age", "0-10", 0.95, "Roof 10 years or newer", "TSI-RATE-03 §2.4"),
    ("roof_age", "11-15", 1.05, "Roof 11-15 years", "TSI-RATE-03 §2.4"),
    ("roof_age", "16-20", 1.30, "Roof 16-20 years", "TSI-RATE-03 §2.4"),
    ("roof_age", "21+", 1.50, "Roof older than 20 years", "TSI-RATE-03 §2.4"),
    ("sprinkler", "Y", 0.85, "Fully sprinklered building", "TSI-RATE-03 §2.5"),
    ("sprinkler", "N", 1.00, "Not sprinklered", "TSI-RATE-03 §2.5"),
    ("experience", "0", 0.92, "No losses in 5 years", "TSI-RATE-03 §3.1"),
    ("experience", "1", 1.00, "One loss in 5 years", "TSI-RATE-03 §3.1"),
    ("experience", "2-3", 1.12, "Two or three losses in 5 years", "TSI-RATE-03 §3.1"),
    ("experience", "4+", 1.25, "Four or more losses in 5 years", "TSI-RATE-03 §3.1"),
    ("ml_band", "Low", 0.95, "Submission risk model band Low (p < 0.25)", "TSI-RATE-03 §3.2"),
    ("ml_band", "Moderate", 1.00, "Submission risk model band Moderate (0.25-0.45)", "TSI-RATE-03 §3.2"),
    ("ml_band", "High", 1.15, "Submission risk model band High (p >= 0.45)", "TSI-RATE-03 §3.2"),
    ("deductible", "WH_2PCT", 0.92, "2% wind/hail deductible credit (hail belt)", "TSI-RATE-03 §4.1"),
    ("deductible", "WH_5PCT", 0.82, "5% wind/hail deductible credit (hail belt, required with ACV roof exception)", "TSI-RATE-03 §4.1"),
    ("minimum", "PREMIUM", 7500, "Minimum property premium per account (USD)", "TSI-RATE-03 §5"),
    ("gl", "RATE_PER_1K_REVENUE", 0.62, "General liability rate per $1,000 of revenue (package)", "TSI-RATE-03 §6"),
]

APPETITE_RULES = [
    # rule_id, doc_ref, title, applies_to, action, threshold, description
    ("AP-HAB-HAIL-ROOF", "TSI-UW-B-2026-07 §2", "Hail-belt habitational roof age", "HAB in TX OK KS NE CO", "INELIGIBLE_LOCATION", 15,
     "Any habitational location in the hail belt with a roof older than 15 years is out of appetite for property. Exclude the location, or refer to the CUO for an exception with Actual Cash Value roof settlement and a 5% wind/hail deductible."),
    ("AP-HAB-FRAME-OLD", "TSI-UW-01 §4.3", "Older frame habitational without sprinklers", "HAB", "REFER", 1990,
     "Frame habitational buildings built before 1990 without automatic sprinklers require a CUO referral."),
    ("AP-FL-COASTAL", "TSI-CAT-05 §3.1", "Florida Tier-1 coastal wind", "All segments, FL coastal counties", "DECLINE", 0,
     "Locations in Florida Tier-1 coastal wind counties are outside Tidewell's catastrophe appetite. Decline."),
    ("AP-PROTECTION", "TSI-UW-01 §4.1", "Poor public protection", "All segments", "REFER", 9,
     "Locations in public protection class 9 or 10 require a CUO referral."),
    ("AP-DOCS-LOSSRUN", "TSI-DOC-04 §2.1", "Loss runs currency", "All submissions", "REQUEST_INFO", 90,
     "Currently valued loss runs (valued within 90 days of receipt) covering five years are required before quoting."),
    ("AP-DOCS-MATCH", "TSI-DOC-04 §3.2", "Application vs SOV / loss run discrepancies", "All submissions", "UNDERWRITER_REVIEW", 0,
     "When the statement of values or loss runs contradict the application, underwrite on the documents, not the application, and note every discrepancy in the file."),
    ("AUTH-TIV-SENIOR", "TSI-AUTH-02 §2", "Senior underwriter TIV authority", "All segments", "REFER", 25000000,
     "A senior underwriter may bind accounts up to $25M total insured value; above that the Chief Underwriting Officer must approve."),
]


# ─────────────────────────────────────────────────────────────────────────────
# Brokers + historical book
# ─────────────────────────────────────────────────────────────────────────────

def build_brokers():
    rows = []
    for i, (name, city, st, tier) in enumerate(BROKER_NAMES, start=1):
        rows.append(dict(broker_id=f"BRK-{i:03d}", broker_name=name, city=city, state=st, tier=tier,
                         relationship_since=date(2012 + rng.randint(0, 11), rng.randint(1, 12), 1),
                         appointed_lines="Commercial Property; Package; General Liability"))
    return rows


def roof_band(age: int) -> str:
    return "0-10" if age <= 10 else "11-15" if age <= 15 else "16-20" if age <= 20 else "21+"


def build_policies(brokers):
    """~2,700 policies, 12-month terms, effective Jul-2023 → Jun-2026."""
    seg_w = {k: v[1] for k, v in SEGMENTS.items()}
    st_w = {k: v[0] for k, v in STATES.items()}
    br_by_state: dict[str, list] = {}
    for b in brokers:
        br_by_state.setdefault(b["state"], []).append(b)
    rows = []
    n = 2700
    span = (date(2026, 6, 30) - date(2023, 7, 1)).days
    for i in range(n):
        seg = pick(seg_w)
        st = pick(st_w)
        if seg == "HAB" and rng.random() < 0.18:
            st = rng.choice(["TX", "TX", "OK", "CO"])  # hail-belt habitational grew fast (the market hardened)
        eff = date(2023, 7, 1) + timedelta(days=int(rng.random() ** 0.85 * span))
        hail = st in HAIL_BELT
        construction = pick({"Frame": 0.34 if seg == "HAB" else 0.12, "Joisted masonry": 0.36, "Masonry non-combustible": 0.34,
                             "Fire resistive": 0.08 if seg == "HAB" else 0.18})
        year_built = rng.randint(1968, 2021)
        roof_age = min(eff.year - year_built, int(rng.triangular(1, 30, 17 if (seg == "HAB" and st in HAIL_BELT) else 11)))
        roof_age = max(1, roof_age)
        locations = pick({1: 0.46, 2: 0.22, 3: 0.14, 4: 0.1, 5: 0.05, 6: 0.03})
        tiv = round(locations * math.exp(rng.gauss(math.log(5.2e6), 0.55)), -3)
        sprinklered = rng.random() < (0.55 if construction in ("Frame", "Joisted masonry") else 0.78)
        old_share = 0.0 if roof_age <= 15 else round(min(1.0, rng.uniform(0.25, 1.0) if locations > 1 else 1.0), 2)
        frame_share = 1.0 if construction == "Frame" else round(rng.choice([0.0, 0.0, 0.0, rng.uniform(0.1, 0.4)]) if locations > 1 else 0.0, 2)
        pc = pick({1: 0.02, 2: 0.08, 3: 0.2, 4: 0.24, 5: 0.18, 6: 0.12, 7: 0.08, 8: 0.05, 9: 0.02, 10: 0.01})
        prior_count = min(9, int(rng.expovariate(1.2) * (1.5 if roof_age > 15 else 1.0) * (1.3 if hail else 1.0)))
        prior_amount = round(sum(rng.lognormvariate(math.log(35000), 0.9) for _ in range(prior_count)), -2)
        prior_hail = sum(1 for _ in range(prior_count) if rng.random() < (0.5 if hail else 0.12))
        terr = 1.25 if hail else 1.45 if st == "FL" else 1.0
        base = {"Frame": 0.34, "Joisted masonry": 0.25, "Masonry non-combustible": 0.20, "Fire resistive": 0.15}[construction]
        segf = {"HAB": 1.10, "RET": 1.0, "MFG": 1.15, "WHS": 0.95, "OFF": 0.85, "HOS": 1.20}[seg]
        rf = {"0-10": 0.95, "11-15": 1.05, "16-20": 1.30, "21+": 1.50}[roof_band(roof_age)]
        # the rating plan only recently added roof age at full weight: history was priced softer on old roofs
        rf = 1 + (rf - 1) * 0.35
        premium = max(7500, round(tiv / 100 * base * segf * terr * rf * (0.85 if sprinklered else 1.0) * rng.uniform(0.9, 1.12), -1))
        b = rng.choice(br_by_state.get(st, brokers)) if rng.random() < 0.75 else rng.choice(brokers)
        cls = rng.choice(SEGMENTS[seg][3])
        latent = math.exp(0.9 * (roof_age > 15) * (1.4 if (hail and seg == "HAB") else 0.45) + 0.35 * frame_share
                          + 0.3 * math.log1p(prior_count) + 0.35 * min(prior_hail, 3) * hail - 0.3 * sprinklered + 0.06 * (pc - 5))
        rows.append(dict(
            policy_id=f"TSI-CP-{eff.year % 100:02d}{i:05d}", account_name=company(seg), segment_code=seg, segment=SEGMENTS[seg][0],
            class_description=cls, state=st, city=rng.choice(STATES[st][1]), hail_belt=hail, construction=construction,
            year_built=year_built, roof_age_years=roof_age, roof_age_band=roof_band(roof_age), old_roof_tiv_share=old_share,
            frame_tiv_share=frame_share, sprinklered=sprinklered, protection_class=pc, locations=locations, tiv=float(tiv),
            prior_loss_count_5yr=prior_count, prior_loss_amount_5yr=float(prior_amount), prior_hail_losses_5yr=prior_hail,
            written_premium=float(premium), wind_hail_deductible_pct=2.0 if (hail and rng.random() < 0.4) else 1.0,
            effective_date=eff, expiration_date=eff + timedelta(days=365), broker_id=b["broker_id"],
            underwriter=rng.choice(UNDERWRITERS), _latent=latent,
        ))
    return rows


def build_quarters_and_claims(policies):
    """Earned premium per policy-quarter; claims calibrated to a target loss ratio per cell and quarter."""
    pq = []
    for p in policies:
        term_days = 365.0
        for q in QUARTERS:
            qs, qe = quarter_bounds(q)
            s, e = max(qs, p["effective_date"]), min(qe, p["expiration_date"] - timedelta(days=1))
            if s > e:
                continue
            days = (e - s).days + 1
            pq.append(dict(policy_id=p["policy_id"], quarter=q, quarter_start=qs, earned_premium=round(p["written_premium"] * days / term_days, 2),
                           earned_exposure_days=days, _p=p))

    # target loss-ratio multipliers by quarter — THE PLANTED SIGNAL
    hab_hail_old = [1.02, 0.95, 1.12, 1.45, 1.75, 2.02, 2.38, 2.85]   # ~59% → ~165%
    hab_hail_new = [1.02, 0.96, 1.00, 1.14, 1.08, 1.06, 1.12, 1.22]   # ~60% → ~70%
    cells: dict[tuple, list] = {}
    for r in pq:
        p = r["_p"]
        cells.setdefault((p["segment_code"], p["hail_belt"], p["roof_age_years"] > 15, r["quarter"]), []).append(r)
    claims = []
    cid = 0
    for (seg, hail, old, q), rows in sorted(cells.items(), key=lambda kv: str(kv[0])):
        qi = QUARTERS.index(q)
        base = SEGMENTS[seg][2]
        if seg == "HAB" and hail:
            m = hab_hail_old[qi] if old else hab_hail_new[qi]
        else:
            m = rng.uniform(0.9, 1.1) * (1.12 if (hail and old) else 1.0) * (1.08 if (hail and q.endswith("Q2")) else 1.0)
        ep = sum(r["earned_premium"] for r in rows)
        target = ep * base * m * rng.uniform(0.96, 1.04)
        if target <= 0:
            continue
        if seg == "HAB" and hail and old and qi >= 3:
            perils = {"Hail": 0.58, "Wind": 0.24, "Water damage": 0.08, "Fire": 0.06, "Liability - premises": 0.04}
        elif hail:
            perils = {"Hail": 0.24, "Wind": 0.18, "Fire": 0.2, "Water damage": 0.16, "Theft / vandalism": 0.07, "Liability - premises": 0.1, "Equipment breakdown": 0.05}
        else:
            perils = {"Wind": 0.12, "Fire": 0.3, "Water damage": 0.24, "Theft / vandalism": 0.1, "Liability - premises": 0.15, "Equipment breakdown": 0.09}
        mean_sev = sum(PERIL_SEVERITY[k] * w for k, w in perils.items())
        k = max(1, round(target / mean_sev))
        weights = [r["_p"]["_latent"] ** 2.5 * r["earned_premium"] for r in rows]
        chosen = rng.choices(rows, weights=weights, k=k)
        sev = []
        for r in chosen:
            peril = pick(perils)
            sev.append((r, peril, rng.lognormvariate(math.log(PERIL_SEVERITY[peril]), 0.8)))
        scale = target / sum(s for _, _, s in sev)
        qs, qe = quarter_bounds(q)
        for r, peril, s in sev:
            p = r["_p"]
            lo, hi = max(qs, p["effective_date"]), min(qe, p["expiration_date"] - timedelta(days=1))
            if peril == "Hail" and q.endswith("Q2"):
                lo = max(lo, date(qs.year, 4, 1))
            loss_date = lo + timedelta(days=rng.randint(0, max(0, (hi - lo).days)))
            incurred = round(min(s * scale, p["tiv"] * 0.6), 2)
            open_ = (TODAY - loss_date).days < 240 and rng.random() < 0.55
            paid = round(incurred * (rng.uniform(0.2, 0.7) if open_ else 1.0), 2)
            cid += 1
            claims.append(dict(claim_id=f"CLM-{loss_date.year % 100:02d}-{cid:06d}", policy_id=p["policy_id"], loss_date=loss_date,
                               report_date=loss_date + timedelta(days=rng.randint(1, 20)), accident_quarter=q, peril=peril,
                               incurred_amount=incurred, paid_amount=paid, reserve_amount=round(incurred - paid, 2),
                               status="Open" if open_ else "Closed", catastrophe_event=("PCS severe convective storm" if peril in ("Hail", "Wind") and rng.random() < 0.7 else None)))
    for r in pq:
        r.pop("_p")
    return pq, claims


def build_submission_history(policies, brokers):
    """Every policy effective ≥ Jul-2024 came from a bound submission; add quoted-not-bound + declined around them."""
    tier_hit = {"Premier": 0.46, "Preferred": 0.36, "Standard": 0.27}
    btier = {b["broker_id"]: b["tier"] for b in brokers}
    rows = []
    n = 0
    for p in policies:
        if p["effective_date"] < date(2024, 7, 1):
            continue
        n += 1
        recv = p["effective_date"] - timedelta(days=rng.randint(18, 60))
        p["submission_id"] = f"SUB-{recv.year % 100:02d}-H{n:05d}"
        rows.append(dict(submission_id=p["submission_id"], received_date=recv, broker_id=p["broker_id"], insured_name=p["account_name"],
                         segment_code=p["segment_code"], segment=p["segment"], state=p["state"], tiv=p["tiv"], locations=p["locations"],
                         requested_effective_date=p["effective_date"], outcome="BOUND", quoted_premium=p["written_premium"],
                         bound_premium=p["written_premium"], decline_reason=None, underwriter=p["underwriter"], policy_id=p["policy_id"],
                         days_to_quote=rng.randint(2, 12)))
    # the non-bound submissions, sized so each broker tier lands near its hit ratio
    bound_by_broker: dict[str, int] = {}
    for r in rows:
        bound_by_broker[r["broker_id"]] = bound_by_broker.get(r["broker_id"], 0) + 1
    decline_reasons = ["Outside appetite — class", "Roof age / condition", "Loss history", "Catastrophe exposure (coastal wind)",
                       "Inadequate protection class", "Rate inadequate for exposure", "Incomplete submission"]
    seg_w = {k: v[1] for k, v in SEGMENTS.items()}
    st_w = {k: v[0] for k, v in STATES.items()}
    for b in brokers:
        bound = bound_by_broker.get(b["broker_id"], 0)
        hit = tier_hit[btier[b["broker_id"]]] * rng.uniform(0.85, 1.15)
        others = max(4, int(bound / max(0.12, hit) - bound))
        for _ in range(others):
            n += 1
            seg = pick(seg_w)
            st = b["state"] if rng.random() < 0.7 else pick(st_w)
            recv = date(2024, 5, 15) + timedelta(days=rng.randint(0, (date(2026, 9, 10) - date(2024, 5, 15)).days))
            quoted = rng.random() < 0.62
            outcome = "QUOTED_NOT_BOUND" if quoted else "DECLINED"
            locs = pick({1: 0.5, 2: 0.22, 3: 0.14, 4: 0.14})
            tiv = round(locs * math.exp(rng.gauss(math.log(5.2e6), 0.55)), -3)
            reason = None
            if outcome == "DECLINED":
                reason = "Roof age / condition" if (seg == "HAB" and st in HAIL_BELT and recv >= date(2026, 7, 1) and rng.random() < 0.7) else rng.choice(decline_reasons)
            rows.append(dict(submission_id=f"SUB-{recv.year % 100:02d}-H{n:05d}", received_date=recv, broker_id=b["broker_id"],
                             insured_name=company(seg), segment_code=seg, segment=SEGMENTS[seg][0], state=st, tiv=float(tiv), locations=locs,
                             requested_effective_date=recv + timedelta(days=rng.randint(25, 60)), outcome=outcome,
                             quoted_premium=float(round(tiv / 100 * 0.27 * rng.uniform(0.85, 1.3), -1)) if quoted else None,
                             bound_premium=None, decline_reason=reason, underwriter=rng.choice(UNDERWRITERS), policy_id=None,
                             days_to_quote=rng.randint(2, 15) if quoted else rng.randint(1, 6)))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Today's queue — 24 submissions with PDF packets
# ─────────────────────────────────────────────────────────────────────────────

def loc(no, name, addr, city, st, cons, built, roof, stories, units, spr, tiv, pc=3, coastal=False):
    return dict(loc_no=no, building_name=name, address=addr, city=city, state=st, construction=cons, year_built=built, roof_year=roof,
                stories=stories, units=units, sprinklered=spr, protection_class=pc, tiv=float(tiv), coastal=coastal)


def claim(d, loc_no, cause, paid, reserve, status, line="Property"):
    return dict(loss_date=d, loc_no=loc_no, cause=cause, paid=float(paid), reserve=float(reserve), status=status, line=line)


HERO = dict(
    submission_id="SUB-26-0417", insured="Lone Star Residential Partners LP", broker="Halvorsen & Pike Insurance Services",
    contact="Rachel Okonkwo", seg="HAB", desc="Owner and operator of four garden and mid-rise apartment communities in the Dallas-Fort Worth metroplex (540 units).",
    naics="531110", years=14, eff=date(2026, 10, 15), received=datetime(2026, 9, 24, 9, 12), prior_carrier="Meridian Mutual Insurance Co.",
    expiring=118000, target=112000, revenue=11800000,
    stated=dict(construction="Joisted masonry", year_built=2012, roof_year=2019, sprinklered=True, pc=3, loss_count=1, loss_amount=18400),
    remarks="Well-maintained Class A/B portfolio. Roofs updated 2019-2020, fully sprinklered, professional on-site management. "
            "Clean loss history - one small water claim in five years. Incumbent is non-renewing its habitational book-wide; "
            "insured wants to bind by 10/15. Target premium $112K.",
    locations=[
        loc(1, "Oak Terrace", "1200 W Parker Rd", "Plano", "TX", "Joisted masonry", 2012, 2019, 3, 168, True, 12400000),
        loc(2, "Preston Crossing", "8750 Preston Rd", "Frisco", "TX", "Joisted masonry", 2015, 2020, 3, 156, True, 11200000),
        loc(3, "Cedar Hollow Apartments", "901 Randol Mill Rd", "Arlington", "TX", "Frame", 1984, 2004, 2, 144, False, 9400000),
        loc(4, "Riverside Lofts", "415 N Main St", "Fort Worth", "TX", "Masonry non-combustible", 2008, 2018, 4, 72, True, 5600000),
    ],
    lossrun=dict(carrier="Meridian Mutual Insurance Co.", valued=date(2026, 9, 1), years=5, claims=[
        claim(date(2022, 8, 14), 2, "Water damage - supply line", 18400, 0, "Closed"),
        claim(date(2023, 11, 3), 1, "Slip and fall - parking lot", 42000, 0, "Closed", "General Liability"),
        claim(date(2024, 5, 22), 3, "Hail - roof and siding", 212600, 0, "Closed"),
        claim(date(2025, 4, 2), 3, "Wind / hail - roof", 61300, 35000, "Open"),
    ]),
)

BRAZOS = dict(
    submission_id="SUB-26-0422", insured="Brazos Valley Cold Storage LLC", broker="Wexford Hale Partners", contact="Tomas Reyes",
    seg="WHS", desc="Public refrigerated warehousing for regional food distributors; two tilt-up cold storage buildings in Waco, Texas.",
    naics="493120", years=11, eff=date(2026, 11, 1), received=datetime(2026, 9, 25, 14, 40), prior_carrier="Tallgrass Casualty Co.",
    expiring=None, target=None, revenue=9400000,
    stated=dict(construction="Masonry non-combustible", year_built=2011, roof_year=2017, sprinklered=True, pc=2, loss_count=0, loss_amount=0),
    remarks="Well-run cold storage operation, ammonia system with annual third-party inspection, ESFR sprinklers, "
            "monitored alarm. No losses in five years. New to market - incumbent exiting Texas property.",
    locations=[
        loc(1, "Plant 1 - Freezer / Dock", "2400 Industrial Blvd", "Waco", "TX", "Masonry non-combustible", 2011, 2017, 1, 0, True, 8600000, 2),
        loc(2, "Plant 2 - Cooler / Office", "2450 Industrial Blvd", "Waco", "TX", "Masonry non-combustible", 2014, 2017, 1, 0, True, 5600000, 2),
    ],
    lossrun=dict(carrier="Tallgrass Casualty Co.", valued=date(2026, 9, 10), years=5, claims=[]),
)

GULF = dict(
    submission_id="SUB-26-0409", insured="Gulf Breeze Motor Lodge LLC", broker="Cobalt Bay Brokerage", contact="Denise Farrow",
    seg="HOS", desc="Independent 96-room beachfront motel with outdoor pool and snack bar in Panama City Beach, Florida.",
    naics="721110", years=22, eff=date(2026, 10, 20), received=datetime(2026, 9, 18, 11, 5), prior_carrier="Seacoast Surplus Lines",
    expiring=212000, target=190000, revenue=4100000,
    stated=dict(construction="Masonry non-combustible", year_built=1996, roof_year=2019, sprinklered=False, pc=4, loss_count=2, loss_amount=138000),
    remarks="Beachfront location, roof replaced after Hurricane Michael. Looking for admitted market paper.",
    locations=[loc(1, "Gulf Breeze Motor Lodge", "17800 Front Beach Rd", "Panama City Beach", "FL", "Masonry non-combustible", 1996, 2019, 3, 96, False, 7800000, 4, True)],
    lossrun=dict(carrier="Seacoast Surplus Lines", valued=date(2026, 8, 20), years=5, claims=[
        claim(date(2023, 8, 30), 1, "Wind - Hurricane Idalia", 96000, 0, "Closed"),
        claim(date(2025, 6, 12), 1, "Water damage - guest room", 42000, 0, "Closed"),
    ]),
)


def random_submission(i, brokers, seg, st, received, eff, *, tiv_target=None, stale_lossrun=False, minor_discrepancy=False, pc9=False):
    city = rng.choice(STATES[st][1])
    b = rng.choice([x for x in brokers if x["state"] == st] or brokers)
    nloc = pick({1: 0.4, 2: 0.3, 3: 0.2, 4: 0.1})
    tiv_each = (tiv_target or nloc * math.exp(rng.gauss(math.log(4.5e6), 0.45))) / nloc
    cons = rng.choice(["Joisted masonry", "Masonry non-combustible", "Fire resistive"] if seg != "HAB" else ["Joisted masonry", "Masonry non-combustible"])
    built = rng.randint(1996, 2019)
    roof = rng.randint(max(built, 2013), 2023)
    if seg == "HAB" and st in HAIL_BELT:
        roof = rng.randint(2016, 2023)  # clean hail-belt habitational: newer roofs
    locs = []
    streets = ["Commerce Dr", "Main St", "Industrial Pkwy", "Market St", "Park Ave", "Lakeview Blvd", "Pioneer Rd", "Center St", "Elm St", "Airport Rd"]
    for n in range(1, nloc + 1):
        spr = rng.random() < 0.8
        locs.append(loc(n, f"Building {n}" if seg in ("MFG", "WHS") else f"{rng.choice(NAME_A)} {['Plaza', 'Center', 'Place', 'Commons'][n % 4]}",
                        f"{rng.randint(100, 9900)} {rng.choice(streets)}", city, st, cons, built + rng.randint(0, 3), roof, rng.randint(1, 4),
                        rng.randint(60, 220) if seg == "HAB" else 0, True if n == 1 else spr, round(tiv_each * rng.uniform(0.8, 1.2), -4),
                        9 if (pc9 and n == 1) else rng.randint(2, 6)))
    for l_ in locs:
        l_["sprinklered"] = True  # clean files: stated sprinklered matches
    n_claims = max(pick({0: 0.45, 1: 0.35, 2: 0.2}), 1 if minor_discrepancy else 0)
    cl = []
    for _ in range(n_claims):
        d = TODAY - timedelta(days=rng.randint(200, 1700))
        cause = rng.choice(["Water damage - pipe burst", "Theft - break-in", "Fire - kitchen", "Slip and fall", "Wind - fence and signage", "Equipment breakdown - HVAC"])
        line = "General Liability" if cause == "Slip and fall" else "Property"
        cl.append(claim(d, rng.randint(1, nloc), cause, round(rng.lognormvariate(math.log(22000), 0.7), -2), 0, "Closed", line))
    stated_count, stated_amount = len(cl), sum(c["paid"] + c["reserve"] for c in cl)
    if minor_discrepancy and cl:
        stated_amount = round(stated_amount * 0.8, -2)
    total = sum(l_["tiv"] for l_ in locs)
    seg_desc = {
        "HAB": f"Owner of {nloc} apartment communit{'y' if nloc == 1 else 'ies'} in the {city} area.",
        "RET": f"Operator of {'a neighborhood shopping center' if nloc == 1 else f'{nloc} neighborhood retail centers'} with grocery and restaurant tenants.",
        "MFG": "Contract metal fabrication and powder coating for agricultural and HVAC equipment makers.",
        "WHS": "Third-party dry-goods warehousing and cross-dock distribution for regional retailers.",
        "OFF": f"Owner-occupied professional office {'building' if nloc == 1 else 'buildings'} leased to medical and legal tenants.",
        "HOS": f"Franchise limited-service hotel{'s' if nloc > 1 else ''} near interstate exits.",
    }[seg]
    return dict(
        submission_id=f"SUB-26-{i:04d}", insured=company(seg), broker=b["broker_name"], contact=rng.choice(["Alex Morgan", "Jordan Lee", "Priya Nair", "Sam Whitaker", "Chris Delgado", "Taylor Brooks", "Morgan Ellis", "Kim Sato"]),
        seg=seg, desc=seg_desc, naics={"HAB": "531110", "RET": "531120", "MFG": "332710", "WHS": "493110", "OFF": "531120", "HOS": "721110"}[seg],
        years=rng.randint(4, 30), eff=eff, received=received, prior_carrier=rng.choice(["Tallgrass Casualty Co.", "Meridian Mutual Insurance Co.", "Northstar Indemnity", "Keystone Fire & Marine", "Prairie Union Insurance"]),
        expiring=round(total / 100 * 0.24, -3), target=None, revenue=round(total * rng.uniform(0.3, 0.9), -5),
        stated=dict(construction=cons, year_built=locs[0]["year_built"], roof_year=roof, sprinklered=True, pc=locs[0]["protection_class"],
                    loss_count=stated_count, loss_amount=stated_amount),
        remarks=rng.choice(["Long-standing insured, well maintained, professional management.", "Marketing for better terms at renewal; incumbent took a rate increase.",
                            "New purchase closed this summer; seeking package coverage.", "Growing account, recently added a location.",
                            "Clean account, looking for a stable carrier."]),
        locations=locs,
        lossrun=dict(carrier="Prior carrier", valued=(TODAY - timedelta(days=150)) if stale_lossrun else (TODAY - timedelta(days=rng.randint(8, 50))),
                     years=3 if stale_lossrun else 5, claims=cl),
    )


def build_queue(brokers):
    subs = [HERO, BRAZOS, GULF]
    plan = [
        # (seg, state, kwargs)
        ("OFF", "GA", {}), ("RET", "OH", {}), ("MFG", "IL", {}), ("HAB", "NC", {}), ("WHS", "TN", {}),
        ("RET", "AZ", {"minor_discrepancy": True}), ("HAB", "CO", {}), ("MFG", "PA", {"tiv_target": 31.5e6}), ("OFF", "TX", {}),
        ("HOS", "TN", {}), ("WHS", "OK", {"stale_lossrun": True}), ("HAB", "GA", {}), ("RET", "NC", {}), ("MFG", "OH", {"pc9": True}),
        ("OFF", "IL", {}), ("HAB", "AZ", {"tiv_target": 27.8e6}), ("WHS", "KS", {}), ("RET", "TX", {}), ("HOS", "GA", {}),
        ("OFF", "PA", {}), ("WHS", "CO", {}),
    ]
    used = {417, 422, 409}
    ids = [x for x in range(401, 432) if x not in used]
    for (seg, st, kw), i in zip(plan, ids):
        received = datetime(2026, 9, 14, 8, 0) + timedelta(hours=rng.randint(0, 14 * 24 - 10))
        eff = TODAY + timedelta(days=rng.randint(24, 70))
        subs.append(random_submission(i, brokers, seg, st, received, eff, **kw))
    return subs


# ─────────────────────────────────────────────────────────────────────────────
# PDF packets (reportlab)
# ─────────────────────────────────────────────────────────────────────────────

def render_packets(subs, volume_path):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ss = getSampleStyleSheet()
    grid = TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF4")),
                       ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP")])
    kv = TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9),
                     ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F2F4F7"))])
    usd = lambda v: f"${v:,.0f}"
    docs = []
    for s in subs:
        d = f"{volume_path}/{s['submission_id']}"
        os.makedirs(d, exist_ok=True)
        st = s["stated"]
        total_tiv = sum(l_["tiv"] for l_ in s["locations"])
        # 1) application (ACORD 125 / 140 format)
        p = f"{d}/application.pdf"
        rows = [
            ["Applicant (named insured)", s["insured"]], ["Business description", Paragraph(s["desc"], ss["BodyText"])],
            ["NAICS", s["naics"]], ["Years in business", str(s["years"])], ["Producer / broker", f"{s['broker']} - {s['contact']}"],
            ["Lines requested", "Commercial Property; General Liability (package)"], ["Proposed effective date", s["eff"].strftime("%m/%d/%Y")],
            ["Premises state(s)", ", ".join(sorted({l_["state"] for l_ in s["locations"]}))],
            ["Number of locations", str(len(s["locations"]))], ["Total insured value (all locations)", usd(total_tiv)],
            ["Primary location - construction", st["construction"]], ["Primary location - year built", str(st["year_built"])],
            ["Roof - year last replaced", str(st["roof_year"])], ["Automatic sprinklers", "Yes" if st["sprinklered"] else "No"],
            ["Public protection class", str(st["pc"])], ["Annual revenue / gross receipts", usd(s["revenue"])],
            ["Prior carrier", s["prior_carrier"]], ["Expiring premium", usd(s["expiring"]) if s["expiring"] else "New venture / not disclosed"],
            ["Loss history - past 5 years (number of claims)", str(st["loss_count"])],
            ["Loss history - past 5 years (total incurred)", usd(st["loss_amount"])],
            ["Target premium", usd(s["target"]) if s["target"] else "-"],
            ["Remarks", Paragraph(s["remarks"], ss["BodyText"])],
        ]
        t = Table(rows, colWidths=[200, 330])
        t.setStyle(kv)
        SimpleDocTemplate(p, pagesize=letter, title=f"Application {s['submission_id']}").build([
            Paragraph("COMMERCIAL INSURANCE APPLICATION", ss["Title"]),
            Paragraph("Applicant information and premises summary (ACORD 125 / 140 format) - submitted to Tidewell Specialty Insurance", ss["Italic"]),
            Spacer(1, 10), t, Spacer(1, 10),
            Paragraph(f"Submission reference {s['submission_id']}. Received {s['received'].strftime('%m/%d/%Y %H:%M')}. "
                      "Applicant represents the information above is true and complete.", ss["BodyText"]),
        ])
        docs.append(dict(doc_id=f"{s['submission_id']}-APP", submission_id=s["submission_id"], doc_type="APPLICATION",
                         file_name="application.pdf", file_path=p, pages=1))
        # 2) statement of values
        p = f"{d}/statement_of_values.pdf"
        head = ["Loc #", "Building name", "Street address", "City", "ST", "Construction", "Yr built", "Roof yr", "Stories", "Units",
                "Sprinklered", "Prot. class", "TIV ($)"]
        body = [[str(l_["loc_no"]), l_["building_name"], l_["address"], l_["city"], l_["state"], l_["construction"], str(l_["year_built"]),
                 str(l_["roof_year"]), str(l_["stories"]), str(l_["units"] or "-"), "Y" if l_["sprinklered"] else "N", str(l_["protection_class"]),
                 f"{l_['tiv']:,.0f}"] for l_ in s["locations"]]
        body.append(["", "TOTAL", "", "", "", "", "", "", "", "", "", "", f"{total_tiv:,.0f}"])
        t = Table([head] + body, repeatRows=1)
        t.setStyle(grid)
        SimpleDocTemplate(p, pagesize=landscape(letter), title=f"SOV {s['submission_id']}").build([
            Paragraph(f"STATEMENT OF VALUES - {s['insured']}", ss["Title"]),
            Paragraph(f"Prepared by {s['broker']} for the policy period beginning {s['eff'].strftime('%m/%d/%Y')}. Values at replacement cost.", ss["Italic"]),
            Spacer(1, 10), t,
        ])
        docs.append(dict(doc_id=f"{s['submission_id']}-SOV", submission_id=s["submission_id"], doc_type="SOV",
                         file_name="statement_of_values.pdf", file_path=p, pages=1))
        # 3) loss run
        lr = s["lossrun"]
        p = f"{d}/loss_run.pdf"
        head = ["Date of loss", "Claim #", "Line", "Loc #", "Cause of loss", "Paid ($)", "Reserve ($)", "Total incurred ($)", "Status"]
        body = []
        for j, c in enumerate(lr["claims"], start=1):
            body.append([c["loss_date"].strftime("%m/%d/%Y"), f"{int(s['submission_id'][-4:]) * 7 % 9000 + 1000}-{j:02d}", c["line"], str(c["loc_no"]),
                         c["cause"], f"{c['paid']:,.0f}", f"{c['reserve']:,.0f}", f"{c['paid'] + c['reserve']:,.0f}", c["status"]])
        if not body:
            body.append(["-", "-", "-", "-", "NO LOSSES REPORTED FOR THE PERIODS SHOWN", "0", "0", "0", "-"])
        tot = sum(c["paid"] + c["reserve"] for c in lr["claims"])
        body.append(["", "", "", "", f"TOTAL - {len(lr['claims'])} claim(s)", f"{sum(c['paid'] for c in lr['claims']):,.0f}",
                     f"{sum(c['reserve'] for c in lr['claims']):,.0f}", f"{tot:,.0f}", ""])
        t = Table([head] + body, repeatRows=1)
        t.setStyle(grid)
        start = date(lr["valued"].year - lr["years"], lr["valued"].month, 1)
        SimpleDocTemplate(p, pagesize=landscape(letter), title=f"Loss run {s['submission_id']}").build([
            Paragraph(f"{lr['carrier'] if lr['carrier'] != 'Prior carrier' else s['prior_carrier']} - LOSS RUN REPORT", ss["Title"]),
            Paragraph(f"Insured: {s['insured']}. Policy periods {start.strftime('%m/%d/%Y')} to {lr['valued'].strftime('%m/%d/%Y')} "
                      f"({lr['years']} years). Valued as of {lr['valued'].strftime('%m/%d/%Y')}. All lines of business.", ss["BodyText"]),
            Spacer(1, 10), t,
        ])
        docs.append(dict(doc_id=f"{s['submission_id']}-LR", submission_id=s["submission_id"], doc_type="LOSS_RUN",
                         file_name="loss_run.pdf", file_path=p, pages=1))
    return docs


# ─────────────────────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────────────────────

Str, Int, Dbl, Bool, Dt, Ts = T.StringType(), T.IntegerType(), T.DoubleType(), T.BooleanType(), T.DateType(), T.TimestampNTZType()


def S(name, typ):
    return T.StructField(name, typ, True)


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="financial_services")
    ap.add_argument("--schema", default="commercial_underwriting_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Tidewell Specialty Insurance (fictional) — commercial P&C underwriting copilot demo'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.submission_docs COMMENT 'Broker submission packets (application, statement of values, loss run PDFs) — parsed with ai_parse_document'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.uw_guidelines COMMENT 'Tidewell underwriting guidelines, appetite bulletins, rating manual and authority matrix — documents searched by the Genie agent'")
    for t in ["submission_documents", "submission_inbox", "claims", "policy_quarters", "submission_history", "policies", "brokers",
              "appetite_rules", "rating_factors"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    brokers = build_brokers()
    policies = build_policies(brokers)
    pq, claims = build_quarters_and_claims(policies)
    history = build_submission_history(policies, brokers)
    queue = build_queue(brokers)
    vol = f"/Volumes/{args.catalog}/{args.schema}/submission_docs"
    docs = render_packets(queue, vol)
    print(f"rendered {len(docs)} PDFs into {vol}")

    # quick self-check of the planted signal
    ep, inc = {}, {}
    pol = {p["policy_id"]: p for p in policies}
    for r in pq:
        p = pol[r["policy_id"]]
        k = (p["segment_code"] == "HAB" and p["hail_belt"], r["quarter"])
        ep[k] = ep.get(k, 0) + r["earned_premium"]
    for c in claims:
        p = pol[c["policy_id"]]
        k = (p["segment_code"] == "HAB" and p["hail_belt"], c["accident_quarter"])
        inc[k] = inc.get(k, 0) + c["incurred_amount"]
    for q in QUARTERS:
        print(f"  {q}: hail-belt habitational LR {inc.get((True, q), 0) / ep[(True, q)]:.0%} · rest of book {inc.get((False, q), 0) / ep[(False, q)]:.0%}")

    write(spark, fqs, "brokers", brokers,
          T.StructType([S("broker_id", Str), S("broker_name", Str), S("city", Str), S("state", Str), S("tier", Str),
                        S("relationship_since", Dt), S("appointed_lines", Str)]),
          "Brokers (producers) appointed with Tidewell for commercial property / package business. tier = Premier / Preferred / Standard.",
          pk="broker_id")
    write(spark, fqs, "policies", policies,
          T.StructType([S("policy_id", Str), S("submission_id", Str), S("account_name", Str), S("segment_code", Str), S("segment", Str),
                        S("class_description", Str), S("state", Str), S("city", Str), S("hail_belt", Bool), S("construction", Str),
                        S("year_built", Int), S("roof_age_years", Int), S("roof_age_band", Str), S("old_roof_tiv_share", Dbl),
                        S("frame_tiv_share", Dbl), S("sprinklered", Bool), S("protection_class", Int), S("locations", Int), S("tiv", Dbl),
                        S("prior_loss_count_5yr", Int), S("prior_loss_amount_5yr", Dbl), S("prior_hail_losses_5yr", Int),
                        S("written_premium", Dbl), S("wind_hail_deductible_pct", Dbl), S("effective_date", Dt), S("expiration_date", Dt),
                        S("broker_id", Str), S("underwriter", Str)]),
          "Commercial property / package policies written by Tidewell (12-month terms, effective Jul-2023 to Jun-2026) with the underwriting "
          "characteristics at bind. hail_belt = TX OK KS NE CO. roof_age_years = roof age at the effective date; old_roof_tiv_share = share "
          "of TIV in buildings with roofs older than 15 years.", pk="policy_id")
    write(spark, fqs, "policy_quarters", pq,
          T.StructType([S("policy_id", Str), S("quarter", Str), S("quarter_start", Dt), S("earned_premium", Dbl), S("earned_exposure_days", Int)]),
          "Earned premium per policy per calendar quarter, 2024-Q3 to 2026-Q2 (pro-rata by days). Denominator of every loss ratio.")
    write(spark, fqs, "claims", claims,
          T.StructType([S("claim_id", Str), S("policy_id", Str), S("loss_date", Dt), S("report_date", Dt), S("accident_quarter", Str),
                        S("peril", Str), S("incurred_amount", Dbl), S("paid_amount", Dbl), S("reserve_amount", Dbl), S("status", Str),
                        S("catastrophe_event", Str)]),
          "Claims on Tidewell policies with accident dates 2024-Q3 to 2026-Q2. incurred = paid + case reserve. Numerator of every loss ratio.",
          pk="claim_id")
    write(spark, fqs, "submission_history", history,
          T.StructType([S("submission_id", Str), S("received_date", Dt), S("broker_id", Str), S("insured_name", Str), S("segment_code", Str),
                        S("segment", Str), S("state", Str), S("tiv", Dbl), S("locations", Int), S("requested_effective_date", Dt),
                        S("outcome", Str), S("quoted_premium", Dbl), S("bound_premium", Dbl), S("decline_reason", Str), S("underwriter", Str),
                        S("policy_id", Str), S("days_to_quote", Int)]),
          "Historical broker submissions (received May-2024 to Sep-2026) with the underwriting outcome: BOUND, QUOTED_NOT_BOUND or DECLINED. "
          "Hit ratio = bound / quoted.", pk="submission_id")
    inbox = [dict(submission_id=s["submission_id"], received_ts=s["received"], broker_id=next(b["broker_id"] for b in brokers if b["broker_name"] == s["broker"]),
                  broker_contact=s["contact"], insured_name=s["insured"],
                  email_subject=f"New submission: {s['insured']} - property/GL package eff {s['eff'].strftime('%m/%d/%Y')}",
                  email_body=f"Hi Tidewell team, attached please find the application, SOV and loss runs for {s['insured']}. {s['remarks']} "
                             f"Please let me know if you need anything else. - {s['contact']}, {s['broker']}",
                  attachments=3, status="NEW") for s in queue]
    write(spark, fqs, "submission_inbox", inbox,
          T.StructType([S("submission_id", Str), S("received_ts", Ts), S("broker_id", Str), S("broker_contact", Str), S("insured_name", Str),
                        S("email_subject", Str), S("email_body", Str), S("attachments", Int), S("status", Str)]),
          "The underwriting inbox on Mon 28 Sep 2026: 24 new broker submissions. The facts (values, construction, roofs, losses) live in the "
          "attached PDFs (submission_documents), parsed with ai_parse_document.", pk="submission_id")
    write(spark, fqs, "submission_documents", docs,
          T.StructType([S("doc_id", Str), S("submission_id", Str), S("doc_type", Str), S("file_name", Str), S("file_path", Str), S("pages", Int)]),
          "One row per PDF attached to a new submission: APPLICATION (ACORD 125/140 format), SOV (statement of values), LOSS_RUN.", pk="doc_id")
    write(spark, fqs, "appetite_rules", [dict(zip(["rule_id", "doc_ref", "title", "applies_to", "action", "threshold", "description"], r)) for r in APPETITE_RULES],
          T.StructType([S("rule_id", Str), S("doc_ref", Str), S("title", Str), S("applies_to", Str), S("action", Str), S("threshold", Dbl), S("description", Str)]),
          "Machine-readable appetite, documentation and authority rules (from the Tidewell underwriting guidelines) enforced by triage and the workbench.",
          pk="rule_id")
    write(spark, fqs, "rating_factors", [dict(factor_id=f"{r[0]}:{r[1]}", factor_type=r[0], factor_key=r[1], value=float(r[2]), description=r[3], doc_ref=r[4]) for r in RATING],
          T.StructType([S("factor_id", Str), S("factor_type", Str), S("factor_key", Str), S("value", Dbl), S("description", Str), S("doc_ref", Str)]),
          "Tidewell commercial property rating plan (TSI-RATE-03): base rates per $100 TIV and multiplicative modifiers used by the pricing engine.",
          pk="factor_id")
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {fqs}.uw_decisions (
        decision_id STRING, submission_id STRING, insured_name STRING, segment STRING, state STRING, decision STRING,
        tiv_submitted DOUBLE, tiv_quoted DOUBLE, excluded_locations STRING, property_premium DOUBLE, gl_premium DOUBLE, total_premium DOUBLE,
        conditions STRING, rationale STRING, appetite_refs STRING, ml_p_as_submitted DOUBLE, ml_p_verified DOUBLE, referral_required BOOLEAN,
        drafted_by STRING, decided_by STRING, cuo_note STRING, decided_at TIMESTAMP)
        COMMENT 'Write-back from the Underwriting Copilot app: one row per issued decision (QUOTE, QUOTE_WITH_CONDITIONS or DECLINE), after CUO approval when referred.'""")
    for stmt in [
        f"ALTER TABLE {fqs}.policies ADD CONSTRAINT policies_broker_fk FOREIGN KEY (broker_id) REFERENCES {fqs}.brokers RELY",
        f"ALTER TABLE {fqs}.claims ADD CONSTRAINT claims_policy_fk FOREIGN KEY (policy_id) REFERENCES {fqs}.policies RELY",
        f"ALTER TABLE {fqs}.policy_quarters ADD CONSTRAINT pq_policy_fk FOREIGN KEY (policy_id) REFERENCES {fqs}.policies RELY",
        f"ALTER TABLE {fqs}.submission_history ADD CONSTRAINT sh_broker_fk FOREIGN KEY (broker_id) REFERENCES {fqs}.brokers RELY",
        f"ALTER TABLE {fqs}.submission_inbox ADD CONSTRAINT inbox_broker_fk FOREIGN KEY (broker_id) REFERENCES {fqs}.brokers RELY",
        f"ALTER TABLE {fqs}.submission_documents ADD CONSTRAINT docs_sub_fk FOREIGN KEY (submission_id) REFERENCES {fqs}.submission_inbox RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
