#!/usr/bin/env python
"""
MedVault Health Plan — Prior Authorization Automation: self-contained synthetic
data generation + table build. SYNTHETIC DATA ONLY — no PHI, every person,
provider and NPI is invented.

STORY — "Half the queue is clear approvals waiting two days":
MedVault's Utilization Management (UM) team reviews ~50 prior-authorization (PA)
requests a day across 11 medical policies. CMS-0057-F (Interoperability & Prior
Authorization final rule) requires a decision within 72 hours for EXPEDITED
requests and 7 calendar days for STANDARD ones, with public reporting of the
metrics. The planted signals the demo uncovers:

  1. ~45% of requests met every policy criterion on the nurse's FIRST review and
     were approved unchanged — yet they waited a median ~2 days in a FIFO queue.
     They are auto-approval candidates (automation approves, never denies).
  2. EXPEDITED breaches of the 72h clock are concentrated in FAX requests that
     arrive Friday afternoon -> Sunday (manual fax-indexing backlog on Monday).
  3. MRI Lumbar Spine (CPT 72148, policy MV-RAD-014) is the #1 pended service;
     most pends lack documentation of >= 6 weeks of conservative therapy, and ONE
     practice group (Cascade Spine & Pain Associates) has ~3x the pend rate — a
     provider-education target. Northside Orthopedic Associates is the opposite:
     ~93% first-pass clean -> a gold-card candidate.
  4. A 3-week pilot auto-approves clean ePA (FHIR API) imaging requests in
     minutes — the dashboard shows the auto-approval rate starting to climb.

The OPEN queue (as of AS_OF = the latest Monday 08:00 UTC) is what the nurse workbench app
shows; src/deploy/build_ai_review.sql then runs ai_query() over those open
cases' clinical notes vs. the policy criteria (AI Functions) to produce the
evidence + recommendation tables the app and the auto-approval lane consume.

Tables written to <catalog>.<schema>:
  members, providers, reviewers, medical_policies, policy_criteria,
  pa_requests, clinical_notes, snapshot_info (+ PK/FK RELY + comments)
  _gt_documentation_profile  (hidden ground truth, used only to score the AI)
Policy documents (markdown) -> UC volume /Volumes/<catalog>/<schema>/policy_docs/
(searched by the Genie agent).

Runs two ways (same plain .py — NOT a notebook):
  • On Databricks (DAB spark_python_task) — ambient SparkSession.
  • Locally — Databricks Connect serverless (Python 3.12 venv):
      DATABRICKS_CONFIG_PROFILE=<your-profile> python generate_data.py \
          --catalog healthcare_lifesciences --schema prior_auth_automation
"""
import argparse
import datetime as dt
import io
import os
import random

import pandas as pd

_p = argparse.ArgumentParser(add_help=False)
_p.add_argument("--catalog")
_p.add_argument("--schema")
_cli, _ = _p.parse_known_args()

from pyspark.sql import SparkSession  # noqa: E402

spark = SparkSession.getActiveSession()
ON_DATABRICKS = spark is not None
if spark is None:
    from databricks.connect import DatabricksSession
    _profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
    spark = DatabricksSession.builder.profile(_profile).serverless(True).getOrCreate()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "healthcare_lifesciences")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "prior_auth_automation")
FQ = f"`{CATALOG}`.`{SCHEMA}`"
print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")

rng = random.Random(20260929)

# ---------------------------------------------------------------------------
# Temporal anchor — the queue snapshot = Monday 08:00 UTC (start of the UM day
# shift). Everything decided after AS_OF is "still open" in the snapshot.
# ---------------------------------------------------------------------------
_now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
# Anchored on the most recent MONDAY 08:00 UTC so the story is identical whatever
# day you regenerate: the Monday-morning queue right after the weekend fax pile-up.
AS_OF = _now.replace(hour=8, minute=0, second=0, microsecond=0) - dt.timedelta(days=_now.weekday())
if _now < AS_OF:
    AS_OF -= dt.timedelta(days=7)
DAYS = 120
START = AS_OF - dt.timedelta(days=DAYS)
PILOT_START = AS_OF - dt.timedelta(days=21)
print(f"AS_OF={AS_OF}  START={START}  PILOT_START={PILOT_START}")

# ===========================================================================
# REFERENCE DATA — the medical policy library.
# criterion = (short_label, full_text, met_snippets, notmet_snippets)
# Snippets are the sentences the note builder drops into the clinical note.
# ===========================================================================
POLICIES = [
    dict(
        policy_id="MV-RAD-014", title="MRI Lumbar Spine without Contrast", category="Advanced Imaging",
        cpt="72148", cpt_desc="MRI lumbar spine w/o contrast", specialty="Pain Management",
        icd=[("M54.16", "Radiculopathy, lumbar region"), ("M54.50", "Low back pain, unspecified"),
             ("M51.26", "Other intervertebral disc displacement, lumbar region")],
        auto=True, cost=(950, 1600), weight=18, expedited=0.10,
        complaint="low back pain radiating to the leg",
        criteria=[
            ("Symptom duration >= 6 weeks",
             "Low back pain or lumbar radicular symptoms have persisted for at least 6 weeks.",
             ["Reports low back pain radiating down the {side} leg for {w} weeks.",
              "Radicular pain in the {side} L5 distribution present for approximately {w} weeks."],
             ["Symptoms began {d} days ago after lifting boxes at work."]),
            ("6 weeks conservative therapy",
             "At least 6 weeks of provider-directed conservative therapy (physical therapy, NSAIDs, activity modification) has failed.",
             ["Completed {n} sessions of physical therapy over {w2} weeks plus scheduled naproxen 500 mg BID without meaningful improvement.",
              "Failed {w2} weeks of a home exercise program, formal PT ({n} visits) and meloxicam 15 mg daily."],
             ["Has not started physical therapy; taking OTC ibuprofen as needed."]),
            ("Neuro exam + radiographs",
             "A neurologic examination is documented and plain radiographs have been obtained.",
             ["Lumbar X-ray on {date} shows mild degenerative disc disease at L4-L5. Straight-leg raise positive on the {side} at 40 degrees; EHL strength 4/5, diminished {side} ankle reflex.",
              "Neuro exam: decreased sensation over the {side} dorsal foot, SLR positive at 45 degrees. AP/lateral lumbar radiographs ({date}) without fracture."],
             ["No imaging performed to date and no focal neurologic findings on exam."]),
        ]),
    dict(
        policy_id="MV-RAD-022", title="MRI Brain with and without Contrast", category="Advanced Imaging",
        cpt="70553", cpt_desc="MRI brain w/o & w/ contrast", specialty="Neurology",
        icd=[("R51.9", "Headache, unspecified"), ("G43.909", "Migraine, unspecified"), ("R42", "Dizziness and giddiness")],
        auto=True, cost=(1400, 2300), weight=9, expedited=0.25,
        complaint="worsening headaches",
        criteria=[
            ("Red-flag or pattern change",
             "New neurologic deficit, OR headache with a documented change in pattern or red-flag features.",
             ["Headaches have changed in character over the past {w} weeks, now waking the patient from sleep, with new intermittent {side}-hand numbness.",
              "New-onset headache after age 50 with progressive worsening over {w} weeks."],
             ["Longstanding stable migraine pattern, unchanged for years, with no new features."]),
            ("Neurologic exam documented",
             "A complete neurologic examination is documented.",
             ["Neuro exam: cranial nerves II-XII intact except mild {side} pronator drift; fundoscopic exam without papilledema.",
              "Full neurologic exam documented: subtle {side} hemisensory loss, gait normal, no papilledema."],
             ["Neurologic exam deferred."]),
            ("Failed standard therapy >= 4 weeks",
             "A trial of standard therapy for primary headache (>= 4 weeks) has failed.",
             ["Failed {w2} weeks of topiramate 50 mg daily and sumatriptan rescue.",
              "Failed {w2} weeks of amitriptyline 25 mg nightly with persistent daily headaches."],
             ["No preventive or abortive therapy has been attempted."]),
        ]),
    dict(
        policy_id="MV-CAR-005", title="CT Coronary Angiography (CCTA)", category="Advanced Imaging",
        cpt="75574", cpt_desc="CT angiography heart w/ 3D imaging", specialty="Cardiology",
        icd=[("R07.9", "Chest pain, unspecified"), ("I20.9", "Angina pectoris, unspecified"), ("R94.31", "Abnormal electrocardiogram")],
        auto=True, cost=(700, 1300), weight=8, expedited=0.30,
        complaint="chest discomfort",
        criteria=[
            ("Intermediate pre-test probability",
             "Stable chest pain with intermediate pre-test probability of coronary artery disease.",
             ["Exertional chest pressure for {w} weeks relieved by rest; intermediate pre-test probability (ASCVD 10-year risk {r}%).",
              "Typical angina on exertion for {w} weeks; intermediate pre-test probability per the ACC/AHA chest pain guideline."],
             ["Pain is reproducible on palpation of the chest wall; low pre-test probability of CAD."]),
            ("No coronary imaging in 12 months",
             "No coronary imaging (CCTA, stress imaging or catheterization) within the prior 12 months.",
             ["No prior stress testing or coronary imaging on record.",
              "No coronary imaging in the past 12 months per claims history and patient report."],
             ["Nuclear stress test performed {m} months ago was normal."]),
            ("HR control and eGFR >= 30",
             "Patient can achieve heart-rate control and has eGFR >= 30 mL/min for iodinated contrast.",
             ["Resting HR 64 on metoprolol; eGFR {egfr} mL/min.",
              "Heart rate 58-66 on beta-blocker; creatinine normal (eGFR {egfr})."],
             ["eGFR 24 mL/min (CKD stage 4)."]),
        ]),
    dict(
        policy_id="MV-ORT-007", title="Total Knee Arthroplasty", category="Orthopedic Surgery",
        cpt="27447", cpt_desc="Total knee arthroplasty", specialty="Orthopedic Surgery",
        icd=[("M17.11", "Unilateral primary osteoarthritis, right knee"), ("M17.12", "Unilateral primary osteoarthritis, left knee"),
             ("M17.0", "Bilateral primary osteoarthritis of knee")],
        auto=False, cost=(24000, 36000), weight=7, expedited=0.03,
        complaint="progressive knee pain",
        criteria=[
            ("Advanced OA on X-ray (KL 3-4)",
             "Radiographic evidence of advanced osteoarthritis (Kellgren-Lawrence grade 3 or 4).",
             ["Standing AP knee X-ray shows bone-on-bone medial compartment narrowing with osteophytes, Kellgren-Lawrence grade {kl}.",
              "Weight-bearing radiographs ({date}): severe joint-space loss, subchondral sclerosis, KL grade {kl}."],
             ["X-ray shows mild joint-space narrowing, Kellgren-Lawrence grade 2."]),
            ("3 months failed non-surgical care",
             "At least 3 months of failed non-surgical management (physical therapy, NSAIDs, and/or intra-articular injection).",
             ["Failed {m} months of physical therapy, meloxicam, and two corticosteroid injections.",
              "Non-operative care for {m} months (PT, NSAIDs, hyaluronic acid injection) without durable relief."],
             ["Has not tried physical therapy or injections."]),
            ("Functional limitation and BMI < 40",
             "Documented functional limitation (e.g., KOOS JR or inability to walk more than one block) and BMI below 40.",
             ["KOOS JR score {k}; unable to walk more than one block; BMI {bmi}.",
              "Requires a cane and cannot climb stairs reciprocally; KOOS JR {k}; BMI {bmi}."],
             ["BMI {bmihi}; ambulating community distances without limitation."]),
        ]),
    dict(
        policy_id="MV-ORT-011", title="Arthroscopic Rotator Cuff Repair", category="Orthopedic Surgery",
        cpt="29827", cpt_desc="Arthroscopic rotator cuff repair", specialty="Orthopedic Surgery",
        icd=[("M75.101", "Rotator cuff tear, right shoulder, not specified as traumatic"), ("M75.102", "Rotator cuff tear, left shoulder, not specified as traumatic")],
        auto=False, cost=(14000, 22000), weight=6, expedited=0.05,
        complaint="shoulder pain",
        criteria=[
            ("MRI-confirmed full-thickness tear",
             "MRI-confirmed full-thickness rotator cuff tear.",
             ["MRI on {date} confirms a full-thickness supraspinatus tear with 1.4 cm retraction.",
              "Shoulder MRI ({date}): full-thickness tear of the supraspinatus and anterior infraspinatus."],
             ["MRI shows supraspinatus tendinosis without a full-thickness tear."]),
            ("6 weeks failed conservative care",
             "At least 6 weeks of conservative therapy (physical therapy, NSAIDs and/or injection) has failed.",
             ["Completed {w2} weeks of PT and a subacromial injection with persistent weakness.",
              "Completed {w2} weeks of supervised physical therapy and NSAIDs without functional improvement."],
             ["No conservative therapy attempted; gradual symptom onset."]),
            ("Weakness / functional loss on exam",
             "Documented weakness or functional loss on examination.",
             ["Positive drop-arm test; external rotation strength 3/5.",
              "Weak abduction 3+/5, positive empty-can test, unable to lift the arm overhead."],
             ["Full strength on exam; pain only at end range."]),
        ]),
    dict(
        policy_id="MV-SLP-003", title="Attended Polysomnography (In-Lab Sleep Study)", category="Sleep Medicine",
        cpt="95810", cpt_desc="Polysomnography, attended, 4+ parameters", specialty="Sleep Medicine",
        icd=[("G47.33", "Obstructive sleep apnea"), ("R06.83", "Snoring"), ("G47.10", "Hypersomnia, unspecified")],
        auto=True, cost=(1100, 1800), weight=9, expedited=0.02,
        complaint="sleep evaluation",
        criteria=[
            ("Sleep-disordered breathing symptoms",
             "Symptoms of sleep-disordered breathing are documented (STOP-BANG >= 3 or Epworth Sleepiness Scale > 10).",
             ["STOP-BANG score {sb}; Epworth Sleepiness Scale {ess}; witnessed apneas reported by bed partner.",
              "Loud snoring, witnessed apneas, ESS {ess}; STOP-BANG {sb}."],
             ["Epworth Sleepiness Scale 6; STOP-BANG 1; no witnessed apneas."]),
            ("Home test inappropriate or non-diagnostic",
             "A home sleep apnea test is inappropriate (significant cardiopulmonary disease, suspected non-OSA disorder) or was non-diagnostic.",
             ["Home sleep test on {date} was technically inadequate (< 4 hours of valid recording).",
              "Patient has heart failure with EF 35%, making home sleep apnea testing inappropriate."],
             ["No home sleep apnea test attempted and no comorbidities preclude home testing."]),
            ("Face-to-face evaluation",
             "Ordered after a face-to-face evaluation by a sleep specialist or the treating physician.",
             ["Seen face-to-face in the sleep medicine clinic today.",
              "Face-to-face evaluation with the treating physician on {date}."],
             ["Order placed via e-visit without a face-to-face evaluation."]),
        ]),
    dict(
        policy_id="MV-DME-019", title="CPAP Device (E0601)", category="Durable Medical Equipment",
        cpt="E0601", cpt_desc="Continuous positive airway pressure device", specialty="Sleep Medicine",
        icd=[("G47.33", "Obstructive sleep apnea")],
        auto=True, cost=(650, 1100), weight=10, expedited=0.02,
        complaint="newly diagnosed obstructive sleep apnea",
        criteria=[
            ("OSA confirmed (AHI >= 15, or 5-14 w/ symptoms)",
             "OSA diagnosed by sleep study with AHI >= 15, or AHI 5-14 with documented symptoms.",
             ["Home sleep test {date}: AHI {ahi} events/hour, nadir SpO2 {spo2}%.",
              "Polysomnography ({date}) AHI {ahi}/hr with oxygen nadir {spo2}%."],
             ["Sleep study AHI 3.2 events/hour (within normal limits)."]),
            ("Face-to-face before sleep test",
             "A face-to-face clinical evaluation took place prior to the sleep test.",
             ["Face-to-face evaluation on {date} documented daytime somnolence and snoring before testing.",
              "Pre-test clinic visit on {date} with the treating physician."],
             ["No pre-test clinical evaluation on file."]),
            ("CPAP education + 90-day adherence plan",
             "Patient educated on CPAP use and agrees to a 90-day adherence review.",
             ["Patient educated on mask fitting and agrees to adherence follow-up at 90 days.",
              "CPAP education completed; adherence download scheduled at 90 days."],
             ["Patient declines follow-up adherence monitoring."]),
        ]),
    dict(
        policy_id="MV-PHM-042", title="Adalimumab Biosimilar for Rheumatoid Arthritis", category="Specialty Pharmacy",
        cpt="J0135", cpt_desc="Adalimumab-adaz injection", specialty="Rheumatology",
        icd=[("M05.79", "Rheumatoid arthritis with rheumatoid factor, multiple sites"), ("M06.9", "Rheumatoid arthritis, unspecified")],
        auto=False, cost=(5200, 7400), weight=6, expedited=0.08,
        complaint="persistent polyarticular joint swelling",
        criteria=[
            ("Moderate-severe RA by rheumatologist",
             "Diagnosis of moderate-to-severe rheumatoid arthritis by a rheumatologist.",
             ["Seropositive RA (RF+, anti-CCP+) diagnosed by rheumatology; CDAI {cdai} (high disease activity).",
              "Rheumatology-confirmed RA with {sj} swollen joints; CDAI {cdai}."],
             ["Arthralgias without synovitis; RA not confirmed."]),
            ("Inadequate response to methotrexate >= 3 mo",
             "Inadequate response to at least 3 months of methotrexate, or documented intolerance.",
             ["Inadequate response after {m} months of methotrexate 20 mg weekly.",
              "Methotrexate discontinued after {m} months due to transaminitis (documented intolerance)."],
             ["Methotrexate has not been trialed."]),
            ("Negative TB screen within 12 months",
             "Negative tuberculosis screening within the last 12 months.",
             ["QuantiFERON-TB Gold negative on {date}.",
              "TB screening (IGRA) negative, collected {date}."],
             ["QuantiFERON-TB Gold indeterminate; repeat pending."]),
        ]),
    dict(
        policy_id="MV-ONC-012", title="PET/CT for Oncologic Staging", category="Advanced Imaging",
        cpt="78815", cpt_desc="PET/CT skull base to mid-thigh", specialty="Oncology",
        icd=[("C34.11", "Malignant neoplasm of upper lobe, right lung"), ("C18.9", "Malignant neoplasm of colon, unspecified"),
             ("C50.911", "Malignant neoplasm of right female breast")],
        auto=True, cost=(2800, 4600), weight=7, expedited=0.55,
        complaint="oncology consultation",
        criteria=[
            ("Biopsy-proven malignancy",
             "Biopsy-proven malignancy.",
             ["Pathology on {date}: biopsy-proven adenocarcinoma.",
              "Core biopsy ({date}) confirms invasive carcinoma."],
             ["Suspicious lesion on CT; biopsy is still pending."]),
            ("Initial staging or restaging per NCCN",
             "PET/CT is requested for initial staging or restaging consistent with NCCN guidance.",
             ["PET/CT requested for initial staging prior to treatment planning per NCCN guidance.",
              "Restaging after completion of neoadjuvant therapy per NCCN."],
             ["PET/CT requested for routine surveillance with no clinical change."]),
            ("Result will change management",
             "The result will change management (documented treatment plan).",
             ["Tumor board review scheduled; staging will determine surgery versus chemoradiation.",
              "Result will determine eligibility for curative-intent resection."],
             ["Treatment plan already finalized regardless of the PET result."]),
        ]),
    dict(
        policy_id="MV-GAS-002", title="Laparoscopic Sleeve Gastrectomy", category="Bariatric Surgery",
        cpt="43775", cpt_desc="Laparoscopic sleeve gastrectomy", specialty="Bariatric Surgery",
        icd=[("E66.01", "Morbid (severe) obesity due to excess calories"), ("E66.9", "Obesity, unspecified")],
        auto=False, cost=(18000, 26000), weight=3, expedited=0.0,
        complaint="weight management consultation",
        criteria=[
            ("BMI >= 40, or >= 35 with comorbidity",
             "BMI of 40 or higher, or 35 or higher with an obesity-related comorbidity.",
             ["BMI {bmi40}; comorbid type 2 diabetes and obstructive sleep apnea.",
              "BMI {bmi40} with hypertension and HbA1c 8.1%."],
             ["BMI 33.8 without significant comorbidities."]),
            ("6-month supervised weight program",
             "Completion of a medically supervised weight-management program of at least 6 months.",
             ["Completed a 6-month medically supervised weight-loss program (monthly visits documented).",
              "Participated in a supervised nutrition and exercise program for 7 months."],
             ["Enrolled in a weight-management program 2 months ago."]),
            ("Psychological evaluation clearance",
             "Pre-operative psychological evaluation clearing the patient for surgery.",
             ["Psychological evaluation on {date} cleared the patient for bariatric surgery.",
              "Behavioral health clearance letter dated {date}."],
             ["Psychological evaluation recommends deferring surgery."]),
        ]),
    dict(
        policy_id="MV-REH-009", title="Outpatient Physical Therapy Beyond 20 Visits", category="Rehabilitation",
        cpt="97110", cpt_desc="Therapeutic exercise, each 15 min", specialty="Physical Therapy",
        icd=[("M25.561", "Pain in right knee"), ("S83.511A", "Sprain of ACL of right knee"), ("Z96.651", "Presence of right artificial knee joint")],
        auto=True, cost=(900, 1900), weight=17, expedited=0.01,
        complaint="ongoing rehabilitation after knee injury",
        criteria=[
            ("Objective functional progress",
             "Objective functional progress documented at the most recent re-evaluation.",
             ["Re-evaluation on {date}: knee flexion improved from 85 to 110 degrees; LEFS improved from 32 to 51.",
              "Measurable gains since last re-evaluation: single-leg stance 8s to 25s, LEFS +14 points."],
             ["No measurable progress since the last re-evaluation."]),
            ("Updated plan of care with goals",
             "An updated plan of care with measurable goals signed by the treating provider.",
             ["Updated plan of care signed {date}: goals - independent stair negotiation, return to work.",
              "Signed plan of care ({date}) with measurable goals for return to sport."],
             ["Plan of care expired and has not been re-signed."]),
            ("<= 12 additional visits requested",
             "The request is for 12 or fewer additional visits.",
             ["Requesting {v} additional visits over 6 weeks.",
              "Requesting {v} additional visits (2x/week)."],
             ["Requesting 36 additional visits."]),
        ]),
]
POL = {p["policy_id"]: p for p in POLICIES}

# ===========================================================================
# PROVIDERS, MEMBERS, REVIEWERS (all fictional)
# ===========================================================================
FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "William", "Elizabeth",
         "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Carlos", "Karen", "Daniel", "Nancy", "Anthony",
         "Lisa", "Mark", "Betty", "Kevin", "Sandra", "Brian", "Ashley", "George", "Dorothy", "Ahmed", "Mei", "Raj",
         "Aisha", "Hiroshi", "Olga", "Diego", "Fatima", "Tomas", "Grace", "Noah", "Emma", "Liam", "Ava", "Ethan",
         "Sofia", "Lucas", "Chloe", "Mateo", "Zoe"]
LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
        "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
        "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
        "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams",
        "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Patel", "Kim", "Chen", "Okafor"]
CITIES = [("Portland", "OR"), ("Beaverton", "OR"), ("Salem", "OR"), ("Eugene", "OR"), ("Vancouver", "WA"),
          ("Tacoma", "WA"), ("Seattle", "WA"), ("Spokane", "WA"), ("Boise", "ID"), ("Bend", "OR")]
GROUPS = [
    # (practice group, specialties, n providers, documentation-quality profile, city)
    ("Cascade Spine & Pain Associates", ["Pain Management", "Physical Medicine & Rehabilitation"], 8, "cascade", ("Tacoma", "WA")),
    ("Northside Orthopedic Associates", ["Orthopedic Surgery", "Physical Therapy"], 9, "northside", ("Portland", "OR")),
    ("Willamette Valley Neurology", ["Neurology"], 6, "normal", ("Salem", "OR")),
    ("Pacific Heart & Vascular", ["Cardiology"], 8, "normal", ("Seattle", "WA")),
    ("Evergreen Sleep Center", ["Sleep Medicine"], 6, "normal", ("Beaverton", "OR")),
    ("Columbia Rheumatology Partners", ["Rheumatology"], 5, "normal", ("Vancouver", "WA")),
    ("Summit Oncology Group", ["Oncology"], 7, "good", ("Eugene", "OR")),
    ("Riverbend Bariatric & Metabolic", ["Bariatric Surgery"], 4, "normal", ("Boise", "ID")),
    ("MotionWorks Physical Therapy", ["Physical Therapy"], 12, "normal", ("Spokane", "WA")),
    ("High Desert Orthopedics", ["Orthopedic Surgery", "Pain Management"], 7, "normal", ("Bend", "OR")),
    ("Puget Sound Multispecialty Clinic", ["Neurology", "Cardiology", "Pain Management", "Sleep Medicine",
                                           "Rheumatology", "Oncology", "Physical Therapy", "Orthopedic Surgery"], 28, "normal", ("Seattle", "WA")),
    ("Rose City Family Medicine", ["Pain Management", "Sleep Medicine", "Physical Therapy", "Cardiology"], 14, "normal", ("Portland", "OR")),
    ("Inland Northwest Health Partners", ["Orthopedic Surgery", "Neurology", "Bariatric Surgery", "Oncology",
                                          "Physical Therapy", "Sleep Medicine"], 18, "normal", ("Spokane", "WA")),
]
providers = []
pid = 0
for gname, specs, n, quality, (city, state) in GROUPS:
    for i in range(n):
        pid += 1
        spec = specs[i % len(specs)]
        cred = "PT, DPT" if spec == "Physical Therapy" else rng.choice(["MD", "MD", "DO", "MD"])
        providers.append(dict(
            provider_id=f"PRV-{pid:04d}",
            npi=str(1000000000 + rng.randint(10_000_000, 899_999_999)),  # fake — not a real NPI
            provider_name=f"{rng.choice(FIRST)} {rng.choice(LAST)}, {cred}",
            specialty=spec, practice_group=gname, city=city, state=state,
            quality_profile=quality,
            epa_enabled=(rng.random() < (0.65 if quality in ("northside", "good") else 0.30)),
        ))
PROV_BY_SPEC = {}
for p in providers:
    PROV_BY_SPEC.setdefault(p["specialty"], []).append(p)
CASCADE = [p for p in providers if p["quality_profile"] == "cascade"]
NORTHSIDE_OS = [p for p in providers if p["quality_profile"] == "northside" and p["specialty"] == "Orthopedic Surgery"]

LOB = [("Medicare Advantage", 0.55), ("Commercial PPO", 0.30), ("Medicaid Managed Care", 0.15)]
# Sex-consistent first names: the name is still drawn from FIRST (same RNG stream, so every planted
# number is unchanged), then swapped to its paired name of the member's sex when they disagree.
MALE_FIRST = ["James", "Robert", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Carlos", "Daniel",
              "Anthony", "Mark", "Kevin", "Brian", "George", "Ahmed", "Raj", "Hiroshi", "Diego", "Tomas", "Noah",
              "Liam", "Ethan", "Lucas", "Mateo"]
FEMALE_FIRST = ["Maria", "Linda", "Patricia", "Jennifer", "Elizabeth", "Susan", "Jessica", "Sarah", "Karen", "Nancy",
                "Lisa", "Betty", "Sandra", "Ashley", "Dorothy", "Mei", "Aisha", "Olga", "Fatima", "Grace", "Emma",
                "Ava", "Sofia", "Chloe", "Zoe"]


def first_name_for_sex(name: str, sex: str) -> str:
    if sex == "M" and name in FEMALE_FIRST:
        return MALE_FIRST[FEMALE_FIRST.index(name)]
    if sex == "F" and name in MALE_FIRST:
        return FEMALE_FIRST[MALE_FIRST.index(name)]
    return name


members = []
for i in range(4200):
    lob = rng.choices([l for l, _ in LOB], [w for _, w in LOB])[0]
    age = rng.randint(66, 91) if lob == "Medicare Advantage" else rng.randint(19, 64)
    city, state = rng.choice(CITIES)
    members.append(dict(
        member_id=f"MV{100000 + i * 7 + rng.randint(0, 6):07d}",
        first_name=rng.choice(FIRST), last_name=rng.choice(LAST),
        age=age, sex=rng.choice(["F", "M"]), line_of_business=lob,
        plan_name={"Medicare Advantage": rng.choice(["MedVault Advantage Plus (HMO)", "MedVault Advantage Choice (PPO)"]),
                   "Commercial PPO": "MedVault Select PPO",
                   "Medicaid Managed Care": "MedVault Community Care"}[lob],
        city=city, state=state, risk_score=round(rng.uniform(0.6, 2.4), 2),
    ))
    members[-1]["first_name"] = first_name_for_sex(members[-1]["first_name"], members[-1]["sex"])

NURSES = ["Dana Whitfield, RN", "Marcus Bell, RN", "Priya Natarajan, RN", "Hannah Kowalski, RN", "Luis Ortega, RN",
          "Grace Liu, RN", "Tanya Brooks, RN", "Omar Haddad, RN", "Emily Sorensen, RN", "Kofi Mensah, RN",
          "Rachel Stein, RN", "Jasmine Reyes, RN", "Victor Cho, RN", "Megan O'Neil, RN"]
MDS = ["Dr. Marcus Oyelaran (Medical Director)", "Dr. Elena Varga (Medical Director)",
       "Dr. Samuel Ito (Associate Medical Director)"]
reviewers = ([dict(reviewer_id=f"RN-{i + 1:02d}", reviewer_name=n, role="UM Nurse Reviewer",
                   team="Imaging & Outpatient" if i < 7 else "Surgical & Pharmacy") for i, n in enumerate(NURSES)]
             + [dict(reviewer_id=f"MD-{i + 1:02d}", reviewer_name=n, role="Medical Director", team="Physician Review")
                for i, n in enumerate(MDS)])
RN_IDS = [r["reviewer_id"] for r in reviewers if r["role"] == "UM Nurse Reviewer"]
MD_IDS = [r["reviewer_id"] for r in reviewers if r["role"] == "Medical Director"]


# ===========================================================================
# PA REQUESTS — event-timeline simulation
# ===========================================================================
def fill(s, age=None):
    return s.format(
        side=rng.choice(["left", "right"]), w=rng.randint(7, 16), w2=rng.randint(6, 10), d=rng.randint(4, 20),
        n=rng.randint(8, 14), m=rng.randint(4, 11), r=rng.choice([9.8, 12.4, 14.1, 16.7, 11.2]),
        egfr=rng.randint(58, 96), kl=rng.choice([3, 4, 4]), k=rng.randint(38, 52), bmi=round(rng.uniform(27.5, 36.9), 1),
        bmihi=round(rng.uniform(41.0, 46.5), 1), sb=rng.randint(4, 7), ess=rng.randint(12, 19),
        ahi=round(rng.uniform(16, 48), 1), spo2=rng.randint(76, 86), cdai=rng.randint(24, 41), sj=rng.randint(6, 14),
        bmi40=round(rng.uniform(40.2, 47.8), 1), v=rng.choice([8, 10, 12]), age=age or rng.randint(40, 63),
        date=(AS_OF - dt.timedelta(days=rng.randint(10, 80))).strftime("%m/%d/%Y"),
    )


def pick_profile(prov, pol):
    """Ground-truth documentation profile: clear / missing doc / criterion not met / complex."""
    q = prov["quality_profile"]
    if q == "northside":
        w = [0.93, 0.05, 0.01, 0.01]
    elif q == "cascade" and pol["policy_id"] == "MV-RAD-014":
        w = [0.22, 0.62, 0.08, 0.08]
    elif q == "cascade":
        w = [0.30, 0.50, 0.10, 0.10]
    elif q == "good":
        w = [0.62, 0.28, 0.05, 0.05]
    else:
        w = [0.52, 0.36, 0.06, 0.06]
    if pol["policy_id"] == "MV-GAS-002":
        w = [0.25, 0.45, 0.15, 0.15]
    return rng.choices(["clear", "missing", "notmet", "complex"], w)[0]


def received_time(day):
    hour = rng.choices(range(24), [1, 1, 1, 1, 1, 2, 4, 7, 9, 10, 10, 9, 8, 9, 10, 10, 9, 8, 6, 4, 3, 2, 2, 1])[0]
    return day + dt.timedelta(hours=hour, minutes=rng.randint(0, 59))


def next_business_morning(t):
    d = t
    while True:
        d = (d + dt.timedelta(days=1)).replace(hour=9, minute=0)
        if d.weekday() < 5:
            return d


def intake_delay(t, channel):
    if channel == "ePA (FHIR API)":
        return t + dt.timedelta(minutes=rng.randint(1, 12))
    if channel == "Provider Portal":
        return t + dt.timedelta(hours=rng.uniform(0.3, 2.5))
    # Fax: manual indexing, business hours only. Friday >= 15:00 or the weekend
    # waits for Monday's indexing backlog (the planted breach driver).
    wd = t.weekday()
    if (wd == 4 and t.hour >= 15) or wd >= 5:
        return next_business_morning(t) + dt.timedelta(hours=rng.uniform(20, 34))
    if t.hour >= 17:
        return next_business_morning(t) + dt.timedelta(hours=rng.uniform(1, 4))
    if t.hour < 8:
        return t.replace(hour=9, minute=0) + dt.timedelta(hours=rng.uniform(1, 4))
    return t + dt.timedelta(hours=rng.uniform(3, 9))


def queue_wait(urgency):
    if urgency == "Expedited":
        return dt.timedelta(hours=min(40, rng.lognormvariate(2.3, 0.55)))     # median ~10h
    return dt.timedelta(hours=min(150, rng.lognormvariate(4.0, 0.42)))        # median ~55h


pol_ids = [p["policy_id"] for p in POLICIES]
pol_w = [p["weight"] for p in POLICIES]
rows, notes = [], []
note_seq = 0
req_seq = 4000
for day_i in range(DAYS + 1):
    day = (START + dt.timedelta(days=day_i)).replace(hour=0, minute=0)
    wd = day.weekday()
    n_today = int(rng.gauss(58, 6) if wd < 5 else rng.gauss(20, 4))
    for _ in range(max(n_today, 5)):
        t_recv = received_time(day)
        if t_recv >= AS_OF or t_recv < START:
            continue
        pol = POL[rng.choices(pol_ids, pol_w)[0]]
        if pol["policy_id"] == "MV-RAD-014" and rng.random() < 0.38:
            prov = rng.choice(CASCADE)
        elif pol["policy_id"] in ("MV-ORT-007", "MV-ORT-011") and rng.random() < 0.35:
            prov = rng.choice(NORTHSIDE_OS)
        else:
            prov = rng.choice(PROV_BY_SPEC.get(pol["specialty"], providers))
        mem = rng.choice(members)
        urgency = "Expedited" if rng.random() < pol["expedited"] + 0.10 else "Standard"
        if prov["epa_enabled"] and rng.random() < 0.55:
            channel = "ePA (FHIR API)"
        else:
            channel = rng.choices(["Fax", "Provider Portal"], [0.52, 0.48])[0]
        profile = pick_profile(prov, pol)
        n_crit = len(pol["criteria"])
        status_by_c = ["Met"] * n_crit
        if profile == "missing":
            if pol["policy_id"] == "MV-RAD-014" and (prov["quality_profile"] == "cascade" or rng.random() < 0.7):
                idx = 1  # conservative therapy not documented — the lumbar-MRI pend driver
            else:
                idx = rng.randrange(n_crit)
            status_by_c[idx] = "Not Documented"
        elif profile == "notmet":
            status_by_c[rng.randrange(n_crit)] = "Not Met"
        elif profile == "complex":
            a, b = rng.sample(range(n_crit), 2)
            status_by_c[a] = "Not Met"
            status_by_c[b] = "Not Documented"

        req_seq += 1
        request_id = f"PA-{t_recv.strftime('%y%m')}-{req_seq:06d}"
        sla_h = 72 if urgency == "Expedited" else 168
        due = t_recv + dt.timedelta(hours=sla_h)
        icd = rng.choice(pol["icd"])
        t_intake = intake_delay(t_recv, channel)
        rn = rng.choice(RN_IDS)
        md = rng.choice(MD_IDS)

        # ---- decision path ----
        auto_pilot = (pol["auto"] and channel == "ePA (FHIR API)" and profile == "clear"
                      and t_recv >= PILOT_START and pol["category"] == "Advanced Imaging" and rng.random() < 0.9)
        withdrawn = rng.random() < 0.025
        events = []
        decided_by, reviewer, outcome, path = None, None, None, None
        pend_reason, denial_reason, pend_count = None, None, 0
        if auto_pilot:
            t_dec = t_intake + dt.timedelta(minutes=rng.randint(1, 6))
            outcome, path, decided_by, reviewer = "Approved", "Auto-approved (rules pilot)", "Automation", None
            t_first = t_dec
            events.append((t_dec, "Approved"))
        else:
            t_first = t_intake + queue_wait(urgency)
            if urgency == "Standard" and t_first.weekday() >= 5:  # standard queue is worked on weekdays
                t_first = next_business_morning(t_first) + dt.timedelta(hours=rng.uniform(0, 6))
            reviewer = rn
            events.append((t_intake, "Queued"))
            events.append((t_first, "In Nurse Review"))
            t_nurse_done = t_first + dt.timedelta(minutes=rng.randint(18, 55))
            exp = urgency == "Expedited"
            if withdrawn:
                outcome, path, decided_by, t_dec = "Withdrawn", "Withdrawn by provider", "Provider", t_nurse_done
                events.append((t_dec, "Withdrawn"))
            elif profile == "clear":
                outcome, path, decided_by, t_dec = "Approved", "Nurse approved", "UM Nurse", t_nurse_done
                events.append((t_dec, "Approved"))
            elif profile == "missing":
                pend_count = 1
                miss = pol["criteria"][status_by_c.index("Not Documented")][0]
                pend_reason = f"Missing documentation: {miss}"
                events.append((t_nurse_done, "Pended - Info Requested"))
                if rng.random() < 0.92:
                    t_info = t_nurse_done + dt.timedelta(hours=rng.uniform(18, 110) if not exp else rng.uniform(3, 26))
                    events.append((t_info, "In Nurse Review"))
                    if rng.random() < 0.94:
                        t_dec = t_info + dt.timedelta(hours=rng.uniform(4, 30) if not exp else rng.uniform(1, 6))
                        outcome, path, decided_by = "Approved", "Pended then approved", "UM Nurse"
                        events.append((t_dec, "Approved"))
                    else:
                        t_md = t_info + dt.timedelta(hours=rng.uniform(6, 24) if not exp else rng.uniform(1, 5))
                        events.append((t_md, "Medical Director Review"))
                        outcome, path, decided_by, reviewer = "Denied", "Medical director denied", "Medical Director", md
                        t_dec = t_md + dt.timedelta(hours=rng.uniform(6, 36) if not exp else rng.uniform(2, 8))
                        denial_reason = f"Criteria not met after additional information: {miss}"
                        events.append((t_dec, "Denied"))
                else:
                    t_md = t_nurse_done + (dt.timedelta(days=rng.uniform(7, 12)) if not exp else dt.timedelta(hours=rng.uniform(30, 50)))
                    events.append((t_md, "Medical Director Review"))
                    outcome, path, decided_by, reviewer = "Denied", "Medical director denied", "Medical Director", md
                    t_dec = t_md + dt.timedelta(hours=rng.uniform(4, 24))
                    denial_reason = f"Insufficient documentation (no response to request): {miss}"
                    events.append((t_dec, "Denied"))
            else:  # notmet / complex → physician review (only an MD may issue an adverse determination)
                t_md = t_nurse_done + dt.timedelta(hours=rng.uniform(2, 20) if not exp else rng.uniform(1, 6))
                events.append((t_md, "Medical Director Review"))
                reviewer, decided_by = md, "Medical Director"
                t_dec = t_md + dt.timedelta(hours=rng.uniform(8, 40) if urgency == "Standard" else rng.uniform(3, 14))
                approve_p = 0.30 if profile == "notmet" else 0.60
                crit_nm = pol["criteria"][status_by_c.index("Not Met")][0]
                if rng.random() < approve_p:
                    outcome, path = "Approved", "Medical director approved (peer-to-peer)"
                    events.append((t_dec, "Approved"))
                else:
                    outcome, path = "Denied", "Medical director denied"
                    denial_reason = f"Criteria not met: {crit_nm}"
                    events.append((t_dec, "Denied"))

        # ---- status as of AS_OF ----
        status = "Intake / Indexing"
        for ts, st in events:
            if ts <= AS_OF:
                status = st
        is_open = events[-1][0] > AS_OF
        if is_open:
            decision_ts, final_outcome, tat, sla_met = None, "Open", None, None
            first_review = t_first if t_first <= AS_OF else None
            path_out, decided_by_out = None, None
            reviewer_out = reviewer if first_review else None
            denial_out = None
            pend_out = pend_reason if status == "Pended - Info Requested" else None
            pend_count_out = 1 if pend_out else 0
        else:
            decision_ts = events[-1][0]
            final_outcome = outcome
            tat = round((decision_ts - t_recv).total_seconds() / 3600, 2)
            sla_met = (tat <= sla_h) if outcome != "Withdrawn" else None
            first_review = t_first
            path_out, decided_by_out, reviewer_out = path, decided_by, reviewer
            denial_out, pend_out, pend_count_out = denial_reason, pend_reason, pend_count

        units = 1
        if pol["cpt"] == "97110":
            units = rng.choice([8, 10, 12])
            if status_by_c[2] == "Not Met":
                units = 36
        pos = ("Freestanding imaging center" if pol["category"] == "Advanced Imaging" and rng.random() < 0.5 else
               "Outpatient hospital" if pol["category"] == "Advanced Imaging" else
               "Inpatient hospital" if pol["category"] == "Bariatric Surgery" or (pol["policy_id"] == "MV-ORT-007" and rng.random() < 0.6) else
               "Ambulatory surgery center" if "Surgery" in pol["category"] else
               "Home" if pol["category"] == "Durable Medical Equipment" else
               "Sleep lab" if pol["category"] == "Sleep Medicine" else "Office")
        rows.append(dict(
            request_id=request_id, member_id=mem["member_id"], provider_id=prov["provider_id"],
            policy_id=pol["policy_id"], service_code=pol["cpt"], service_description=pol["cpt_desc"],
            service_category=pol["category"], icd10_code=icd[0], diagnosis_description=icd[1],
            urgency=urgency, channel=channel, line_of_business=mem["line_of_business"],
            received_ts=t_recv, intake_ts=t_intake if t_intake <= AS_OF else None,
            first_review_ts=first_review, decision_ts=decision_ts, due_ts=due, sla_hours=sla_h,
            status=status, final_outcome=final_outcome, decision_path=path_out, decided_by_role=decided_by_out,
            reviewer_id=reviewer_out, turnaround_hours=tat, sla_met=sla_met,
            criteria_met_on_first_review=(profile == "clear") if first_review is not None and not withdrawn else None,
            pend_count=pend_count_out, pend_reason=pend_out, denial_reason=denial_out,
            est_cost_usd=round(rng.uniform(*pol["cost"]), 2), requested_units=units, place_of_service=pos,
            gt_profile=profile, gt_criteria="|".join(status_by_c),
        ))

        # ---- clinical note(s) ----
        age = mem["age"]
        sex_word = "female" if mem["sex"] == "F" else "male"
        snippets = []
        for ci, (_label, _txt, met, notmet) in enumerate(pol["criteria"]):
            st = status_by_c[ci]
            if st == "Met":
                snippets.append((ci, fill(rng.choice(met), age)))
            elif st == "Not Met":
                snippets.append((ci, fill(rng.choice(notmet), age)))
        second = None
        met_snips = [s for s in snippets if status_by_c[s[0]] == "Met"]
        if met_snips and rng.random() < 0.30:
            second = rng.choice(met_snips)
            snippets = [s for s in snippets if s is not second]
        note_date = (t_recv - dt.timedelta(days=rng.randint(0, 6))).strftime("%m/%d/%Y")
        hpi = " ".join(s for _, s in snippets) or "See attached documentation."
        body = (
            f"PRIOR AUTHORIZATION CLINICAL SUMMARY - {prov['specialty']}\n"
            f"Date of service: {note_date}    Provider: {prov['provider_name']} ({prov['practice_group']})\n"
            f"Patient: {age}-year-old {sex_word}, MedVault member {mem['member_id']}\n\n"
            f"CHIEF COMPLAINT: {pol['complaint'].capitalize()}.\n\n"
            f"HISTORY / FINDINGS: {hpi}\n\n"
            f"ASSESSMENT: {icd[1]} ({icd[0]}).\n\n"
            f"PLAN: Request prior authorization for {pol['title']} ({pol['cpt']}). "
            + ("Urgent - a delay could seriously jeopardize the patient's health; expedited review requested."
               if urgency == "Expedited" else "Standard review.")
        )
        note_seq += 1
        notes.append(dict(note_id=f"N-{note_seq:07d}", request_id=request_id, note_type="Clinical summary",
                          author=prov["provider_name"], note_date=note_date, note_text=body))
        if second is not None:
            doc_type = {"Advanced Imaging": "Diagnostic report", "Orthopedic Surgery": "Imaging and therapy summary",
                        "Rehabilitation": "PT re-evaluation", "Specialty Pharmacy": "Labs and medication history",
                        "Sleep Medicine": "Sleep study report", "Durable Medical Equipment": "Sleep study report",
                        "Bariatric Surgery": "Program completion letter"}.get(pol["category"], "Supporting document")
            note_seq += 1
            notes.append(dict(note_id=f"N-{note_seq:07d}", request_id=request_id, note_type=doc_type,
                              author=prov["practice_group"], note_date=note_date,
                              note_text=f"{doc_type.upper()}\nPatient: {age}-year-old {sex_word}\n\n{second[1]}"))

n_open = sum(1 for r in rows if r["final_outcome"] == "Open")
print(f"requests={len(rows)} notes={len(notes)} open={n_open}")


# ===========================================================================
# WRITE TABLES
# ===========================================================================
def save(name, pdf, comment):
    if not isinstance(pdf, pd.DataFrame):
        pdf = pd.DataFrame(pdf)
    spark.createDataFrame(pdf).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.`{name}`")
    spark.sql(f"COMMENT ON TABLE {FQ}.`{name}` IS :c", args={"c": comment})
    print(f"  wrote {name}: {len(pdf)} rows")


policy_rows = [dict(policy_id=p["policy_id"], policy_title=p["title"], service_category=p["category"],
                    service_code=p["cpt"], service_description=p["cpt_desc"], reviewing_specialty=p["specialty"],
                    auto_approval_eligible=p["auto"], criteria_count=len(p["criteria"]),
                    effective_date=dt.date(2026, 1, 1), policy_doc_path=f"policy_docs/{p['policy_id']}.md")
               for p in POLICIES]
crit_rows = [dict(criterion_id=f"{p['policy_id']}.C{i + 1}", policy_id=p["policy_id"], criterion_number=i + 1,
                  criterion_label=c[0], criterion_text=c[1], required=True)
             for p in POLICIES for i, c in enumerate(p["criteria"])]

pa_df = pd.DataFrame(rows)
gt = pa_df[["request_id", "gt_profile", "gt_criteria"]]
pa_public = pa_df.drop(columns=["gt_profile", "gt_criteria"])
for col in ["received_ts", "intake_ts", "first_review_ts", "decision_ts", "due_ts"]:
    pa_public[col] = pd.to_datetime(pa_public[col])
for col in ["sla_met", "criteria_met_on_first_review"]:
    pa_public[col] = pa_public[col].astype("boolean")
for col in ["turnaround_hours"]:
    pa_public[col] = pa_public[col].astype("float64")

save("members", members, "MedVault Health Plan members (synthetic, no PHI). One row per member.")
save("providers", [{k: v for k, v in p.items() if k != "quality_profile"} for p in providers],
     "Requesting providers (synthetic, fake NPIs) with practice group and ePA (FHIR API) enablement.")
save("reviewers", reviewers, "Utilization-management reviewers: UM nurses and medical directors (only medical directors issue denials).")
save("medical_policies", policy_rows, "MedVault medical policy library - one row per policy; auto_approval_eligible marks services allowed in the auto-approval lane.")
save("policy_criteria", crit_rows, "Coverage criteria per medical policy. ALL required criteria must be met for approval.")
save("pa_requests", pa_public, (
    "Prior-authorization requests (last 120 days + the open queue as of the snapshot). One row per request. "
    "turnaround_hours = received_ts to decision_ts; SLA = 72h expedited / 168h (7 days) standard per CMS-0057-F. "
    "final_outcome = Open for requests still in the queue."))
save("clinical_notes", notes, "Clinical documentation submitted with each PA request (synthetic notes, no PHI).")
save("_gt_documentation_profile", gt, "Hidden ground truth used only to score the AI review - NOT for Genie or the dashboard.")
save("snapshot_info", [dict(as_of_ts=AS_OF, generated_at=_now, pilot_start_ts=PILOT_START)],
     "Queue snapshot timestamp. Open-queue SLA clocks are computed relative to as_of_ts.")

COLS = {
    "pa_requests": {
        "request_id": "Prior authorization request id",
        "urgency": "Expedited (72h CMS clock) or Standard (7-day / 168h clock)",
        "channel": "Intake channel: Fax, Provider Portal, or ePA (FHIR API)",
        "received_ts": "When the request was received (the SLA clock starts here)",
        "intake_ts": "When the request was indexed into the UM system (fax needs manual indexing)",
        "first_review_ts": "When a UM nurse first opened the case",
        "decision_ts": "Final determination time (null while open)",
        "due_ts": "SLA deadline = received_ts + sla_hours", "sla_hours": "72 for expedited, 168 for standard",
        "status": "Status as of the snapshot: Intake / Indexing, Queued, In Nurse Review, Pended - Info Requested, Medical Director Review, Approved, Denied, Withdrawn",
        "final_outcome": "Approved, Denied, Withdrawn, or Open",
        "decision_path": "How the case was decided: Auto-approved (rules pilot), Nurse approved, Pended then approved, Medical director approved (peer-to-peer), Medical director denied, Withdrawn by provider",
        "decided_by_role": "Automation, UM Nurse, Medical Director or Provider (withdrawn)",
        "turnaround_hours": "Hours from received_ts to decision_ts",
        "sla_met": "True when turnaround_hours <= sla_hours (null for open/withdrawn)",
        "criteria_met_on_first_review": "True when every policy criterion was already documented at the nurse's first review - an auto-approval candidate",
        "pend_reason": "Why the case was pended (missing documentation)",
        "denial_reason": "Adverse determination reason (the policy criterion not met)",
        "est_cost_usd": "Estimated allowed cost of the requested service (USD)",
    },
}
for t, cols in COLS.items():
    for c, txt in cols.items():
        spark.sql(f"ALTER TABLE {FQ}.`{t}` ALTER COLUMN `{c}` COMMENT :c", args={"c": txt})

for t, k in [("members", "member_id"), ("providers", "provider_id"), ("reviewers", "reviewer_id"),
             ("medical_policies", "policy_id"), ("policy_criteria", "criterion_id"),
             ("pa_requests", "request_id"), ("clinical_notes", "note_id")]:
    spark.sql(f"ALTER TABLE {FQ}.`{t}` ALTER COLUMN `{k}` SET NOT NULL")
    try:
        spark.sql(f"ALTER TABLE {FQ}.`{t}` ADD CONSTRAINT `pk_{t}` PRIMARY KEY (`{k}`) RELY")
    except Exception as e:  # re-run: constraint already present
        print(f"  (pk_{t} kept: {str(e)[:80]})")
for t, c, rt, rc in [("pa_requests", "member_id", "members", "member_id"),
                     ("pa_requests", "provider_id", "providers", "provider_id"),
                     ("pa_requests", "policy_id", "medical_policies", "policy_id"),
                     ("policy_criteria", "policy_id", "medical_policies", "policy_id"),
                     ("clinical_notes", "request_id", "pa_requests", "request_id")]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.`{t}` ADD CONSTRAINT `fk_{t}_{c}` FOREIGN KEY (`{c}`) REFERENCES {FQ}.`{rt}` (`{rc}`) RELY")
    except Exception as e:
        print(f"  (fk_{t}_{c} kept: {str(e)[:80]})")

# ===========================================================================
# POLICY DOCUMENTS → UC volume (searched by the Genie agent)
# ===========================================================================
spark.sql(f"CREATE VOLUME IF NOT EXISTS {FQ}.policy_docs COMMENT 'MedVault medical policy documents (synthetic) - documents searched by the Genie agent'")
VOL = f"/Volumes/{CATALOG}/{SCHEMA}/policy_docs"
_EX = dict(side="left", w=3, w2=2, d=10, n=0, m=3, r=5, egfr=24, kl=2, k=70, bmi=30, bmihi=44, sb=1, ess=6,
           ahi=3, spo2=95, cdai=5, sj=1, bmi40=33, v=36, age=70, date="01/01/2026")


def policy_md(p):
    lines = [f"# MedVault Health Plan Medical Policy {p['policy_id']}: {p['title']}", "",
             f"- **Policy number:** {p['policy_id']}", f"- **Service category:** {p['category']}",
             f"- **Codes:** {p['cpt']} ({p['cpt_desc']})", "- **Effective date:** 01/01/2026",
             "- **Applies to:** Medicare Advantage, Medicaid Managed Care and Commercial PPO members",
             "- **Auto-approval lane:** " + ("ELIGIBLE - requests that document every criterion may be approved automatically."
                                             if p["auto"] else "NOT eligible - UM nurse review is required even when every criterion is met."),
             "", "## 1. Purpose", "",
             f"This policy defines when MedVault considers {p['title']} medically necessary. Decisions follow CMS-0057-F "
             "timeframes: 72 hours for expedited requests and 7 calendar days for standard requests.",
             "", "## 2. Coverage criteria", "",
             f"{p['title']} is considered medically necessary when ALL of the following criteria are met:", ""]
    for i, c in enumerate(p["criteria"]):
        lines.append(f"- **{p['policy_id']}.C{i + 1} - {c[0]}:** {c[1]}")
    lines += ["", "## 3. Documentation requirements", "",
              "The submitted clinical documentation must explicitly state the evidence for each criterion (dates, durations, "
              "test results, exam findings). A criterion that is not documented is treated as unmet and the request is pended "
              "with a request to the provider for that specific item.", "",
              "## 4. Review process", "",
              "- A UM nurse reviewer evaluates the documentation against every criterion.",
              "- When all criteria are met the nurse (or, for auto-approval-eligible services, the automated rule) approves.",
              "- When documentation is missing the request is pended and the provider is asked for the specific item.",
              "- Only a Medical Director may issue an adverse determination (denial). Providers may request a peer-to-peer discussion.",
              "- Automation may approve but must NEVER deny or pend.", "",
              "## 5. Not medically necessary - examples", ""]
    for i, c in enumerate(p["criteria"]):
        lines.append(f"- {p['policy_id']}.C{i + 1} not met: {c[3][0].format(**_EX)}")
    lines += ["", "## 6. References", "", "- CMS Interoperability and Prior Authorization Final Rule (CMS-0057-F)",
              "- MedVault Utilization Management Program Description 2026 (MV-UM-000)", ""]
    return "\n".join(lines)


UM_DOC = """# MedVault Utilization Management Program Description 2026 (MV-UM-000)

## Turnaround standards
- Expedited (urgent) requests: decision within 72 hours of receipt.
- Standard requests: decision within 7 calendar days (168 hours) of receipt.
- Approval rate, denial rate and average turnaround are publicly reported per CMS-0057-F.

## Auto-approval lane
A request may be approved automatically when (1) the medical policy is marked auto-approval eligible,
(2) the AI criteria review marks EVERY required criterion as Met with a quoted piece of evidence, and
(3) the review confidence is at least 0.85. Automation never denies or pends; everything else is routed to a UM nurse.

## Pend (request for information)
When a criterion is not documented the nurse pends the case and sends the provider a request naming the specific missing item.

## Adverse determinations
Only a Medical Director may deny. The denial letter must cite the specific policy criterion that was not met
and offer a peer-to-peer discussion.

## Gold carding
Practice groups with 90% or higher first-pass approval over the prior 6 months may be exempted from prior authorization
for selected services.
"""

try:
    from databricks.sdk import WorkspaceClient
    w = WorkspaceClient() if ON_DATABRICKS else WorkspaceClient(profile=os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT"))
    for p in POLICIES:
        w.files.upload(f"{VOL}/{p['policy_id']}.md", io.BytesIO(policy_md(p).encode()), overwrite=True)
    w.files.upload(f"{VOL}/MV-UM-000.md", io.BytesIO(UM_DOC.encode()), overwrite=True)
    print(f"  uploaded {len(POLICIES) + 1} policy documents to {VOL}")
except Exception as e:  # best-effort — tables are the critical path
    print(f"  WARN policy doc upload failed: {e}")

print("== done ==")
