#!/usr/bin/env python
"""
Veridian Mobile — Churn Retention Desk: self-contained synthetic data + gold build.

STORY — "Churn isn't one problem, it's three — and the blanket discount fixes none of them"
Veridian Mobile (fictional US regional carrier, ~32K postpaid accounts in this sample)
watched monthly postpaid churn climb from ~1.0% to ~1.9% over the summer of 2026.
Three planted, independent drivers explain it:

  1. NETWORK — a 5G standalone-core migration on 2026-06-10 degraded 5 cell sites in
     the Southwest (PHX-03, PHX-07, PHX-08, TUS-02, LVS-05). Dropped-call rate on those
     sites jumps from ~0.8% to ~3.8% and 5G download speed collapses.
  2. BILL SHOCK — the "Switch & Save 12" acquisition campaign (Aug–Oct 2025, $15/line
     off for 12 months) rolls off in Aug–Oct 2026. Those accounts see a ~+25-35% bill.
  3. COMPETITOR — Crest Wireless (fictional) launched a "$25/line Unlimited" promo on
     2026-07-01 in 8 Southwest + Texas markets. Port-out PIN requests spike there.

And a fourth, the CMO's "aha": the retention desk has been answering all three with the
same blanket 20% discount (DISC-20). In retention_offer_history the driver-MATCHED offer
(network care pack for network, rate-lock for bill shock, competitive match for Crest)
saves ~2x as many customers at a fraction of the cost — DISC-20 also breaches the margin
guardrail on most accounts.

Tables written to <catalog>.<schema>:
  customers                 account dim (+ status / churn_date / exit reason)
  network_quality_monthly   per account-month dropped-call rate, 5G speed, outage minutes
  billing_monthly           per account-month bill, promo discount, bill change %
  care_calls                call-center interactions (+ transcript for the last ~90 days)
  port_out_requests         number-transfer PIN requests (strong churn precursor)
  competitor_promos         market-level competitor offers
  offer_catalog             retention offers + cost model + guardrail parameters
  retention_offer_history   past offers made by the desk and their outcome
  retention_decisions       (empty) write-back target for the app's accept/decline
  gold_churn_monthly        churn rate by month x region x market x segment x plan
  gold_network_sites        dropped-call rate + churn by cell site x month

Downstream (separate tasks): src/ai/transcript_insights.sql (AI Functions on a warehouse)
and src/ml/train_churn_model.py (XGBoost + SHAP drivers, UC-registered, batch-scored).

Runs two ways (same plain .py — NOT a notebook):
  • DAB spark_python_task — ambient SparkSession; `--catalog <c> --schema <s>`.
  • Locally — Databricks Connect serverless (Python 3.12 venv):
      DATABRICKS_CONFIG_PROFILE=<your-profile> python generate_data.py --catalog telecommunications \
          --schema churn_retention_copilot
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

from pyspark.sql import SparkSession  # noqa: E402

spark = SparkSession.getActiveSession()
if spark is None:
    from databricks.connect import DatabricksSession
    _profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
    spark = DatabricksSession.builder.profile(_profile).serverless(True).getOrCreate()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "telecommunications")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "churn_retention_copilot")
FQ = f"`{CATALOG}`.`{SCHEMA}`"
print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")

rng = np.random.default_rng(20260929)

# ---------------------------------------------------------------------------
# Time window: 12 months, Oct 2025 .. Sep 2026 (the "as-of" date is 2026-09-30).
# ---------------------------------------------------------------------------
MONTHS = pd.date_range("2025-10-01", "2026-09-01", freq="MS")
NM = len(MONTHS)
M_IDX = {m.strftime("%Y-%m"): i for i, m in enumerate(MONTHS)}
AS_OF = dt.date(2026, 9, 30)

# ---------------------------------------------------------------------------
# Geography: 6 regions x 4 markets, 10 cell sites per market.
# ---------------------------------------------------------------------------
MARKETS = {
    "Southwest": [("Phoenix", "PHX"), ("Tucson", "TUS"), ("Las Vegas", "LVS"), ("Albuquerque", "ABQ")],
    "Texas":     [("Dallas", "DAL"), ("Houston", "HOU"), ("Austin", "AUS"), ("San Antonio", "SAT")],
    "Southeast": [("Atlanta", "ATL"), ("Charlotte", "CLT"), ("Orlando", "ORL"), ("Nashville", "BNA")],
    "Midwest":   [("Chicago", "CHI"), ("Columbus", "CMH"), ("Minneapolis", "MSP"), ("Kansas City", "MKC")],
    "Northeast": [("Boston", "BOS"), ("Philadelphia", "PHL"), ("Pittsburgh", "PIT"), ("Hartford", "HFD")],
    "West":      [("Denver", "DEN"), ("Portland", "PDX"), ("Sacramento", "SMF"), ("Salt Lake City", "SLC")],
}
REGION_W = {"Southwest": 0.20, "Texas": 0.20, "Southeast": 0.17, "Midwest": 0.15, "Northeast": 0.14, "West": 0.14}
MIGRATED_SITES = {"PHX-03", "PHX-07", "PHX-08", "TUS-02", "LVS-05"}   # 5G SA core migration
MIGRATION_MONTH = M_IDX["2026-06"]
CREST_MARKETS = {"PHX", "TUS", "LVS", "ABQ", "DAL", "HOU", "AUS", "SAT"}
CREST_START = M_IDX["2026-07"]
SUMMIT_MARKETS = {"BOS", "PHL", "PIT", "HFD"}
SUMMIT_START = M_IDX["2025-11"]

market_rows = [(r, city, code) for r, lst in MARKETS.items() for city, code in lst]
SITES = [f"{code}-{i:02d}" for _, _, code in market_rows for i in range(1, 11)]
# chronic weak-coverage sites (not the migration) — background noise
CHRONIC = set(rng.choice([s for s in SITES if s not in MIGRATED_SITES], 9, replace=False))

# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------
N_BASE = 29_500
N_CAMPAIGN = 2_700        # Switch & Save 12 acquisitions, Aug–Oct 2025
N = N_BASE + N_CAMPAIGN

FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Sofia", "David", "Aisha", "Daniel", "Grace",
         "Luis", "Emily", "Kevin", "Priya", "Marcus", "Hannah", "Andre", "Olivia", "Tyler", "Mei",
         "Jordan", "Camila", "Brandon", "Fatima", "Ethan", "Nora", "Isaac", "Rosa", "Caleb", "Leah",
         "Omar", "Chloe", "Diego", "Ava", "Nathan", "Zoe", "Samuel", "Elena", "Victor", "Ruby"]
LAST = ["Garcia", "Johnson", "Nguyen", "Smith", "Patel", "Brown", "Martinez", "Kim", "Davis", "Lopez",
        "Wilson", "Anderson", "Thomas", "Hernandez", "Moore", "Jackson", "Lee", "Walker", "Young", "Allen",
        "King", "Wright", "Scott", "Torres", "Hill", "Flores", "Green", "Adams", "Baker", "Rivera",
        "Campbell", "Mitchell", "Carter", "Roberts", "Chen", "Reyes", "Okafor", "Silva", "Murphy", "Ortiz"]

regions = rng.choice(list(REGION_W), N, p=list(REGION_W.values()))
market_idx = np.array([rng.integers(0, 4) for _ in range(N)])
market_code = np.array([MARKETS[r][i][1] for r, i in zip(regions, market_idx)])
market_city = np.array([MARKETS[r][i][0] for r, i in zip(regions, market_idx)])
# Phoenix is the biggest market in the Southwest; skew Southwest accounts towards PHX
sw = regions == "Southwest"
market_code[sw] = rng.choice(["PHX", "TUS", "LVS", "ABQ"], sw.sum(), p=[0.42, 0.2, 0.24, 0.14])
market_city[sw] = pd.Series(market_code[sw]).map({"PHX": "Phoenix", "TUS": "Tucson", "LVS": "Las Vegas", "ABQ": "Albuquerque"}).values
site_num = rng.integers(1, 11, N)
cell_site = np.array([f"{c}-{s:02d}" for c, s in zip(market_code, site_num)])
# the migrated sites are dense urban sites — re-home ~half of their market's other accounts there
_mig_by_mkt = {"PHX": ["PHX-03", "PHX-07", "PHX-08"], "TUS": ["TUS-02"], "LVS": ["LVS-05"]}
for _mk, _sites in _mig_by_mkt.items():
    _ix = np.nonzero((market_code == _mk) & (rng.random(N) < 0.22))[0]
    cell_site[_ix] = rng.choice(_sites, len(_ix))

segment = rng.choice(["Consumer", "Family", "Small Business"], N, p=[0.58, 0.28, 0.14])
lines = np.where(segment == "Consumer", rng.choice([1, 2], N, p=[0.68, 0.32]),
         np.where(segment == "Family", rng.choice([3, 4, 5], N, p=[0.45, 0.4, 0.15]),
                  rng.choice([2, 3, 4, 6, 8], N, p=[0.25, 0.3, 0.25, 0.12, 0.08])))
PLAN_PRICE = {"Unlimited Premium": 85.0, "Unlimited Plus": 70.0, "Unlimited Starter": 60.0,
              "Essentials 15GB": 45.0, "Business Unlimited": 65.0}
plan = np.where(segment == "Small Business", "Business Unlimited",
                rng.choice(["Unlimited Premium", "Unlimited Plus", "Unlimited Starter", "Essentials 15GB"],
                           N, p=[0.2, 0.36, 0.28, 0.16]))
per_line = np.array([PLAN_PRICE[p] for p in plan])
ml_disc = np.where(lines >= 3, 0.25, np.where(lines == 2, 0.10, 0.0))
list_arpu = np.round(per_line * lines * (1 - ml_disc) + rng.choice([0, 0, 0, 10, 15], N), 2)

# activation month index relative to MONTHS[0] (negative = before the window)
tenure_end = np.clip(np.round(rng.gamma(1.6, 22, N)).astype(int), 1, 150)
act_idx = (NM - 1) - tenure_end + 1          # month index activated (tenure counted at Sep-26)
# the campaign cohort: activated Aug, Sep, Oct 2025 (idx -2, -1, 0)
camp = np.zeros(N, bool)
camp[N_BASE:] = True
act_idx[camp] = rng.choice([-2, -1, 0], N_CAMPAIGN, p=[0.3, 0.4, 0.3])

# Switch & Save 12 promo: campaign cohort mostly; a trickle of other cohorts
promo = np.where(camp, rng.random(N) < 0.86, rng.random(N) < 0.10)
promo_start = act_idx.copy()
promo_end = promo_start + 12                   # first month billed at full price
promo_disc = np.where(promo, 15.0 * lines, 0.0)

contract = rng.choice(["Device installment (24m)", "Bring your own device"], N, p=[0.57, 0.43])
device_balance = np.where(np.char.startswith(contract.astype(str), "Device"), np.round(rng.uniform(0, 900, N), 0), 0.0)
autopay = rng.random(N) < 0.64
frailty = rng.lognormal(0, 0.35, N)

# ---------------------------------------------------------------------------
# Monthly network quality + billing + churn simulation
# ---------------------------------------------------------------------------
site_arr = cell_site
is_mig = np.isin(site_arr, list(MIGRATED_SITES))
is_chronic = np.isin(site_arr, list(CHRONIC))
dcr_base = rng.lognormal(np.log(0.75), 0.30, N)
crest = np.isin(market_code, list(CREST_MARKETS))
summit = np.isin(market_code, list(SUMMIT_MARKETS))

active = np.zeros(N, bool)
churned = np.zeros(N, bool)
churn_month = np.full(N, -1)
net_rows, bill_rows = [], []
pin_events, call_events = [], []
prev_bill = np.full(N, np.nan)
bill_hist = np.full((N, NM), np.nan)

for m in range(NM):
    newly = (act_idx == m)
    active |= (act_idx <= m) & ~churned
    # --- network
    dcr = dcr_base * rng.lognormal(0, 0.12, N)
    dcr = np.where(is_chronic, dcr + 1.3, dcr)
    if m == MIGRATION_MONTH:
        dcr = np.where(is_mig, dcr + 1.6, dcr)
    elif m > MIGRATION_MONTH:
        dcr = np.where(is_mig, dcr + 3.0 + rng.normal(0, 0.3, N), dcr)
    dcr = np.round(np.clip(dcr, 0.1, 9.0), 2)
    dl = rng.normal(210, 35, N)
    dl = np.where(is_chronic, dl * 0.6, dl)
    dl = np.where(is_mig & (m >= MIGRATION_MONTH), dl * (0.55 if m == MIGRATION_MONTH else 0.3), dl)
    dl = np.round(np.clip(dl, 8, 400), 1)
    outage = np.round(rng.gamma(1.2, 6, N) + np.where(is_mig & (m >= MIGRATION_MONTH), rng.gamma(2, 40, N), 0), 0)
    # --- billing
    promo_on = promo & (m >= promo_start) & (m < promo_end)
    fees = np.round(rng.gamma(1.5, 2.0, N), 2)
    overage = np.where(rng.random(N) < 0.05, np.round(rng.uniform(5, 40, N), 2), 0.0)
    bill = np.round(list_arpu - np.where(promo_on, promo_disc, 0.0) + fees + overage, 2)
    bill_hist[:, m] = bill
    ref = bill_hist[:, max(0, m - 3)]
    bill_change = np.where(np.isnan(ref) | (m < 1), 0.0, (bill - ref) / ref)
    months_since_expiry = m - promo_end
    # --- hazard
    net_mult = 1 + 1.35 * np.clip(dcr - 1.2, 0, None)
    shock_mult = np.where(promo & (months_since_expiry == 0), 4.0,
                 np.where(promo & (months_since_expiry == 1), 3.2,
                 np.where(promo & (months_since_expiry == 2), 1.9, 1.0)))
    comp_mult = np.where(crest & (m >= CREST_START), 2.0, 1.0) * np.where(summit & (m >= SUMMIT_START), 1.12, 1.0)
    ten_now = (m - act_idx) + 1
    ten_mult = np.where(ten_now < 6, 1.35, np.where(ten_now > 36, 0.72, 1.0))
    lock_mult = np.where(device_balance > 250, 0.6, 1.0)
    misc = np.where(autopay, 0.85, 1.0) * np.where(lines >= 3, 0.82, 1.0) * np.where(segment == "Small Business", 0.85, 1.0)
    h = 0.0125 * net_mult * shock_mult * comp_mult * ten_mult * lock_mult * misc * frailty
    h = np.clip(h, 0, 0.6)
    elig = active & ~newly
    churn_now = elig & (rng.random(N) < h)
    # --- care calls (Poisson by driver intensity)
    lam = 0.012 + 0.15 * (dcr > 2.0) + 0.30 * (shock_mult > 1.5) + 0.06 * (comp_mult > 1.2) + 0.7 * churn_now
    n_calls = np.where(active, rng.poisson(lam), 0)
    for i in np.nonzero(n_calls)[0]:
        for _ in range(n_calls[i]):
            call_events.append((i, m, bool(churn_now[i]), float(dcr[i]), float(bill_change[i]),
                                bool(shock_mult[i] > 1.5), bool(comp_mult[i] > 1.2)))
    # --- port-out PIN requests: most churners request one; "shoppers" too
    pin_churn = churn_now & (rng.random(N) < 0.78)
    pin_shop = active & ~churn_now & (rng.random(N) < np.clip(h * 2.2, 0, 0.35))
    for i in np.nonzero(pin_churn | pin_shop)[0]:
        pin_events.append((i, m, bool(churn_now[i])))
    # --- rows
    idx = np.nonzero(active)[0]
    for i in idx:
        net_rows.append((i, m, dcr[i], dl[i], outage[i]))
        bill_rows.append((i, m, bill[i], float(promo_disc[i] if promo_on[i] else 0.0), round(float(bill_change[i]) * 100, 1),
                          overage[i]))
    churned |= churn_now
    churn_month[churn_now] = m
    active &= ~churn_now

print(f"accounts={N} churned={churned.sum()} active_end={active.sum()}")

cust_id = np.array([f"VM-{100000 + i}" for i in range(N)])
first = rng.choice(FIRST, N)
last = rng.choice(LAST, N)
act_date = [(MONTHS[0] + pd.DateOffset(months=int(a))).date() + dt.timedelta(days=int(d))
            for a, d in zip(act_idx, rng.integers(0, 27, N))]
churn_date = [None if cm < 0 else (MONTHS[cm].date() + dt.timedelta(days=int(rng.integers(0, 27)))) for cm in churn_month]


def exit_reason(i):
    m = churn_month[i]
    if m < 0:
        return None
    net = is_mig[i] and m >= MIGRATION_MONTH or is_chronic[i]
    shock = promo[i] and 0 <= m - promo_end[i] <= 2
    comp = crest[i] and m >= CREST_START
    opts = []
    if net: opts += ["Network quality"] * 3
    if shock: opts += ["Price / bill increase"] * 3
    if comp: opts += ["Competitor offer"] * 2
    opts += ["Moved / relocation", "Device / handset", "Customer service", "Price / bill increase", "Competitor offer"]
    return rng.choice(opts)


customers = pd.DataFrame({
    "customer_id": cust_id,
    "customer_name": [f"{a} {b}" for a, b in zip(first, last)],
    "segment": segment, "plan": plan, "lines": lines.astype(int),
    "region": regions, "market": market_city, "market_code": market_code, "cell_site_id": cell_site,
    "activation_date": act_date,
    "tenure_months": np.where(churn_month >= 0, churn_month - act_idx + 1, NM - act_idx).astype(int),
    "list_monthly_arpu": list_arpu,
    "contract_type": contract, "device_balance": device_balance, "autopay": autopay,
    "acquisition_promo": np.where(promo, "Switch & Save 12", None),
    "promo_end_date": [None if not p else (MONTHS[0] + pd.DateOffset(months=int(e))).date() for p, e in zip(promo, promo_end)],
    "status": np.where(churned, "Churned", "Active"),
    "churn_date": churn_date,
    "exit_reason": [exit_reason(i) for i in range(N)],
})
customers["current_monthly_bill"] = np.round(np.nan_to_num(bill_hist[np.arange(N), np.where(churn_month >= 0, churn_month, NM - 1)]), 2)

month_str = [m.date() for m in MONTHS]
net_df = pd.DataFrame(net_rows, columns=["i", "m", "dropped_call_rate_pct", "avg_5g_download_mbps", "outage_minutes"])
net_df.insert(0, "customer_id", cust_id[net_df.i.values])
net_df.insert(1, "month", [month_str[m] for m in net_df.m.values])
net_df.insert(2, "cell_site_id", cell_site[net_df.i.values])
net_df = net_df.drop(columns=["i", "m"])

bill_df = pd.DataFrame(bill_rows, columns=["i", "m", "bill_amount", "promo_discount", "bill_change_3m_pct", "overage_charges"])
bill_df.insert(0, "customer_id", cust_id[bill_df.i.values])
bill_df.insert(1, "month", [month_str[m] for m in bill_df.m.values])
bill_df = bill_df.drop(columns=["i", "m"])

pin_df = pd.DataFrame(pin_events, columns=["i", "m", "led_to_churn"])
pin_df["request_id"] = [f"PIN-{700000 + k}" for k in range(len(pin_df))]
pin_df["customer_id"] = cust_id[pin_df.i.values]
pin_df["request_date"] = [
    (churn_date[i] - dt.timedelta(days=int(rng.integers(2, 35)))) if (lc and churn_date[i]) else
    (MONTHS[m].date() + dt.timedelta(days=int(rng.integers(0, 27))))
    for i, m, lc in zip(pin_df.i, pin_df.m, pin_df.led_to_churn)]
pin_df["channel"] = rng.choice(["App", "Retail store", "Call center", "Web"], len(pin_df), p=[0.45, 0.2, 0.2, 0.15])
pin_df = pin_df[["request_id", "customer_id", "request_date", "channel", "led_to_churn"]]

comp_df = pd.DataFrame(
    [("CR-2026-07", "Crest Wireless", "$25/line Unlimited (4+ lines) — 12-month price lock", code, city, dt.date(2026, 7, 1), None, 25.0)
     for r, lst in MARKETS.items() for city, code in lst if code in CREST_MARKETS] +
    [("SM-2025-11", "Summit Mobile", "Free streaming bundle with any Unlimited plan", code, city, dt.date(2025, 11, 1), dt.date(2026, 2, 28), 55.0)
     for r, lst in MARKETS.items() for city, code in lst if code in SUMMIT_MARKETS],
    columns=["promo_id", "competitor", "offer_description", "market_code", "market", "start_date", "end_date", "per_line_price"])

# ---------------------------------------------------------------------------
# Care calls + transcripts (transcripts only for the last ~90 days: Jul–Sep 2026)
# ---------------------------------------------------------------------------
AGENTS = [f"AG-{k:03d}" for k in range(1, 61)]
TX_START = M_IDX["2026-07"]


def pick(xs):
    return xs[int(rng.integers(0, len(xs)))]


def transcript(theme, cancel, name, market, bill_delta, dcr):
    a = pick(["Thanks for calling Veridian Mobile, this is {ag}. Who do I have the pleasure of speaking with?",
              "Veridian Mobile customer care, my name is {ag}. How can I help you today?",
              "Hi, you've reached Veridian Mobile. I'm {ag} — what can I do for you?"]).format(ag=pick(["Dana", "Luis", "Keisha", "Tom", "Priya", "Marco", "Jen", "Sam"]))
    lines_ = [f"Agent: {a}", f"Customer: Hi, it's {name}."]
    up = int(round(abs(bill_delta) * 100)) if bill_delta else 30
    if theme == "network":
        lines_ += [pick([f"Customer: My calls keep dropping. Since June it's been every day — I'm in {market} and I work from home.",
                         f"Customer: The signal at my house in {market} has been terrible since your 5G upgrade. Calls cut out mid-sentence.",
                         f"Customer: I've had maybe ten dropped calls this week alone. My kids can't even stream on the bus anymore."]),
                   pick(["Agent: I'm sorry about that. I can see some network work was done at the site that serves your area.",
                         "Agent: I apologize. Let me check the tower status near you — I do see an open network ticket.",
                         "Agent: I understand how frustrating that is. Our engineers are aware of degraded service in your area."]),
                   pick(["Customer: That's what they told me last month too. Nothing has changed.",
                         "Customer: I'm paying for Unlimited and I can't make a phone call. That's not okay.",
                         "Customer: Wi-Fi calling helps at home but in the car it's useless."])]
    elif theme == "bill_shock":
        lines_ += [pick([f"Customer: My bill just went up by like {up} percent. Nobody told me the promo was ending.",
                         f"Customer: Why is my bill ${round(up * 1.2)} higher this month? I didn't change anything.",
                         "Customer: I signed up for Switch and Save and now the discount is just gone? That feels like bait and switch."]),
                   pick(["Agent: I see — your 12-month Switch and Save credit ended with this billing cycle.",
                         "Agent: Let me explain the charges. The promotional credit on your lines expired last month.",
                         "Agent: I understand. The introductory pricing was for twelve months and that period has completed."]),
                   pick(["Customer: So I'm just supposed to pay more for the exact same service?",
                         "Customer: That's a lot of money for a family of four. I need you to fix this.",
                         "Customer: Honestly, I feel misled."])]
    elif theme == "competitor":
        lines_ += [pick([f"Customer: Crest Wireless is offering twenty-five dollars a line in {market}. Can you match that?",
                         "Customer: My neighbor switched to Crest and pays half what I do. Give me a reason to stay.",
                         "Customer: I got a mailer from Crest with a price lock for a year. What can you do for me?"]),
                   pick(["Agent: I appreciate you giving us the chance. Let me look at what options are on your account.",
                         "Agent: I understand, that's an aggressive offer. Let me see what I can do.",
                         "Agent: Thanks for being upfront. Let me review your plan and loyalty options."]),
                   pick(["Customer: I've been with you for years, I'd rather not switch, but the math is the math.",
                         "Customer: If you can't get close to that I'm going to port out.",
                         "Customer: I'm not trying to be difficult, I just can't justify the difference."])]
    elif theme == "device":
        lines_ += [pick(["Customer: My phone's battery dies by noon. Am I eligible for an upgrade yet?",
                         "Customer: The screen cracked and I want to know my options with the installment plan.",
                         "Customer: I want the new phone but I still owe on this one."]),
                   "Agent: Let me pull up your device installment details.",
                   pick(["Customer: Okay, that's helpful.", "Customer: Can you waive any of the remaining balance?",
                         "Customer: That's more than I expected."])]
    elif theme == "plan_change":
        lines_ += [pick(["Customer: I'd like to add a line for my daughter.",
                         "Customer: I want to move to a cheaper plan, I barely use my data.",
                         "Customer: Can I add international calling to Mexico?"]),
                   "Agent: Absolutely, I can help with that.", "Customer: Great, thank you."]
    else:  # billing dispute
        lines_ += [pick(["Customer: There's a roaming charge on my bill from a trip — I had the travel pass.",
                         "Customer: I was charged twice for the same month.",
                         "Customer: There's a late fee but I'm on autopay."]),
                   "Agent: Let me look into that charge for you.",
                   pick(["Customer: Please remove it.", "Customer: This keeps happening.", "Customer: Okay."])]
    if cancel:
        lines_ += [pick(["Customer: Honestly I'm ready to leave. I need my transfer PIN.",
                         "Customer: I want to cancel. How do I get the port-out PIN?",
                         "Customer: If this isn't fixed today I'm switching carriers."]),
                   pick(["Agent: I'd really like to keep you. Let me see what I can offer before you decide.",
                         "Agent: I understand. Before I generate the PIN, can I review some options with you?",
                         "Agent: I hear you. Let me escalate this to our loyalty team."]),
                   pick(["Customer: I'll think about it, but I'm not happy.", "Customer: Just send me the PIN.",
                         "Customer: Fine, but this is the last time."])]
    else:
        lines_ += [pick(["Agent: Is there anything else I can help with today?", "Agent: I've made a note on your account."]),
                   pick(["Customer: No, that's it. Thanks.", "Customer: Okay, thanks for your help.", "Customer: I hope it gets better."])]
    return "\n".join(lines_)


call_rows = []
for k, (i, m, is_churn, dcr_i, bc, shock, comp) in enumerate(call_events):
    themes, w = ["plan_change", "device", "billing_dispute"], [0.35, 0.35, 0.30]
    if dcr_i > 2.0: themes.append("network"); w.append(2.2)
    if shock: themes.append("bill_shock"); w.append(2.6)
    if comp: themes.append("competitor"); w.append(1.4 if not is_churn else 2.2)
    w = np.array(w) / sum(w)
    theme = themes[int(rng.choice(len(themes), p=w))]
    cancel = is_churn and rng.random() < 0.8 or (theme in ("network", "bill_shock", "competitor") and rng.random() < 0.25)
    day = int(rng.integers(0, 27))
    ts = dt.datetime.combine(MONTHS[m].date() + dt.timedelta(days=day), dt.time(int(rng.integers(8, 20)), int(rng.integers(0, 60))))
    if churn_date[i] and ts.date() > churn_date[i]:
        ts = dt.datetime.combine(churn_date[i] - dt.timedelta(days=1), ts.time())
    reason_code = {"network": "TECH-COVERAGE", "bill_shock": "BILL-INQUIRY", "competitor": "RETENTION",
                   "device": "DEVICE", "plan_change": "PLAN-CHANGE", "billing_dispute": "BILL-DISPUTE"}[theme]
    tx = transcript(theme, cancel, customers.customer_name.iat[i].split()[0], market_city[i], bc, dcr_i) if m >= TX_START else None
    call_rows.append((f"CALL-{900000 + k}", cust_id[i], ts, reason_code, int(rng.gamma(3, 140)), pick(AGENTS),
                      "Escalated to loyalty" if cancel else pick(["Resolved", "Resolved", "Follow-up needed"]), tx))
calls_df = pd.DataFrame(call_rows, columns=["call_id", "customer_id", "call_ts", "reason_code", "duration_sec", "agent_id", "disposition", "transcript"])
print(f"care_calls={len(calls_df)} with transcript={calls_df.transcript.notna().sum()}")

# ---------------------------------------------------------------------------
# Offer catalog (cost model + guardrail parameters). cost_formula is evaluated by the
# app's guardrail engine AND by the SQL below — keep both in step.
#   margin guardrail: total_offer_cost <= GUARDRAIL_PCT x 12-month gross margin
#   (gross margin = 58% of monthly bill)  -> cap = 12 x bill x 0.58 x 0.30
# ---------------------------------------------------------------------------
offer_catalog = pd.DataFrame([
    ("NET-CARE", "Network Care Pack", "network",
     "Free 5G signal booster installed + $15/mo bill credit for 3 months + priority network ticket",
     "fixed", 165.0, 3, "Customer is on a degraded or chronic weak-coverage site (dropped-call rate > 2%)"),
    ("WIFI-CALL", "Wi-Fi Calling Setup + Credit", "network",
     "Guided Wi-Fi calling setup + $10/mo credit for 3 months", "fixed", 30.0, 3,
     "Any network complaint"),
    ("RATE-LOCK", "Loyalty Rate Lock", "bill_shock",
     "Restore 50% of the expired Switch & Save discount ($7.50/line/month) for 6 months", "per_line_month", 7.5, 6,
     "Switch & Save promo expired in the last 90 days"),
    ("GOODWILL-50", "Goodwill Bill Credit", "care",
     "$50 one-time goodwill credit", "fixed", 50.0, 1, "Any account"),
    ("CREST-MATCH", "Competitive Loyalty Offer", "competitor",
     "$10/line/month loyalty credit for 6 months + 12-month price lock (answers the Crest $25/line promo)", "per_line_month", 10.0, 6,
     "Market has an active Crest Wireless promo"),
    ("UPGRADE-200", "Early Upgrade Credit", "device",
     "$200 off a new device on a fresh 24-month installment plan", "fixed", 200.0, 24,
     "Device installment account"),
    ("DISC-20", "Blanket 20% Discount", "any",
     "20% off the monthly bill for 12 months — the desk's legacy default", "pct_bill_month", 0.20, 12, "Any account"),
    ("HOTSPOT-6", "Premium Hotspot Add-on", "any",
     "Free 50GB premium hotspot add-on for 6 months", "fixed", 60.0, 6, "Unlimited plans"),
], columns=["offer_code", "offer_name", "target_driver", "description", "cost_type", "cost_value", "duration_months", "eligibility"])
offer_catalog["guardrail_pct_of_12m_margin"] = 0.30
offer_catalog["gross_margin_pct"] = 0.58


def offer_cost(code, bill, n_lines):
    r = offer_catalog.set_index("offer_code").loc[code]
    if r.cost_type == "fixed":
        return float(r.cost_value)
    if r.cost_type == "per_line_month":
        return float(r.cost_value * n_lines * r.duration_months)
    return float(r.cost_value * bill * r.duration_months)


# ---------------------------------------------------------------------------
# Retention offer history (Apr–Sep 2026). Planted: DISC-20 was the default until the
# Aug "driver-matched" pilot. Acceptance depends on offer x driver match.
# ---------------------------------------------------------------------------
ACCEPT = {  # driver -> offer -> P(accept)
    "network":    {"NET-CARE": 0.56, "WIFI-CALL": 0.34, "DISC-20": 0.21, "GOODWILL-50": 0.15, "HOTSPOT-6": 0.10, "CREST-MATCH": 0.22, "RATE-LOCK": 0.18, "UPGRADE-200": 0.20},
    "bill_shock": {"RATE-LOCK": 0.64, "DISC-20": 0.39, "GOODWILL-50": 0.27, "HOTSPOT-6": 0.12, "CREST-MATCH": 0.40, "NET-CARE": 0.10, "WIFI-CALL": 0.08, "UPGRADE-200": 0.18},
    "competitor": {"CREST-MATCH": 0.49, "DISC-20": 0.30, "UPGRADE-200": 0.33, "GOODWILL-50": 0.14, "RATE-LOCK": 0.28, "HOTSPOT-6": 0.12, "NET-CARE": 0.10, "WIFI-CALL": 0.06},
    "care":       {"GOODWILL-50": 0.44, "DISC-20": 0.35, "HOTSPOT-6": 0.25, "UPGRADE-200": 0.30, "RATE-LOCK": 0.25, "CREST-MATCH": 0.25, "NET-CARE": 0.15, "WIFI-CALL": 0.12},
}
MATCHED = {"network": "NET-CARE", "bill_shock": "RATE-LOCK", "competitor": "CREST-MATCH", "care": "GOODWILL-50"}

hist = []
act_pool = np.nonzero(~churned)[0]
churn_pool = np.nonzero(churned & (churn_month >= M_IDX["2026-04"]))[0]
H_MONTHS = list(range(M_IDX["2026-04"], NM))
for k in range(6200):
    m = int(rng.choice(H_MONTHS, p=np.array([0.12, 0.13, 0.15, 0.18, 0.21, 0.21])))
    driver = rng.choice(["network", "bill_shock", "competitor", "care"], p=[0.30, 0.30, 0.25, 0.15])
    pilot = m >= M_IDX["2026-08"]
    if pilot and rng.random() < 0.62:
        offer = MATCHED[driver]; strategy = "Driver-matched (pilot)"
    elif rng.random() < 0.68:
        offer = "DISC-20"; strategy = "Blanket discount"
    else:
        offer = rng.choice(list(ACCEPT[driver])); strategy = "Rep discretion"
    accepted = rng.random() < ACCEPT[driver][offer]
    if accepted:
        i = int(rng.choice(act_pool))
        retained = rng.random() < 0.93
    else:
        i = int(rng.choice(churn_pool)) if rng.random() < 0.62 else int(rng.choice(act_pool))
        retained = not churned[i]
    b = float(customers.current_monthly_bill.iat[i])
    cost = offer_cost(offer, b, int(lines[i]))
    hist.append((f"OFR-{500000 + k}", cust_id[i], MONTHS[m].date() + dt.timedelta(days=int(rng.integers(0, 27))),
                 driver, offer, strategy, round(cost, 2), bool(accepted), bool(retained and accepted),
                 round(b, 2), round(b * 12 if (accepted and retained) else 0.0, 2), pick(AGENTS)))
hist_df = pd.DataFrame(hist, columns=["offer_id", "customer_id", "offer_date", "primary_driver", "offer_code", "offer_strategy",
                                      "offer_cost", "accepted", "saved", "monthly_bill", "annual_revenue_saved", "agent_id"])

if os.environ.get("DRY_RUN"):
    c = customers
    cm = pd.Series(churn_month)
    act_start = [((act_idx < m) & ((churn_month < 0) | (churn_month >= m))).sum() for m in range(NM)]
    print("monthly churn %:", [round(100 * (churn_month == m).sum() / act_start[m], 2) for m in range(NM)])
    print(c.groupby("region").status.apply(lambda d: round(100 * (d == "Churned").mean(), 1)))
    print(c[c.status == "Churned"].exit_reason.value_counts())
    h = hist_df
    print(h.groupby(["primary_driver", "offer_code"]).saved.mean().unstack().round(2))
    print(h.groupby("offer_strategy").agg(n=("saved", "size"), save=("saved", "mean"), cost=("offer_cost", "mean")))
    print(pin_df.shape, calls_df.shape)
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# Write raw tables
# ---------------------------------------------------------------------------
def write(df, name, comment):
    sdf = spark.createDataFrame(df)
    sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.`{name}`")
    spark.sql(f"COMMENT ON TABLE {FQ}.`{name}` IS :c", args={"c": comment})
    print(f"  wrote {name}: {len(df):,}")


write(customers, "customers", "Veridian Mobile postpaid accounts (one row per account) with status, churn date and exit reason. As-of 2026-09-30.")
write(net_df, "network_quality_monthly", "Monthly network experience per account: dropped-call rate %, 5G download Mbps, outage minutes, serving cell site.")
write(bill_df, "billing_monthly", "Monthly bill per account with promo discount and 3-month bill change % (bill shock).")
write(calls_df, "care_calls", "Call-center interactions. transcript populated for calls from 2026-07-01 (analyzed by AI Functions into care_call_insights).")
write(pin_df, "port_out_requests", "Number-transfer (port-out) PIN requests — the strongest near-term churn precursor.")
write(comp_df, "competitor_promos", "Competitor promotions by market (Crest Wireless $25/line launched 2026-07-01 in Southwest + Texas).")
write(offer_catalog, "offer_catalog", "Retention offers with cost model and margin guardrail (cost <= 30% of 12-month gross margin).")
write(hist_df, "retention_offer_history", "Past retention offers made by the desk (Apr-Sep 2026) and their outcome. saved = accepted AND still active 90 days later.")

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {FQ}.retention_decisions (
  decision_id STRING, customer_id STRING, decided_at TIMESTAMP, offer_code STRING, offer_cost DOUBLE,
  decision STRING, churn_probability DOUBLE, primary_driver STRING, monthly_bill DOUBLE,
  annual_revenue_saved DOUBLE, decided_by STRING, channel STRING, outreach_message STRING)
COMMENT 'Write-back from the Retention Desk app: every accept/decline a retention specialist records.'""")

# ---------------------------------------------------------------------------
# Gold tables
# ---------------------------------------------------------------------------
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_churn_monthly
COMMENT 'Postpaid churn by month x region x market x segment x plan. churn_rate_pct = churned / active at start of month.'
AS
WITH months AS (SELECT explode(sequence(DATE'2025-10-01', DATE'2026-09-01', INTERVAL 1 MONTH)) AS month),
base AS (
  SELECT m.month, c.*
  FROM months m JOIN {FQ}.customers c
    ON date_trunc('MONTH', c.activation_date) < m.month
   AND (c.churn_date IS NULL OR date_trunc('MONTH', c.churn_date) >= m.month))
SELECT month, region, market, segment, plan,
       count(*) AS active_start,
       sum(CASE WHEN date_trunc('MONTH', churn_date) = month THEN 1 ELSE 0 END) AS churned,
       round(100.0 * sum(CASE WHEN date_trunc('MONTH', churn_date) = month THEN 1 ELSE 0 END) / count(*), 3) AS churn_rate_pct,
       round(sum(CASE WHEN date_trunc('MONTH', churn_date) = month THEN current_monthly_bill ELSE 0 END), 2) AS monthly_revenue_lost
FROM base GROUP BY ALL""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_network_sites
COMMENT 'Network experience and churn by serving cell site x month. The 5 sites migrated to the 5G SA core on 2026-06-10 stand out.'
AS
SELECT n.month, n.cell_site_id, c.market, c.region,
       count(*) AS accounts,
       round(avg(n.dropped_call_rate_pct), 2) AS avg_dropped_call_rate_pct,
       round(avg(n.avg_5g_download_mbps), 1) AS avg_5g_download_mbps,
       round(avg(n.outage_minutes), 1) AS avg_outage_minutes,
       sum(CASE WHEN date_trunc('MONTH', c.churn_date) = n.month THEN 1 ELSE 0 END) AS churned,
       n.cell_site_id IN ('PHX-03','PHX-07','PHX-08','TUS-02','LVS-05') AS migrated_to_5g_sa_core
FROM {FQ}.network_quality_monthly n JOIN {FQ}.customers c USING (customer_id)
GROUP BY ALL""")

# PK / FK (RELY) for Genie + Catalog Explorer
for t, col in [("customers", "customer_id"), ("offer_catalog", "offer_code"), ("care_calls", "call_id"),
               ("retention_offer_history", "offer_id"), ("port_out_requests", "request_id")]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN {col} SET NOT NULL")
        spark.sql(f"ALTER TABLE {FQ}.{t} ADD CONSTRAINT {t}_pk PRIMARY KEY ({col}) RELY")
    except Exception as e:  # re-runs: constraint exists
        print(f"  (pk {t}: {str(e).splitlines()[0][:80]})")
for t in ["network_quality_monthly", "billing_monthly", "care_calls", "port_out_requests", "retention_offer_history"]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.{t} ADD CONSTRAINT {t}_customer_fk FOREIGN KEY (customer_id) REFERENCES {FQ}.customers(customer_id) RELY")
    except Exception as e:
        print(f"  (fk {t}: {str(e).splitlines()[0][:80]})")

print(spark.sql(f"SELECT month, round(100*sum(churned)/sum(active_start),2) churn_pct, sum(churned) churned FROM {FQ}.gold_churn_monthly GROUP BY month ORDER BY month").toPandas().to_string())
print("done.")
