#!/usr/bin/env python
"""
Calder Pine Private Wealth — Advisor Morning Book: self-contained synthetic data + gold build.

STORY — "Money is moving. Is it moving to us?"
Calder Pine Private Wealth (fictional US wealth manager, 36 advisors, 6 offices, ~5,400 client
households, ~$9B AUM) had three rate cuts this summer (Fed funds 4.50% -> 3.75%, Jun-Sep 2026).
Every one of them created "money in motion":
  * CDs bought at 5%+ in 2024-25 are maturing into a 3.55% renewal rate,
  * sweep cash keeps piling up at 0.25% while online banks (the fictional "Brightline Direct")
    advertise 4.00%,
  * 2023-vintage mortgages at 7%+ are now 0.75pt+ above the 5.90% 30-year rate (refi window),
  * and life events — a death, an inheritance, a retirement, a business sale — reset the relationship.

Planted signals the demo uncovers:
  1. MONEY IN MOTION — ~$0.5B of client assets have a "next 60 days" trigger (CD maturities,
     idle sweep cash, inheritances, 401(k) rollovers); gold_household_signals.
  2. AUM AT RISK — after a bereavement / inheritance, households the advisor contacted within
     30 days kept ~95% of their assets; the ones nobody called lost ~40% within 6 months
     (external transfers to heirs' advisors / Brightline). gold_life_event_retention.
  3. TARGETED BEATS GENERIC — signal-matched next-best actions convert ~4x the default
     "annual portfolio review" (nba_history / gold_nba_conversion).
  4. PROPENSITY != SUITABILITY — historically, advisors sold buffered structured notes to
     inheritance recipients and it "converted" — the propensity model learns that. But most of
     those clients were conservative or recently bereaved: complex-product complaints come
     almost entirely from that group. The app's suitability engine blocks those actions.

Hero households (advisor Elena Marsh, Denver — ADV-007):
  HH-10042 Margaret Castellano (67) — widowed May 2026, $750K life insurance + $1.9M inherited
           IRA/brokerage, $812K idle in sweep, a $260K CD at 5.10% maturing 2026-10-09, and a
           $150K transfer to Brightline Direct in August. Nobody has called since June.
  HH-10077 Raj & Priya Mehta (44) — $780K mortgage at 7.25% (refi window), under contract on a
           lake house (needs $400K by mid-November), 38% of the portfolio in employer stock ARXT.
  HH-10113 Tom Whitaker (62) — retired Aug 31 from Ridgeline Aerospace, $640K 401(k) held away.

Tables written to <catalog>.<schema>:
  advisors, households, accounts, liabilities, life_events, cash_flows_monthly, advisor_notes,
  market_rates, nba_actions, suitability_rules, nba_history, advisor_decisions (empty write-back),
  gold_household_signals, gold_flows_monthly, gold_nba_conversion, gold_life_event_retention.
Downstream tasks: src/ai/note_insights.sql (AI Functions), src/ml/train_nba_model.py (UC model +
scores + suitability -> nba_recommendations, household_opportunities).

Runs two ways (plain .py, NOT a notebook):
  * DAB spark_python_task — ambient SparkSession; `--catalog <c> --schema <s>`.
  * Locally — Databricks Connect serverless (Python 3.12 venv):
      DATABRICKS_CONFIG_PROFILE=<your-profile> python generate_data.py --catalog financial_services \
          --schema wealth_advisor_copilot
"""
import argparse
import datetime as dt
import os

import numpy as np
import pandas as pd

_p = argparse.ArgumentParser(add_help=False)
_p.add_argument("--catalog")
_p.add_argument("--schema")
_cli, _ = _p.parse_known_args()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "financial_services")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "wealth_advisor_copilot")
FQ = f"`{CATALOG}`.`{SCHEMA}`"

rng = np.random.default_rng(20260928)
AS_OF = dt.date(2026, 9, 28)
MONTHS = pd.date_range("2025-10-01", "2026-09-01", freq="MS")
NM = len(MONTHS)
HIST_START = dt.date(2025, 4, 1)


def d(s):
    return dt.date.fromisoformat(s)


def rand_date(a, b):
    return a + dt.timedelta(days=int(rng.integers(0, max(1, (b - a).days))))


def month_idx(x):
    return (x.year - 2025) * 12 + x.month - 10


# ---------------------------------------------------------------------------
# Market rates — three cuts Jun / Jul / Sep 2026
# ---------------------------------------------------------------------------
FED = [4.50, 4.50, 4.50, 4.50, 4.50, 4.50, 4.50, 4.50, 4.25, 4.00, 4.00, 3.75]
rates = pd.DataFrame({
    "month": [m.date() for m in MONTHS],
    "fed_funds_pct": FED,
    "cd_12m_renewal_pct": [round(f + 0.10 - (0.10 if i >= 8 else 0) - (0.15 if i >= 11 else 0), 2) for i, f in enumerate(FED)],
    "treasury_1y_pct": [round(f - 0.20, 2) for f in FED],
    "govt_mmf_yield_pct": [round(f - 0.15, 2) for f in FED],
    "mortgage_30y_pct": [6.95, 6.90, 6.88, 6.85, 6.80, 6.78, 6.70, 6.62, 6.35, 6.10, 6.02, 5.90],
    "sweep_rate_pct": [0.25] * NM,
    "competitor_hysa_pct": [4.25, 4.25, 4.25, 4.25, 4.25, 4.25, 4.25, 4.20, 4.10, 4.05, 4.00, 4.00],
})
rates.loc[NM - 1, "cd_12m_renewal_pct"] = 3.55
MORTGAGE_NOW = 5.90

# ---------------------------------------------------------------------------
# Advisors — 36 across 6 offices
# ---------------------------------------------------------------------------
OFFICES = ["Denver", "Boston", "New York", "Chicago", "Austin", "San Francisco"]
FIRST = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William",
         "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Karen", "Charles", "Sarah", "Daniel", "Nancy",
         "Matthew", "Lisa", "Anthony", "Betty", "Mark", "Sandra", "Steven", "Ashley", "Paul", "Emily", "Andrew", "Donna",
         "Joshua", "Michelle", "Kenneth", "Carol", "Kevin", "Amanda", "Brian", "Melissa", "George", "Deborah", "Wei",
         "Priya", "Carlos", "Sofia", "Hiroshi", "Aisha", "Omar", "Elena", "Luis", "Grace", "Nathan", "Hannah", "Samuel",
         "Olivia", "Isaac", "Maya", "Ethan", "Chloe", "Raj", "Ana", "Kwame", "Mei", "Diego", "Fatima", "Ivan", "Leah"]
LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez",
        "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez",
        "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen",
        "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall",
        "Rivera", "Campbell", "Mitchell", "Carter", "Roberts", "Chen", "Patel", "Kim", "Okafor", "Sullivan", "Bennett",
        "Foster", "Hayes", "Brooks", "Price", "Reed", "Coleman", "Murphy", "Ward", "Hughes", "Fischer", "Novak", "Russo"]
ADV_NAMES = ["Elena Marsh", "Marcus Bell", "Hannah Ortiz", "Jonah Whitfield", "Priscilla Nakamura", "Derek Coleman",
             "Sophie Lindqvist", "Anthony Rizzo", "Grace Adeyemi", "Owen Pritchard", "Lucia Ferrante", "Samuel Kerr",
             "Natalie Brooks", "Victor Huang", "Rachel Stein", "Isaiah Monroe", "Claire Dubois", "Mateo Alvarez",
             "Julia Wexler", "Tobias Grant", "Amara Osei", "Henry Caldwell", "Nina Petrova", "Ravi Menon",
             "Bethany Cole", "Gabriel Santos", "Ingrid Holm", "Jamal Carter", "Leah Rosen", "Colin Mahoney",
             "Daniela Cruz", "Peter Vance", "Yuki Tanaka", "Frances O'Neil", "Dominic Shaw", "Alicia Park"]
advisors = []
for i, name in enumerate(ADV_NAMES):
    aid = "ADV-007" if i == 0 else f"ADV-{i + 100:03d}"
    advisors.append({
        "advisor_id": aid, "advisor_name": name, "office": "Denver" if i == 0 else OFFICES[i % 6],
        "title": "Senior Wealth Advisor, CFP" if i % 3 == 0 else "Wealth Advisor",
        "years_experience": int(rng.integers(4, 28)) if i else 14,
        "team": f"{('Denver' if i == 0 else OFFICES[i % 6])} Private Client",
    })
advisors = pd.DataFrame(advisors)
ADV_IDS = advisors.advisor_id.tolist()
ADV_OFFICE = dict(zip(advisors.advisor_id, advisors.office))

# ---------------------------------------------------------------------------
# Households
# ---------------------------------------------------------------------------
N_HH = 5400
RISK = ["Conservative", "Moderately Conservative", "Moderate", "Growth", "Aggressive"]
EXP = ["Limited", "Moderate", "Extensive"]
STATES = {"Denver": "CO", "Boston": "MA", "New York": "NY", "Chicago": "IL", "Austin": "TX", "San Francisco": "CA"}
hh = []
for i in range(N_HH):
    hid = f"HH-{10001 + i}"
    adv = ADV_IDS[i % len(ADV_IDS)]
    age = int(np.clip(rng.normal(61, 12), 30, 92))
    aum = float(np.clip(rng.lognormal(np.log(950_000), 0.85), 150_000, 60_000_000))
    seg = "Emerging HNW" if aum < 1e6 else "HNW" if aum < 5e6 else "Very HNW" if aum < 25e6 else "UHNW"
    rp = int(np.clip(round(rng.normal(3.6 - (age - 55) * 0.045, 0.9)), 1, 5))
    exp = int(np.clip(round(rng.normal(1.1 + (aum > 2e6) * 0.5 + (age > 50) * 0.2, 0.6)), 0, 2))
    last = LAST[int(rng.integers(len(LAST)))]
    first = FIRST[int(rng.integers(len(FIRST)))]
    hh.append({
        "household_id": hid, "household_name": f"{last} Household", "primary_first_name": first,
        "primary_last_name": last, "primary_age": age, "advisor_id": adv, "office": ADV_OFFICE[adv],
        "state": STATES[ADV_OFFICE[adv]], "segment": seg, "aum": aum,
        "risk_profile": RISK[rp - 1], "risk_score": rp,
        "time_horizon_years": int(np.clip(rng.normal(max(3, 88 - age) * 0.45, 3), 2, 30)),
        "liquidity_need": ["Low", "Medium", "High"][int(rng.choice(3, p=[0.55, 0.35, 0.10]))],
        "investment_experience": EXP[exp],
        "marital_status": str(rng.choice(["Married", "Single", "Widowed", "Divorced"], p=[0.62, 0.14, 0.12, 0.12])),
        "dependents": int(rng.choice(4, p=[0.5, 0.2, 0.2, 0.1])),
        "annual_income": float(round(np.clip(rng.lognormal(np.log(260_000), 0.6), 60_000, 5e6), -3)),
        "tenure_years": int(np.clip(rng.gamma(2.2, 4.5), 1, 35)),
        "trusted_contact_on_file": bool(rng.random() < 0.58),
        "vulnerable_client": False, "vulnerable_reason": None,
        "concentrated_symbol": None, "concentrated_pct": 0.0,
        "held_away_401k": 0.0,
    })
hh = pd.DataFrame(hh)
hh.loc[hh.primary_age >= 80, "vulnerable_client"] = True
hh.loc[hh.primary_age >= 80, "vulnerable_reason"] = "Age 80+ (specified adult, FINRA 2165)"
conc = rng.random(N_HH) < 0.06
hh.loc[conc, "concentrated_symbol"] = rng.choice(["ARXT", "NVTR", "HLXM", "QSTO", "BRKN", "MDRX"], conc.sum())
hh.loc[conc, "concentrated_pct"] = np.round(rng.uniform(0.22, 0.55, conc.sum()), 3)


def set_hh(hid, **kw):
    ix = hh.index[hh.household_id == hid][0]
    for k, v in kw.items():
        hh.at[ix, k] = v


ELENA = "ADV-007"
set_hh("HH-10042", household_name="Castellano Household", primary_first_name="Margaret", primary_last_name="Castellano",
       primary_age=67, advisor_id=ELENA, office="Denver", state="CO", segment="HNW", aum=2_940_000.0,
       risk_profile="Moderately Conservative", risk_score=2, time_horizon_years=12, liquidity_need="Medium",
       investment_experience="Moderate", marital_status="Widowed", dependents=0, annual_income=96_000.0, tenure_years=11,
       trusted_contact_on_file=True, vulnerable_client=True, vulnerable_reason="Recent bereavement (spouse, May 2026)")
set_hh("HH-10077", household_name="Mehta Household", primary_first_name="Raj", primary_last_name="Mehta",
       primary_age=44, advisor_id=ELENA, office="Denver", state="CO", segment="HNW", aum=2_120_000.0,
       risk_profile="Growth", risk_score=4, time_horizon_years=20, liquidity_need="Low", investment_experience="Extensive",
       marital_status="Married", dependents=2, annual_income=540_000.0, tenure_years=6, trusted_contact_on_file=True,
       concentrated_symbol="ARXT", concentrated_pct=0.38)
set_hh("HH-10113", household_name="Whitaker Household", primary_first_name="Tom", primary_last_name="Whitaker",
       primary_age=62, advisor_id=ELENA, office="Denver", state="CO", segment="HNW", aum=1_380_000.0,
       risk_profile="Moderate", risk_score=3, time_horizon_years=25, liquidity_need="Medium", investment_experience="Moderate",
       marital_status="Married", dependents=0, annual_income=210_000.0, tenure_years=9, trusted_contact_on_file=True,
       held_away_401k=640_000.0)
HEROES = {"HH-10042", "HH-10077", "HH-10113"}

# ---------------------------------------------------------------------------
# Life events — 18 months (Apr 2025 .. Sep 2026)
# ---------------------------------------------------------------------------
EV_RATE = {  # per household over 18 months
    "Death of spouse": 0.022, "Inheritance received": 0.030, "Retirement": 0.045, "Business sale": 0.010,
    "Job change": 0.050, "Home purchase planned": 0.035, "Child starting college": 0.040, "New grandchild": 0.030,
    "Divorce": 0.012,
}
events = []
eid = 1
for r in hh.itertuples():
    if r.household_id in HEROES:
        continue
    for et, p in EV_RATE.items():
        p_adj = p * (2.2 if et in ("Death of spouse", "Inheritance received") and r.primary_age > 65 else 1.0)
        p_adj *= (0.2 if et == "Retirement" and r.primary_age < 52 else 1.0)
        # recent months are busier (rate-cut year, boomer transfer) — keeps the "last 90 days" list meaty
        if rng.random() < p_adj:
            edate = rand_date(HIST_START, AS_OF) if rng.random() < 0.6 else rand_date(d("2026-06-15"), AS_OF)
            amt = {"Death of spouse": 0.0, "Inheritance received": float(np.clip(rng.lognormal(np.log(600_000), 0.8), 80_000, 8e6)),
                   "Retirement": float(np.clip(rng.lognormal(np.log(520_000), 0.6), 100_000, 4e6)),
                   "Business sale": float(np.clip(rng.lognormal(np.log(3_000_000), 0.7), 500_000, 3e7)),
                   "Job change": float(np.clip(rng.lognormal(np.log(310_000), 0.7), 40_000, 2e6)),
                   "Home purchase planned": float(np.clip(rng.lognormal(np.log(350_000), 0.5), 80_000, 2e6)),
                   "Child starting college": 60_000.0, "New grandchild": 0.0, "Divorce": 0.0}[et]
            src = str(rng.choice(["Advisor note", "Client-reported", "Account activity", "Public record"], p=[0.38, 0.30, 0.22, 0.10]))
            events.append([f"LE-{eid:05d}", r.household_id, et, edate, round(amt, -3), src])
            eid += 1
hero_events = [
    ("HH-10042", "Death of spouse", "2026-05-22", 0.0, "Public record", "Robert Castellano (spouse) passed away."),
    ("HH-10042", "Inheritance received", "2026-07-15", 1_900_000.0, "Account activity", "Spousal IRA rollover + transfer-on-death brokerage from Robert's accounts; $750K life insurance deposited to sweep 2026-07-02."),
    ("HH-10077", "Home purchase planned", "2026-09-02", 400_000.0, "Advisor note", "Under contract on a lake house in Grand Lake, CO; ~$400K down payment due mid-November."),
    ("HH-10113", "Retirement", "2026-08-31", 640_000.0, "Client-reported", "Retired from Ridgeline Aerospace; $640K 401(k) still with the plan provider."),
]
for h_, et, ds, amt, src, _ in hero_events:
    events.append([f"LE-{eid:05d}", h_, et, d(ds), amt, src])
    eid += 1
ev = pd.DataFrame(events, columns=["event_id", "household_id", "event_type", "event_date", "amount_estimate", "source"])
ev["detail"] = None
for h_, et, ds, amt, src, det in hero_events:
    ev.loc[(ev.household_id == h_) & (ev.event_type == et), "detail"] = det
# widowed households get a bereavement flag for 12 months
bereaved = ev[(ev.event_type == "Death of spouse") & (ev.event_date >= AS_OF - dt.timedelta(days=365))].household_id
for hid in bereaved:
    ix = hh.index[hh.household_id == hid][0]
    hh.at[ix, "vulnerable_client"] = True
    hh.at[ix, "vulnerable_reason"] = "Recent bereavement (spouse)" if hid != "HH-10042" else hh.at[ix, "vulnerable_reason"]
    hh.at[ix, "marital_status"] = "Widowed"
# job change / retirement -> held-away 401(k)
for r in ev[ev.event_type.isin(["Job change", "Retirement"])].itertuples():
    if r.household_id in HEROES:
        continue
    if rng.random() < 0.75:
        hh.loc[hh.household_id == r.household_id, "held_away_401k"] = r.amount_estimate

# ---------------------------------------------------------------------------
# Advisor contact log (drives "contacted within 30 days" -> retention)
# ---------------------------------------------------------------------------
HH_ADV = dict(zip(hh.household_id, hh.advisor_id))
AGE = dict(zip(hh.household_id, hh.primary_age))
contact_dates = {h_: [] for h_ in hh.household_id}
for h_ in hh.household_id:
    n = int(rng.poisson(5.5))  # ~ every 3 months
    for _ in range(n):
        contact_dates[h_].append(rand_date(HIST_START, AS_OF))
# life-event follow-up: advisor reaches out within 30 days ~45% of the time
ev["advisor_contacted_within_30d"] = False
ev["first_contact_date"] = None
for i, r in ev.iterrows():
    if r.household_id in HEROES:
        continue
    if rng.random() < 0.45:
        cd = r.event_date + dt.timedelta(days=int(rng.integers(2, 29)))
        if cd <= AS_OF:
            contact_dates[r.household_id].append(cd)
            ev.at[i, "advisor_contacted_within_30d"] = True
            ev.at[i, "first_contact_date"] = cd
# hero contact history
contact_dates["HH-10042"] = [d("2025-11-18"), d("2026-02-24"), d("2026-06-10")]
contact_dates["HH-10077"] = [d("2026-01-20"), d("2026-05-12"), d("2026-09-02")]
contact_dates["HH-10113"] = [d("2026-03-03"), d("2026-06-18"), d("2026-09-10")]
m_ev = ev.household_id == "HH-10042"
ev.loc[m_ev & (ev.event_type == "Death of spouse"), ["advisor_contacted_within_30d", "first_contact_date"]] = [True, d("2026-06-10")]
ev.loc[m_ev & (ev.event_type == "Inheritance received"), ["advisor_contacted_within_30d", "first_contact_date"]] = [False, None]
ev.loc[ev.household_id == "HH-10077", ["advisor_contacted_within_30d", "first_contact_date"]] = [True, d("2026-09-02")]
ev.loc[ev.household_id == "HH-10113", ["advisor_contacted_within_30d", "first_contact_date"]] = [True, d("2026-09-10")]
ev["first_contact_date"] = pd.to_datetime(ev["first_contact_date"]).dt.date
ev["event_date"] = pd.to_datetime(ev["event_date"]).dt.date

# ---------------------------------------------------------------------------
# Monthly cash flows + AUM (Oct 2025 .. Sep 2026) with planted outflows
# ---------------------------------------------------------------------------
MKT = [0.012, 0.009, -0.004, 0.015, 0.006, -0.011, 0.018, 0.010, 0.007, 0.013, -0.006, 0.011]
ev_by_hh = ev.groupby("household_id")
flows = []
final_cash = {}
aum_start = {}
for r in hh.itertuples():
    h_ = r.household_id
    aum = r.aum * float(rng.uniform(0.88, 0.97))  # grow into today's AUM
    cash_pct = float(np.clip(rng.normal(0.045, 0.03), 0.005, 0.20))
    cash = aum * cash_pct
    evs = ev_by_hh.get_group(h_) if h_ in ev_by_hh.groups else None
    idle_drift = 0.0
    last_contact = max([c for c in contact_dates[h_]], default=HIST_START)
    for mi, m in enumerate(MONTHS):
        m0 = m.date()
        m1 = (m + pd.offsets.MonthBegin(1)).date()
        dep = float(max(0, rng.normal(r.annual_income / 12 * 0.12, r.annual_income / 60)))
        wd = float(max(0, rng.normal(aum * 0.0025, aum * 0.001)))
        out_ext, in_ext, out_reason = 0.0, 0.0, None
        if evs is not None:
            for e in evs.itertuples():
                if e.event_type in ("Inheritance received", "Business sale", "Retirement") and m0 <= e.event_date < m1 and h_ not in HEROES:
                    # the new money lands in sweep cash (money in motion)
                    land = e.amount_estimate * (0.8 if e.event_type != "Retirement" else 0.25)
                    in_ext += land
                    cash += land
                # AUM AT RISK: bereavement / inheritance w/o a timely call -> assets walk (2-6 months later)
                if e.event_type in ("Death of spouse", "Inheritance received") and h_ not in HEROES:
                    months_after = (m0.year - e.event_date.year) * 12 + m0.month - e.event_date.month
                    if 2 <= months_after <= 6:
                        p_walk = 0.08 if e.advisor_contacted_within_30d else 0.40
                        if rng.random() < p_walk / 3:
                            frac = float(rng.uniform(0.15, 0.55)) if not e.advisor_contacted_within_30d else float(rng.uniform(0.05, 0.15))
                            out_ext += aum * frac
                            out_reason = "Transfer to heir's advisor" if e.event_type == "Death of spouse" else "Transfer to another firm"
        # idle-cash leakage after the rate cuts: large sweep balances, no recent contact -> Brightline
        if mi >= 8 and cash > 250_000 and (m0 - last_contact).days > 90 and h_ not in HEROES and rng.random() < 0.10:
            amt = cash * float(rng.uniform(0.2, 0.5))
            out_ext += amt
            out_reason = out_reason or "Cash to online bank (Brightline Direct)"
        # rate cuts -> idle cash builds (CD maturities roll to sweep, clients hesitate)
        if mi >= 8:
            idle_drift = aum * float(rng.uniform(0.000, 0.012))
            cash += idle_drift
        mkt = (aum - cash) * MKT[mi] * float(rng.normal(1, 0.25))
        aum = max(50_000.0, aum + dep - wd + in_ext - out_ext + mkt)
        cash = float(np.clip(cash + dep * 0.5 - wd - min(out_ext, cash * 0.7), aum * 0.004, aum * 0.9))
        flows.append([h_, m0, round(dep, 2), round(wd, 2), round(in_ext, 2), round(out_ext, 2), out_reason,
                      round(mkt, 2), round(aum, 2), round(cash, 2)])
    aum_start[h_] = aum
    final_cash[h_] = cash
flows = pd.DataFrame(flows, columns=["household_id", "month", "deposits", "withdrawals", "external_transfers_in",
                                     "external_transfers_out", "outflow_reason", "market_change", "aum_end", "sweep_cash_end"])

# Hero flows: Margaret — life insurance to sweep in July, IRA/brokerage in, $150K to Brightline in August
def hero_flow(hid, month, **kw):
    ix = flows.index[(flows.household_id == hid) & (flows.month == d(month))][0]
    for k, v in kw.items():
        flows.at[ix, k] = v


mc = flows.household_id == "HH-10042"
base = [1_020_000, 1_026_000, 1_024_000, 1_031_000, 1_035_000, 1_029_000, 1_036_000, 1_041_000, 1_044_000,
        2_951_000, 2_812_000, 2_940_000]
cashp = [38_000, 39_000, 37_000, 40_000, 41_000, 39_000, 40_000, 42_000, 43_000, 924_000, 794_000, 812_000]
for i, m in enumerate(MONTHS):
    hero_flow("HH-10042", str(m.date()), aum_end=float(base[i]), sweep_cash_end=float(cashp[i]),
              external_transfers_in=(2_650_000.0 if i == 9 else 0.0),
              external_transfers_out=(150_000.0 if i == 10 else 0.0),
              outflow_reason=("Cash to online bank (Brightline Direct)" if i == 10 else None))
for hid, total, cash in [("HH-10077", 2_120_000, 96_000), ("HH-10113", 1_380_000, 71_000)]:
    for i, m in enumerate(MONTHS):
        hero_flow(hid, str(m.date()), aum_end=float(round(total * (0.93 + 0.07 * i / 11), -3)),
                  sweep_cash_end=float(cash), external_transfers_out=0.0, outflow_reason=None)
final = flows[flows.month == MONTHS[-1].date()].set_index("household_id")
hh["aum"] = hh.household_id.map(final.aum_end).round(-3)
hh["segment"] = np.where(hh.aum < 1e6, "Emerging HNW", np.where(hh.aum < 5e6, "HNW", np.where(hh.aum < 25e6, "Very HNW", "UHNW")))
hh["sweep_cash"] = hh.household_id.map(final.sweep_cash_end).round(-2)
hh["cash_pct"] = (hh.sweep_cash / hh.aum).round(4)
last_c = {h_: max(v) if v else None for h_, v in contact_dates.items()}
hh["last_contact_date"] = hh.household_id.map(last_c)
hh["relationship_start"] = [AS_OF - dt.timedelta(days=int(t * 365 + rng.integers(0, 300))) for t in hh.tenure_years]

# ---------------------------------------------------------------------------
# Accounts (balances reconcile to AUM) + CDs + held-away 401(k)
# ---------------------------------------------------------------------------
acc = []
aid = 1
for r in hh.itertuples():
    invest = r.aum - r.sweep_cash
    parts = []
    if r.household_id == "HH-10042":
        parts = [("Individual Brokerage", 612_000.0, None, None), ("Inherited brokerage (TOD)", 780_000.0, None, None),
                 ("Traditional IRA (spousal rollover)", 1_120_000.0, None, None),
                 ("Bank CD 12-month", 260_000.0, 5.10, d("2026-10-09"))]
        invest = sum(p[1] for p in parts)
    elif r.household_id == "HH-10077":
        parts = [("Joint Brokerage", 1_310_000.0, None, None), ("Traditional IRA", 410_000.0, None, None),
                 ("Roth IRA", 144_000.0, None, None), ("529 Plan", 160_000.0, None, None)]
    elif r.household_id == "HH-10113":
        parts = [("Joint Brokerage", 702_000.0, None, None), ("Traditional IRA", 490_000.0, None, None),
                 ("Bank CD 12-month", 117_000.0, 4.85, d("2027-02-14"))]
    else:
        has_cd = rng.random() < 0.22
        cd_amt = float(round(min(invest * rng.uniform(0.08, 0.25), 2_000_000), -3)) if has_cd else 0.0
        rest = invest - cd_amt
        w = rng.dirichlet([3, 2, 0.8, 0.6 if r.aum > 2e6 else 0.05])
        for name, x in zip(["Individual Brokerage", "Traditional IRA", "Roth IRA", "Revocable Trust"], w):
            if x * rest > 5_000:
                parts.append((name, float(round(x * rest, -2)), None, None))
        if has_cd:
            # maturities cluster in the next 60 days (bought during the 2025 rate peak)
            mat = rand_date(AS_OF + dt.timedelta(days=3), AS_OF + dt.timedelta(days=60)) if rng.random() < 0.45 \
                else rand_date(AS_OF + dt.timedelta(days=61), AS_OF + dt.timedelta(days=365))
            parts.append(("Bank CD 12-month", cd_amt, float(round(rng.uniform(4.6, 5.35), 2)), mat))
    for name, bal, rate, mat in parts:
        acc.append([f"AC-{aid:06d}", r.household_id, name, "Calder Pine", bal, rate, mat])
        aid += 1
    acc.append([f"AC-{aid:06d}", r.household_id, "Cash Sweep (bank deposit)", "Calder Pine", float(r.sweep_cash), 0.25, None])
    aid += 1
    if r.held_away_401k > 0:
        acc.append([f"AC-{aid:06d}", r.household_id, "Employer 401(k) — held away",
                    "Ridgeline Aerospace 401(k) Plan" if r.household_id == "HH-10113" else "Former employer plan",
                    float(r.held_away_401k), None, None])
        aid += 1
accounts = pd.DataFrame(acc, columns=["account_id", "household_id", "account_type", "custodian", "balance", "rate_pct", "maturity_date"])
# household AUM = assets at Calder Pine (held-away excluded)
aum_real = accounts[accounts.custodian == "Calder Pine"].groupby("household_id").balance.sum()
hh["aum"] = hh.household_id.map(aum_real).round(-2)
hh.loc[hh.household_id == "HH-10042", "sweep_cash"] = 812_000.0
flows.loc[(flows.month == MONTHS[-1].date()), "aum_end"] = flows.loc[(flows.month == MONTHS[-1].date()), "household_id"].map(hh.set_index("household_id").aum)
hh["cash_pct"] = (hh.sweep_cash / hh.aum).round(4)
hh["segment"] = np.where(hh.aum < 1e6, "Emerging HNW", np.where(hh.aum < 5e6, "HNW", np.where(hh.aum < 25e6, "Very HNW", "UHNW")))
hh["net_worth_estimate"] = (hh.aum * rng.uniform(1.3, 2.2, N_HH) + hh.held_away_401k).round(-3)

# ---------------------------------------------------------------------------
# Liabilities — mortgages (2023 vintage = refi window), HELOCs
# ---------------------------------------------------------------------------
liab = []
lid = 1
for r in hh.itertuples():
    if r.household_id == "HH-10077":
        liab.append([f"LN-{lid:05d}", r.household_id, "Mortgage (30-yr fixed)", "Summit Home Loans", 780_000.0, 7.25,
                     d("2023-10-16"), 5_457.0, 1_350_000.0]); lid += 1
        continue
    if r.household_id in HEROES or r.primary_age > 75 or rng.random() > 0.42:
        continue
    vint = int(rng.choice([2019, 2020, 2021, 2022, 2023, 2024, 2025], p=[0.12, 0.16, 0.2, 0.14, 0.2, 0.12, 0.06]))
    rate = {2019: 3.9, 2020: 3.0, 2021: 2.9, 2022: 5.4, 2023: 7.0, 2024: 6.8, 2025: 6.7}[vint] + float(rng.normal(0, 0.25))
    bal = float(round(np.clip(rng.lognormal(np.log(520_000), 0.5), 120_000, 3_000_000), -3))
    pv = round(bal * rng.uniform(1.4, 2.6), -3)
    pmt = bal * (rate / 1200) / (1 - (1 + rate / 1200) ** -360)
    lender = "Calder Pine Bank" if rng.random() < 0.18 else str(rng.choice(["Summit Home Loans", "Keystone Mortgage", "Pacific Crest Lending"]))
    liab.append([f"LN-{lid:05d}", r.household_id, "Mortgage (30-yr fixed)", lender, bal, round(rate, 2),
                 rand_date(dt.date(vint, 1, 1), dt.date(vint, 12, 28)), round(pmt), pv]); lid += 1
liabilities = pd.DataFrame(liab, columns=["liability_id", "household_id", "liability_type", "lender", "balance", "rate_pct",
                                          "origination_date", "monthly_payment", "property_value"])

# ---------------------------------------------------------------------------
# NBA action catalog + suitability rules (the deterministic guardrail)
# ---------------------------------------------------------------------------
actions = pd.DataFrame([
    # code, name, category, complexity, min_risk, min_horizon, illiquid, revenue_bps, basis, disclosures
    ["CD-LADDER", "Treasury / CD ladder for maturing CDs", "Invest", "Simple", 1, 0, False, 15, "maturing CD + 30% idle cash", "D-CD, D-TSY"],
    ["CASH-MMF", "Move idle sweep cash to a government money market fund", "Invest", "Simple", 1, 0, False, 10, "30% of idle cash", "D-MMF"],
    ["MANAGED-PORTFOLIO", "Invest in a diversified managed portfolio", "Invest", "Moderate", 2, 3, False, 95, "60% of idle cash", "D-ADV, D-FEE"],
    ["STRUCTURED-NOTE", "Buffered structured note (5-yr, S&P 500 linked)", "Invest", "Complex", 4, 5, True, 150, "50% of idle cash", "D-SN"],
    ["PRIVATE-CREDIT", "Private credit interval fund", "Invest", "Complex", 4, 5, True, 125, "30% of idle cash", "D-PC"],
    ["DIRECT-INDEX", "Direct indexing to diversify a concentrated position", "Invest", "Moderate", 3, 5, False, 40, "concentrated position value", "D-DI"],
    ["IRA-ROLLOVER", "Roll a held-away 401(k) into a Calder Pine IRA", "Invest", "Moderate", 1, 0, False, 85, "held-away 401(k)", "D-ROLL"],
    ["MORTGAGE-REFI", "Refinance the mortgage with Calder Pine Bank", "Lend", "Simple", 1, 0, False, 60, "mortgage balance", "D-REFI"],
    ["SBLOC", "Securities-based line of credit (instead of selling)", "Lend", "Complex", 3, 2, False, 250, "planned purchase / 30% of taxable", "D-SBLOC"],
    ["ESTATE-REVIEW", "Estate, beneficiary & titling review with the trust team", "Plan", "Simple", 1, 0, False, 90, "AUM retained (at risk)", "D-CRS"],
    ["EDU-529", "Open / fund a 529 education plan", "Plan", "Simple", 1, 0, False, 50, "$60K first-year funding", "D-529"],
    ["ANNUAL-REVIEW", "Annual portfolio review (generic)", "Plan", "Simple", 1, 0, False, 5, "5% of AUM", "D-CRS"],
], columns=["action_code", "action_name", "category", "complexity", "min_risk_score", "min_horizon_years", "illiquid",
            "revenue_bps", "assets_basis", "required_disclosures"])

rules = pd.DataFrame([
    ["S1", "Risk tolerance", "Client risk score must be >= the product's minimum risk score.", "FAIL", "CPW Suitability Policy §2.1; Reg BI Care Obligation, 17 CFR 240.15l-1(a)(2)(ii)"],
    ["S2", "Time horizon", "Client time horizon must be >= the product's minimum holding period.", "FAIL", "CPW Suitability Policy §2.2"],
    ["S3", "Liquidity", "Illiquid products (lock-up / limited redemption) require a Low liquidity need.", "FAIL", "CPW Suitability Policy §2.3"],
    ["S4", "Knowledge & experience", "Complex products require Extensive investment experience.", "FAIL", "CPW Complex Products Policy §3.1; FINRA Regulatory Notice 22-08"],
    ["S5", "Vulnerable client", "Within 12 months of a bereavement, or for a specified adult (80+): no Complex products; Moderate products only after a documented planning meeting + supervisor pre-approval.", "FAIL/REVIEW", "CPW Vulnerable Client Policy §2-§3; FINRA Rules 2165, 4512"],
    ["S6", "Concentration", "A Complex product may not exceed 10% of estimated liquid net worth; SBLOC collateral with a single position > 30% needs a reduced advance rate (REVIEW).", "FAIL/REVIEW", "CPW Suitability Policy §2.5"],
    ["S7", "Rollover best interest", "A 401(k) rollover recommendation needs the PTE 2020-02 rollover comparison (fees, services, investment options) delivered before the client decides.", "REVIEW", "CPW Rollover Policy §5.1; DOL PTE 2020-02; Reg BI"],
], columns=["rule_id", "rule_name", "requirement", "outcome_on_breach", "citation"])

# ---------------------------------------------------------------------------
# NBA history — 18 months of offers (targeted vs generic) — the model's training data
# ---------------------------------------------------------------------------
TRIG_ACT = {  # trigger -> matched actions (and base conversion)
    "CD maturity": [("CD-LADDER", 0.42), ("MANAGED-PORTFOLIO", 0.22), ("STRUCTURED-NOTE", 0.24)],
    "Idle cash": [("CASH-MMF", 0.38), ("MANAGED-PORTFOLIO", 0.26), ("STRUCTURED-NOTE", 0.27), ("PRIVATE-CREDIT", 0.18)],
    "Inheritance received": [("MANAGED-PORTFOLIO", 0.30), ("STRUCTURED-NOTE", 0.44), ("ESTATE-REVIEW", 0.36), ("CASH-MMF", 0.25)],
    "Death of spouse": [("ESTATE-REVIEW", 0.52), ("STRUCTURED-NOTE", 0.34), ("CASH-MMF", 0.24)],
    "Retirement": [("IRA-ROLLOVER", 0.46), ("MANAGED-PORTFOLIO", 0.28)],
    "Job change": [("IRA-ROLLOVER", 0.41)],
    "Business sale": [("MANAGED-PORTFOLIO", 0.34), ("PRIVATE-CREDIT", 0.29), ("ESTATE-REVIEW", 0.30)],
    "Home purchase planned": [("SBLOC", 0.33), ("MORTGAGE-REFI", 0.20)],
    "Refi window": [("MORTGAGE-REFI", 0.39)],
    "Concentrated position": [("DIRECT-INDEX", 0.31), ("SBLOC", 0.18)],
    "Child starting college": [("EDU-529", 0.37)],
    "New grandchild": [("EDU-529", 0.29), ("ESTATE-REVIEW", 0.24)],
}
hist = []
oid = 1
HHR = hh.set_index("household_id")
ev_hist = ev[(ev.event_date < AS_OF - dt.timedelta(days=14))]
trig_rows = [(r.household_id, r.event_type, r.event_date, r.amount_estimate) for r in ev_hist.itertuples()]
# synthetic non-event triggers (CD maturity / idle cash / refi / concentration) over history
for _ in range(9000):
    h_ = hh.household_id.iloc[int(rng.integers(N_HH))]
    t = str(rng.choice(["CD maturity", "Idle cash", "Refi window", "Concentrated position"], p=[0.35, 0.4, 0.15, 0.10]))
    trig_rows.append((h_, t, rand_date(HIST_START, AS_OF - dt.timedelta(days=20)), float(rng.lognormal(np.log(300_000), 0.7))))
for h_, trig, tdate, tamt in trig_rows:
    if trig not in TRIG_ACT or h_ in HEROES:
        continue
    r = HHR.loc[h_]
    for code, base_p in TRIG_ACT[trig]:
        if rng.random() > 0.55:
            continue
        lag = int(rng.choice([rng.integers(1, 14), rng.integers(14, 45), rng.integers(45, 120)], p=[0.35, 0.40, 0.25]))
        odate = tdate + dt.timedelta(days=lag)
        if odate >= AS_OF:
            continue
        p = base_p * (1.45 if lag < 14 else 1.0 if lag < 45 else 0.55)
        p *= {"Emerging HNW": 0.9, "HNW": 1.0, "Very HNW": 1.08, "UHNW": 1.1}[r.segment]
        p *= 1.15 if r.tenure_years > 10 else 1.0
        hist.append([h_, r.advisor_id, odate, code, trig, lag, float(min(0.9, p)), tamt])
# generic calendar reviews (the default playbook) — lots of them, low conversion
for _ in range(11000):
    h_ = hh.household_id.iloc[int(rng.integers(N_HH))]
    if h_ in HEROES:
        continue
    r = HHR.loc[h_]
    hist.append([h_, r.advisor_id, rand_date(HIST_START, AS_OF - dt.timedelta(days=1)), "ANNUAL-REVIEW", "Calendar (no trigger)",
                 None, 0.075, 0.0])
    # sometimes an advisor also pitches an untargeted product at the review
    if rng.random() < 0.18:
        code = str(rng.choice(["MANAGED-PORTFOLIO", "STRUCTURED-NOTE", "PRIVATE-CREDIT", "DIRECT-INDEX"]))
        hist.append([h_, r.advisor_id, rand_date(HIST_START, AS_OF - dt.timedelta(days=1)), code, "Calendar (no trigger)", None, 0.06, 0.0])
hist = pd.DataFrame(hist, columns=["household_id", "advisor_id", "offer_date", "action_code", "trigger_type",
                                   "days_since_trigger", "p", "trigger_amount"])
hist["accepted"] = rng.random(len(hist)) < hist.p
basis = {"CD-LADDER": 0.8, "CASH-MMF": 0.3, "MANAGED-PORTFOLIO": 0.6, "STRUCTURED-NOTE": 0.4, "PRIVATE-CREDIT": 0.25,
         "DIRECT-INDEX": 0.7, "IRA-ROLLOVER": 1.0, "MORTGAGE-REFI": 1.0, "SBLOC": 0.8, "ESTATE-REVIEW": 0.0,
         "EDU-529": 0.0, "ANNUAL-REVIEW": 0.0}
bps = dict(zip(actions.action_code, actions.revenue_bps))
hist["assets_moved"] = np.where(hist.accepted, [
    round(float(a) * basis[c] * rng.uniform(0.6, 1.1), -2) if basis[c] else (60_000.0 if c == "EDU-529" else 0.0)
    for a, c in zip(hist.trigger_amount, hist.action_code)], 0.0)
hist["revenue_12m"] = (hist.assets_moved * hist.action_code.map(bps) / 10_000).round(2)
# complaints: complex products sold to clients who would FAIL today's suitability rules
rk = hist.household_id.map(HHR.risk_score)
exp_ = hist.household_id.map(HHR.investment_experience)
vul = hist.household_id.map(HHR.vulnerable_client) | hist.trigger_type.isin(["Death of spouse"])
cx = hist.action_code.isin(["STRUCTURED-NOTE", "PRIVATE-CREDIT", "SBLOC"])
unsuitable = cx & ((rk < 4) | (exp_ != "Extensive") | vul)
hist["would_fail_suitability"] = unsuitable
hist["complaint_filed"] = hist.accepted & (rng.random(len(hist)) < np.where(unsuitable, 0.11, 0.006))
hist["channel"] = rng.choice(["Meeting", "Phone", "Email", "Video call"], len(hist), p=[0.35, 0.3, 0.2, 0.15])
hist["outcome"] = np.where(hist.accepted, "Accepted", np.where(rng.random(len(hist)) < 0.55, "Declined", "No response"))
hist = hist.sort_values("offer_date").reset_index(drop=True)
hist.insert(0, "offer_id", [f"OF-{i + 1:06d}" for i in range(len(hist))])
hist["targeted"] = hist.trigger_type != "Calendar (no trigger)"
hist = hist.drop(columns=["p"])

# ---------------------------------------------------------------------------
# Advisor notes (CRM free text) — AI Functions read the last 60 days
# ---------------------------------------------------------------------------
NOTE_T = {
    "Death of spouse": ["Learned that {first}'s husband passed away last month. Sent condolences; will follow up about accounts and beneficiaries.",
                        "{first} called — her spouse died recently. Overwhelmed with paperwork; asked what happens to the joint account."],
    "Inheritance received": ["{first} mentioned the estate of her mother is settling; expects roughly ${amt} to land in the next few weeks.",
                             "Client said he inherited about ${amt} from his father and is 'not sure what to do with it yet'."],
    "Retirement": ["{first} retiring at the end of the month. Wants to understand income options and what to do with the 401(k) (~${amt})."],
    "Job change": ["{first} started a new role at a startup. Old 401(k) of about ${amt} still with the prior employer."],
    "Business sale": ["{first} closed the sale of the family business — about ${amt} in proceeds coming in. Wants to talk taxes and diversification."],
    "Home purchase planned": ["{first} is house hunting; needs about ${amt} for a down payment in the next 3 months. Prefers not to sell stock."],
    "Child starting college": ["{first}'s daughter starts college next fall. Asked about 529 plans and tuition cash flow."],
    "New grandchild": ["{first} just became a grandparent! Interested in setting something aside for education."],
    "Divorce": ["{first} going through a divorce; asked us to freeze changes until the settlement is final."],
}
GENERIC = ["Quarterly check-in. No changes to goals. Portfolio within policy.", "Client called about a statement question; resolved.",
           "Reviewed performance YTD. Client comfortable with the allocation.", "Sent the annual Form CRS and fee disclosure.",
           "Client asked about the market pullback; talked through the long-term plan.", "Updated address and trusted contact info.",
           "Discussed rates coming down — client asked what the Fed cuts mean for their cash.",
           "Client wondering why the sweep account pays so little compared to online banks."]
FN = dict(zip(hh.household_id, hh.primary_first_name))
notes = []
nid = 1
for h_, dates in contact_dates.items():
    if h_ in HEROES:
        continue
    for cd in dates:
        notes.append([h_, HH_ADV[h_], cd, str(rng.choice(["Phone", "Meeting", "Email", "Video call"])), str(rng.choice(GENERIC))])
for r in ev.itertuples():
    if r.household_id in HEROES or r.source != "Advisor note":
        continue
    nd = r.event_date + dt.timedelta(days=int(rng.integers(0, 10)))
    if nd > AS_OF:
        nd = AS_OF
    t = str(rng.choice(NOTE_T[r.event_type])).format(first=FN[r.household_id], amt=f"{r.amount_estimate:,.0f}")
    notes.append([r.household_id, HH_ADV[r.household_id], nd, "Phone", t])
hero_notes = [
    ("HH-10042", "2025-11-18", "Meeting", "Annual review with Margaret and Robert. Conservative, income-focused. Bought a 12-month CD at 5.10% in October; matures Oct 2026."),
    ("HH-10042", "2026-02-24", "Phone", "Robert's health is declining; Margaret handling more of the finances. Asked to add son Daniel as trusted contact — done."),
    ("HH-10042", "2026-06-10", "Phone", "Condolence call with Margaret after Robert's passing on May 22. She is overwhelmed; agreed to talk again 'once the estate paperwork settles'. No investment discussion."),
    ("HH-10042", "2026-09-15", "Phone", "(Client service, logged by J. Ruiz) Margaret called about the CD maturing Oct 9 — asked whether she should move the money to Brightline Direct where her son Daniel banks, 'they pay 4%'. Life insurance money ($750K) still sitting in sweep. She'd like to talk to Elena. Daniel is helping her with the finances now."),
    ("HH-10077", "2026-05-12", "Video call", "Mid-year review with Raj and Priya. Mortgage at 7.25% with Summit Home Loans bothers them. ARXT (Raj's employer) now ~38% of the portfolio."),
    ("HH-10077", "2026-09-02", "Phone", "Raj: under contract on a lake house in Grand Lake — need about $400,000 down by mid-November. Does NOT want to sell ARXT (big embedded gain, blackout windows). Asked if we can help with financing."),
    ("HH-10113", "2026-06-18", "Meeting", "Tom confirms retirement from Ridgeline Aerospace on Aug 31. Wants a retirement income plan."),
    ("HH-10113", "2026-09-10", "Phone", "Tom retired. His 401(k) (~$640,000) is still with the Ridgeline plan. Asked whether he should roll it over or leave it."),
]
for h_, ds, ch, t in hero_notes:
    notes.append([h_, ELENA, d(ds), ch, t])
notes = pd.DataFrame(notes, columns=["household_id", "advisor_id", "note_date", "channel", "note_text"])
notes = notes.sort_values(["note_date", "household_id"]).reset_index(drop=True)
notes.insert(0, "note_id", [f"NT-{i + 1:06d}" for i in range(len(notes))])

# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------
if os.environ.get("DRY_RUN"):
    print(hh.segment.value_counts(), hh.aum.sum() / 1e9)
    print(ev.event_type.value_counts())
    rec = ev[ev.event_type.isin(["Death of spouse", "Inheritance received"]) & (ev.event_date < d("2026-03-01"))]
    f = flows.merge(rec[["household_id", "advisor_contacted_within_30d"]], on="household_id")
    print(f.groupby("advisor_contacted_within_30d").external_transfers_out.sum() / 1e6)
    print(hist.groupby("targeted").accepted.mean(), hist.groupby("action_code").accepted.mean())
    print(hist.groupby("would_fail_suitability").complaint_filed.sum())
    raise SystemExit(0)

from pyspark.sql import SparkSession  # noqa: E402

spark = SparkSession.getActiveSession()
if spark is None:
    from databricks.connect import DatabricksSession
    spark = DatabricksSession.builder.profile(os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")).serverless(True).getOrCreate()
print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {FQ}.policy_docs COMMENT 'Calder Pine product, suitability and compliance policies (documents searched by the Genie agent)'")


def write(df, name, comment):
    sdf = spark.createDataFrame(df)
    sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.`{name}`")
    spark.sql(f"COMMENT ON TABLE {FQ}.`{name}` IS :c", args={"c": comment})
    print(f"  wrote {name}: {len(df):,}")


hh_out = hh.copy()
hh_out["concentrated_pct"] = hh_out.concentrated_pct.astype(float)
write(advisors, "advisors", "Calder Pine wealth advisors (36) and their office.")
write(hh_out, "households", "Client households (one row per household): advisor, segment, AUM at Calder Pine, sweep cash, risk profile (1-5), time horizon, liquidity need, investment experience, vulnerable-client flag, concentrated position, held-away 401(k). As of 2026-09-28.")
write(accounts, "accounts", "Accounts per household (brokerage, IRA, trust, bank CDs with maturity dates, cash sweep at 0.25%, held-away 401(k) with custodian != 'Calder Pine').")
write(liabilities, "liabilities", "Mortgages per household with lender, rate and origination. Refi window = rate_pct >= 30-yr market rate (5.90%) + 0.75.")
write(ev, "life_events", "Client life events (Apr 2025 - Sep 2026): death of spouse, inheritance, retirement, business sale, job change, home purchase, college, grandchild, divorce. advisor_contacted_within_30d drives retention.")
write(flows, "cash_flows_monthly", "Monthly flows per household (Oct 2025 - Sep 2026): deposits, withdrawals, external transfers in/out (with outflow_reason), market change, AUM and sweep cash at month end.")
write(notes, "advisor_notes", "Advisor CRM notes (free text) per client interaction. The last 60 days are read by AI Functions into note_insights.")
write(rates, "market_rates", "Monthly market rates: Fed funds (cut Jun/Jul/Sep 2026), 12-month CD renewal, 1-yr Treasury, government MMF yield, 30-yr mortgage, Calder Pine sweep rate (0.25%) and competitor high-yield savings (Brightline Direct).")
write(actions, "nba_actions", "Next-best-action catalog: category (Invest/Lend/Plan), complexity, minimum risk score and horizon, illiquidity, revenue in bps of the assets basis, required disclosures.")
write(rules, "suitability_rules", "Deterministic suitability rules (Reg BI care obligation + Calder Pine policy) applied to every recommended action.")
write(hist, "nba_history", "18 months of next-best actions offered by advisors and their outcome. targeted = triggered by a signal (vs a generic calendar review). would_fail_suitability = a complex product the current rules would block.")

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {FQ}.advisor_decisions (
  decision_id STRING, household_id STRING, advisor_id STRING, decided_at TIMESTAMP, action_code STRING,
  decision STRING, assets_in_scope DOUBLE, propensity DOUBLE, suitability_status STRING, disclosures STRING,
  outreach_channel STRING, outreach_message STRING, decided_by STRING)
COMMENT 'Write-back from the Advisor Morning Book app: every decision an advisor logs on a next-best action (proposed / meeting booked / not now).'""")

# ---------------------------------------------------------------------------
# Gold
# ---------------------------------------------------------------------------
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_household_signals
COMMENT 'Active money-in-motion / relationship signals per household as of 2026-09-28 (one row per signal). amount = assets in motion.'
AS
WITH asof AS (SELECT DATE'2026-09-28' AS d)
SELECT a.household_id, 'CD maturity' AS signal_type, a.maturity_date AS signal_date, a.balance AS amount,
       concat('CD ', a.account_id, ' at ', format_number(a.rate_pct, 2), '% matures ', a.maturity_date, ' (renewal rate 3.55%)') AS detail,
       datediff(a.maturity_date, (SELECT d FROM asof)) AS days_to_act
FROM {FQ}.accounts a WHERE a.maturity_date BETWEEN DATE'2026-09-28' AND DATE'2026-11-27'
UNION ALL
SELECT h.household_id, 'Idle cash', DATE'2026-09-28', h.sweep_cash - greatest(50000, 0.03 * h.aum),
       concat(format_number(100 * h.cash_pct, 1), '% of assets in sweep at 0.25% (govt MMF yields 3.60%)'), 30
FROM {FQ}.households h WHERE h.sweep_cash >= 150000 AND h.cash_pct >= 0.10
UNION ALL
SELECT e.household_id, e.event_type, e.event_date, e.amount_estimate, coalesce(e.detail, concat(e.event_type, ' (', e.source, ')')),
       greatest(7, 45 - datediff((SELECT d FROM asof), e.event_date))  -- life events: call within 45 days, never less than a week
FROM {FQ}.life_events e WHERE e.event_date >= DATE'2026-05-01' AND e.event_type <> 'Divorce'
UNION ALL
SELECT l.household_id, 'Refi window', DATE'2026-09-28', l.balance,
       concat('Mortgage at ', format_number(l.rate_pct, 2), '% with ', l.lender, ' vs 5.90% today'), 60
FROM {FQ}.liabilities l WHERE l.rate_pct >= 6.65 AND l.balance >= 150000
UNION ALL
SELECT h.household_id, 'Held-away 401(k)', DATE'2026-09-28', h.held_away_401k, 'Employer 401(k) held away — rollover conversation', 60
FROM {FQ}.households h WHERE h.held_away_401k > 0
UNION ALL
SELECT h.household_id, 'Concentrated position', DATE'2026-09-28', round(h.concentrated_pct * h.aum, -3),
       concat(h.concentrated_symbol, ' is ', format_number(100 * h.concentrated_pct, 0), '% of the portfolio'), 90
FROM {FQ}.households h WHERE h.concentrated_pct >= 0.25
UNION ALL
SELECT c.household_id, 'External outflow', c.month, c.external_transfers_out, c.outflow_reason, 7
FROM {FQ}.cash_flows_monthly c WHERE c.month >= DATE'2026-08-01' AND c.external_transfers_out > 0""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_flows_monthly
COMMENT 'AUM and flows by month x office x advisor x segment. net_new_assets = deposits - withdrawals + transfers in - transfers out.'
AS
SELECT c.month, h.office, h.advisor_id, a.advisor_name, h.segment,
       count(*) AS households,
       round(sum(c.aum_end), 0) AS aum,
       round(sum(c.sweep_cash_end), 0) AS sweep_cash,
       round(sum(c.deposits - c.withdrawals + c.external_transfers_in - c.external_transfers_out), 0) AS net_new_assets,
       round(sum(c.external_transfers_out), 0) AS external_outflows,
       round(sum(CASE WHEN c.outflow_reason LIKE 'Transfer to%' THEN c.external_transfers_out ELSE 0 END), 0) AS outflows_after_life_event,
       round(sum(CASE WHEN c.outflow_reason LIKE 'Cash to online bank%' THEN c.external_transfers_out ELSE 0 END), 0) AS cash_outflows_to_online_banks
FROM {FQ}.cash_flows_monthly c JOIN {FQ}.households h USING (household_id) JOIN {FQ}.advisors a ON a.advisor_id = h.advisor_id
GROUP BY ALL""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_nba_conversion
COMMENT 'Next-best-action conversion by month x action x trigger. targeted = signal-triggered vs generic calendar review.'
AS
SELECT date_trunc('MONTH', offer_date) AS month, action_code, trigger_type, targeted,
       CASE WHEN days_since_trigger IS NULL THEN 'No trigger' WHEN days_since_trigger < 14 THEN '< 14 days'
            WHEN days_since_trigger < 45 THEN '14-44 days' ELSE '45+ days' END AS response_speed,
       count(*) AS offers, sum(CAST(accepted AS INT)) AS accepted,
       round(sum(assets_moved), 0) AS assets_moved, round(sum(revenue_12m), 0) AS revenue_12m,
       sum(CAST(complaint_filed AS INT)) AS complaints, sum(CAST(would_fail_suitability AS INT)) AS unsuitable_offers
FROM {FQ}.nba_history GROUP BY ALL""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_life_event_retention
COMMENT 'Bereavement / inheritance events (Apr 2025 - Mar 2026, so 6 months of follow-up exist): AUM before the event and external outflows in the 6 months after, split by whether the advisor called within 30 days.'
AS
WITH e AS (
  SELECT * FROM {FQ}.life_events
  WHERE event_type IN ('Death of spouse','Inheritance received') AND event_date < DATE'2026-03-28'),
before AS (
  SELECT e.event_id, max_by(c.aum_end, c.month) AS aum_before
  FROM e JOIN {FQ}.cash_flows_monthly c ON c.household_id = e.household_id AND c.month < date_trunc('MONTH', e.event_date)
  GROUP BY e.event_id),
outf AS (
  SELECT e.event_id, sum(c.external_transfers_out) AS outflows_6m
  FROM e JOIN {FQ}.cash_flows_monthly c ON c.household_id = e.household_id
   AND c.month > date_trunc('MONTH', e.event_date) AND c.month <= add_months(date_trunc('MONTH', e.event_date), 6)
  GROUP BY e.event_id)
SELECT e.event_id, e.household_id, h.advisor_id, h.office, e.event_type, e.event_date, e.advisor_contacted_within_30d,
       coalesce(b.aum_before, h.aum) AS aum_before, coalesce(o.outflows_6m, 0) AS outflows_6m,
       round(1 - least(1, coalesce(o.outflows_6m, 0) / greatest(coalesce(b.aum_before, h.aum), 1)), 4) AS assets_retained_pct
FROM e JOIN {FQ}.households h USING (household_id) LEFT JOIN before b USING (event_id) LEFT JOIN outf o USING (event_id)""")

for t, col in [("advisors", "advisor_id"), ("households", "household_id"), ("accounts", "account_id"),
               ("liabilities", "liability_id"), ("life_events", "event_id"), ("advisor_notes", "note_id"),
               ("nba_actions", "action_code"), ("nba_history", "offer_id"), ("suitability_rules", "rule_id")]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN {col} SET NOT NULL")
        spark.sql(f"ALTER TABLE {FQ}.{t} ADD CONSTRAINT {t}_pk PRIMARY KEY ({col}) RELY")
    except Exception as e:
        print(f"  (pk {t}: {str(e).splitlines()[0][:80]})")
for t in ["accounts", "liabilities", "life_events", "cash_flows_monthly", "advisor_notes", "nba_history"]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.{t} ADD CONSTRAINT {t}_hh_fk FOREIGN KEY (household_id) REFERENCES {FQ}.households(household_id) RELY")
    except Exception as e:
        print(f"  (fk {t}: {str(e).splitlines()[0][:80]})")
try:
    spark.sql(f"ALTER TABLE {FQ}.households ADD CONSTRAINT households_adv_fk FOREIGN KEY (advisor_id) REFERENCES {FQ}.advisors(advisor_id) RELY")
    spark.sql(f"ALTER TABLE {FQ}.nba_history ADD CONSTRAINT nba_history_action_fk FOREIGN KEY (action_code) REFERENCES {FQ}.nba_actions(action_code) RELY")
except Exception as e:
    print(f"  (fk: {str(e).splitlines()[0][:80]})")

print(spark.sql(f"SELECT advisor_contacted_within_30d, count(*) n, round(avg(assets_retained_pct)*100,1) retained_pct, round(sum(outflows_6m)/1e6,1) outflows_m FROM {FQ}.gold_life_event_retention GROUP BY 1").toPandas().to_string())
print(spark.sql(f"SELECT signal_type, count(*) n, round(sum(amount)/1e6,1) usd_m FROM {FQ}.gold_household_signals GROUP BY 1 ORDER BY 3 DESC").toPandas().to_string())
print("done.")
