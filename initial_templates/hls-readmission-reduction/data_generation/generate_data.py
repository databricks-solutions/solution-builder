"""
Larkspur Health — hospital care transitions & readmission reduction: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog healthcare_lifesciences --schema readmission_reduction
    python generate_data.py --stats-only        # no Spark: print the planted-signal numbers

Tables written (Delta, PK/FK RELY constraints + comments):
  hospitals             Larkspur Health's 3 acute-care hospitals (+ Medicare IPPS base-operating DRG payments for HRRP)
  units                 inpatient discharge units (4 West Cardiac Step-Down, 3 North Pulmonary, …)
  unit_events           staffing / clinic-schedule changes per unit (the context behind the signal)
  patients              patients (synthetic names for the coordinator worklist)
  discharges            one row per index discharge over ~2 years + the planned discharges of the next days
  readmissions          unplanned 30-day readmissions (any Larkspur hospital) linked to their index discharge
  discharge_notes       discharge summaries (free text) for the last ~120 days + planned discharges
  hrrp_benchmarks       national 30-day readmission rate per HRRP condition (the ERR denominator of this demo)
  note_truth            generator ground truth of what each note says (eval of the AI Functions only — never shown)

THE PLANTED SIGNAL — heart-failure readmissions at Larkspur Regional's 4 West jumped in the last 6 months:
  * 26 weeks ago 4 West lost its weekend discharge navigator and the HF Transitions Clinic dropped its Saturday
    session (unit_events). Since then, HF patients discharged on a FRIDAY or SATURDAY leave with no 7-day follow-up
    appointment ~80% of the time (vs ~25% before and on weekdays) — the notes say "patient to call the clinic Monday".
  * HF patients with no 7-day follow-up readmit at ~2x the rate of those with one. 4 West's HF 30-day readmission
    rate climbs while the rest of the system is flat.
  * Larkspur Regional's estimated HF excess readmission ratio climbs above 1.1 → the biggest line of its CMS HRRP
    penalty exposure.
  * Transportation barriers ("does not drive", "no ride") only live in the free-text notes — AI Functions surface them.

Dates are anchored on the Monday of the current week, so the weekday mix (and every number) is identical on any run day.
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, timedelta

SEED = 20261131
rng = random.Random(SEED)

AS_OF = date.today()
MONDAY = AS_OF - timedelta(days=AS_OF.weekday())          # Monday of the current week
N_WEEKS = 105                                              # 104 past weeks + the current one (+ next week's planned)
SIGNAL_WEEKS = 26                                          # the navigator left 26 weeks ago
SIGNAL_START = MONDAY - timedelta(weeks=SIGNAL_WEEKS)
NOTES_DAYS = 120
PLANNED_DAYS = 3

HOSPITALS = [
    # id, name, city, ccn, beds, medicare_base_drg_payments (FY), dual_proportion
    ("LRMC", "Larkspur Regional Medical Center", "Larkspur", "99-0147", 412, 214_000_000, 0.19),
    ("MCH", "Millbrook Community Hospital", "Millbrook", "99-0233", 186, 71_000_000, 0.24),
    ("CRH", "Castle Ridge Hospital", "Castle Ridge", "99-0318", 142, 46_000_000, 0.14),
]

UNITS = [
    # unit_id, hospital, name, service_line, weekly discharges, condition mix
    ("LRMC-4W", "LRMC", "4 West — Cardiac Step-Down", "Cardiology", 27, {"HF": 0.56, "AMI": 0.20, "OTHER": 0.24}),
    ("LRMC-7C", "LRMC", "7 Central — Cardiovascular Surgery", "Cardiac Surgery", 12, {"CABG": 0.46, "AMI": 0.30, "OTHER": 0.24}),
    ("LRMC-5E", "LRMC", "5 East — General Medicine", "Hospital Medicine", 34, {"PN": 0.24, "HF": 0.12, "COPD": 0.12, "OTHER": 0.52}),
    ("LRMC-3N", "LRMC", "3 North — Pulmonary", "Pulmonology", 20, {"COPD": 0.46, "PN": 0.34, "OTHER": 0.20}),
    ("LRMC-6S", "LRMC", "6 South — Orthopedics", "Orthopedics", 22, {"THA_TKA": 0.66, "OTHER": 0.34}),
    ("MCH-2W", "MCH", "2 West — Telemetry", "Cardiology", 20, {"HF": 0.36, "AMI": 0.14, "PN": 0.15, "COPD": 0.10, "OTHER": 0.25}),
    ("MCH-3E", "MCH", "3 East — Medical / Surgical", "Hospital Medicine", 20, {"THA_TKA": 0.30, "PN": 0.20, "COPD": 0.15, "OTHER": 0.35}),
    ("CRH-1M", "CRH", "1 Main — Medical", "Hospital Medicine", 18, {"HF": 0.21, "PN": 0.25, "COPD": 0.20, "OTHER": 0.34}),
    ("CRH-2S", "CRH", "2 South — Surgical", "Orthopedics", 10, {"THA_TKA": 0.52, "OTHER": 0.48}),
]
SIGNAL_UNIT = "LRMC-4W"

CONDITIONS = {
    # code: (label, base readmit prob, mean LOS, age mean, DRG base payment, dx list)
    "HF": ("Heart failure", 0.185, 5.0, 77, 9_800, [("I50.23", "Acute on chronic systolic heart failure"), ("I50.33", "Acute on chronic diastolic heart failure"), ("I11.0", "Hypertensive heart disease with heart failure")]),
    "AMI": ("Acute myocardial infarction", 0.135, 3.8, 70, 13_200, [("I21.4", "NSTEMI"), ("I21.09", "STEMI of anterior wall")]),
    "PN": ("Pneumonia", 0.145, 4.4, 73, 8_600, [("J18.9", "Pneumonia, unspecified organism"), ("J15.9", "Bacterial pneumonia")]),
    "COPD": ("COPD", 0.170, 4.0, 71, 7_400, [("J44.1", "COPD with acute exacerbation"), ("J44.0", "COPD with acute lower respiratory infection")]),
    "CABG": ("Coronary artery bypass graft", 0.110, 7.2, 67, 38_500, [("Z95.1", "Coronary artery bypass graft (index admission)")]),
    "THA_TKA": ("Elective hip / knee replacement", 0.042, 2.1, 68, 14_800, [("Z96.651", "Total knee arthroplasty"), ("Z96.641", "Total hip arthroplasty")]),
    "OTHER": ("Other (not an HRRP condition)", 0.115, 4.1, 63, 9_000, [("N39.0", "Urinary tract infection"), ("A41.9", "Sepsis, unspecified"), ("K57.32", "Diverticulitis"), ("E11.65", "Type 2 diabetes with hyperglycemia"), ("I48.91", "Atrial fibrillation")]),
}
NATIONAL_RATE = {"HF": 0.199, "AMI": 0.138, "PN": 0.160, "COPD": 0.190, "CABG": 0.117, "THA_TKA": 0.045}

DOW_WEIGHTS = [0.155, 0.150, 0.150, 0.155, 0.205, 0.110, 0.075]   # Mon … Sun (Friday discharge peak)
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

FIRST = ["James", "Mary", "Robert", "Patricia", "John", "Linda", "Michael", "Barbara", "William", "Elizabeth", "David", "Susan",
         "Richard", "Jessica", "Joseph", "Karen", "Thomas", "Nancy", "Charles", "Lisa", "Daniel", "Betty", "Paul", "Sandra",
         "Mark", "Margaret", "Donald", "Ruth", "George", "Carol", "Kenneth", "Sharon", "Steven", "Donna", "Edward", "Janet",
         "Ronald", "Gloria", "Anthony", "Joyce", "Frank", "Evelyn", "Raymond", "Frances", "Gerald", "Samuel", "Irene",
         "Walter", "Doris", "Arthur", "Beverly", "Henry", "Marilyn", "Eugene", "Lorraine"]
FIRST_ES = ["Ana", "Luis", "Rosa", "Maria", "Jose", "Carmen", "Jorge"]
FIRST_VI = ["Minh", "Lan", "Hoa", "Duc"]
LAST = ["Anderson", "Baker", "Carter", "Dawson", "Ellis", "Foster", "Hughes", "Iverson", "Jensen", "Keller", "Morales",
        "Olsen", "Porter", "Quinn", "Sullivan", "Underwood", "Walsh", "Young", "Zimmerman", "Bishop", "Coleman", "Fleming",
        "Gallagher", "Hartman", "Lindqvist", "Mercer", "Novak", "Pruitt", "Ramsey", "Schaefer", "Thornton", "Webb", "Holloway", "McBride"]
LAST_ES = ["Reyes", "Garcia", "Lopez", "Vasquez", "Delgado", "Ortega", "Castillo"]
LAST_VI = ["Nguyen", "Tran", "Pham"]
ZIPS = {"LRMC": ["97401", "97402", "97403", "97404", "97405", "97408"], "MCH": ["97420", "97423", "97424"], "CRH": ["97440", "97441", "97444"]}

ATTENDINGS = {
    "Cardiology": ["Dr. Priya Raman", "Dr. Owen Castellanos", "Dr. Hannah Lui"],
    "Cardiac Surgery": ["Dr. Marcus Feld", "Dr. Ingrid Solberg"],
    "Hospital Medicine": ["Dr. Kofi Mensah", "Dr. Rachel Ostrowski", "Dr. Tomas Varga", "Dr. Leah Goldfarb"],
    "Pulmonology": ["Dr. Samir Haddad", "Dr. Colleen Brandt"],
    "Orthopedics": ["Dr. Grant Whitaker", "Dr. Yuki Tanabe"],
}
FOLLOWUP_CLINIC = {
    "HF": "HF Transitions Clinic", "AMI": "Cardiology Clinic", "CABG": "Cardiothoracic Surgery Clinic",
    "PN": "Primary care", "COPD": "Pulmonary Clinic", "THA_TKA": "Orthopedic Clinic", "OTHER": "Primary care",
}


def logit(p): return math.log(p / (1 - p))
def sigmoid(x): return 1 / (1 + math.exp(-x))


def pick(weights: dict):
    r, acc = rng.random(), 0.0
    for k, w in weights.items():
        acc += w
        if r <= acc:
            return k
    return list(weights)[-1]


def poisson(lam):
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


# ── patients ────────────────────────────────────────────────────────────────
def new_patient(pid: str, hospital: str, cond: str) -> dict:
    age = int(max(19, min(97, rng.gauss(CONDITIONS[cond][3], 10))))
    sex = "F" if rng.random() < (0.47 if cond in ("HF", "AMI", "CABG") else 0.54) else "M"
    if age >= 65:
        payer = pick({"Medicare FFS": 0.60, "Medicare Advantage": 0.32, "Commercial": 0.08})
        dual = payer.startswith("Medicare") and rng.random() < 0.17
    else:
        payer = pick({"Commercial": 0.55, "Medicaid": 0.33, "Medicare FFS": 0.12})
        dual = payer == "Medicare FFS" and rng.random() < 0.4
    lang = pick({"English": 0.86, "Spanish": 0.10, "Vietnamese": 0.02, "Russian": 0.02})
    lives_alone = rng.random() < (0.36 if age >= 75 else 0.24)
    transport = rng.random() < (0.22 if age >= 75 or lives_alone else 0.11)       # hidden: only the notes mention it
    afford = rng.random() < (0.16 if dual or payer == "Medicaid" else 0.06)        # hidden: only the notes mention it
    first = rng.choice(FIRST_ES if lang == "Spanish" else FIRST_VI if lang == "Vietnamese" else FIRST)
    last = rng.choice(LAST_ES if lang == "Spanish" else LAST_VI if lang == "Vietnamese" else LAST)
    return dict(patient_id=pid, first_name=first, last_name=last, age=age, sex=sex, zip=rng.choice(ZIPS[hospital]), payer=payer,
                dual_eligible=bool(dual), primary_language=lang, lives_alone=bool(lives_alone), has_pcp=rng.random() < 0.82,
                home_hospital=hospital, _transport=transport, _afford=afford)


def build():
    patients: dict[str, dict] = {}
    pools: dict[tuple, list] = {}
    discharges, readmissions, truth = [], [], []
    enc_n = 0
    for w in range(N_WEEKS + 1):
        week_monday = MONDAY - timedelta(weeks=N_WEEKS - 1 - w)
        for unit_id, hosp, _uname, service, weekly, mix in UNITS:
            n = max(0, int(round(rng.gauss(weekly, weekly ** 0.5))))
            for _ in range(n):
                dow = pick({i: x for i, x in enumerate(DOW_WEIGHTS)})
                cond = pick(mix)
                ddate = week_monday + timedelta(days=dow)
                if ddate > AS_OF + timedelta(days=PLANNED_DAYS):
                    continue
                enc_n += 1
                pool = pools.setdefault((hosp, cond if cond in ("HF", "COPD") else "X"), [])
                if pool and rng.random() < (0.22 if cond in ("HF", "COPD") else 0.08):
                    p = rng.choice(pool)                                          # a returning patient
                else:
                    p = new_patient(f"MRN{100000 + len(patients) + 1}", hosp, cond)
                    patients[p["patient_id"]] = p
                    pool.append(p)
                discharges.append(make_discharge(f"E{2000000 + enc_n}", p, unit_id, hosp, service, cond, ddate))
    featured(discharges, patients)
    discharges.sort(key=lambda d: (d["discharge_date"], d["encounter_id"]))
    for d in discharges:
        d["_kept"] = (rng.random() < (0.55 if patients[d["patient_id"]]["_transport"] else 0.88)) if d["followup_7d_scheduled"] else None
    calibrate(discharges, patients)
    for d in discharges:
        simulate_outcome(d, patients[d["patient_id"]], readmissions)
    notes = []
    for d in discharges:
        if d["discharge_date"] >= AS_OF - timedelta(days=NOTES_DAYS):
            text, t = make_note(d, patients[d["patient_id"]])
            notes.append(dict(encounter_id=d["encounter_id"], note_type="Discharge summary" if d["status"] == "discharged" else "Discharge planning note",
                              author=d["attending"], note_date=min(d["discharge_date"], AS_OF), note_text=text))
            truth.append(dict(encounter_id=d["encounter_id"], **t))
    return patients, discharges, readmissions, notes, truth


def make_discharge(eid, p, unit_id, hosp, service, cond, ddate) -> dict:
    label, _base, los_mean, _age, drg_pay, dxs = CONDITIONS[cond]
    los = max(1, int(round(rng.lognormvariate(math.log(los_mean), 0.45))))
    emergent = rng.random() < (0.10 if cond == "THA_TKA" else 0.55 if cond == "CABG" else 0.86)
    charlson = max(0, int(round(rng.gauss({"HF": 4.6, "COPD": 3.6, "AMI": 3.2, "CABG": 3.0, "PN": 3.1, "THA_TKA": 1.4}.get(cond, 2.6), 1.6))))
    ed6 = poisson(1.1 if cond in ("HF", "COPD") else 0.6)
    prior12 = poisson(0.85 if cond in ("HF", "COPD") else 0.4)
    meds = max(2, int(round(rng.gauss({"HF": 12, "COPD": 10, "AMI": 10, "CABG": 11}.get(cond, 7), 3))))
    disp = pick({"Home": 0.58, "Home with home health": 0.24, "Skilled nursing facility": 0.15, "Inpatient rehab": 0.03}
                if cond not in ("THA_TKA", "CABG") else {"Home": 0.42, "Home with home health": 0.40, "Skilled nursing facility": 0.10, "Inpatient rehab": 0.08})
    dow = ddate.weekday()
    fri_sat, weekend = dow in (4, 5), dow in (5, 6)
    hrrp = cond != "OTHER"
    p_fu = (0.76 if hrrp else 0.58) - (0.06 if fri_sat else 0) - (0.08 if weekend else 0)
    if unit_id == SIGNAL_UNIT and cond == "HF" and ddate >= SIGNAL_START:
        p_fu = 0.12 if dow in (4, 5, 6) else 0.68                       # ← no weekend navigator, no Saturday HF clinic
    if disp in ("Skilled nursing facility", "Inpatient rehab"):
        p_fu = max(p_fu, 0.80)                                  # the facility physician sees them
    fu = rng.random() < p_fu
    fu_date = ddate + timedelta(days=rng.choice([3, 4, 5, 5, 6, 7])) if fu else None
    code, desc = rng.choice(dxs)
    return dict(encounter_id=eid, patient_id=p["patient_id"], hospital_id=hosp, unit_id=unit_id, admit_date=ddate - timedelta(days=los),
                discharge_date=ddate, discharge_dow=DOW[dow], los_days=los, admit_type="Emergency" if emergent else "Elective",
                hrrp_condition=cond, condition_label=label, principal_dx_code=code, principal_dx=desc, charlson_index=charlson,
                ed_visits_6m=ed6, prior_admits_12m=prior12, discharge_med_count=meds, discharge_disposition=disp,
                followup_7d_scheduled=bool(fu), followup_date=fu_date, followup_clinic=FOLLOWUP_CLINIC[cond] if fu else None,
                followup_completed=None, attending=rng.choice(ATTENDINGS[service]), status="planned" if ddate > AS_OF else "discharged",
                age_at_discharge=p["age"], payer=p["payer"], medicare_ffs_65=p["payer"] == "Medicare FFS" and p["age"] >= 65,
                drg_payment=int(drg_pay * rng.uniform(0.85, 1.2)), readmitted_30d=None, _hf_med_change=cond == "HF" and rng.random() < 0.55)


TARGET_RATE = {"HF": 0.196, "AMI": 0.127, "PN": 0.147, "COPD": 0.175, "CABG": 0.107, "THA_TKA": 0.035, "OTHER": 0.128}
HOSPITAL_EFFECT = {"LRMC": 0.0, "MCH": 0.06, "CRH": -0.05}
UNIT_EFFECT = {"LRMC-6S": -0.10, "CRH-2S": -0.35, "MCH-3E": -0.15}
OFFSETS: dict = {}


def risk_logit(d, p) -> float:
    """Deterministic part of the readmission log-odds (before the per-condition calibration offset)."""
    cond = d["hrrp_condition"]
    x = HOSPITAL_EFFECT[d["hospital_id"]]
    x += 0.40 if d["charlson_index"] >= 5 else 0.18 if d["charlson_index"] >= 3 else 0
    x += 0.32 if d["ed_visits_6m"] >= 2 else 0
    x += 0.30 if d["prior_admits_12m"] >= 1 else 0
    x += 0.22 if d["prior_admits_12m"] >= 2 else 0
    x += 0.20 if d["los_days"] >= 7 else 0
    x += 0.24 if p["lives_alone"] else 0
    x += 0.18 if p["dual_eligible"] else 0
    x += 0.15 if not p["has_pcp"] else 0
    x += 0.25 if p["age"] >= 80 else 0
    x += 0.15 if d["discharge_disposition"] == "Skilled nursing facility" else -0.10 if d["discharge_disposition"] == "Home with home health" else 0
    x += 0.60 if p["_transport"] else 0
    x += 0.18 if d["_hf_med_change"] else 0
    if d["followup_7d_scheduled"]:
        if d["_kept"] is False:
            x += 0.40
    else:
        x += 0.95 if cond == "HF" else 0.55
    x += UNIT_EFFECT.get(d["unit_id"], 0.0)
    if d["unit_id"] == SIGNAL_UNIT and cond == "HF" and d["discharge_dow"] in ("Fri", "Sat", "Sun") and d["discharge_date"] >= SIGNAL_START:
        x += 0.60                                              # no navigator: no teach-back / med reconciliation call either
    return x


def calibrate(discharges, patients):
    """Per-condition offset so the PRE-signal system rate matches TARGET_RATE (the signal then moves 4 West only)."""
    for cond, target in TARGET_RATE.items():
        xs = [risk_logit(d, patients[d["patient_id"]]) for d in discharges
              if d["hrrp_condition"] == cond and d["status"] == "discharged" and d["discharge_date"] < SIGNAL_START
              and (d["medicare_ffs_65"] or cond == "OTHER")]
        lo, hi = -8.0, 4.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if sum(sigmoid(x + mid) for x in xs) / len(xs) > target:
                hi = mid
            else:
                lo = mid
        OFFSETS[cond] = (lo + hi) / 2


def simulate_outcome(d, p, readmissions):
    if d["status"] == "planned":
        return
    cond = d["hrrp_condition"]
    if d["followup_7d_scheduled"]:
        d["followup_completed"] = None if d["followup_date"] > AS_OF else d["_kept"]
    x = risk_logit(d, p) + OFFSETS[cond]
    closed = d["discharge_date"] <= AS_OF - timedelta(days=30)
    if rng.random() >= sigmoid(x):
        d["readmitted_30d"] = False if closed else None
        return
    early = not d["followup_7d_scheduled"]
    days = int(min(30, max(1, rng.gammavariate(1.6 if early else 2.2, 3.6 if early else 5.0))))
    rdate = d["discharge_date"] + timedelta(days=days)
    if rdate > AS_OF:
        d["readmitted_30d"] = None                             # 30-day window still open, not readmitted (yet)
        return
    d["readmitted_30d"] = True                                 # rates must only use closed windows (discharge ≤ as_of − 30 d)
    reasons = {"HF": ["Heart failure exacerbation — volume overload", "Acute kidney injury after diuretic increase", "Hypotension / dizziness after medication change", "Heart failure exacerbation — missed diuretic doses"],
               "COPD": ["COPD exacerbation", "Hypoxia — home oxygen not set up", "Pneumonia"],
               "PN": ["Recurrent pneumonia", "Sepsis", "Dehydration"],
               "AMI": ["Chest pain — rule out ACS", "Bleeding on dual antiplatelet therapy", "Heart failure"],
               "CABG": ["Sternal wound infection", "Atrial fibrillation", "Pleural effusion"],
               "THA_TKA": ["Surgical site infection", "Deep vein thrombosis", "Fall"],
               "OTHER": ["Sepsis", "Recurrent infection", "Hyperglycemia", "Fall"]}[cond]
    readmissions.append(dict(readmission_id=f"R{d['encounter_id'][1:]}", index_encounter_id=d["encounter_id"], patient_id=d["patient_id"],
                             readmit_date=rdate, days_to_readmit=days,
                             readmit_hospital_id=d["hospital_id"] if rng.random() < 0.86 else rng.choice([h[0] for h in HOSPITALS]),
                             via_ed=rng.random() < 0.91, planned=False, readmit_reason=rng.choice(reasons),
                             readmit_los_days=max(1, int(round(rng.lognormvariate(math.log(4.6), 0.4)))),
                             readmit_cost_usd=int(rng.lognormvariate(math.log(15800), 0.35))))


def featured(discharges, patients):
    """Hand-authored worklist patients the demo script walks through."""
    fri = AS_OF + timedelta(days=(4 - AS_OF.weekday()) % 7)          # the coming Friday (today if Friday)
    last_fri = fri - timedelta(days=7)
    specs = [
        dict(first_name="Harold", last_name="Brennan", age=78, sex="M", payer="Medicare FFS", dual=False, lives_alone=True, has_pcp=True,
             transport=True, afford=False, unit="LRMC-4W", cond="HF", ddate=fri, los=6, charlson=5, ed6=2, prior=1, meds=13,
             disp="Home", fu=False, code="I50.23", dx="Acute on chronic systolic heart failure", lang="English"),
        dict(first_name="Earl", last_name="Whitfield", age=84, sex="M", payer="Medicare FFS", dual=True, lives_alone=True, has_pcp=False,
             transport=True, afford=True, unit="LRMC-4W", cond="HF", ddate=last_fri, los=5, charlson=6, ed6=3, prior=2, meds=14,
             disp="Home", fu=False, code="I50.33", dx="Acute on chronic diastolic heart failure", lang="English"),
        dict(first_name="Rosa", last_name="Delgado", age=72, sex="F", payer="Medicare FFS", dual=True, lives_alone=False, has_pcp=True,
             transport=False, afford=True, unit="LRMC-3N", cond="COPD", ddate=AS_OF - timedelta(days=1), los=4, charlson=4, ed6=2, prior=1,
             meds=11, disp="Home with home health", fu=True, code="J44.1", dx="COPD with acute exacerbation", lang="Spanish"),
        dict(first_name="Margaret", last_name="Olsen", age=69, sex="F", payer="Medicare FFS", dual=False, lives_alone=False, has_pcp=True,
             transport=False, afford=False, unit="LRMC-6S", cond="THA_TKA", ddate=AS_OF + timedelta(days=1), los=2, charlson=1, ed6=0, prior=0,
             meds=6, disp="Home", fu=True, code="Z96.651", dx="Total knee arthroplasty", lang="English"),
    ]
    service = {"HF": "Cardiology", "COPD": "Pulmonology", "THA_TKA": "Orthopedics"}
    for i, s in enumerate(specs):
        pid = f"MRN0{9001 + i}"
        p = dict(patient_id=pid, first_name=s["first_name"], last_name=s["last_name"], age=s["age"], sex=s["sex"], zip=ZIPS["LRMC"][i],
                 payer=s["payer"], dual_eligible=s["dual"], primary_language=s["lang"], lives_alone=s["lives_alone"], has_pcp=s["has_pcp"],
                 home_hospital="LRMC", _transport=s["transport"], _afford=s["afford"])
        patients[pid] = p
        d = make_discharge(f"E{1990001 + i}", p, s["unit"], "LRMC", service[s["cond"]], s["cond"], s["ddate"])
        d.update(los_days=s["los"], admit_date=s["ddate"] - timedelta(days=s["los"]), charlson_index=s["charlson"], ed_visits_6m=s["ed6"],
                 prior_admits_12m=s["prior"], discharge_med_count=s["meds"], discharge_disposition=s["disp"], principal_dx_code=s["code"],
                 principal_dx=s["dx"], admit_type="Elective" if s["cond"] == "THA_TKA" else "Emergency", followup_7d_scheduled=s["fu"],
                 followup_date=s["ddate"] + timedelta(days=5) if s["fu"] else None, followup_clinic=FOLLOWUP_CLINIC[s["cond"]] if s["fu"] else None,
                 attending="Dr. Priya Raman" if s["cond"] == "HF" else d["attending"], _hf_med_change=s["cond"] == "HF", _featured=s["last_name"])
        discharges.append(d)


# ── discharge notes ─────────────────────────────────────────────────────────
MED_CHANGES = {
    "HF": [("Furosemide increased from 40 mg daily to 80 mg daily", True), ("Started sacubitril/valsartan 24/26 mg twice daily; lisinopril discontinued (36-hour washout completed)", True),
           ("Metoprolol succinate increased to 50 mg daily", False), ("Started spironolactone 12.5 mg daily", True), ("Started dapagliflozin 10 mg daily", False),
           ("Torsemide 20 mg daily replaces furosemide", True)],
    "AMI": [("Started ticagrelor 90 mg twice daily with aspirin 81 mg", True), ("Started atorvastatin 80 mg nightly", False), ("Started metoprolol tartrate 25 mg twice daily", False)],
    "CABG": [("Started amiodarone 200 mg daily for post-op atrial fibrillation", True), ("Aspirin 81 mg and atorvastatin 80 mg", False), ("Oxycodone 5 mg as needed for 5 days", True)],
    "PN": [("Levofloxacin 750 mg daily to complete 5 days", False), ("Amoxicillin-clavulanate to complete 7 days", False)],
    "COPD": [("Prednisone 40 mg daily for 5 days", False), ("Started tiotropium inhaler daily", False), ("New home oxygen 2 L/min by nasal cannula", True), ("Azithromycin 250 mg for 4 more days", False)],
    "THA_TKA": [("Apixaban 2.5 mg twice daily for 35 days (VTE prophylaxis)", True), ("Oxycodone 5 mg as needed for 7 days", True), ("Acetaminophen 1 g three times daily", False)],
    "OTHER": [("Cephalexin 500 mg four times daily for 7 days", False), ("Insulin glargine increased to 24 units nightly", True), ("Started apixaban 5 mg twice daily", True), ("Metformin held until follow-up", False)],
}
COURSE = {
    "HF": "Admitted with dyspnea, orthopnea and 4.5 kg weight gain. Diuresed with IV furosemide, net negative 5.2 L. Echo EF {ef}%. Discharge weight {wt} kg.",
    "AMI": "Presented with chest pain and troponin elevation. Cardiac catheterization with drug-eluting stent to the {vessel}. Uncomplicated course.",
    "CABG": "CABG x{grafts}. Post-operative course notable for paroxysmal atrial fibrillation, rate controlled.",
    "PN": "Admitted with fever, productive cough and right lower lobe infiltrate. Treated with IV ceftriaxone and azithromycin, transitioned to oral antibiotics.",
    "COPD": "Admitted with COPD exacerbation, hypoxic to 86% on room air. Treated with nebulizers, steroids and antibiotics. Ambulatory saturation 89% on room air.",
    "THA_TKA": "Elective total joint arthroplasty, uncomplicated. Ambulating with walker, cleared by physical therapy.",
    "OTHER": "Admitted for {dx_lower}. Treated and clinically improved.",
}


def make_note(d, p):
    cond = d["hrrp_condition"]
    feat = d.get("_featured")
    r2 = random.Random(SEED ^ int(d["encounter_id"][1:]))
    t = dict(lives_alone=p["lives_alone"], transportation_barrier=p["_transport"], medication_affordability=p["_afford"],
             high_risk_med_change=False, followup_status="booked" if d["followup_7d_scheduled"] else None)
    course = COURSE[cond].format(ef=r2.choice([20, 25, 30, 35, 40, 55]), wt=r2.randint(62, 104), vessel=r2.choice(["LAD", "right coronary artery", "circumflex"]),
                                 grafts=r2.choice([2, 3, 4]), dx_lower=d["principal_dx"].lower())
    if feat == "Brennan":
        chosen = [MED_CHANGES["HF"][0], MED_CHANGES["HF"][1]]
        course = COURSE["HF"].format(ef=25, wt=81)
    elif feat == "Whitfield":
        chosen = [MED_CHANGES["HF"][5], MED_CHANGES["HF"][3]]
        course = COURSE["HF"].format(ef=55, wt=77)
    elif cond == "HF" and not d["_hf_med_change"]:
        chosen = [MED_CHANGES["HF"][2], MED_CHANGES["HF"][4]][: r2.randint(1, 2)]
    elif cond == "HF":
        chosen = [r2.choice([m for m in MED_CHANGES["HF"] if m[1]])] + r2.sample([m for m in MED_CHANGES["HF"] if not m[1]], k=r2.randint(0, 1))
    else:
        chosen = r2.sample(MED_CHANGES[cond], k=min(len(MED_CHANGES[cond]), r2.randint(1, 2)))
    t["high_risk_med_change"] = any(h for _, h in chosen)
    social = []
    if p["lives_alone"]:
        social.append(r2.choice(["Lives alone in a second-floor apartment.", "Lives alone; daughter lives out of state and calls weekly.", "Widowed, lives alone.", "Lives alone; a neighbor checks in occasionally."]))
    else:
        social.append(r2.choice(["Lives with spouse, who will assist with medications.", "Lives with adult son.", "Lives with wife, who drives him to appointments.", "Lives with daughter and her family."]))
    if p["_transport"]:
        social.append(r2.choice(["Does not drive and has no reliable ride to appointments.", "States there has been no transportation since the car was sold; relied on a neighbor for rides.",
                                 "Reports missing prior clinic visits because the bus route was cut.", "No car; son works days and cannot drive to appointments."]))
    if p["_afford"]:
        social.append(r2.choice(["Reports skipping doses at times because of copays.", "Concerned about the cost of the new medications.", "Has run out of inhalers before because of cost."]))
    if p["primary_language"] != "English":
        social.append(f"Preferred language {p['primary_language']}; interpreter used for discharge teaching.")
    if not p["lives_alone"] and not p["_transport"] and r2.random() < 0.5:
        social.append("Independent in ADLs, drives.")
    if d["followup_7d_scheduled"]:
        fu = f"{d['followup_clinic']} appointment scheduled for {d['followup_date'].strftime('%a %b %d')}."
    else:
        options = [("Patient instructed to call the HF clinic on Monday to schedule a follow-up visit." if cond == "HF" else "Patient instructed to call the clinic to schedule a follow-up visit.", "patient_to_call"),
                   ("Follow up with PCP in 1-2 weeks (patient to arrange).", "patient_to_call"),
                   ("No follow-up appointment could be scheduled at discharge — clinic closed for the weekend.", "not_arranged"),
                   ("No follow-up appointment was made before discharge.", "not_arranged")]
        fu, st = r2.choice([options[0], options[0], options[2]] if d["discharge_dow"] in ("Fri", "Sat") and cond == "HF" else options)
        t["followup_status"] = st
    if feat == "Brennan":
        social = ["Lives alone in a second-floor apartment; daughter lives out of state.", "Does not drive and has no reliable ride to appointments."]
        fu = "Patient instructed to call the HF clinic on Monday to schedule a follow-up visit. Weekend discharge — navigator not available."
        t["followup_status"] = "patient_to_call"
    elif feat == "Whitfield":
        social = ["Widowed, lives alone.", "No car; son works days and cannot drive to appointments.", "Concerned about the cost of the new medications."]
        fu = "No follow-up appointment could be scheduled at discharge — clinic closed for the weekend."
        t["followup_status"] = "not_arranged"
    labs = ""
    if cond == "HF" and t["high_risk_med_change"]:
        labs = "BMP in 3-5 days to check potassium and creatinine — no lab order placed yet." if feat else r2.choice(["BMP in 3-5 days to check potassium and creatinine.", "Repeat BMP within one week.", ""])
    discharged = d["status"] == "discharged"
    note = (f"DISCHARGE {'SUMMARY' if discharged else 'PLANNING NOTE'} — {d['unit_id']} — {'discharged' if discharged else 'anticipated discharge'} {d['discharge_date'].strftime('%a %b %d, %Y')}\n"
            f"{p['age']} y/o {'male' if p['sex'] == 'M' else 'female'}. Principal diagnosis: {d['principal_dx']} ({d['principal_dx_code']}). LOS {d['los_days']} days.\n"
            f"Hospital course: {course}\n"
            f"Medication changes: {'; '.join(m for m, _ in chosen)}.\n"
            f"Disposition: {d['discharge_disposition']}.\n"
            f"Social: {' '.join(social)}\n"
            f"Follow-up: {fu}" + (f"\nPending: {labs}" if labs else "") +
            ("\nEducation: daily weights, 2 g sodium diet, call for weight gain > 2 lb in a day or 5 lb in a week." if cond == "HF" else ""))
    return note, t


# ── Spark writes ────────────────────────────────────────────────────────────
def get_spark():
    from pyspark.sql import SparkSession
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


def write(spark, fq_schema, name, rows, struct, comment, pk=None):
    fq = f"{fq_schema}.{name}"
    cols = [f.name for f in struct.fields]
    df = spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], struct)
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        for c in [x.strip() for x in pk.split(",")]:
            spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {c} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


def stats(discharges):
    def rate(rows):
        done = [d for d in rows if d["discharge_date"] <= AS_OF - timedelta(days=30) and d["status"] == "discharged"]
        return f"{sum(d['readmitted_30d'] for d in done) / max(1, len(done)):.3f} (n={len(done)})"
    recent = lambda d: d["discharge_date"] >= SIGNAL_START
    hf4w = [d for d in discharges if d["unit_id"] == SIGNAL_UNIT and d["hrrp_condition"] == "HF"]
    print("AS_OF", AS_OF, "signal start", SIGNAL_START, "discharges", len(discharges))
    print("system all-cause", rate(discharges))
    print("4W HF before / last 26w", rate([d for d in hf4w if not recent(d)]), rate([d for d in hf4w if recent(d)]))
    other_hf = [d for d in discharges if d["unit_id"] != SIGNAL_UNIT and d["hrrp_condition"] == "HF"]
    print("other HF before / last 26w", rate([d for d in other_hf if not recent(d)]), rate([d for d in other_hf if recent(d)]))
    r = [d for d in hf4w if recent(d) and d["discharge_dow"] in ("Fri", "Sat")]
    print("4W HF Fri/Sat last 26w: fu rate", round(sum(d["followup_7d_scheduled"] for d in r) / max(1, len(r)), 3), "n", len(r))
    print("  with fu", rate([d for d in r if d["followup_7d_scheduled"]]), "without", rate([d for d in r if not d["followup_7d_scheduled"]]))
    allhf = [d for d in discharges if d["hrrp_condition"] == "HF"]
    print("all HF with fu / without", rate([d for d in allhf if d["followup_7d_scheduled"]]), rate([d for d in allhf if not d["followup_7d_scheduled"]]))
    for h in HOSPITALS:
        for c in NATIONAL_RATE:
            rows = [d for d in discharges if d["hospital_id"] == h[0] and d["hrrp_condition"] == c and d["medicare_ffs_65"] and d["discharge_date"] <= AS_OF - timedelta(days=30)]
            rr = sum(d["readmitted_30d"] for d in rows) / max(1, len(rows))
            print(f"  {h[0]:4s} {c:8s} rate {rr:.3f} n {len(rows):5d} ERR~{rr / NATIONAL_RATE[c]:.2f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="healthcare_lifesciences")
    ap.add_argument("--schema", default="readmission_reduction")
    ap.add_argument("--stats-only", action="store_true")
    args, _ = ap.parse_known_args()
    patients, discharges, readmissions, notes, truth = build()
    stats(discharges)
    print(f"patients {len(patients)} readmissions {len(readmissions)} notes {len(notes)} planned {sum(d['status'] == 'planned' for d in discharges)}")
    if args.stats_only:
        return

    from pyspark.sql import types as T
    S = T.StructField
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Larkspur Health — hospital care transitions & 30-day readmission reduction demo (synthetic data)'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.care_pathways COMMENT 'Larkspur care-transition pathways and policies - documents searched by the Genie agent'")
    for t in ["note_truth", "discharge_notes", "readmissions", "discharges", "patients", "unit_events", "units", "hospitals", "hrrp_benchmarks"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    write(spark, fqs, "hospitals", [dict(hospital_id=h[0], hospital_name=h[1], city=h[2], ccn=h[3], beds=h[4], medicare_base_drg_payments=h[5],
                                         dual_proportion=h[6], data_as_of=AS_OF) for h in HOSPITALS],
          T.StructType([S("hospital_id", T.StringType()), S("hospital_name", T.StringType()), S("city", T.StringType()), S("ccn", T.StringType()),
                        S("beds", T.IntegerType()), S("medicare_base_drg_payments", T.LongType()), S("dual_proportion", T.DoubleType()), S("data_as_of", T.DateType())]),
          "Larkspur Health acute-care hospitals. medicare_base_drg_payments = annual Medicare IPPS base-operating DRG payments (the base the CMS HRRP penalty applies to, capped at 3%). data_as_of = the date the demo data was generated (today).",
          pk="hospital_id")
    write(spark, fqs, "units", [dict(unit_id=u[0], hospital_id=u[1], unit_name=u[2], service_line=u[3]) for u in UNITS],
          T.StructType([S("unit_id", T.StringType()), S("hospital_id", T.StringType()), S("unit_name", T.StringType()), S("service_line", T.StringType())]),
          "Inpatient discharge units.", pk="unit_id")
    events = [
        dict(event_id="EV1", unit_id="LRMC-4W", event_date=SIGNAL_START - timedelta(days=3), event_type="staffing",
             description="Weekend discharge navigator (0.6 FTE RN, Fri-Sun) resigned; position posted, not filled."),
        dict(event_id="EV2", unit_id="LRMC-4W", event_date=SIGNAL_START + timedelta(days=4), event_type="clinic_schedule",
             description="HF Transitions Clinic discontinued its Saturday morning session (NP reassigned); Friday-afternoon discharge booking slots removed."),
        dict(event_id="EV3", unit_id="LRMC-5E", event_date=SIGNAL_START + timedelta(days=40), event_type="staffing",
             description="Hospitalist group added a second nocturnist; no change to the discharge process."),
        dict(event_id="EV4", unit_id="MCH-2W", event_date=SIGNAL_START - timedelta(days=90), event_type="program",
             description="Meds-to-beds pharmacy program launched on 2 West (bedside delivery of discharge prescriptions)."),
    ]
    write(spark, fqs, "unit_events", events, T.StructType([S("event_id", T.StringType()), S("unit_id", T.StringType()), S("event_date", T.DateType()),
                                                            S("event_type", T.StringType()), S("description", T.StringType())]),
          "Operational changes per unit (staffing, clinic schedules, programs) — the context behind readmission trends.", pk="event_id")
    write(spark, fqs, "patients", list(patients.values()), T.StructType([
        S("patient_id", T.StringType()), S("first_name", T.StringType()), S("last_name", T.StringType()), S("age", T.IntegerType()), S("sex", T.StringType()),
        S("zip", T.StringType()), S("payer", T.StringType()), S("dual_eligible", T.BooleanType()), S("primary_language", T.StringType()),
        S("lives_alone", T.BooleanType()), S("has_pcp", T.BooleanType()), S("home_hospital", T.StringType())]),
        "Patients (synthetic). lives_alone comes from the registration social-history screen. dual_eligible = Medicare + Medicaid.", pk="patient_id")
    write(spark, fqs, "discharges", discharges, T.StructType([
        S("encounter_id", T.StringType()), S("patient_id", T.StringType()), S("hospital_id", T.StringType()), S("unit_id", T.StringType()),
        S("admit_date", T.DateType()), S("discharge_date", T.DateType()), S("discharge_dow", T.StringType()), S("los_days", T.IntegerType()),
        S("admit_type", T.StringType()), S("hrrp_condition", T.StringType()), S("condition_label", T.StringType()), S("principal_dx_code", T.StringType()),
        S("principal_dx", T.StringType()), S("charlson_index", T.IntegerType()), S("ed_visits_6m", T.IntegerType()), S("prior_admits_12m", T.IntegerType()),
        S("discharge_med_count", T.IntegerType()), S("discharge_disposition", T.StringType()), S("followup_7d_scheduled", T.BooleanType()),
        S("followup_date", T.DateType()), S("followup_clinic", T.StringType()), S("followup_completed", T.BooleanType()), S("attending", T.StringType()),
        S("status", T.StringType()), S("age_at_discharge", T.IntegerType()), S("payer", T.StringType()), S("medicare_ffs_65", T.BooleanType()),
        S("drg_payment", T.IntegerType()), S("readmitted_30d", T.BooleanType())]),
        "One row per index inpatient discharge (~2 years) plus planned discharges of the next days (status = planned). hrrp_condition: HF, AMI, PN, COPD, CABG, THA_TKA or OTHER. "
        "discharge_dow = weekday of discharge (Mon..Sun). followup_7d_scheduled = a follow-up appointment within 7 days was booked before the patient left. "
        "readmitted_30d = unplanned readmission to any Larkspur hospital within 30 days (TRUE as soon as it happens; NULL while the 30-day window is still open and no readmission yet, and for planned discharges — compute rates only on discharges at least 30 days old). "
        "medicare_ffs_65 = counts toward CMS HRRP (Medicare fee-for-service, 65+).",
        pk="encounter_id")
    write(spark, fqs, "readmissions", readmissions, T.StructType([
        S("readmission_id", T.StringType()), S("index_encounter_id", T.StringType()), S("patient_id", T.StringType()), S("readmit_date", T.DateType()),
        S("days_to_readmit", T.IntegerType()), S("readmit_hospital_id", T.StringType()), S("via_ed", T.BooleanType()), S("planned", T.BooleanType()),
        S("readmit_reason", T.StringType()), S("readmit_los_days", T.IntegerType()), S("readmit_cost_usd", T.IntegerType())]),
        "Unplanned readmissions within 30 days of an index discharge (one per index discharge).", pk="readmission_id")
    write(spark, fqs, "discharge_notes", notes, T.StructType([
        S("encounter_id", T.StringType()), S("note_type", T.StringType()), S("author", T.StringType()), S("note_date", T.DateType()), S("note_text", T.StringType())]),
        "Discharge summaries / discharge-planning notes (free text) for the last ~120 days and the planned discharges. Social risks and medication changes live ONLY here — see discharge_note_insights for the AI Functions read.",
        pk="encounter_id")
    write(spark, fqs, "note_truth", truth, T.StructType([
        S("encounter_id", T.StringType()), S("lives_alone", T.BooleanType()), S("transportation_barrier", T.BooleanType()),
        S("medication_affordability", T.BooleanType()), S("high_risk_med_change", T.BooleanType()), S("followup_status", T.StringType())]),
        "Generator ground truth of what each discharge note says — for evaluating the AI Functions extraction only; never used by the app or agent.", pk="encounter_id")
    write(spark, fqs, "hrrp_benchmarks", [dict(hrrp_condition=c, condition_label=CONDITIONS[c][0], national_readmission_rate=r) for c, r in NATIONAL_RATE.items()],
          T.StructType([S("hrrp_condition", T.StringType()), S("condition_label", T.StringType()), S("national_readmission_rate", T.DoubleType())]),
          "National 30-day unplanned readmission rate per CMS HRRP condition (Medicare FFS 65+). This demo estimates the excess readmission ratio from observed vs national rate, credibility-weighted for small volumes (CMS risk-adjusts with a hierarchical model).",
          pk="hrrp_condition")
    for stmt in [
        f"ALTER TABLE {fqs}.units ADD CONSTRAINT units_hospital_fk FOREIGN KEY (hospital_id) REFERENCES {fqs}.hospitals RELY",
        f"ALTER TABLE {fqs}.unit_events ADD CONSTRAINT events_unit_fk FOREIGN KEY (unit_id) REFERENCES {fqs}.units RELY",
        f"ALTER TABLE {fqs}.discharges ADD CONSTRAINT discharges_patient_fk FOREIGN KEY (patient_id) REFERENCES {fqs}.patients RELY",
        f"ALTER TABLE {fqs}.discharges ADD CONSTRAINT discharges_unit_fk FOREIGN KEY (unit_id) REFERENCES {fqs}.units RELY",
        f"ALTER TABLE {fqs}.discharges ADD CONSTRAINT discharges_hospital_fk FOREIGN KEY (hospital_id) REFERENCES {fqs}.hospitals RELY",
        f"ALTER TABLE {fqs}.readmissions ADD CONSTRAINT readmissions_index_fk FOREIGN KEY (index_encounter_id) REFERENCES {fqs}.discharges RELY",
        f"ALTER TABLE {fqs}.discharge_notes ADD CONSTRAINT notes_encounter_fk FOREIGN KEY (encounter_id) REFERENCES {fqs}.discharges RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
