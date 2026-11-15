"""
Halcyra Therapeutics — clinical trial site selection & enrollment rescue: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, `pip install databricks-connect`,
    DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog healthcare_lifesciences --schema trial_site_selection

Tables written (Delta, PK/FK RELY constraints + comments):
  trials                   Halcyra's 5 active interventional trials (the portfolio)
  protocol_criteria        inclusion / exclusion criteria per trial (+ the feasibility assumption behind each)
  sites                    ~200 US investigator sites (active in a Halcyra trial or candidates in the feasibility network)
  trial_sites              which site runs which trial, and its status (active / activating / not_activated)
  site_activation          start-up milestones per trial site (selection → CDA → contract → IRB → SIV → activation)
  enrollment_plan          planned cumulative randomizations per trial per month (the enrollment curve in the protocol)
  screening_log            one row per patient screened (all trials): outcome, coded screen-fail reason, coordinator note
  screening_truth          generator ground truth of each screen failure's real criterion (eval only, never shown to the AI)
  site_catchment           de-identified EHR-network patient counts around every site, criterion by criterion
                           (T2D+CKD pool → eGFR → UACR → HbA1c → SGLT2i use → potassium) — current vs amended protocol
  population_trends        quarterly share of the T2D+CKD population on an SGLT2 inhibitor, by region
  competing_trials         other sponsors' trials recruiting the same population
  competing_trial_sites    which of our sites / candidates also run a competing trial (and since when)
  site_trial_history       every site's past trials (any sponsor): enrollment rate, screen-fail rate, start-up days — ML training data

THE PLANTED SIGNAL — CASCADE-CKD is 40% behind plan because the protocol was written for a world that no longer exists:
  * Exclusion E4 ("SGLT2 inhibitor use within 12 weeks of screening") assumed ~15% of T2D+CKD patients were on an
    SGLT2i (2023 feasibility). SGLT2 inhibitors are now standard of care in diabetic kidney disease: ~49% of the
    catchment population today. E4 has become the #1 screen-failure reason and its share keeps climbing.
  * Site coordinators code most E4 failures as "OTHER — concomitant medication" in the EDC, so the coded report
    UNDER-counts it; AI Functions reading the free-text notes recover the real picture.
  * ~76% of those SGLT2i patients have been on a STABLE dose ≥ 12 weeks — the population a "stable background
    SGLT2i allowed + stratified randomization" amendment would bring back (the SAP already prespecifies the subgroup).
  * A competing trial (Nephrexa Bio's REDWOOD-CKD) opened ~8 months ago at 13 of our Southeast/Texas sites; their
    randomization rate fell ~55% since.  8 activated sites have randomized nobody (industry: ~11% of sites enroll zero).
  * Local-IRB academic sites take ~250 days to activate vs ~150 on the central IRB.
  * Candidate sites in the Midwest / Mountain West feasibility network have deep amended-eligible pools, no competing
    trial, and good history — the ML model ranks them for the rescue list.
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
# Time anchors
# ─────────────────────────────────────────────────────────────────────────────
AS_OF = date.today()


def month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


CUR_MONTH = month_start(AS_OF)
COMPETITOR_START = add_months(CUR_MONTH, -8) + timedelta(days=9)  # REDWOOD-CKD opens enrollment

# ─────────────────────────────────────────────────────────────────────────────
# Portfolio
# ─────────────────────────────────────────────────────────────────────────────
# trial_id, protocol, acronym, title, phase, TA, indication, target, planned_sites, months_since_fpi,
# planned_enroll_months, protocol_version, study_manager, base_rate_per_site (randomized / site / month), pass_rate
TRIALS = [
    ("CASCADE-CKD", "HAL-301", "CASCADE-CKD",
     "A Phase III, randomized, double-blind, placebo-controlled study of velmeraptan in adults with type 2 diabetes and chronic kidney disease",
     "Phase III", "Nephrology", "Diabetic kidney disease (T2D + CKD)", 1200, 72, 17, 24, "v3.0", "Dr. Elena Marsh", None, None),
    ("TIDEWATER-HF", "HAL-305", "TIDEWATER-HF",
     "A Phase III study of orvenitide in heart failure with preserved ejection fraction",
     "Phase III", "Cardiology", "Heart failure with preserved ejection fraction (HFpEF)", 2400, 110, 20, 28, "v2.1", "Marcus Oyelaran", 0.95, 0.63),
    ("SENTRY-AF", "HAL-330", "SENTRY-AF",
     "A Phase III event-driven study of tavorixaban vs apixaban in non-valvular atrial fibrillation",
     "Phase III", "Cardiology", "Non-valvular atrial fibrillation", 1800, 90, 14, 20, "v1.2", "Priya Venkataraman", 1.42, 0.74),
    ("LUMEN-MASH", "HAL-214", "LUMEN-MASH",
     "A Phase IIb dose-ranging study of halcyfibrate in MASH with F2-F3 fibrosis",
     "Phase IIb", "Hepatology", "Metabolic dysfunction-associated steatohepatitis (MASH)", 300, 34, 11, 15, "v2.0", "Tomasz Wierzbicki", 0.98, 0.41),
    ("ORCHID-1", "HAL-122", "ORCHID-1",
     "A Phase I/II open-label study of HAL-122 in KRAS G12D-mutant advanced solid tumors",
     "Phase I/II", "Oncology", "KRAS G12D-mutant advanced solid tumors", 120, 18, 12, 18, "v4.0", "Dr. Amara Nwosu", 0.52, 0.33),
]

# CASCADE-CKD criteria (the one the demo digs into). criterion_id, type, short_name, text, assumed pass %, amendable, rationale
CASCADE_CRITERIA = [
    ("I1", "inclusion", "Age 18-85, T2D diagnosis", "Adults aged 18 to 85 years with a documented diagnosis of type 2 diabetes mellitus.", 0.98, False,
     "Target population."),
    ("I2", "inclusion", "eGFR 25-<60", "eGFR (CKD-EPI 2021) ≥ 25 and < 60 mL/min/1.73m² at screening.", 0.90, False,
     "Defines moderate-to-severe CKD where the renal endpoint event rate supports the sample size."),
    ("I3", "inclusion", "UACR 300-5000 mg/g", "Urine albumin-to-creatinine ratio ≥ 300 and < 5000 mg/g (first-morning void, central lab).", 0.84, False,
     "Enriches for progressors; the primary endpoint (sustained ≥40% eGFR decline, ESKD or renal death) needs albuminuric patients."),
    ("I4", "inclusion", "HbA1c ≤ 10.5%", "HbA1c ≤ 10.5% at screening.", 0.95, True,
     "Excludes uncontrolled diabetes likely to need rescue therapy changes during the run-in."),
    ("I5", "inclusion", "Max-tolerated ACEi/ARB ≥ 4 wks", "On a maximum tolerated, stable dose of an ACE inhibitor or ARB for ≥ 4 weeks.", 0.93, False,
     "Standard-of-care background; the drug is tested on top of RAS blockade."),
    ("E1", "exclusion", "Non-diabetic kidney disease", "Known non-diabetic kidney disease (e.g. IgA nephropathy, polycystic kidney disease).", 0.97, False,
     "Different disease biology."),
    ("E2", "exclusion", "Dialysis / transplant", "Dialysis within 12 weeks or kidney transplant.", 0.99, False, "End-stage disease."),
    ("E3", "exclusion", "Recent CV event", "Myocardial infarction, stroke or HF hospitalization within 12 weeks.", 0.96, False, "Safety."),
    ("E4", "exclusion", "SGLT2 inhibitor within 12 weeks", "Treatment with an SGLT2 inhibitor within 12 weeks prior to screening.", 0.85, True,
     "Written in 2023 to avoid confounding the renal endpoint with a second renoprotective agent. Feasibility assumed ~15% SGLT2i use."),
    ("E5", "exclusion", "Other MRA", "Treatment with a steroidal or non-steroidal mineralocorticoid receptor antagonist within 4 weeks.", 0.97, False,
     "Same mechanism of action as velmeraptan."),
    ("E6", "exclusion", "Hepatic impairment", "Child-Pugh B or C hepatic impairment.", 0.99, False, "PK safety."),
    ("E7", "exclusion", "Potassium > 4.8 mmol/L", "Serum potassium > 4.8 mmol/L at screening.", 0.92, True,
     "Hyperkalemia risk with MR antagonism."),
]
# screen-fail engine for CASCADE — per-screened-patient failure hazard by criterion (E4 grows with SGLT2i uptake)
CASCADE_FAIL_HAZARD = {"I3": 0.115, "I2": 0.065, "E7": 0.07, "I4": 0.045, "I5": 0.03, "E3": 0.015, "E5": 0.012, "E1": 0.01, "CONSENT": 0.045}

OTHER_CRITERIA = {
    "TIDEWATER-HF": [("I1", "inclusion", "LVEF ≥ 50%", "Left ventricular ejection fraction ≥ 50% by echo within 12 months.", 0.8, False),
                     ("I2", "inclusion", "NT-proBNP ≥ 300 pg/mL", "NT-proBNP ≥ 300 pg/mL (≥ 900 if atrial fibrillation).", 0.7, False),
                     ("I3", "inclusion", "NYHA II-IV", "NYHA class II-IV symptoms.", 0.9, False),
                     ("E1", "exclusion", "eGFR < 25", "eGFR < 25 mL/min/1.73m².", 0.93, False),
                     ("E2", "exclusion", "Recent ACS", "Acute coronary syndrome within 90 days.", 0.95, False)],
    "SENTRY-AF": [("I1", "inclusion", "CHA2DS2-VASc ≥ 2", "CHA2DS2-VASc score ≥ 2 (men) or ≥ 3 (women).", 0.88, False),
                  ("E1", "exclusion", "Mechanical valve", "Mechanical heart valve or moderate-severe mitral stenosis.", 0.97, False),
                  ("E2", "exclusion", "Active bleeding", "Active bleeding or high bleeding risk (HAS-BLED ≥ 4).", 0.93, False),
                  ("E3", "exclusion", "CrCl < 25", "Creatinine clearance < 25 mL/min.", 0.95, False)],
    "LUMEN-MASH": [("I1", "inclusion", "Biopsy F2-F3", "Biopsy-proven MASH with fibrosis stage F2 or F3 within 6 months.", 0.55, False),
                   ("I2", "inclusion", "NAS ≥ 4", "NAFLD activity score ≥ 4.", 0.8, False),
                   ("E1", "exclusion", "Other liver disease", "Other chronic liver disease (viral, alcohol-related, autoimmune).", 0.9, False),
                   ("E2", "exclusion", "Cirrhosis", "Cirrhosis (F4) or decompensation history.", 0.92, False)],
    "ORCHID-1": [("I1", "inclusion", "KRAS G12D confirmed", "KRAS G12D mutation confirmed by central NGS.", 0.45, False),
                 ("I2", "inclusion", "ECOG 0-1", "ECOG performance status 0-1.", 0.8, False),
                 ("E1", "exclusion", "Active CNS metastases", "Untreated or symptomatic CNS metastases.", 0.88, False),
                 ("E2", "exclusion", "Prior KRAS inhibitor", "Prior treatment with a KRAS G12D-directed therapy.", 0.9, False)],
}

# ─────────────────────────────────────────────────────────────────────────────
# Geography: metro, state, region, lat, lon, weight
# ─────────────────────────────────────────────────────────────────────────────
METROS = [
    ("Atlanta", "GA", "Southeast", 33.75, -84.39), ("Birmingham", "AL", "Southeast", 33.52, -86.80),
    ("Charlotte", "NC", "Southeast", 35.23, -80.84), ("Jacksonville", "FL", "Southeast", 30.33, -81.66),
    ("Tampa", "FL", "Southeast", 27.95, -82.46), ("Miami", "FL", "Southeast", 25.76, -80.19),
    ("Memphis", "TN", "Southeast", 35.15, -90.05), ("Nashville", "TN", "Southeast", 36.16, -86.78),
    ("Houston", "TX", "South Central", 29.76, -95.37), ("Dallas", "TX", "South Central", 32.78, -96.80),
    ("San Antonio", "TX", "South Central", 29.42, -98.49), ("New Orleans", "LA", "South Central", 29.95, -90.07),
    ("Oklahoma City", "OK", "South Central", 35.47, -97.52), ("Chicago", "IL", "Midwest", 41.88, -87.63),
    ("Detroit", "MI", "Midwest", 42.33, -83.05), ("Grand Rapids", "MI", "Midwest", 42.96, -85.67),
    ("Columbus", "OH", "Midwest", 39.96, -83.00), ("Cleveland", "OH", "Midwest", 41.50, -81.69),
    ("Indianapolis", "IN", "Midwest", 39.77, -86.16), ("Milwaukee", "WI", "Midwest", 43.04, -87.91),
    ("Minneapolis", "MN", "Midwest", 44.98, -93.27), ("St. Louis", "MO", "Midwest", 38.63, -90.20),
    ("Kansas City", "MO", "Midwest", 39.10, -94.58), ("Omaha", "NE", "Midwest", 41.26, -95.93),
    ("Des Moines", "IA", "Midwest", 41.59, -93.62), ("Denver", "CO", "Mountain West", 39.74, -104.99),
    ("Salt Lake City", "UT", "Mountain West", 40.76, -111.89), ("Albuquerque", "NM", "Mountain West", 35.08, -106.65),
    ("Phoenix", "AZ", "Mountain West", 33.45, -112.07), ("Boise", "ID", "Mountain West", 43.62, -116.21),
    ("Los Angeles", "CA", "West", 34.05, -118.24), ("San Diego", "CA", "West", 32.72, -117.16),
    ("Sacramento", "CA", "West", 38.58, -121.49), ("Portland", "OR", "West", 45.52, -122.68),
    ("Seattle", "WA", "West", 47.61, -122.33), ("Boston", "MA", "Northeast", 42.36, -71.06),
    ("New York", "NY", "Northeast", 40.71, -74.01), ("Philadelphia", "PA", "Northeast", 39.95, -75.17),
    ("Pittsburgh", "PA", "Northeast", 40.44, -79.99), ("Baltimore", "MD", "Northeast", 39.29, -76.61),
    ("Buffalo", "NY", "Northeast", 42.89, -78.88), ("Hartford", "CT", "Northeast", 41.77, -72.67),
]
METRO_BY_NAME = {m[0]: m for m in METROS}
# prevalence multipliers of diabetic kidney disease by region (drives catchment pools)
REGION_DKD = {"Southeast": 1.25, "South Central": 1.2, "Midwest": 1.05, "Mountain West": 0.85, "West": 0.9, "Northeast": 0.95}
# SGLT2i uptake today by region (share of T2D+CKD on an SGLT2i)
REGION_SGLT2 = {"Southeast": 0.47, "South Central": 0.46, "Midwest": 0.50, "Mountain West": 0.52, "West": 0.53, "Northeast": 0.50}

FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "William", "Elizabeth", "Daniel",
         "Sofia", "Ahmed", "Mei", "Carlos", "Aisha", "Hiroshi", "Olivia", "Rajesh", "Grace", "Samuel", "Nadia", "Victor",
         "Hannah", "Kwame", "Leah", "Andrei", "Isabel", "Tomas", "Fatima", "Benjamin", "Chloe", "Diego", "Ruth", "Ivan"]
LAST = ["Alvarez", "Brennan", "Castillo", "Donovan", "Ellison", "Fitzgerald", "Garrison", "Hollis", "Ibarra", "Jansen",
        "Kowalczyk", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrakis", "Quintero", "Rosenberg", "Sandoval",
        "Thackeray", "Underwood", "Valdez", "Whitaker", "Yilmaz", "Zimmerman", "Ashworth", "Banerjee", "Calloway",
        "Delacroix", "Esposito", "Farouk", "Gallagher", "Haddad", "Iverson", "Kaplan", "Lorenzo", "Mbeki", "Novak"]

SITE_PATTERNS = {
    "community": ["{m} Kidney & Hypertension Associates", "{m} Nephrology Research", "{m} Renal Care Clinical Research",
                  "{m} Diabetes & Endocrine Clinic", "{m} Internal Medicine Research Group"],
    "research_network": ["{m} Clinical Research Center", "Summit Clinical Trials — {m}", "Meridian Research — {m}",
                         "Beacon Clinical Research — {m}"],
    "academic": ["{m} University Health — Division of Nephrology", "{m} Academic Medical Center — Kidney Research"],
    "hospital": ["{m} Regional Medical Center — Research Institute", "St. Brendan Health {m} — Clinical Research"],
}


def person():
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


# ─────────────────────────────────────────────────────────────────────────────
# Sites
# ─────────────────────────────────────────────────────────────────────────────
# Hand-placed hero sites (the demo refers to them by name).
HERO_SITES = [
    # site_id, name, metro, type, irb, fte, quality, cascade_role, catchment_scale, prior_halcyra
    ("S-1042", "Magnolia Clinical Research", "Birmingham", "research_network", "central", 1.5, 0.55, "zero_competitor", 1.1, 1),
    ("S-1107", "Gulf Coast Kidney Institute", "Houston", "community", "central", 2.5, 1.25, "competitor_drop", 1.3, 2),
    ("S-1188", "Northfield University Health — Division of Nephrology", "Boston", "academic", "local", 3.0, 1.1, "top_active", 1.0, 3),
    ("S-2014", "Great Lakes Nephrology Research", "Grand Rapids", "community", "central", 3.0, 1.35, "candidate_top", 1.35, 2),
    ("S-2031", "Front Range Kidney Research", "Denver", "research_network", "central", 2.5, 1.3, "candidate_top", 1.15, 1),
    ("S-2057", "Heartland Renal Research", "Omaha", "community", "central", 2.0, 1.25, "candidate_top", 1.2, 0),
    ("S-2066", "Wasatch Diabetes & Kidney Center", "Salt Lake City", "community", "central", 2.0, 1.2, "candidate_top", 1.1, 1),
    ("S-2090", "Twin Cities Nephrology Research", "Minneapolis", "community", "central", 2.5, 1.2, "candidate_top", 1.2, 0),
    ("S-2112", "Peachtree Kidney Trials", "Atlanta", "research_network", "central", 3.0, 1.35, "candidate_competitor", 1.45, 1),
]
COMPETITOR_METROS = {"Atlanta", "Birmingham", "Charlotte", "Jacksonville", "Tampa", "Memphis", "Houston", "Dallas", "San Antonio", "New Orleans"}


def build_sites():
    sites = []
    used_names = set()
    for sid, name, metro, stype, irb, fte, quality, role, cscale, prior in HERO_SITES:
        m = METRO_BY_NAME[metro]
        sites.append(dict(site_id=sid, site_name=name, principal_investigator=f"Dr. {person()}", city=metro, state=m[1],
                          region=m[2], latitude=round(m[3] + rng.uniform(-0.08, 0.08), 4),
                          longitude=round(m[4] + rng.uniform(-0.08, 0.08), 4), site_type=stype, irb_type=irb,
                          coordinator_fte=fte, therapeutic_focus="Nephrology" if "Kidney" in name or "Neph" in name or "Renal" in name else "Multi-specialty",
                          prior_halcyra_trials=prior, _quality=quality, _role=role, _cscale=cscale))
        used_names.add(name)
    n = 1000
    for i in range(196):
        m = METROS[i % len(METROS)] if i < 168 else rng.choice(METROS)
        stype = rng.choices(["community", "research_network", "academic", "hospital"], [0.42, 0.26, 0.17, 0.15])[0]
        name = rng.choice(SITE_PATTERNS[stype]).format(m=m[0])
        k = 2
        while name in used_names:
            name = f"{rng.choice(SITE_PATTERNS[stype]).format(m=m[0])}" + (f" ({['North', 'South', 'East', 'West', 'Central'][k % 5]})")
            k += 1
        used_names.add(name)
        n += rng.randint(3, 9)
        sid = f"S-{n}"
        while any(s["site_id"] == sid for s in sites):
            n += 1
            sid = f"S-{n}"
        irb = "local" if stype == "academic" and rng.random() < 0.85 else ("local" if stype == "hospital" and rng.random() < 0.4 else "central")
        focus = "Nephrology" if ("Kidney" in name or "Neph" in name or "Renal" in name) else \
            ("Endocrinology" if "Diabetes" in name else rng.choice(["Multi-specialty", "Multi-specialty", "Cardiology", "Hepatology", "Oncology"]))
        sites.append(dict(site_id=sid, site_name=name, principal_investigator=f"Dr. {person()}", city=m[0], state=m[1],
                          region=m[2], latitude=round(m[3] + rng.uniform(-0.15, 0.15), 4),
                          longitude=round(m[4] + rng.uniform(-0.15, 0.15), 4), site_type=stype, irb_type=irb,
                          coordinator_fte=round(rng.choice([1.0, 1.5, 2.0, 2.0, 2.5, 3.0, 4.0]), 1), therapeutic_focus=focus,
                          prior_halcyra_trials=rng.choices([0, 1, 2, 3, 4], [0.35, 0.3, 0.2, 0.1, 0.05])[0],
                          _quality=max(0.2, rng.lognormvariate(0, 0.38)), _role=None, _cscale=max(0.35, rng.lognormvariate(0, 0.35))))
    return sites


def assign_cascade(sites):
    """72 CASCADE sites selected: 64 active, 5 still activating, 3 never activated. Southeast/South Central heavy
    (the 2023 feasibility favoured high-prevalence regions); Midwest / Mountain West mostly left as candidates."""
    for s in sites:
        r = s["_role"]
        if r in ("zero_competitor", "competitor_drop", "top_active"):
            s["_cascade"] = "active"
        elif r in ("candidate_top", "candidate_competitor"):
            s["_cascade"] = None
    pool = [s for s in sites if s["_role"] is None]
    rng.shuffle(pool)
    region_pick = {"Southeast": 0.9, "South Central": 0.9, "Northeast": 0.62, "West": 0.5, "Midwest": 0.2, "Mountain West": 0.12}
    chosen = []
    for s in pool:
        if s["therapeutic_focus"] in ("Oncology", "Hepatology"):
            continue
        if rng.random() < region_pick[s["region"]]:
            chosen.append(s)
    chosen = chosen[:69]
    for i, s in enumerate(chosen):
        s["_cascade"] = "active" if i < 61 else ("activating" if i < 66 else "not_activated")
    for s in pool:
        s.setdefault("_cascade", None)
    # zero enrollers: 7 low-quality active sites (+ the Magnolia hero = 8)
    actives = [s for s in chosen if s["_cascade"] == "active"]
    for s in sorted(actives, key=lambda x: x["_quality"])[:7]:
        s["_role"] = "zero"


def activation_days(s, rng_):
    base = 150 if s["irb_type"] == "central" else 245
    if s["site_type"] == "academic":
        base += 20
    if s["prior_halcyra_trials"] >= 2:
        base -= 25
    return max(70, int(rng_.gauss(base, base * 0.16)))


def build_trial_sites_and_activation(sites):
    trial_sites, activation = [], []
    fpi = {t[0]: add_months(CUR_MONTH, -t[9]) for t in TRIALS}
    # CASCADE
    for s in sites:
        st = s.get("_cascade")
        if not st:
            continue
        days = activation_days(s, rng)
        if st == "active":
            if s["_role"] in ("zero_competitor", "competitor_drop", "top_active"):
                act = fpi["CASCADE-CKD"] + timedelta(days=rng.randint(0, 60) if s["_role"] != "zero_competitor" else 150)
            else:
                act = fpi["CASCADE-CKD"] + timedelta(days=int(rng.triangular(0, 330, 60)))
            act = min(act, AS_OF - timedelta(days=45))
        elif st == "activating":
            act = None
        else:
            act = None
        selected = (act or AS_OF) - timedelta(days=days) if act else AS_OF - timedelta(days=rng.randint(120, 260))
        if act and selected > fpi["CASCADE-CKD"] - timedelta(days=30) and s["_role"] is None:
            pass
        ms = milestones(selected, act, days, st)
        s["_cascade_activation"] = act
        trial_sites.append(dict(trial_id="CASCADE-CKD", site_id=s["site_id"], status=st, activation_date=act,
                                target_randomized=17 if st != "not_activated" else 0))
        activation.append(dict(trial_id="CASCADE-CKD", site_id=s["site_id"], **ms))
    # other trials: random subsets
    for t in TRIALS[1:]:
        tid, n_sites = t[0], t[8]
        focus_ok = {"TIDEWATER-HF": ("Cardiology", "Multi-specialty", "Nephrology"), "SENTRY-AF": ("Cardiology", "Multi-specialty", "Endocrinology"),
                    "LUMEN-MASH": ("Hepatology", "Multi-specialty", "Endocrinology"), "ORCHID-1": ("Oncology", "Multi-specialty")}[tid]
        cands = [s for s in sites if s["therapeutic_focus"] in focus_ok and s["_role"] not in ("candidate_top",)]
        rng.shuffle(cands)
        for s in cands[: int(n_sites * 0.62)]:
            days = activation_days(s, rng)
            act = fpi[tid] + timedelta(days=int(rng.triangular(0, 300, 40)))
            act = min(act, AS_OF - timedelta(days=30))
            ms = milestones(act - timedelta(days=days), act, days, "active")
            s.setdefault("_other", {})[tid] = act
            trial_sites.append(dict(trial_id=tid, site_id=s["site_id"], status="active", activation_date=act,
                                    target_randomized=int(t[7] / n_sites)))
            activation.append(dict(trial_id=tid, site_id=s["site_id"], **ms))
    return trial_sites, activation


def milestones(selected: date, act: date | None, days: int, status: str):
    f = [0.07, 0.14, 0.52, 0.78, 0.9, 1.0]  # cda, feasibility, contract, irb, siv, activation (fractions of cycle)
    pts = [selected + timedelta(days=int(days * x)) for x in f]
    out = dict(selected_date=selected, cda_signed_date=pts[0], feasibility_complete_date=pts[1],
               contract_executed_date=pts[2], irb_approval_date=pts[3], siv_date=pts[4], activation_date=act,
               cycle_time_days=days if act else None)
    if status in ("activating", "not_activated"):
        # stuck at contract / IRB
        cut = AS_OF
        for k in ("cda_signed_date", "feasibility_complete_date", "contract_executed_date", "irb_approval_date", "siv_date"):
            if out[k] and out[k] > cut:
                out[k] = None
        if status == "not_activated":
            out["contract_executed_date"] = None
            out["irb_approval_date"] = None
            out["siv_date"] = None
        out["activation_date"] = None
        out["cycle_time_days"] = None
    out["days_in_startup"] = (AS_OF - selected).days if not act else days
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Catchment (de-identified EHR-network counts) + population trends
# ─────────────────────────────────────────────────────────────────────────────

def build_catchment(sites):
    rows = []
    for s in sites:
        base = 2600 * REGION_DKD[s["region"]] * s["_cscale"] * (1.25 if s["site_type"] in ("academic", "hospital") else 1.0)
        pool = int(base * rng.uniform(0.85, 1.15))
        egfr = int(pool * rng.uniform(0.52, 0.6))              # eGFR 25-<60
        uacr = int(egfr * rng.uniform(0.34, 0.42))              # UACR 300-5000
        hba1c = int(uacr * rng.uniform(0.9, 0.95))              # HbA1c ≤ 10.5
        sg_share = min(0.7, max(0.3, REGION_SGLT2[s["region"]] + rng.uniform(-0.05, 0.05)))
        on_sglt2 = int(hba1c * sg_share)
        stable = int(on_sglt2 * rng.uniform(0.72, 0.8))         # stable dose ≥ 12 weeks
        k_share_48 = rng.uniform(0.13, 0.19)
        k_share_50 = k_share_48 * rng.uniform(0.45, 0.55)
        elig_cur = int((hba1c - on_sglt2) * (1 - k_share_48))
        elig_amend = int((hba1c - on_sglt2 + stable) * (1 - k_share_48))
        elig_amend_k = int((hba1c - on_sglt2 + stable) * (1 - k_share_50))
        rows.append(dict(site_id=s["site_id"], radius_miles=30, t2d_ckd_patients=pool, meets_egfr=egfr, meets_uacr=uacr,
                         meets_hba1c=hba1c, on_sglt2i=on_sglt2, sglt2i_stable_12wk=stable,
                         pct_on_sglt2i=round(on_sglt2 / max(hba1c, 1), 3),
                         potassium_over_4_8_pct=round(k_share_48, 3), potassium_over_5_0_pct=round(k_share_50, 3),
                         eligible_current_protocol=elig_cur, eligible_amended_e4=elig_amend,
                         eligible_amended_e4_e7=elig_amend_k, data_as_of=AS_OF - timedelta(days=AS_OF.weekday() + 1),
                         source="Halcyra RWD network — de-identified EHR counts (synthetic)"))
        s["_elig_cur"], s["_elig_amend"] = elig_cur, elig_amend
    return rows


def build_population_trends():
    rows = []
    q0 = date(2023, 1, 1)
    quarters = []
    d = q0
    while d <= AS_OF:
        quarters.append(d)
        d = add_months(d, 3)
    n = len(quarters)
    for region, today_share in REGION_SGLT2.items():
        for i, q in enumerate(quarters):
            frac = i / max(n - 1, 1)
            share = 0.14 + (today_share - 0.14) * (1 - math.exp(-3.2 * frac)) / (1 - math.exp(-3.2))
            rows.append(dict(quarter_start=q, quarter=f"{q.year}-Q{(q.month - 1) // 3 + 1}", region=region,
                             t2d_ckd_patients=int(98000 * REGION_DKD[region] * (1 + 0.01 * i)),
                             pct_on_sglt2i=round(share + rng.uniform(-0.008, 0.008), 3),
                             pct_on_ns_mra=round(0.01 + 0.05 * frac, 3)))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Competing trials
# ─────────────────────────────────────────────────────────────────────────────

def build_competition(sites):
    comp = [
        dict(competing_trial_id="NCT-REDWOOD", acronym="REDWOOD-CKD", sponsor="Nephrexa Bio", phase="Phase III",
             indication="Diabetic kidney disease (T2D + CKD)", mechanism="Oral aldosterone synthase inhibitor",
             start_date=COMPETITOR_START, status="Recruiting", us_sites=48, target_enrollment=1500,
             overlap_note="Near-identical population (eGFR 25-75, UACR ≥ 200) and — unlike CASCADE-CKD — allows stable background SGLT2i."),
        dict(competing_trial_id="NCT-BRIDGEPORT", acronym="BRIDGEPORT-DKD", sponsor="Castellan Pharma", phase="Phase IIb",
             indication="Diabetic kidney disease", mechanism="Anti-fibrotic monoclonal antibody (IV)",
             start_date=add_months(CUR_MONTH, -20), status="Recruiting", us_sites=22, target_enrollment=240,
             overlap_note="Smaller Phase IIb; overlapping population but IV administration limits competition."),
        dict(competing_trial_id="NCT-KESTREL", acronym="KESTREL-HF", sponsor="Orbitra Therapeutics", phase="Phase III",
             indication="HFpEF", mechanism="Myosin modulator", start_date=add_months(CUR_MONTH, -15), status="Recruiting",
             us_sites=90, target_enrollment=2000, overlap_note="Competes with TIDEWATER-HF, not with CASCADE-CKD."),
    ]
    links = []
    cascade_active = [s for s in sites if s.get("_cascade") == "active" and s["city"] in COMPETITOR_METROS]
    # 13 of our active CASCADE sites in the Southeast / South Central also got REDWOOD-CKD
    heroes = [s for s in cascade_active if s["_role"] in ("zero_competitor", "competitor_drop")]
    others = [s for s in cascade_active if s["_role"] not in ("zero_competitor", "competitor_drop", "top_active")]
    rng.shuffle(others)
    redwood_ours = heroes + others[: 13 - len(heroes)]
    for s in redwood_ours:
        s["_redwood"] = True
        links.append(dict(competing_trial_id="NCT-REDWOOD", site_id=s["site_id"], site_activation_date=COMPETITOR_START + timedelta(days=rng.randint(0, 40))))
    # candidates in the same metros too
    cands = [s for s in sites if not s.get("_cascade") and s["city"] in COMPETITOR_METROS and s["therapeutic_focus"] in ("Nephrology", "Multi-specialty", "Endocrinology")]
    for s in cands[:18] + [x for x in sites if x["_role"] == "candidate_competitor"]:
        if s.get("_redwood"):
            continue
        s["_redwood"] = True
        links.append(dict(competing_trial_id="NCT-REDWOOD", site_id=s["site_id"], site_activation_date=COMPETITOR_START + timedelta(days=rng.randint(0, 90))))
    for s in rng.sample([x for x in sites if x["therapeutic_focus"] == "Nephrology"], 9):
        s["_bridgeport"] = True
        links.append(dict(competing_trial_id="NCT-BRIDGEPORT", site_id=s["site_id"], site_activation_date=add_months(CUR_MONTH, -20) + timedelta(days=rng.randint(0, 120))))
    for s in rng.sample([x for x in sites if x["therapeutic_focus"] in ("Cardiology", "Multi-specialty")], 20):
        links.append(dict(competing_trial_id="NCT-KESTREL", site_id=s["site_id"], site_activation_date=add_months(CUR_MONTH, -15) + timedelta(days=rng.randint(0, 150))))
    return comp, links


# ─────────────────────────────────────────────────────────────────────────────
# Screening log
# ─────────────────────────────────────────────────────────────────────────────
SGLT2 = [("empagliflozin", "Jardiance", "10 mg"), ("empagliflozin", "Jardiance", "25 mg"), ("dapagliflozin", "Farxiga", "10 mg"),
         ("canagliflozin", "Invokana", "100 mg")]
NOTE_TEMPLATES = {
    "E4": ["Pt on {brand} {dose} daily since {since} — PI declined to wash out (nephrologist wants her to stay on it).",
           "Conmed exclusion: {generic} {dose} started {since}. Patient unwilling to stop SGLT2i for 12 wk washout.",
           "Screen fail — currently taking {brand} ({generic}) {dose}, on it {months} months. Not eligible per protocol.",
           "Referring nephrologist will not discontinue {generic}; pt on stable dose since {since}.",
           "{brand} {dose} per PCP since {since}. Excluded for SGLT2 inhibitor use.",
           "Pt switched to {brand} at last nephrology visit ({since}). Excluded — SGLT2i within 12 weeks."],
    "I3": ["UACR {uacr} mg/g on central lab — below 300 threshold.", "Central lab UACR {uacr} mg/g, does not meet albuminuria criterion.",
           "Albuminuria too low (UACR {uacr}). Repeat not allowed per protocol."],
    "I2": ["eGFR {egfr} at screening — outside 25-<60 window.", "Screening eGFR {egfr} mL/min/1.73m2, not eligible."],
    "E7": ["K+ {k} mmol/L at screening visit (limit 4.8).", "Serum potassium {k} — hyperkalemia exclusion."],
    "I4": ["HbA1c {a1c}% — above 10.5% limit.", "A1c {a1c}, uncontrolled; PCP adjusting insulin."],
    "I5": ["Not on stable max-tolerated ARB — losartan dose changed 2 weeks ago.", "ACEi stopped for cough, not yet on ARB 4 weeks."],
    "E3": ["HF hospitalization 6 weeks ago.", "NSTEMI within 12 weeks."],
    "E5": ["On spironolactone 25 mg — MRA exclusion.", "Finerenone started by nephrology last month."],
    "E1": ["Biopsy history of IgA nephropathy.", "ADPKD on imaging — non-diabetic CKD."],
    "CONSENT": ["Withdrew consent before randomization — travel burden (monthly visits).", "Pt decided not to participate after run-in.",
                "Lost to follow-up after screening visit 1."],
}


def cascade_e4_hazard(month_idx: int, total: int, region: str) -> float:
    frac = month_idx / max(total - 1, 1)
    return 0.17 + 0.19 * frac + (0.02 if region in ("West", "Mountain West") else 0)


def make_note(reason: str, d: date) -> tuple[str, dict]:
    tpl = rng.choice(NOTE_TEMPLATES[reason])
    generic, brand, dose = rng.choice(SGLT2)
    months = rng.choices([1, 2, 5, 8, 11, 14, 20, 26], [0.12, 0.12, 0.14, 0.16, 0.14, 0.12, 0.1, 0.1])[0]
    since = d - timedelta(days=int(months * 30.4))
    extra = dict(months_on_sglt2i=months if reason == "E4" else None)
    txt = tpl.format(brand=brand, generic=generic, dose=dose, since=since.strftime("%b %Y"), months=months,
                     uacr=rng.randint(110, 290), egfr=rng.choice([19, 21, 23, 62, 64, 68, 71]), k=round(rng.uniform(4.9, 5.6), 1),
                     a1c=round(rng.uniform(10.7, 12.4), 1))
    return txt, extra


def build_screening(sites, trial_sites):
    log, truth = [], []
    seq = 0
    by_site = {s["site_id"]: s for s in sites}
    fpi = {t[0]: add_months(CUR_MONTH, -t[9]) for t in TRIALS}
    trial_meta = {t[0]: t for t in TRIALS}
    for ts in trial_sites:
        if ts["status"] != "active" or not ts["activation_date"]:
            continue
        s = by_site[ts["site_id"]]
        tid = ts["trial_id"]
        act = ts["activation_date"]
        if tid == "CASCADE-CKD":
            # screened per month ~ quality × catchment (current-protocol eligible pool) × coordinator capacity
            lam = 1.3 * s["_quality"] * math.sqrt(s["_elig_cur"] / 600) * (0.75 + 0.12 * s["coordinator_fte"])
            if s["_role"] == "top_active":
                lam = 5.4
            if s["_role"] == "competitor_drop":
                lam = 4.6
        else:
            meta = trial_meta[tid]
            lam = 1.3 * meta[13] / meta[14] * s["_quality"] * rng.uniform(0.8, 1.2)
        d = act
        total_months = trial_meta[tid][9]
        while d < AS_OF:
            m_idx = (d.year - fpi[tid].year) * 12 + d.month - fpi[tid].month
            rate = lam
            if tid == "CASCADE-CKD" and s.get("_redwood") and d >= COMPETITOR_START:
                rate *= 0.45
            ramp = min(1.0, 0.45 + (d - act).days / 120)
            n = poisson(rate * ramp * 3 / 30.4)  # Poisson per 3-day step
            for _ in range(n):
                seq += 1
                sd = d + timedelta(days=rng.randint(0, 2))
                if sd >= AS_OF:
                    continue
                age = int(min(85, max(18, rng.gauss(64, 9))))
                sex = rng.choices(["F", "M"], [0.44, 0.56])[0]
                race = rng.choices(["White", "Black or African American", "Hispanic or Latino", "Asian", "Other"],
                                   [0.52, 0.2, 0.18, 0.06, 0.04] if s["region"] in ("Southeast", "South Central") else [0.64, 0.12, 0.14, 0.07, 0.03])[0]
                row = dict(screening_id=f"SCR-{seq:06d}", trial_id=tid, site_id=s["site_id"], screen_date=sd, age=age, sex=sex,
                           race_ethnicity=race, outcome="randomized", randomization_date=None, coded_reason=None, coordinator_note=None)
                if s["_role"] == "zero" or s["_role"] == "zero_competitor":
                    # zero enrollers: a handful of screens, all fail
                    if rng.random() < 0.6:
                        seq -= 1
                        continue
                    fail_reason = pick_fail_reason_cascade(m_idx, total_months, s["region"], force=True) if tid == "CASCADE-CKD" else None
                elif tid == "CASCADE-CKD":
                    fail_reason = pick_fail_reason_cascade(m_idx, total_months, s["region"])
                else:
                    fail_reason = pick_fail_reason_other(tid)
                if fail_reason:
                    row["outcome"] = "withdrawn" if fail_reason == "CONSENT" else "screen_failed"
                    note, extra = make_note(fail_reason, sd) if tid == "CASCADE-CKD" else (other_note(tid, fail_reason), {})
                    row["coordinator_note"] = note
                    if tid == "CASCADE-CKD":
                        other_p = {"E4": 0.58, "CONSENT": 0.0}.get(fail_reason, 0.18)
                        row["coded_reason"] = "CONSENT_WITHDRAWN" if fail_reason == "CONSENT" else ("OTHER" if rng.random() < other_p else fail_reason)
                    else:
                        row["coded_reason"] = fail_reason
                    truth.append(dict(screening_id=row["screening_id"], true_criterion="CONSENT_WITHDRAWN" if fail_reason == "CONSENT" else fail_reason,
                                      months_on_sglt2i=extra.get("months_on_sglt2i"),
                                      sglt2i_stable_12wk=(extra.get("months_on_sglt2i") or 0) >= 3 if fail_reason == "E4" else None))
                else:
                    row["randomization_date"] = sd + timedelta(days=rng.randint(14, 28))
                    if row["randomization_date"] >= AS_OF:
                        row["outcome"] = "in_screening"
                        row["randomization_date"] = None
                log.append(row)
            d = d + timedelta(days=3)
    return log, truth


def poisson(lam: float) -> int:
    L = math.exp(-lam)
    k, p = 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def pick_fail_reason_cascade(m_idx, total, region, force=False):
    hz = dict(CASCADE_FAIL_HAZARD)
    hz["E4"] = cascade_e4_hazard(m_idx, total, region)
    p_pass = 1.0
    for v in hz.values():
        p_pass *= (1 - v)
    if not force and rng.random() < p_pass:
        return None
    keys = list(hz.keys())
    return rng.choices(keys, [hz[k] for k in keys])[0]


def pick_fail_reason_other(tid):
    crit = OTHER_CRITERIA[tid]
    p_pass = TRIALS[[t[0] for t in TRIALS].index(tid)][14]
    if rng.random() < p_pass:
        return None
    w = [1 - c[4] for c in crit] + [0.05]
    return rng.choices([c[0] for c in crit] + ["CONSENT"], w)[0]


def other_note(tid, code):
    if code == "CONSENT":
        return "Withdrew consent before randomization."
    c = next(x for x in OTHER_CRITERIA[tid] if x[0] == code)
    return f"Does not meet {code}: {c[2]}."


# ─────────────────────────────────────────────────────────────────────────────
# Enrollment plan + site history (ML training data)
# ─────────────────────────────────────────────────────────────────────────────

def build_plan():
    rows = []
    for t in TRIALS:
        tid, target, months = t[0], t[7], t[10]
        fpi = add_months(CUR_MONTH, -t[9])
        for i in range(months + 1):
            x = i / months
            # logistic-ish S curve (site ramp) normalised to hit target at the planned LPI
            cum = target * x ** 1.5
            rows.append(dict(trial_id=tid, month_start=add_months(fpi, i), month_number=i, planned_cum_randomized=int(round(cum))))
    return rows


def build_history(sites):
    rows = []
    tas = ["Nephrology", "Endocrinology", "Cardiology", "Hepatology", "Oncology"]
    k = 0
    for s in sites:
        n = rng.randint(3, 11) if s["site_type"] != "community" else rng.randint(2, 8)
        for _ in range(n):
            k += 1
            ta = rng.choices(tas, [0.3 if s["therapeutic_focus"] == "Nephrology" else 0.12, 0.2, 0.26, 0.1, 0.1])[0]
            phase = rng.choice(["Phase II", "Phase III", "Phase III", "Phase III"])
            year = rng.randint(AS_OF.year - 8, AS_OF.year - 1)
            density = max(0.2, s["_elig_cur"] / 600 * rng.uniform(0.7, 1.3)) if ta in ("Nephrology", "Endocrinology") else rng.uniform(0.4, 1.6)
            competing = rng.choices([0, 1, 2, 3], [0.45, 0.3, 0.17, 0.08])[0]
            act_days = activation_days(s, rng)
            sf = min(0.85, max(0.1, rng.gauss(0.42 if ta != "Oncology" else 0.6, 0.1)))
            rate = (0.55 * s["_quality"] * (density ** 0.55) * (0.8 + 0.1 * s["coordinator_fte"]) * (0.78 ** competing)
                    * (1.1 if s["irb_type"] == "central" else 0.92) * (0.85 if ta == "Oncology" else 1.0) * rng.lognormvariate(0, 0.22))
            months = rng.randint(8, 24)
            enrolled = max(0, int(round(rate * months + rng.gauss(0, 0.6))))
            if s["_role"] in ("zero", "zero_competitor") and rng.random() < 0.5:
                enrolled = rng.randint(0, 2)
            rows.append(dict(history_id=f"H-{k:05d}", site_id=s["site_id"], past_trial_code=f"{rng.choice(['NCT', 'HAL', 'EXT'])}-{rng.randint(10000, 99999)}",
                             sponsor_type="Halcyra" if (s["prior_halcyra_trials"] > 0 and rng.random() < 0.3) else "Other sponsor",
                             therapeutic_area=ta, phase=phase, start_year=year, months_enrolling=months,
                             patients_randomized=enrolled, enroll_rate_per_month=round(enrolled / months, 3),
                             screen_fail_rate=round(sf, 3), activation_days=act_days, competing_trials_nearby=competing,
                             eligible_density_index=round(density, 3), protocol_deviations_per_patient=round(max(0, rng.gauss(0.35 / s["_quality"], 0.12)), 2)))
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
        pks = [p.strip() for p in pk.split(",")]
        for p in pks:
            spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {p} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="healthcare_lifesciences")
    ap.add_argument("--schema", default="trial_site_selection")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Halcyra Therapeutics — clinical trial site selection & enrollment rescue demo (synthetic)'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.protocol_docs COMMENT 'CASCADE-CKD protocol, SAP excerpt, feasibility report and amendment SOP - documents searched by the Genie agent'")
    for t in ["competing_trial_sites", "competing_trials", "screening_truth", "screening_log", "site_activation", "trial_sites",
              "site_catchment", "site_trial_history", "enrollment_plan", "protocol_criteria", "population_trends", "sites", "trials"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    print(f"AS_OF={AS_OF} competitor_start={COMPETITOR_START}")
    sites = build_sites()
    assign_cascade(sites)
    catchment = build_catchment(sites)
    trial_sites, activation = build_trial_sites_and_activation(sites)
    comp, comp_links = build_competition(sites)
    log, truth = build_screening(sites, trial_sites)
    plan = build_plan()
    history = build_history(sites)
    trends = build_population_trends()
    print(f"generated: {len(sites)} sites, {len(trial_sites)} trial-sites, {len(log)} screenings, {len(history)} history rows")

    trial_rows = [dict(trial_id=t[0], protocol_number=t[1], acronym=t[2], title=t[3], phase=t[4], therapeutic_area=t[5],
                       indication=t[6], target_enrollment=t[7], planned_sites=t[8], fpi_date=add_months(CUR_MONTH, -t[9]),
                       planned_lpi_date=add_months(add_months(CUR_MONTH, -t[9]), t[10]), planned_enrollment_months=t[10],
                       protocol_version=t[11], study_manager=t[12], status="Enrolling",
                       planned_screen_fail_rate={"CASCADE-CKD": 0.35}.get(t[0], round(1 - (t[14] or 0.6) + 0.03, 2)))
                  for t in TRIALS]
    write(spark, fqs, "trials", trial_rows, T.StructType([
        S("trial_id", T.StringType()), S("protocol_number", T.StringType()), S("acronym", T.StringType()), S("title", T.StringType()),
        S("phase", T.StringType()), S("therapeutic_area", T.StringType()), S("indication", T.StringType()),
        S("target_enrollment", T.IntegerType()), S("planned_sites", T.IntegerType()), S("fpi_date", T.DateType()),
        S("planned_lpi_date", T.DateType()), S("planned_enrollment_months", T.IntegerType()), S("protocol_version", T.StringType()),
        S("study_manager", T.StringType()), S("status", T.StringType()), S("planned_screen_fail_rate", T.DoubleType())]),
        "Halcyra Therapeutics active interventional trials. target_enrollment = randomized patients; fpi = first patient in; lpi = last patient in (planned).",
        pk="trial_id")

    crit_rows = [dict(trial_id="CASCADE-CKD", criterion_id=c[0], criterion_type=c[1], short_name=c[2], criterion_text=c[3],
                      feasibility_assumed_pass_rate=c[4], amendable=c[5], rationale=c[6]) for c in CASCADE_CRITERIA]
    for tid, cl in OTHER_CRITERIA.items():
        crit_rows += [dict(trial_id=tid, criterion_id=c[0], criterion_type=c[1], short_name=c[2], criterion_text=c[3],
                           feasibility_assumed_pass_rate=c[4], amendable=c[5], rationale=None) for c in cl]
    for tid in [t[0] for t in TRIALS]:
        crit_rows.append(dict(trial_id=tid, criterion_id="CONSENT_WITHDRAWN", criterion_type="other", short_name="Consent withdrawn / lost",
                              criterion_text="Patient withdrew consent or was lost before randomization (not a protocol criterion).",
                              feasibility_assumed_pass_rate=None, amendable=False, rationale=None))
    write(spark, fqs, "protocol_criteria", crit_rows, T.StructType([
        S("trial_id", T.StringType()), S("criterion_id", T.StringType()), S("criterion_type", T.StringType()),
        S("short_name", T.StringType()), S("criterion_text", T.StringType()), S("feasibility_assumed_pass_rate", T.DoubleType()),
        S("amendable", T.BooleanType()), S("rationale", T.StringType())]),
        "Inclusion (I*) and exclusion (E*) criteria per trial, with the pass rate the feasibility study assumed and whether the criterion is a candidate for amendment.",
        pk="trial_id, criterion_id")

    site_cols = ["site_id", "site_name", "principal_investigator", "city", "state", "region", "latitude", "longitude",
                 "site_type", "irb_type", "coordinator_fte", "therapeutic_focus", "prior_halcyra_trials"]
    write(spark, fqs, "sites", [{k: s[k] for k in site_cols} for s in sites], T.StructType([
        S("site_id", T.StringType()), S("site_name", T.StringType()), S("principal_investigator", T.StringType()),
        S("city", T.StringType()), S("state", T.StringType()), S("region", T.StringType()), S("latitude", T.DoubleType()),
        S("longitude", T.DoubleType()), S("site_type", T.StringType()), S("irb_type", T.StringType()),
        S("coordinator_fte", T.DoubleType()), S("therapeutic_focus", T.StringType()), S("prior_halcyra_trials", T.IntegerType())]),
        "US investigator sites in Halcyra's feasibility network (fictional). irb_type central = uses the central IRB (faster start-up).",
        pk="site_id")
    write(spark, fqs, "trial_sites", trial_sites, T.StructType([
        S("trial_id", T.StringType()), S("site_id", T.StringType()), S("status", T.StringType()), S("activation_date", T.DateType()),
        S("target_randomized", T.IntegerType())]),
        "Sites selected for each trial. status: active (enrolling) | activating (start-up in progress) | not_activated (selected but stalled). Sites of the network not listed for CASCADE-CKD are rescue candidates.",
        pk="trial_id, site_id")
    write(spark, fqs, "site_activation", activation, T.StructType([
        S("trial_id", T.StringType()), S("site_id", T.StringType()), S("selected_date", T.DateType()), S("cda_signed_date", T.DateType()),
        S("feasibility_complete_date", T.DateType()), S("contract_executed_date", T.DateType()), S("irb_approval_date", T.DateType()),
        S("siv_date", T.DateType()), S("activation_date", T.DateType()), S("cycle_time_days", T.IntegerType()),
        S("days_in_startup", T.IntegerType())]),
        "Site start-up milestones per trial site. cycle_time_days = site selected → site activated (null while still in start-up).",
        pk="trial_id, site_id")
    write(spark, fqs, "enrollment_plan", plan, T.StructType([
        S("trial_id", T.StringType()), S("month_start", T.DateType()), S("month_number", T.IntegerType()),
        S("planned_cum_randomized", T.IntegerType())]),
        "Planned cumulative randomized patients per trial by month since FPI (the protocol enrollment curve).",
        pk="trial_id, month_start")
    write(spark, fqs, "screening_log", log, T.StructType([
        S("screening_id", T.StringType()), S("trial_id", T.StringType()), S("site_id", T.StringType()), S("screen_date", T.DateType()),
        S("age", T.IntegerType()), S("sex", T.StringType()), S("race_ethnicity", T.StringType()), S("outcome", T.StringType()),
        S("randomization_date", T.DateType()), S("coded_reason", T.StringType()), S("coordinator_note", T.StringType())]),
        "One row per patient screened. outcome: randomized | screen_failed | withdrawn | in_screening. coded_reason = criterion id the site coded in the EDC "
        "(OTHER = not coded to a criterion — read coordinator_note). race_ethnicity is for diversity-plan monitoring only.",
        pk="screening_id")
    write(spark, fqs, "screening_truth", truth, T.StructType([
        S("screening_id", T.StringType()), S("true_criterion", T.StringType()), S("months_on_sglt2i", T.IntegerType()),
        S("sglt2i_stable_12wk", T.BooleanType())]),
        "Generator ground truth of every screen failure's real criterion — for evaluating AI Functions only, never used by the app or agent.",
        pk="screening_id")
    write(spark, fqs, "site_catchment", catchment, T.StructType([
        S("site_id", T.StringType()), S("radius_miles", T.IntegerType()), S("t2d_ckd_patients", T.IntegerType()),
        S("meets_egfr", T.IntegerType()), S("meets_uacr", T.IntegerType()), S("meets_hba1c", T.IntegerType()),
        S("on_sglt2i", T.IntegerType()), S("sglt2i_stable_12wk", T.IntegerType()), S("pct_on_sglt2i", T.DoubleType()),
        S("potassium_over_4_8_pct", T.DoubleType()), S("potassium_over_5_0_pct", T.DoubleType()),
        S("eligible_current_protocol", T.IntegerType()), S("eligible_amended_e4", T.IntegerType()),
        S("eligible_amended_e4_e7", T.IntegerType()), S("data_as_of", T.DateType()), S("source", T.StringType())]),
        "De-identified EHR-network patient counts within 30 miles of each site, criterion by criterion (CASCADE-CKD funnel): T2D+CKD → eGFR 25-<60 → UACR 300-5000 → HbA1c ≤10.5 → minus SGLT2i users (E4) → minus K+ > 4.8 (E7). "
        "eligible_amended_e4 = if stable (≥12 wk) SGLT2i users were allowed; eligible_amended_e4_e7 = also K+ limit 5.0.",
        pk="site_id")
    write(spark, fqs, "population_trends", trends, T.StructType([
        S("quarter_start", T.DateType()), S("quarter", T.StringType()), S("region", T.StringType()), S("t2d_ckd_patients", T.IntegerType()),
        S("pct_on_sglt2i", T.DoubleType()), S("pct_on_ns_mra", T.DoubleType())]),
        "Quarterly share of the T2D+CKD population on an SGLT2 inhibitor (and non-steroidal MRA) by US region — de-identified EHR network (synthetic).",
        pk="quarter_start, region")
    write(spark, fqs, "competing_trials", comp, T.StructType([
        S("competing_trial_id", T.StringType()), S("acronym", T.StringType()), S("sponsor", T.StringType()), S("phase", T.StringType()),
        S("indication", T.StringType()), S("mechanism", T.StringType()), S("start_date", T.DateType()), S("status", T.StringType()),
        S("us_sites", T.IntegerType()), S("target_enrollment", T.IntegerType()), S("overlap_note", T.StringType())]),
        "Other sponsors' trials recruiting overlapping populations (fictional, from public registry monitoring).",
        pk="competing_trial_id")
    write(spark, fqs, "competing_trial_sites", comp_links, T.StructType([
        S("competing_trial_id", T.StringType()), S("site_id", T.StringType()), S("site_activation_date", T.DateType())]),
        "Which network sites also run a competing trial, and since when.", pk="competing_trial_id, site_id")
    write(spark, fqs, "site_trial_history", history, T.StructType([
        S("history_id", T.StringType()), S("site_id", T.StringType()), S("past_trial_code", T.StringType()), S("sponsor_type", T.StringType()),
        S("therapeutic_area", T.StringType()), S("phase", T.StringType()), S("start_year", T.IntegerType()),
        S("months_enrolling", T.IntegerType()), S("patients_randomized", T.IntegerType()), S("enroll_rate_per_month", T.DoubleType()),
        S("screen_fail_rate", T.DoubleType()), S("activation_days", T.IntegerType()), S("competing_trials_nearby", T.IntegerType()),
        S("eligible_density_index", T.DoubleType()), S("protocol_deviations_per_patient", T.DoubleType())]),
        "Each site's past trials (any sponsor, from the feasibility database): enrollment rate, screen-fail rate, start-up days, competition — training data for the site enrollment model.",
        pk="history_id")

    for stmt in [
        f"ALTER TABLE {fqs}.trial_sites ADD CONSTRAINT trial_sites_trial_fk FOREIGN KEY (trial_id) REFERENCES {fqs}.trials RELY",
        f"ALTER TABLE {fqs}.trial_sites ADD CONSTRAINT trial_sites_site_fk FOREIGN KEY (site_id) REFERENCES {fqs}.sites RELY",
        f"ALTER TABLE {fqs}.screening_log ADD CONSTRAINT screening_trial_fk FOREIGN KEY (trial_id) REFERENCES {fqs}.trials RELY",
        f"ALTER TABLE {fqs}.screening_log ADD CONSTRAINT screening_site_fk FOREIGN KEY (site_id) REFERENCES {fqs}.sites RELY",
        f"ALTER TABLE {fqs}.site_catchment ADD CONSTRAINT catchment_site_fk FOREIGN KEY (site_id) REFERENCES {fqs}.sites RELY",
        f"ALTER TABLE {fqs}.site_trial_history ADD CONSTRAINT history_site_fk FOREIGN KEY (site_id) REFERENCES {fqs}.sites RELY",
        f"ALTER TABLE {fqs}.competing_trial_sites ADD CONSTRAINT cts_trial_fk FOREIGN KEY (competing_trial_id) REFERENCES {fqs}.competing_trials RELY",
        f"ALTER TABLE {fqs}.competing_trial_sites ADD CONSTRAINT cts_site_fk FOREIGN KEY (site_id) REFERENCES {fqs}.sites RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
