#!/usr/bin/env python
"""
AML / SAR Copilot — self-contained synthetic data generator (RAW layer).

Northwind Federal Bank (fictional, South Florida retail + commercial bank).
12 months of core-banking activity (Oct-2025 -> Sep-2026) for ~3,000 customers,
plus the output of a rules-based transaction-monitoring system (TMS) and the
historical SAR case log.

THE PLANTED SIGNAL — the "Bayline ring" (structuring + funnel + trade cover):
  * 9 linked parties: a used-vehicle exporter (Bayline Auto Exports LLC), three
    shell LLCs registered at the SAME suite, and five individual money mules who
    share phone numbers and one online-banking device fingerprint.
  * From 10-Aug-2026 the mules and shells make ~130 cash deposits of
    $8,200-$9,900 (always under the $10K CTR threshold) across 7 branches, sweep
    the cash to the hub within 1-3 days, and the hub wires ~$1.2M to a UAE free-
    zone trader and a Hong Kong holding company.
  * Each party ALONE looks modest and was onboarded with a LOW/MEDIUM KYC rating,
    so the rules engine scores the ring's alerts in the 30s-50s — they sit in the
    bottom half of the queue, below hundreds of false positives from legitimately
    cash-intensive (HIGH-rated) restaurants and car washes. August alerts on the
    same parties were already closed as "no SAR" in isolation.
  * The ML model (src/ml/train_score.py) learns from 12 months of dispositions
    that network + pass-through + multi-branch sub-threshold cash is what
    actually ends in a SAR -> it ranks the ring's open alerts at the top.

Tables written to <catalog>.<schema>:
  customers, accounts, branches, transactions, customer_attributes,
  alerts, sar_cases
Downstream: src/transform/build_gold.py (features, network, KPIs) and
src/ml/train_score.py (model + scored queue).

Run:  python generate_data.py --catalog demo_generator --schema aml_sar_copilot
      (Databricks Connect locally, or as a serverless spark_python_task).
"""
import argparse
import datetime as dt

import numpy as np
import pandas as pd

SEED = 20260929
START = dt.date(2025, 10, 1)
END = dt.date(2026, 9, 28)          # last day of activity (data "as of" 2026-09-29)
N_DAYS = (END - START).days + 1
OPEN_CUTOFF = dt.date(2026, 9, 10)  # alerts on/after this date are still open in the queue
RING_START = dt.date(2026, 8, 10)
RING_END = dt.date(2026, 9, 26)

rng = np.random.default_rng(SEED)

FIRST = ["James", "Maria", "Robert", "Ana", "Michael", "Carmen", "David", "Rosa", "Daniel", "Luisa",
         "Kevin", "Sofia", "Brian", "Elena", "Jason", "Gabriela", "Eric", "Patricia", "Andre", "Valeria",
         "Marcus", "Isabel", "Tyler", "Camila", "Jordan", "Natalia", "Ryan", "Lucia", "Omar", "Priya",
         "Wei", "Aisha", "Samuel", "Mei", "Victor", "Fatima", "Noah", "Grace", "Ethan", "Chloe"]
LAST = ["Garcia", "Rodriguez", "Smith", "Martinez", "Johnson", "Hernandez", "Lopez", "Williams", "Perez",
        "Brown", "Gonzalez", "Davis", "Sanchez", "Miller", "Ramirez", "Wilson", "Torres", "Moore", "Rivera",
        "Taylor", "Flores", "Anderson", "Diaz", "Thomas", "Cruz", "Jackson", "Reyes", "White", "Morales",
        "Harris", "Ortiz", "Clark", "Gutierrez", "Lewis", "Chavez", "Lee", "Patel", "Nguyen", "Kim", "Chen"]
OCCUPATIONS = ["Registered nurse", "Teacher", "Software engineer", "Retail associate", "Accountant",
               "Truck driver", "Real estate agent", "Student", "Retired", "Electrician", "Server",
               "Rideshare driver", "Dental hygienist", "Sales manager", "Construction worker", "Pharmacist",
               "Self-employed contractor", "Attorney", "Chef", "Mechanic"]
CITIES = [("Miami", "FL"), ("Hialeah", "FL"), ("Fort Lauderdale", "FL"), ("Hollywood", "FL"),
          ("Coral Gables", "FL"), ("Doral", "FL"), ("Pembroke Pines", "FL"), ("Boca Raton", "FL"),
          ("West Palm Beach", "FL"), ("Homestead", "FL"), ("Miami Beach", "FL"), ("Kendall", "FL")]
STREETS = ["Biscayne Blvd", "Flagler St", "Coral Way", "Bird Rd", "Sunrise Blvd", "Las Olas Blvd",
           "Okeechobee Rd", "Pines Blvd", "Glades Rd", "Palm Ave", "NW 36th St", "SW 8th St", "Hollywood Blvd"]
BRANCHES = [
    ("BR-01", "Brickell", "Miami"), ("BR-02", "Coral Gables", "Coral Gables"), ("BR-03", "Doral", "Doral"),
    ("BR-04", "Hialeah Gardens", "Hialeah"), ("BR-05", "Little Havana", "Miami"), ("BR-06", "Kendall", "Kendall"),
    ("BR-07", "Miami Beach", "Miami Beach"), ("BR-08", "Las Olas", "Fort Lauderdale"),
    ("BR-09", "Hollywood", "Hollywood"), ("BR-10", "Pembroke Pines", "Pembroke Pines"),
    ("BR-11", "Boca Raton", "Boca Raton"), ("BR-12", "West Palm", "West Palm Beach"),
    ("BR-13", "Homestead", "Homestead"), ("BR-14", "Port Everglades", "Fort Lauderdale"),
    ("BR-15", "Wynwood", "Miami"), ("BR-16", "Sunrise", "Fort Lauderdale"),
]
BRANCH_IDS = [b[0] for b in BRANCHES]
HIGH_RISK = ["AE", "HK", "PA", "CY", "TR", "NG", "VE", "KY", "VG"]
REMIT = ["MX", "DO", "CO", "HT", "JM", "PH", "IN", "GT", "HN"]
TRADE = ["CN", "HK", "DE", "IT", "BR", "CO", "MX", "AE"]
BIZ_TYPES = [  # (industry, naics, cash_intensive)
    ("Full-service restaurant", "722511", True), ("Car wash", "811192", True),
    ("Convenience store", "445131", True), ("Laundromat", "812310", True),
    ("Beauty salon", "812112", True), ("Import / export trading", "423990", False),
    ("Medical practice", "621111", False), ("Construction contractor", "236220", False),
    ("Logistics & freight", "488510", False), ("Software consultancy", "541511", False),
    ("Property management", "531311", False), ("Dental practice", "621210", False),
    ("Used vehicle dealer", "441120", True), ("Marine supplies", "423860", False),
]
BIZ_SUFFIX = ["LLC", "Inc", "Group LLC", "Holdings LLC", "Corp"]
BIZ_WORDS = ["Sunrise", "Coastal", "Palmetto", "Biscayne", "Everglades", "Atlantic", "Keystone", "Gulfstream",
             "Seabreeze", "Tropic", "Harborline", "Mangrove", "Citrus", "Bayfront", "Southpoint", "Lighthouse"]

rows_tx: list = []


def rand_dates(n, start=START, end=END):
    span = (end - start).days + 1
    d = rng.integers(0, span, n)
    secs = rng.integers(8 * 3600, 20 * 3600, n)
    return pd.Timestamp(start) + pd.to_timedelta(d, unit="D") + pd.to_timedelta(secs, unit="s")


def add_tx(cust, acct, ts, ttype, amount, channel, branch=None, cp_name=None, cp_country="US",
           cp_customer=None, direction=None, memo=None):
    n = len(ts)
    if n == 0:
        return
    if direction is None:
        direction = "credit" if ttype in ("cash_deposit", "ach_in", "wire_in", "p2p_in", "internal_in") else "debit"

    def arr(v):
        return list(v) if isinstance(v, (list, np.ndarray, pd.Series)) else [v] * n

    rows_tx.append(pd.DataFrame({
        "customer_id": cust, "account_id": acct, "txn_ts": pd.to_datetime(ts), "txn_type": ttype,
        "amount": np.round(np.asarray(amount, dtype=float), 2), "direction": direction, "channel": arr(channel),
        "branch_id": arr(branch), "counterparty_name": arr(cp_name), "counterparty_country": arr(cp_country),
        "counterparty_customer_id": arr(cp_customer), "memo": arr(memo),
    }))


# ---------------------------------------------------------------------------
# 1. Customers + accounts
# ---------------------------------------------------------------------------
def make_customers():
    custs = []
    n_ind, n_biz = 2560, 440
    for i in range(n_ind):
        city, st = CITIES[rng.integers(len(CITIES))]
        custs.append(dict(
            customer_id=f"C{100000 + i}", customer_name=f"{FIRST[rng.integers(40)]} {LAST[rng.integers(40)]}",
            customer_type="individual", occupation_or_industry=OCCUPATIONS[rng.integers(len(OCCUPATIONS))],
            naics_code=None, cash_intensive=False, city=city, state=st,
            address=f"{rng.integers(100, 9999)} {STREETS[rng.integers(len(STREETS))]}, {city}, {st}",
            phone=f"+1-305-{rng.integers(200, 999)}-{rng.integers(1000, 9999)}",
            device_id=f"DEV-{rng.integers(10**8, 10**9)}",
            onboarding_date=START - dt.timedelta(days=int(rng.integers(30, 3650))),
            kyc_risk_rating=str(rng.choice(["low", "medium", "high"], p=[0.72, 0.24, 0.04])),
            pep_flag=bool(rng.random() < 0.006), home_branch=BRANCH_IDS[rng.integers(len(BRANCH_IDS))],
            expected_monthly_cash=float(rng.choice([0, 200, 500, 1000, 2000], p=[0.3, 0.3, 0.2, 0.15, 0.05])),
            segment="Retail", role="normal"))
    for j in range(n_biz):
        city, st = CITIES[rng.integers(len(CITIES))]
        ind, naics, cash = BIZ_TYPES[rng.integers(len(BIZ_TYPES))]
        name = f"{BIZ_WORDS[rng.integers(len(BIZ_WORDS))]} {ind.split(' ')[0].title()} {BIZ_SUFFIX[rng.integers(len(BIZ_SUFFIX))]}"
        custs.append(dict(
            customer_id=f"B{200000 + j}", customer_name=name, customer_type="business",
            occupation_or_industry=ind, naics_code=naics, cash_intensive=cash, city=city, state=st,
            address=f"{rng.integers(100, 9999)} {STREETS[rng.integers(len(STREETS))]}, {city}, {st}",
            phone=f"+1-954-{rng.integers(200, 999)}-{rng.integers(1000, 9999)}",
            device_id=f"DEV-{rng.integers(10**8, 10**9)}",
            onboarding_date=START - dt.timedelta(days=int(rng.integers(60, 5000))),
            # policy: cash-intensive businesses are rated HIGH by default -> lots of rule noise
            kyc_risk_rating=("high" if cash and rng.random() < 0.8 else str(rng.choice(["low", "medium", "high"], p=[0.45, 0.45, 0.10]))),
            pep_flag=False, home_branch=BRANCH_IDS[rng.integers(len(BRANCH_IDS))],
            expected_monthly_cash=float(rng.integers(30, 90) * 1000 if cash else rng.choice([0, 1000, 3000])),
            segment="Commercial" if rng.random() < 0.3 else "Small Business", role="normal"))
    return pd.DataFrame(custs)


customers = make_customers()

# Households: pairs of individuals sharing an address (legit, cluster size 2)
ind_idx = customers.index[customers.customer_type == "individual"].to_numpy()
hh = rng.choice(ind_idx, size=(260, 2), replace=False)
for a, b in hh:
    customers.loc[b, "address"] = customers.loc[a, "address"]
    customers.loc[b, "city"] = customers.loc[a, "city"]
    customers.loc[b, "customer_name"] = customers.loc[b, "customer_name"].split(" ")[0] + " " + customers.loc[a, "customer_name"].split(" ")[1]
households = [(customers.loc[a, "customer_id"], customers.loc[b, "customer_id"]) for a, b in hh]

# ---------------------------------------------------------------------------
# 2. Bad actors: 14 historical rings, 36 solo actors, + the current Bayline ring
# ---------------------------------------------------------------------------
used = set(np.concatenate([hh[:, 0], hh[:, 1]]).tolist())
free_ind = [i for i in ind_idx if i not in used]
rng.shuffle(free_ind)
biz_idx = customers.index[(customers.customer_type == "business") & (~customers.cash_intensive)].to_numpy()
rng.shuffle(biz_idx)

hist_rings = []
p_ind, p_biz = 0, 0
for r in range(14):
    size = int(rng.integers(3, 7))
    hub = biz_idx[p_biz]; p_biz += 1
    members = free_ind[p_ind:p_ind + size - 1]; p_ind += size - 1
    s_day = int(rng.integers(0, 290))
    win = (START + dt.timedelta(days=s_day), START + dt.timedelta(days=s_day + int(rng.integers(28, 50))))
    shared_addr = customers.loc[hub, "address"]
    shared_phone = f"+1-786-{rng.integers(200, 999)}-{rng.integers(1000, 9999)}"
    shared_dev = f"DEV-{rng.integers(10**8, 10**9)}"
    for k, m in enumerate(members):
        if k % 2 == 0:
            customers.loc[m, "phone"] = shared_phone
        if rng.random() < 0.7:
            customers.loc[m, "device_id"] = shared_dev
        if k == 0:
            customers.loc[m, "address"] = shared_addr
        customers.loc[m, "role"] = "hist_ring"
        customers.loc[m, "kyc_risk_rating"] = str(rng.choice(["low", "medium", "high"], p=[0.5, 0.35, 0.15]))
    customers.loc[hub, "role"] = "hist_ring_hub"
    hist_rings.append(dict(hub=hub, members=list(members), window=win, dest=str(rng.choice(HIGH_RISK))))

solo = free_ind[p_ind:p_ind + 24] + list(biz_idx[p_biz:p_biz + 12])
solo_windows = {}
for s in solo:
    customers.loc[s, "role"] = "solo_bad"
    sd = int(rng.integers(0, 300))
    solo_windows[s] = (START + dt.timedelta(days=sd), START + dt.timedelta(days=sd + int(rng.integers(20, 40))))

# --- the current ring (Bayline) : appended as new customers -----------------
RING = [
    dict(customer_id="B290001", customer_name="Bayline Auto Exports LLC", customer_type="business",
         occupation_or_industry="Used vehicle export", naics_code="423110", role="ring_hub",
         address="1420 Harbor Blvd, Suite 9, Fort Lauderdale, FL", phone="+1-954-555-0142",
         onboarding_date=dt.date(2026, 2, 12), kyc_risk_rating="medium", expected_monthly_cash=15000.0),
    dict(customer_id="B290002", customer_name="Seaview Freight Partners LLC", customer_type="business",
         occupation_or_industry="Freight forwarding", naics_code="488510", role="ring_shell",
         address="1420 Harbor Blvd, Suite 9, Fort Lauderdale, FL", phone="+1-954-555-0177",
         onboarding_date=dt.date(2026, 3, 3), kyc_risk_rating="low", expected_monthly_cash=5000.0),
    dict(customer_id="B290003", customer_name="Coralpoint Trading LLC", customer_type="business",
         occupation_or_industry="General merchandise wholesale", naics_code="423990", role="ring_shell",
         address="1420 Harbor Blvd, Suite 9, Fort Lauderdale, FL", phone="+1-954-555-0188",
         onboarding_date=dt.date(2026, 3, 19), kyc_risk_rating="low", expected_monthly_cash=5000.0),
    dict(customer_id="B290004", customer_name="Mangrove Wholesale Group LLC", customer_type="business",
         occupation_or_industry="Auto parts wholesale", naics_code="423120", role="ring_shell",
         address="1420 Harbor Blvd, Suite 9, Fort Lauderdale, FL", phone="+1-954-555-0193",
         onboarding_date=dt.date(2026, 4, 7), kyc_risk_rating="low", expected_monthly_cash=4000.0),
    dict(customer_id="C190001", customer_name="Luis Arroyo", customer_type="individual",
         occupation_or_industry="Rideshare driver", role="ring_mule",
         address="3318 NW 7th St, Apt 4, Miami, FL", phone="+1-786-555-0119",
         onboarding_date=dt.date(2026, 4, 22), kyc_risk_rating="low", expected_monthly_cash=500.0),
    dict(customer_id="C190002", customer_name="Daniela Voss", customer_type="individual",
         occupation_or_industry="Student", role="ring_mule",
         address="7801 Coral Way, Apt 12, Miami, FL", phone="+1-786-555-0119",
         onboarding_date=dt.date(2026, 5, 2), kyc_risk_rating="low", expected_monthly_cash=200.0),
    dict(customer_id="C190003", customer_name="Kevin Mbeki", customer_type="individual",
         occupation_or_industry="Warehouse associate", role="ring_mule",
         address="2240 Hollywood Blvd, Apt 3B, Hollywood, FL", phone="+1-786-555-0119",
         onboarding_date=dt.date(2026, 5, 9), kyc_risk_rating="low", expected_monthly_cash=300.0),
    dict(customer_id="C190004", customer_name="Tatiana Brenes", customer_type="individual",
         occupation_or_industry="Server", role="ring_mule",
         address="515 Okeechobee Rd, Hialeah, FL", phone="+1-786-555-0231",
         onboarding_date=dt.date(2026, 5, 20), kyc_risk_rating="low", expected_monthly_cash=500.0),
    dict(customer_id="C190005", customer_name="Marco Delgado", customer_type="individual",
         occupation_or_industry="Self-employed contractor", role="ring_mule",
         address="1420 Harbor Blvd, Suite 9, Fort Lauderdale, FL", phone="+1-786-555-0231",
         onboarding_date=dt.date(2026, 6, 1), kyc_risk_rating="medium", expected_monthly_cash=1000.0),
]
for r in RING:
    city = r["address"].split(", ")[-2]
    r.update(cash_intensive=False, city=city, state="FL", device_id="DEV-770413229", pep_flag=False,
             home_branch="BR-14", segment="Small Business" if r["customer_type"] == "business" else "Retail")
    r.setdefault("naics_code", None)
RING[0]["device_id"] = "DEV-118200731"   # hub + one shell share a second device
RING[3]["device_id"] = "DEV-118200731"
customers = pd.concat([customers, pd.DataFrame(RING)], ignore_index=True)
customers["onboarding_date"] = pd.to_datetime(customers["onboarding_date"]).dt.date

acc_rows = []
for c in customers.itertuples():
    prod = "Business Checking" if c.customer_type == "business" else "Personal Checking"
    acc_rows.append((f"A{c.customer_id[1:]}1", c.customer_id, prod, c.onboarding_date))
    if c.customer_type == "individual" and rng.random() < 0.35:
        acc_rows.append((f"A{c.customer_id[1:]}2", c.customer_id, "Savings", c.onboarding_date))
    if c.customer_type == "business" and rng.random() < 0.3:
        acc_rows.append((f"A{c.customer_id[1:]}2", c.customer_id, "Business Money Market", c.onboarding_date))
accounts = pd.DataFrame(acc_rows, columns=["account_id", "customer_id", "product", "open_date"])
accounts["status"] = "active"
primary_acct = {c: f"A{c[1:]}1" for c in customers.customer_id}

# ---------------------------------------------------------------------------
# 3. Normal activity
# ---------------------------------------------------------------------------
growth = np.linspace(0.85, 1.2, N_DAYS)  # activity (and alerts) grow ~40% over the year


def dates_poisson(rate_per_month, start=START, end=END):
    days = (end - start).days + 1
    n = rng.poisson(rate_per_month * days / 30.4)
    if n == 0:
        return pd.to_datetime([])
    off = (start - START).days
    w = growth[off:off + days]
    w = w / w.sum()
    d = rng.choice(days, size=n, p=w)
    secs = rng.integers(8 * 3600, 20 * 3600, n)
    return pd.Timestamp(start) + pd.to_timedelta(d, unit="D") + pd.to_timedelta(secs, unit="s")


for c in customers.itertuples():
    if c.role.startswith("ring"):
        continue
    a = primary_acct[c.customer_id]
    st = max(START, c.onboarding_date)
    if c.customer_type == "individual":
        pay = rng.uniform(1200, 4800)
        ts = dates_poisson(2.1, st); add_tx(c.customer_id, a, ts, "ach_in", pay * rng.uniform(0.95, 1.05, len(ts)), "ach", cp_name="Payroll - " + str(rng.choice(["ADP", "Paychex", "Gusto", "State of FL"])))
        ts = dates_poisson(6, st); add_tx(c.customer_id, a, ts, "ach_out", rng.gamma(2, 120, len(ts)) + 20, "ach", cp_name=rng.choice(["FPL Utility", "Comcast", "State Farm", "Mortgage Svc", "AT&T"], len(ts)))
        ts = dates_poisson(2.5, st); add_tx(c.customer_id, a, ts, "p2p_out", rng.gamma(2, 60, len(ts)) + 10, "mobile", cp_name="Zelle payee")
        ts = dates_poisson(1.8, st); add_tx(c.customer_id, a, ts, "cash_withdrawal", rng.choice([40, 60, 100, 200, 300, 400], len(ts)), "atm", branch=rng.choice(BRANCH_IDS, len(ts)))
        if c.expected_monthly_cash > 0:
            ts = dates_poisson(1.2, st)
            amt = rng.gamma(1.5, c.expected_monthly_cash / 1.5, len(ts)) + 20
            add_tx(c.customer_id, a, ts, "cash_deposit", amt, "branch", branch=np.where(rng.random(len(ts)) < 0.8, c.home_branch, rng.choice(BRANCH_IDS, len(ts))))
        if rng.random() < 0.10:  # remittance senders -> legit foreign wires
            ts = dates_poisson(1.0, st); add_tx(c.customer_id, a, ts, "wire_out", rng.uniform(200, 2500, len(ts)), "online", cp_name="Family remittance", cp_country=str(rng.choice(REMIT)))
        if rng.random() < 0.03:  # one-off big life-event wire (house closing, car)
            ts = rand_dates(1, st); add_tx(c.customer_id, a, ts, "wire_out", [float(rng.choice([25000, 40000, 60000, 85000]))], "branch", cp_name="Title & escrow co.")
            ts2 = ts - pd.Timedelta(days=int(rng.integers(3, 20))); add_tx(c.customer_id, a, ts2, "wire_in", [float(rng.uniform(20000, 90000))], "wire", cp_name="Brokerage transfer")
    else:
        rev = rng.uniform(40000, 400000)
        ts = dates_poisson(20, st); add_tx(c.customer_id, a, ts, "ach_in", rng.gamma(3, rev / 60, len(ts)), "ach", cp_name="Card settlement - " + str(rng.choice(["Fiserv", "Square", "Stripe"])))
        ts = dates_poisson(12, st); add_tx(c.customer_id, a, ts, "ach_out", rng.gamma(2, rev / 50, len(ts)), "ach", cp_name=rng.choice(["Sysco", "US Foods", "Home Depot Pro", "Grainger", "Uline"], len(ts)))
        ts = dates_poisson(2.2, st); add_tx(c.customer_id, a, ts, "ach_out", np.full(len(ts), rev * 0.18), "ach", cp_name="Payroll - ADP")
        if c.cash_intensive:
            ts = dates_poisson(14, st)
            base = c.expected_monthly_cash / 14
            amt = rng.gamma(4, base / 4, len(ts))
            add_tx(c.customer_id, a, ts, "cash_deposit", amt, "branch", branch=np.where(rng.random(len(ts)) < 0.92, c.home_branch, rng.choice(BRANCH_IDS, len(ts))))
        if c.occupation_or_industry in ("Import / export trading", "Marine supplies", "Logistics & freight") or rng.random() < 0.15:
            ts = dates_poisson(2.5, st)
            add_tx(c.customer_id, a, ts, "wire_out", rng.gamma(2, rev / 12, len(ts)), "online", cp_name="Supplier - " + str(rng.choice(["Shenzhen Hualong", "Guangzhou Textile", "Milano Forniture", "Dubai Trade Hub", "Bogota Flores"])), cp_country=rng.choice(TRADE, len(ts)))
            ts = dates_poisson(1.0, st)
            add_tx(c.customer_id, a, ts, "wire_in", rng.gamma(2, rev / 10, len(ts)), "wire", cp_name="Customer remittance", cp_country=rng.choice(["US", "CA", "MX", "CO"], len(ts)))

cust_ix = customers.set_index("customer_id")


def cname(i):
    return cust_ix.customer_name.get(i) if isinstance(i, str) else customers.loc[i, "customer_name"]


# household transfers (legit linked pairs)
for a_id, b_id in households:
    ts = dates_poisson(1.5)
    add_tx(a_id, primary_acct[a_id], ts, "p2p_out", rng.gamma(2, 150, len(ts)), "mobile", cp_name=cname(b_id), cp_customer=b_id)


def dates_in(win, rate_per_week):
    s, e = win
    days = (e - s).days + 1
    n = max(1, rng.poisson(rate_per_week * days / 7))
    return pd.Timestamp(s) + pd.to_timedelta(rng.integers(0, days, n), unit="D") + pd.to_timedelta(rng.integers(9 * 3600, 17 * 3600, n), unit="s")


# ---------------------------------------------------------------------------
# 4. Historical rings (became SARs) + solo bad actors
# ---------------------------------------------------------------------------
for ring in hist_rings:
    hub_id = customers.loc[ring["hub"], "customer_id"]
    total = 0.0
    for m in ring["members"]:
        mid = customers.loc[m, "customer_id"]
        ts = dates_in(ring["window"], rng.uniform(1.5, 3))
        amt = rng.uniform(8000, 9950, len(ts))
        add_tx(mid, primary_acct[mid], ts, "cash_deposit", amt, "branch", branch=rng.choice(BRANCH_IDS, len(ts)))
        sweep = ts + pd.to_timedelta(rng.integers(1, 3, len(ts)), unit="D")
        add_tx(mid, primary_acct[mid], sweep, "internal_out", amt * rng.uniform(0.9, 0.98, len(ts)), "online", cp_name=cname(hub_id), cp_customer=hub_id)
        add_tx(hub_id, primary_acct[hub_id], sweep, "internal_in", amt * 0.94, "online", cp_name=cname(mid), cp_customer=mid)
        total += amt.sum()
    n_w = int(rng.integers(3, 7))
    ts = pd.Timestamp(ring["window"][1]) - pd.to_timedelta(np.sort(rng.integers(0, 25, n_w)), unit="D") + pd.Timedelta(hours=14)
    add_tx(hub_id, primary_acct[hub_id], ts, "wire_out", np.round(np.full(n_w, total * 0.85 / n_w), -3), "online", cp_name="Offshore trading co.", cp_country=ring["dest"])

for s, win in solo_windows.items():
    sid = customers.loc[s, "customer_id"]
    kind = rng.choice(["passthrough", "structuring", "hr_wires"])
    if kind == "passthrough":
        ts = dates_in(win, 1.5); amt = rng.uniform(15000, 60000, len(ts))
        add_tx(sid, primary_acct[sid], ts, "wire_in", amt, "wire", cp_name="Unrelated remitter", cp_country=str(rng.choice(["US", "MX", "PA"])))
        add_tx(sid, primary_acct[sid], ts + pd.Timedelta(days=2), "wire_out", amt * 0.96, "online", cp_name="Beneficiary abroad", cp_country=str(rng.choice(HIGH_RISK)))
    elif kind == "structuring":
        ts = dates_in(win, 2.5); amt = rng.uniform(8500, 9950, len(ts))
        add_tx(sid, primary_acct[sid], ts, "cash_deposit", amt, "branch", branch=rng.choice(BRANCH_IDS, len(ts)))
        add_tx(sid, primary_acct[sid], ts + pd.Timedelta(days=3), "wire_out", amt * 0.9, "online", cp_name="Beneficiary abroad", cp_country=str(rng.choice(HIGH_RISK)))
    else:
        ts = dates_in(win, 1.2)
        add_tx(sid, primary_acct[sid], ts, "wire_out", rng.choice([20000, 35000, 50000, 75000], len(ts)).astype(float), "online", cp_name="Shell beneficiary", cp_country=str(rng.choice(HIGH_RISK)))
        add_tx(sid, primary_acct[sid], ts - pd.Timedelta(days=1), "cash_deposit", rng.uniform(9000, 9900, len(ts)), "branch", branch=rng.choice(BRANCH_IDS, len(ts)))

# ---------------------------------------------------------------------------
# 5. THE BAYLINE RING (planted signal)
# ---------------------------------------------------------------------------
HUB, SHELLS, MULES = "B290001", ["B290002", "B290003", "B290004"], ["C190001", "C190002", "C190003", "C190004", "C190005"]
RING_IDS = [HUB] + SHELLS + MULES
ring_branches = ["BR-14", "BR-08", "BR-09", "BR-16", "BR-03", "BR-15", "BR-05"]
win = (RING_START, RING_END)
for rid in RING_IDS:  # background legit-looking activity so the parties are not empty
    ob = cust_ix.onboarding_date[rid]
    ts = dates_poisson(3, max(START, ob)); add_tx(rid, primary_acct[rid], ts, "ach_out", rng.gamma(2, 180, len(ts)), "ach", cp_name=rng.choice(["FPL Utility", "Comcast", "T-Mobile"], len(ts)))
    if rid.startswith("C"):
        ts = dates_poisson(2, max(START, ob)); add_tx(rid, primary_acct[rid], ts, "ach_in", rng.uniform(600, 1400, len(ts)), "ach", cp_name="Payroll - Gusto")
ts = dates_poisson(4, cust_ix.onboarding_date[HUB]); add_tx(HUB, primary_acct[HUB], ts, "ach_in", rng.uniform(3000, 12000, len(ts)), "ach", cp_name="Card settlement - Square")
ring_cash_total = 0.0
for mid in MULES + SHELLS:
    ts = dates_in(win, 2.6 if mid in MULES else 2.0).sort_values()
    amt = rng.uniform(8200, 9900, len(ts))
    add_tx(mid, primary_acct[mid], ts, "cash_deposit", amt, "branch", branch=rng.choice(ring_branches, len(ts)))
    ring_cash_total += amt.sum()
    dest = HUB if (mid in SHELLS or rng.random() < 0.5) else SHELLS[int(rng.integers(0, 3))]
    sweep = ts + pd.to_timedelta(rng.integers(1, 3, len(ts)), unit="D") + pd.Timedelta(hours=2)
    add_tx(mid, primary_acct[mid], sweep, "internal_out", amt * rng.uniform(0.93, 0.985, len(ts)), "online", cp_name=cname(dest), cp_customer=dest, memo="Inventory payment")
    add_tx(dest, primary_acct[dest], sweep, "internal_in", amt * 0.955, "online", cp_name=cname(mid), cp_customer=mid, memo="Inventory payment")
    if dest != HUB:  # shell forwards to hub
        s2 = sweep + pd.Timedelta(days=1)
        add_tx(dest, primary_acct[dest], s2, "internal_out", amt * 0.94, "online", cp_name=cname(HUB), cp_customer=HUB, memo="Vehicle purchase deposit")
        add_tx(HUB, primary_acct[HUB], s2, "internal_in", amt * 0.94, "online", cp_name=cname(dest), cp_customer=dest, memo="Vehicle purchase deposit")
wire_days = [9, 14, 18, 22, 25, 29, 32, 35, 38, 41, 43, 45, 46]
wire_dates = pd.to_datetime([RING_START + dt.timedelta(days=d) for d in wire_days]) + pd.Timedelta(hours=15)
wire_amts = [72500, 85000, 91000, 88500, 97000, 92500, 99000, 94000, 88000, 96500, 91500, 87000, 93000]
benef = np.array(["Golden Dunes General Trading FZE"] * 8 + ["Pearl Delta Holdings Ltd"] * 5)
cty = np.array(["AE"] * 8 + ["HK"] * 5)
order = rng.permutation(13)
add_tx(HUB, primary_acct[HUB], wire_dates, "wire_out", np.array(wire_amts, dtype=float), "online",
       cp_name=benef[order], cp_country=cty[order], memo="Vehicle export - invoice")

tx = pd.concat(rows_tx, ignore_index=True)
tx = tx[(tx.txn_ts >= pd.Timestamp(START)) & (tx.txn_ts < pd.Timestamp(END) + pd.Timedelta(days=1))]
tx = tx.sort_values("txn_ts").reset_index(drop=True)
tx.insert(0, "txn_id", [f"T{10_000_000 + i}" for i in range(len(tx))])
tx["amount"] = tx["amount"].clip(lower=1.0)
tx["cash_below_ctr"] = (tx.txn_type == "cash_deposit") & (tx.amount >= 8000) & (tx.amount < 10000)
tx["high_risk_country"] = tx.counterparty_country.isin(HIGH_RISK)
print(f"transactions: {len(tx):,} | ring cash deposits ${ring_cash_total:,.0f}")

# ---------------------------------------------------------------------------
# 6. Rules-based TMS alerts (14-day buckets per customer)
# ---------------------------------------------------------------------------
tx["bucket"] = ((tx.txn_ts - pd.Timestamp(START)).dt.days // 14).astype(int)
g = tx.groupby(["customer_id", "bucket"])
cash = tx[tx.txn_type == "cash_deposit"].groupby(["customer_id", "bucket"]).amount.agg(["sum", "count"])
sub = tx[tx.cash_below_ctr].groupby(["customer_id", "bucket"]).amount.agg(["sum", "count"])
hrw = tx[(tx.txn_type == "wire_out") & tx.high_risk_country].groupby(["customer_id", "bucket"]).amount.agg(["sum", "count"])
# pass-through: money that arrives (cash / wire / transfer) and leaves again by wire / transfer / P2P
inflow = tx[tx.txn_type.isin(["cash_deposit", "wire_in", "internal_in", "p2p_in"])].groupby(["customer_id", "bucket"]).amount.sum()
outflow = tx[tx.txn_type.isin(["wire_out", "internal_out", "p2p_out"])].groupby(["customer_id", "bucket"]).amount.sum()
roundw = tx[(tx.txn_type == "wire_out") & (tx.amount >= 10000) & ((tx.amount % 500) == 0)].groupby(["customer_id", "bucket"]).amount.agg(["sum", "count"])
agg = pd.DataFrame({"last_ts": g.txn_ts.max()}).join(cash.add_prefix("cash_")).join(sub.add_prefix("sub_")).join(hrw.add_prefix("hrw_")) \
    .join(inflow.rename("inflow")).join(outflow.rename("outflow")).join(roundw.add_prefix("rw_")).fillna(0).reset_index()
agg = agg.merge(customers[["customer_id", "kyc_risk_rating", "pep_flag", "expected_monthly_cash", "role", "customer_type"]], on="customer_id")
KYCW = {"low": 0, "medium": 10, "high": 25}
alerts = []
for r in agg.itertuples():
    kyc = KYCW[r.kyc_risk_rating] + (10 if r.pep_flag else 0)
    trig = []
    if r.sub_count >= 2 and r.sub_sum >= 16000:
        trig.append(("Cash structuring - below CTR threshold", 26 + min(12, 1.5 * r.sub_count), r.sub_sum, r.sub_count))
    if r.cash_sum >= max(1.1 * r.expected_monthly_cash / 2, 3000 if r.customer_type == "individual" else 16000):
        trig.append(("High cash volume vs. expected profile", 40 + min(15, r.cash_sum / 20000), r.cash_sum, r.cash_count))
    if r.hrw_sum >= 5000:
        trig.append(("Wire to high-risk jurisdiction", 36 + min(12, r.hrw_sum / 25000), r.hrw_sum, r.hrw_count))
    if r.inflow >= 25000 and r.outflow >= 0.8 * r.inflow:
        trig.append(("Rapid movement of funds", 30 + min(10, r.inflow / 50000), r.outflow, 0))
    if r.rw_count >= 2:
        trig.append(("Large round-dollar wires", 38 + min(10, r.rw_count * 2), r.rw_sum, r.rw_count))
    for scen, base, amt, cnt in trig:
        score = float(np.clip(base + kyc + rng.normal(0, 4), 5, 99))
        alerts.append((r.customer_id, r.bucket, scen, r.last_ts, score, float(amt), int(cnt), r.role))
al = pd.DataFrame(alerts, columns=["customer_id", "bucket", "scenario", "last_ts", "rule_score", "triggered_amount", "triggered_txn_count", "role"])
al["alert_ts"] = al.last_ts.dt.normalize() + pd.Timedelta(days=1, hours=6)
al = al[al.alert_ts <= pd.Timestamp(END) + pd.Timedelta(days=1)]
al["lookback_start"] = (pd.Timestamp(START) + pd.to_timedelta(al.bucket * 14, unit="D")).dt.date
al["lookback_end"] = al.last_ts.dt.date
al = al.sort_values("alert_ts").reset_index(drop=True)
al.insert(0, "alert_id", [f"AL-{26_000 + i}" for i in range(len(al))])
al["account_id"] = al.customer_id.map(primary_acct)
al["rule_score"] = al.rule_score.round(0)

ANALYSTS = ["j.okafor", "m.santos", "r.feldman", "a.nguyen", "l.baptiste", "d.kowalski", "s.haddad",
            "p.moreau", "t.reyes", "k.ishikawa", "e.brandt", "n.castillo"]
win_by_cust = {}
for ring in hist_rings:
    for m in ring["members"] + [ring["hub"]]:
        win_by_cust[customers.loc[m, "customer_id"]] = ring["window"]
for s, w in solo_windows.items():
    win_by_cust[customers.loc[s, "customer_id"]] = w
status, disp_ts, analyst, hours = [], [], [], []
for r in al.itertuples():
    ad = r.alert_ts.date()
    prog = (ad - START).days / N_DAYS
    w = win_by_cust.get(r.customer_id)
    in_win = w is not None and (w[0] - dt.timedelta(days=7)) <= ad <= (w[1] + dt.timedelta(days=21))
    if r.role.startswith("ring"):
        s = "open" if ad >= OPEN_CUTOFF else "closed_no_sar"   # August alerts were closed in isolation
    elif ad >= OPEN_CUTOFF:
        s = "open" if rng.random() < 0.9 else "in_review"
    elif ad >= OPEN_CUTOFF - dt.timedelta(days=18) and rng.random() < 0.35:
        s = "in_review"
    elif in_win:
        s = "sar_filed" if rng.random() < 0.6 else "closed_no_sar"
    else:
        s = "sar_filed" if rng.random() < 0.008 else "closed_no_sar"
    status.append(s)
    if s in ("closed_no_sar", "sar_filed"):
        triage = rng.gamma(2, 2 + 5 * prog)  # triage time grows with the backlog
        disp_ts.append(r.alert_ts + pd.Timedelta(days=float(triage)))
        analyst.append(ANALYSTS[rng.integers(len(ANALYSTS))])
        hours.append(round(float(rng.gamma(2, 0.7 if s == "closed_no_sar" else 3)), 1))
    else:
        disp_ts.append(pd.NaT)
        analyst.append(ANALYSTS[rng.integers(len(ANALYSTS))] if s == "in_review" else None)
        hours.append(np.nan)
al["status"] = status
al["disposition_ts"] = pd.to_datetime(disp_ts)
al["assigned_analyst"] = analyst
al["analyst_hours"] = hours

# SAR cases: one per (customer, 30-day window) of sar_filed alerts
sar = al[al.status == "sar_filed"].copy()
sar["grp"] = sar.customer_id + "_" + (sar.alert_ts.dt.dayofyear // 30).astype(str)
cases = []
for i, (k, grp) in enumerate(sar.groupby("grp")):
    det = grp.alert_ts.min()
    prog = (det.date() - START).days / N_DAYS
    days_to_file = int(np.clip(rng.gamma(6, (17 + 14 * prog) / 6), 6, 75))
    filed = det + pd.Timedelta(days=days_to_file)
    if filed.date() > END:
        continue
    c_role = grp.role.iloc[0]
    typ = "Structuring / funnel account" if c_role in ("hist_ring", "hist_ring_hub") else {
        "Cash structuring - below CTR threshold": "Structuring", "Wire to high-risk jurisdiction": "High-risk jurisdiction wires",
        "Rapid movement of funds": "Pass-through / rapid movement", "Large round-dollar wires": "Suspicious wire activity",
        "High cash volume vs. expected profile": "Unexplained cash activity"}[grp.scenario.iloc[0]]
    cases.append(dict(case_id=f"CASE-{7000 + i}", customer_id=grp.customer_id.iloc[0], primary_alert_id=grp.alert_id.iloc[0],
                      alert_count=len(grp), typology=typ, detection_ts=det, case_opened_ts=det + pd.Timedelta(days=int(rng.integers(1, 5))),
                      sar_filed_ts=filed, days_to_file=days_to_file, sla_breached=bool(days_to_file > 30),
                      amount_involved=float(round(grp.triggered_amount.sum(), 2)), filed_by=grp.assigned_analyst.iloc[0],
                      bsa_filing_id=f"31000{rng.integers(10**9, 10**10)}", decision_source="legacy_manual"))
sar_cases = pd.DataFrame(cases)
al = al.drop(columns=["bucket", "last_ts", "role"])
dispo = al.status.isin(["closed_no_sar", "sar_filed"]).sum()
print(f"alerts: {len(al):,} | open {int((al.status=='open').sum())} | in_review {int((al.status=='in_review').sum())} "
      f"| sar_filed {int((al.status=='sar_filed').sum())} | FP rate {(al.status=='closed_no_sar').sum()/dispo:.1%} | cases {len(sar_cases)}")
print(al[al.customer_id.isin(RING_IDS)][["alert_id", "customer_id", "scenario", "alert_ts", "rule_score", "status"]].to_string())

attrs = pd.concat([
    customers[["customer_id", "address"]].rename(columns={"address": "attr_value"}).assign(attr_type="address"),
    customers[["customer_id", "phone"]].rename(columns={"phone": "attr_value"}).assign(attr_type="phone"),
    customers[["customer_id", "device_id"]].rename(columns={"device_id": "attr_value"}).assign(attr_type="device"),
], ignore_index=True)
branches = pd.DataFrame(BRANCHES, columns=["branch_id", "branch_name", "city"])


# ---------------------------------------------------------------------------
# 7. Write to Unity Catalog
# ---------------------------------------------------------------------------
def get_spark():
    try:
        from databricks.connect import DatabricksSession
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        from pyspark.sql import SparkSession
        return SparkSession.builder.getOrCreate()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--catalog", default="demo_generator")
    p.add_argument("--schema", default="aml_sar_copilot")
    a, _ = p.parse_known_args()
    spark = get_spark()
    fq = f"{a.catalog}.{a.schema}"
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fq}")
    tables = {
        "customers": (customers.drop(columns=["role"]), "KYC customer master (individuals + businesses) with risk rating, identity attributes and expected monthly cash activity."),
        "accounts": (accounts, "Deposit accounts per customer."),
        "branches": (branches, "Northwind Federal branch network (South Florida)."),
        "transactions": (tx.drop(columns=["bucket"]), "12 months of core-banking transactions: cash, ACH, wires, P2P and internal transfers. cash_below_ctr = cash deposit between $8,000 and $9,999.99."),
        "customer_attributes": (attrs, "Identity attributes (address / phone / online-banking device) used for entity resolution."),
        "alerts": (al, "Rules-based transaction-monitoring (TMS) alerts with rule score and investigator disposition (open, in_review, closed_no_sar = false positive, sar_filed)."),
        "sar_cases": (sar_cases, "Historical SAR cases filed with FinCEN, incl. detection-to-filing days (30-day regulatory SLA)."),
    }
    for name, (pdf, comment) in tables.items():
        pdf = pdf.copy()
        for col in pdf.columns:
            if pdf[col].dtype == object:
                pdf[col] = pdf[col].astype(object).where(pdf[col].notna(), None)
        sdf = spark.createDataFrame(pdf)
        sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.{name}")
        spark.sql(f"COMMENT ON TABLE {fq}.{name} IS '{comment}'")
        print(f"  wrote {fq}.{name}: {len(pdf):,} rows")


if __name__ == "__main__":
    main()
