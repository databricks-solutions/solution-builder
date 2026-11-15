"""
Crestwood Snacks Co. — trade promotion ROI demo: synthetic data generator.

Self-contained (numpy + pandas + Spark). Writes the SILVER tables of
<catalog>.<schema> (the schema is created if missing):

  retailers                 5 retail accounts (funding method, JBP commitments, fixed fees)
  products                  10 salty-snack SKUs (list price, shelf price, unit COGS, brand family)
  calendar_weeks            104 history weeks + the 13 weeks of next quarter (holiday flags)
  promo_events              ~170 completed trade promotions (tactic, depth, feature/display, funding, fees)
  pos_weekly_sales          retailer x SKU x week sell-out (units, dollars, price, promo flag)  ~6,200 rows
  retailer_shipments        retailer x SKU x week sell-in (units shipped, units bought on deal)  ~6,200 rows
  promo_plan                next quarter's draft promo calendar (26 planned events)

Planted signal (what the demo uncovers):
  ValuMax Stores runs DEEP BOGO events (50% effective) funded OFF-INVOICE. They produce the
  biggest volume spikes in the portfolio (~+260% during the event) but lose money:
    * pantry loading — ValuMax's stock-up shoppers buy ahead, sales dip ~40% of the lift in the 4 weeks after
    * cannibalization — sister Crestwood Kettle / Classic SKUs lose ~25% of the lift during the event
    * forward buying — off-invoice deal money lets ValuMax buy ~35% extra at deal price and sell it later at full price
    * subsidised baseline — the 50% allowance is paid on every unit that would have sold anyway
  Feature + Display at a 20-25% TPR, settled scan-based, pays back at every retailer (incl. ValuMax).
  Next quarter's draft calendar still carries 4 ValuMax BOGO events — the copilot flags and re-plans them.

Dates are relative to "now" (the history ends last week; the plan covers the next 13 weeks) and
the RNG is seeded, so every run tells the same story.

Usage (job task or local Databricks Connect with Python 3.12):
  python generate_data.py --catalog retail_consumer_goods --schema trade_promotion_roi
"""
import argparse
import datetime as dt
import math

import numpy as np
import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument("--catalog", default="retail_consumer_goods")
parser.add_argument("--schema", default="trade_promotion_roi")
parser.add_argument("--dry-run", default="", help="write pickles to this dir instead of Delta (local tuning)")
args, _ = parser.parse_known_args()
CAT, SCH = args.catalog, args.schema

def get_spark():
    """Ambient session on Databricks (job task / notebook); Databricks Connect (serverless) locally."""
    try:
        from pyspark.sql import SparkSession
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except ImportError:
        from pyspark.sql import SparkSession
        return SparkSession.builder.getOrCreate()


spark = None if args.dry_run else get_spark()

rng = np.random.default_rng(42)

# ─────────────────────────────────────────────────────────────── calendar
TODAY = dt.date.today()
THIS_MONDAY = TODAY - dt.timedelta(days=TODAY.weekday())
N_HIST, N_PLAN = 104, 13
HIST_WEEKS = [THIS_MONDAY - dt.timedelta(weeks=N_HIST - i) for i in range(N_HIST)]   # ends last week
PLAN_WEEKS = [THIS_MONDAY + dt.timedelta(weeks=i + 1) for i in range(N_PLAN)]        # next 13 weeks
ALL_WEEKS = HIST_WEEKS + PLAN_WEEKS


def holiday_of(week_start: dt.date):
    """Snack-relevant US holiday weeks (week containing the day)."""
    end = week_start + dt.timedelta(days=6)
    y = week_start.year
    cands = []
    for yy in (y - 1, y, y + 1):
        # Super Bowl: 2nd Sunday of Feb
        feb1 = dt.date(yy, 2, 1)
        sb = feb1 + dt.timedelta(days=(6 - feb1.weekday()) % 7 + 7)
        cands.append(("Big Game", sb, 1.30))
        # Memorial Day: last Monday of May
        may31 = dt.date(yy, 5, 31)
        cands.append(("Memorial Day", may31 - dt.timedelta(days=may31.weekday()), 1.18))
        cands.append(("July 4th", dt.date(yy, 7, 4), 1.28))
        sep1 = dt.date(yy, 9, 1)
        cands.append(("Labor Day", sep1 + dt.timedelta(days=(0 - sep1.weekday()) % 7), 1.15))
        nov1 = dt.date(yy, 11, 1)
        cands.append(("Thanksgiving", nov1 + dt.timedelta(days=(3 - nov1.weekday()) % 7 + 21), 1.08))
        cands.append(("New Year", dt.date(yy, 12, 31), 1.12))
    for name, d, mult in cands:
        if week_start <= d <= end:
            return name, mult
    return None, 1.0


def season_mult(week_start: dt.date) -> float:
    doy = week_start.timetuple().tm_yday
    # summer grilling / picnic peak (early July), soft trough in January
    return 1.0 + 0.13 * math.sin(2 * math.pi * (doy - 100) / 365.25) + 0.04 * math.cos(4 * math.pi * (doy - 10) / 365.25)


# ─────────────────────────────────────────────────────────────── master data
RETAILERS = [
    # id, name, channel, region, stores, volume scale, price index, funding, JBP min events/qtr, fee scale
    ("R01", "ValuMax Stores", "Mass", "National", 1850, 1.00, 0.94, "off-invoice", 6, 1.00),
    ("R02", "Greenleaf Market", "Grocery", "West", 620, 0.42, 1.04, "scan-based", 0, 0.45),
    ("R03", "Harbor Fresh Grocers", "Grocery", "Northeast", 410, 0.31, 1.06, "scan-based", 0, 0.35),
    ("R04", "QuickPantry", "Convenience", "National", 3100, 0.19, 1.18, "scan-based", 0, 0.20),
    ("R05", "BulkWise Club", "Club", "National", 280, 0.26, 0.90, "off-invoice", 0, 0.30),
]
retailers = pd.DataFrame(RETAILERS, columns=[
    "retailer_id", "retailer_name", "channel", "region", "store_count", "volume_scale", "price_index",
    "default_funding_method", "jbp_min_events_per_quarter", "fee_scale"])
retailers["feature_fee_usd"] = (2500 * retailers.fee_scale).round(-2)
retailers["display_fee_usd"] = (3500 * retailers.fee_scale).round(-2)
retailers["scan_settlement_available"] = True   # scan-down settlement accepted for TPR / Feature+Display (not BOGO at off-invoice accounts)
retailers["key_account_manager"] = ["Tom Becker", "Aisha Karim", "Luis Ortega", "Mei Tanaka", "Dan Whitfield"]

PRODUCTS = [
    # sku, brand, name, size, srp, base units/week at ValuMax, brand family
    ("CK-SS-08", "Crestwood Kettle", "Crestwood Kettle Sea Salt 8 oz", "8 oz", 3.99, 9000, "Kettle"),
    ("CK-SS-13", "Crestwood Kettle", "Crestwood Kettle Sea Salt Family 13 oz", "13 oz", 5.79, 6200, "Kettle"),
    ("CK-JA-08", "Crestwood Kettle", "Crestwood Kettle Jalapeno 8 oz", "8 oz", 3.99, 3600, "Kettle"),
    ("CK-BB-08", "Crestwood Kettle", "Crestwood Kettle Honey BBQ 8 oz", "8 oz", 3.99, 4100, "Kettle"),
    ("CC-OR-10", "Crestwood Classic", "Crestwood Classic Original 10 oz", "10 oz", 4.29, 7200, "Classic"),
    ("CC-SO-10", "Crestwood Classic", "Crestwood Classic Sour Cream & Onion 10 oz", "10 oz", 4.29, 4600, "Classic"),
    ("RT-RS-12", "Ridgeline Tortilla", "Ridgeline Restaurant-Style Tortilla 12 oz", "12 oz", 4.49, 5600, "Ridgeline"),
    ("RT-LI-12", "Ridgeline Tortilla", "Ridgeline Hint of Lime Tortilla 12 oz", "12 oz", 4.49, 2900, "Ridgeline"),
    ("TW-MI-16", "Twistwell Pretzels", "Twistwell Mini Pretzels 16 oz", "16 oz", 3.79, 3100, "Twistwell"),
    ("CV-VP-18", "Crestwood Variety", "Crestwood Variety Pack 18 ct", "18 ct", 9.99, 2500, "Variety"),
]
products = pd.DataFrame(PRODUCTS, columns=["sku", "brand", "product_name", "pack_size", "srp_usd", "base_units", "brand_family"])
products["category"] = "Salty Snacks"
products["list_price_usd"] = (products.srp_usd * 0.64).round(2)      # manufacturer price to the retailer
products["unit_cogs_usd"] = (products.srp_usd * 0.20).round(2)
products["unit_margin_usd"] = (products.list_price_usd - products.unit_cogs_usd).round(2)
SKU = products.set_index("sku")
RET = retailers.set_index("retailer_id")

# ─────────────────────────────────────────────────────────────── tactic response (the "truth" the data encodes)
TACTICS = {
    # tactic: (standard depth, mfr funding share of the consumer discount, feature, display)
    "BOGO": (0.50, 0.50, True, False),
    "Feature + Display": (0.22, 0.50, True, True),
    "TPR": (0.18, 0.50, False, False),
    "Multi-buy": (0.30, 0.40, True, False),
}
# gross lift multiplier during the event (actual / baseline), by retailer
LIFT = {
    "R01": {"BOGO": 3.60, "Feature + Display": 3.20, "TPR": 1.60, "Multi-buy": 2.40},
    "R02": {"BOGO": 2.60, "Feature + Display": 3.00, "TPR": 1.48, "Multi-buy": 2.30},
    "R03": {"BOGO": 2.55, "Feature + Display": 2.95, "TPR": 1.47, "Multi-buy": 2.25},
    "R04": {"BOGO": 1.90, "Feature + Display": 2.30, "TPR": 1.46, "Multi-buy": 1.95},
    "R05": {"BOGO": 2.40, "Feature + Display": 2.60, "TPR": 1.52, "Multi-buy": 2.00},
}
# post-event dip (pantry loading) as a share of the gross incremental units, spread over 4 weeks
DIP = {
    "R01": {"BOGO": 0.36, "Feature + Display": 0.14, "TPR": 0.12, "Multi-buy": 0.24},
    "R02": {"BOGO": 0.24, "Feature + Display": 0.10, "TPR": 0.08, "Multi-buy": 0.18},
    "R03": {"BOGO": 0.24, "Feature + Display": 0.10, "TPR": 0.08, "Multi-buy": 0.18},
    "R04": {"BOGO": 0.10, "Feature + Display": 0.05, "TPR": 0.04, "Multi-buy": 0.08},
    "R05": {"BOGO": 0.22, "Feature + Display": 0.12, "TPR": 0.10, "Multi-buy": 0.15},
}
# sister-SKU cannibalization as a share of the gross incremental units (same brand family, same retailer)
CANNIB = {"BOGO": 0.24, "Feature + Display": 0.12, "TPR": 0.10, "Multi-buy": 0.15}
# forward buy (extra units the retailer buys at deal price) as a share of event POS units — off-invoice only
FWD = {"BOGO": 0.30, "Feature + Display": 0.20, "TPR": 0.18, "Multi-buy": 0.22}
DIP_SHAPE = np.array([0.42, 0.28, 0.18, 0.12])

# ─────────────────────────────────────────────────────────────── baseline (the ML model has to learn this)
def baseline_units(rid: str, sku: str, wk_idx: int, week_start: dt.date) -> float:
    r, p = RET.loc[rid], SKU.loc[sku]
    trend = 1.0 + 0.030 * (wk_idx / 52.0)
    _, hol = holiday_of(week_start)
    # regular shelf price index lowers baseline slightly at pricier channels
    price_eff = (r.price_index) ** -1.1
    return p.base_units * r.volume_scale * season_mult(week_start) * hol * trend * price_eff


# ─────────────────────────────────────────────────────────────── historical promo calendar
TACTIC_MIX = {
    "R01": [("BOGO", 0.42), ("Feature + Display", 0.26), ("TPR", 0.20), ("Multi-buy", 0.12)],
    "R02": [("Feature + Display", 0.46), ("TPR", 0.30), ("Multi-buy", 0.24)],
    "R03": [("Feature + Display", 0.36), ("TPR", 0.36), ("Multi-buy", 0.18), ("BOGO", 0.10)],
    "R04": [("TPR", 0.55), ("Multi-buy", 0.45)],
    "R05": [("TPR", 0.50), ("Feature + Display", 0.30), ("Multi-buy", 0.20)],
}
EVENTS_PER_QTR = {"R01": 7, "R02": 5, "R03": 4, "R04": 3, "R05": 3}
BOGO_SKUS = ["CK-SS-08", "CK-SS-13", "CC-OR-10", "RT-RS-12", "CK-BB-08"]
CLUB_SKUS = ["CK-SS-13", "CV-VP-18", "TW-MI-16", "RT-RS-12"]
FAMILIES = products.groupby("brand_family").sku.apply(list).to_dict()

SPAN = 7  # event (<=2 w) + 4 post weeks + a spacer: no other event on the same brand family at that retailer
events = []
busy = {}  # (rid, family) -> set of week idx blocked
eid = 1
for rid in RET.index:
    for q in range(8):
        placed, tries = 0, 0
        q_lo, q_hi = q * 13, q * 13 + 12
        while placed < EVENTS_PER_QTR[rid] and tries < 400:
            tries += 1
            names, probs = zip(*TACTIC_MIX[rid])
            tactic = rng.choice(names, p=np.array(probs) / sum(probs))
            pool = BOGO_SKUS if tactic == "BOGO" else (CLUB_SKUS if rid == "R05" else list(SKU.index))
            sku = rng.choice(pool)
            fam = SKU.loc[sku].brand_family
            weeks = 2 if tactic in ("BOGO", "TPR", "Multi-buy") else int(rng.choice([1, 2], p=[0.35, 0.65]))
            start = int(rng.integers(q_lo, q_hi + 1))
            if start < 4 or start + weeks + 4 > N_HIST - 1:
                continue   # keep 4 clean pre-weeks and a fully observed post window
            block = set(range(start - 2, start + SPAN))
            if busy.get((rid, fam), set()) & block:
                continue
            busy.setdefault((rid, fam), set()).update(block)
            depth0, share, feat, disp = TACTICS[tactic]
            depth = depth0 if tactic in ("BOGO", "Multi-buy") else float(np.clip(rng.normal(depth0, 0.025), 0.10, 0.28))
            funding = RET.loc[rid].default_funding_method
            if rid == "R01" and tactic in ("Feature + Display", "TPR") and start >= 52:
                funding = "scan-based"     # ValuMax has accepted scan-down on display/TPR events since last year
            if tactic == "BOGO" and rid == "R01":
                funding = "off-invoice"
            events.append(dict(
                event_id=f"EV-{eid:04d}", retailer_id=rid, sku=sku, tactic=tactic, discount_depth=round(depth, 3),
                start_idx=start, weeks=weeks, feature_ad=feat, in_store_display=disp, funding_method=funding,
                mfr_funding_share=share))
            eid += 1
            placed += 1
ev = pd.DataFrame(events)

# ─────────────────────────────────────────────────────────────── plan for next quarter (weeks N_HIST .. N_HIST+12)
PLAN = [
    # retailer, sku, tactic, depth, start week (1..13), weeks, planner note
    ("R01", "CK-SS-08", "BOGO", 0.50, 2, 2, "Big volume driver last year - repeat"),
    ("R01", "CC-OR-10", "BOGO", 0.50, 4, 2, "Match competitor BOGO in circular"),
    ("R01", "CK-SS-13", "BOGO", 0.50, 7, 2, "Summer kickoff volume push"),
    ("R01", "RT-RS-12", "BOGO", 0.50, 10, 2, "Game-day tortilla BOGO"),
    ("R01", "CK-JA-08", "Feature + Display", 0.22, 5, 2, "Endcap - JBP display #1"),
    ("R01", "TW-MI-16", "Feature + Display", 0.22, 11, 2, "Endcap - JBP display #2"),
    ("R01", "CC-SO-10", "TPR", 0.18, 12, 2, "Shelf TPR"),
    ("R02", "CK-SS-08", "Feature + Display", 0.22, 3, 2, "Summer feature"),
    ("R02", "RT-RS-12", "Feature + Display", 0.22, 8, 2, "Game-day display"),
    ("R02", "CC-OR-10", "TPR", 0.18, 6, 2, "Shelf TPR"),
    ("R02", "TW-MI-16", "Multi-buy", 0.30, 11, 2, "2 for $5.30"),
    ("R02", "CK-SS-13", "TPR", 0.18, 12, 2, "Shelf TPR"),
    ("R03", "CK-SS-08", "Feature + Display", 0.22, 4, 2, "Circular + endcap"),
    ("R03", "CC-SO-10", "TPR", 0.18, 7, 2, "Shelf TPR"),
    ("R03", "RT-RS-12", "Multi-buy", 0.30, 9, 2, "2 for $6.20"),
    ("R03", "CC-OR-10", "Feature + Display", 0.22, 12, 2, "Circular + endcap"),
    ("R04", "CK-SS-08", "TPR", 0.18, 3, 2, "Shelf TPR"),
    ("R04", "CC-OR-10", "TPR", 0.18, 6, 2, "Shelf TPR"),
    ("R04", "RT-RS-12", "TPR", 0.18, 9, 2, "Shelf TPR"),
    ("R04", "TW-MI-16", "TPR", 0.18, 12, 2, "Shelf TPR"),
    ("R05", "CV-VP-18", "TPR", 0.18, 2, 2, "Instant savings coupon"),
    ("R05", "CK-SS-13", "Feature + Display", 0.22, 6, 2, "Pallet display"),
    ("R05", "TW-MI-16", "TPR", 0.18, 9, 2, "Instant savings coupon"),
    ("R05", "RT-RS-12", "TPR", 0.18, 12, 2, "Instant savings coupon"),
    ("R02", "CK-JA-08", "TPR", 0.18, 2, 2, "Shelf TPR"),
    ("R03", "CK-SS-13", "TPR", 0.18, 2, 2, "Shelf TPR"),
]
plan_rows = []
for i, (rid, sku, tactic, depth, wk, weeks, note) in enumerate(PLAN, start=1):
    _, share, feat, disp = TACTICS[tactic]
    funding = RET.loc[rid].default_funding_method
    if rid == "R01" and tactic in ("Feature + Display", "TPR"):
        funding = "scan-based"
    r, p = RET.loc[rid], SKU.loc[sku]
    shelf = round(p.srp_usd * r.price_index, 2)
    fixed = (r.feature_fee_usd if feat else 0) + (r.display_fee_usd if disp else 0)
    plan_rows.append(dict(
        plan_event_id=f"PL-{i:03d}", retailer_id=rid, sku=sku, tactic=tactic, discount_depth=depth,
        start_week=PLAN_WEEKS[wk - 1], end_week=PLAN_WEEKS[wk - 1] + dt.timedelta(days=7 * weeks - 1), weeks=weeks,
        feature_ad=feat, in_store_display=disp, funding_method=funding, mfr_funding_share=share,
        regular_shelf_price_usd=shelf, promo_price_usd=round(shelf * (1 - depth), 2), fixed_fees_usd=float(fixed),
        planner="Elena Marsh" if rid == "R01" else "Revenue Growth Mgmt", planner_note=note, status="Draft"))
plan = pd.DataFrame(plan_rows).sort_values(["start_week", "retailer_id"]).reset_index(drop=True)

# ─────────────────────────────────────────────────────────────── simulate weekly sell-out + sell-in
pairs = [(rid, sku) for rid in RET.index for sku in SKU.index if not (rid == "R05" and sku not in CLUB_SKUS)]
W = N_HIST
units = {}
base = {}
for rid, sku in pairs:
    b = np.array([baseline_units(rid, sku, i, HIST_WEEKS[i]) for i in range(W)])
    base[(rid, sku)] = b
    units[(rid, sku)] = b * rng.lognormal(0, 0.03, W)
on_promo = {k: np.zeros(W, dtype=bool) for k in pairs}
ev_of = {k: [None] * W for k in pairs}
price = {}
for rid, sku in pairs:
    price[(rid, sku)] = np.full(W, round(SKU.loc[sku].srp_usd * RET.loc[rid].price_index, 2))
deal_units = {k: np.zeros(W) for k in pairs}

ev_rows = []
for e in ev.itertuples():
    k = (e.retailer_id, e.sku)
    if k not in base:
        continue
    b = base[k]
    lift = LIFT[e.retailer_id][e.tactic] * rng.normal(1.0, 0.07)
    if e.tactic in ("TPR", "Feature + Display"):   # deeper than standard -> a bit more lift
        lift *= (1 + 1.6 * (e.discount_depth - TACTICS[e.tactic][0]))
    wks = list(range(e.start_idx, e.start_idx + e.weeks))
    inc_units = 0.0
    for j, w in enumerate(wks):
        shape = 1.0 if e.weeks == 1 else (1.08 if j == 0 else 0.92)
        add = b[w] * (lift * shape - 1)
        units[k][w] += add
        inc_units += add
        on_promo[k][w] = True
        ev_of[k][w] = e.event_id
        price[k][w] = round(price[k][w] * (1 - e.discount_depth), 2)
    # pantry loading: the dip after the event
    dip_total = inc_units * DIP[e.retailer_id][e.tactic] * rng.normal(1.0, 0.08)
    for j, s in enumerate(DIP_SHAPE):
        w = e.start_idx + e.weeks + j
        units[k][w] -= dip_total * s
    # cannibalization of sister SKUs (same brand family) at the same retailer during the event
    sisters = [s for s in FAMILIES[SKU.loc[e.sku].brand_family] if s != e.sku and (e.retailer_id, s) in base]
    can_total = inc_units * CANNIB[e.tactic] * rng.normal(1.0, 0.10) if sisters else 0.0
    wsum = sum(base[(e.retailer_id, s)][wks].sum() for s in sisters) or 1.0
    for s in sisters:
        bs = base[(e.retailer_id, s)]
        for w in wks:
            units[(e.retailer_id, s)][w] -= can_total * bs[w] / wsum
    # forward buy: off-invoice allowances are paid on every unit shipped in the deal window
    ev_pos = sum(units[k][w] for w in wks)
    fwd = ev_pos * FWD[e.tactic] * rng.normal(1.0, 0.10) if e.funding_method == "off-invoice" else 0.0
    deal_window = [e.start_idx - 1] + wks
    for w in deal_window:
        deal_units[k][w] += (ev_pos + fwd) / len(deal_window)
    ev_rows.append(dict(event_id=e.event_id, forward_buy_units_true=fwd))

ev_true = pd.DataFrame(ev_rows)

# sell-in: shipments ~ next week's sell-out, deal windows ship the whole deal buy, forward-bought stock is
# worked down over the 4 weeks after the event (the retailer's orders drop)
ship_rows, pos_rows = [], []
fwd_by_event = ev_true.set_index("event_id").forward_buy_units_true.to_dict()
ship = {k: np.zeros(W) for k in pairs}
for k in pairs:
    u = np.maximum(units[k], 0)
    for w in range(W):
        nxt = u[w + 1] if w + 1 < W else u[w]
        ship[k][w] = 0.55 * u[w] + 0.45 * nxt
for e in ev.itertuples():
    k = (e.retailer_id, e.sku)
    if k not in base:
        continue
    wks = list(range(e.start_idx, e.start_idx + e.weeks))
    deal_window = [e.start_idx - 1] + wks
    for w in deal_window:
        ship[k][w] = deal_units[k][w]
    fwd = fwd_by_event.get(e.event_id, 0.0)
    for j, s in enumerate(DIP_SHAPE):
        w = e.start_idx + e.weeks + j
        ship[k][w] = max(ship[k][w] - fwd * s, 0)

for rid, sku in pairs:
    k = (rid, sku)
    for w in range(W):
        u = max(int(round(units[k][w])), 0)
        pos_rows.append(dict(
            week_start=HIST_WEEKS[w], retailer_id=rid, sku=sku, units_sold=u,
            avg_shelf_price_usd=float(price[k][w]), sales_usd=round(u * float(price[k][w]), 2),
            on_promo=bool(on_promo[k][w]), event_id=ev_of[k][w],
            store_count_selling=int(RET.loc[rid].store_count * (0.97 + 0.03 * rng.random()))))
        ship_rows.append(dict(
            week_start=HIST_WEEKS[w], retailer_id=rid, sku=sku, units_shipped=max(int(round(ship[k][w] * rng.normal(1, 0.03))), 0),
            units_on_deal=int(round(deal_units[k][w])),
            invoice_price_usd=float(SKU.loc[sku].list_price_usd)))
pos = pd.DataFrame(pos_rows)
shp = pd.DataFrame(ship_rows)

# ─────────────────────────────────────────────────────────────── promo_events table (the TPM system of record)
ev = ev[ev.apply(lambda r: (r.retailer_id, r.sku) in base, axis=1)].copy()
ev["start_week"] = ev.start_idx.map(lambda i: HIST_WEEKS[i])
ev["end_week"] = ev.apply(lambda r: HIST_WEEKS[r.start_idx] + dt.timedelta(days=7 * r.weeks - 1), axis=1)
ev["regular_shelf_price_usd"] = ev.apply(lambda r: round(SKU.loc[r.sku].srp_usd * RET.loc[r.retailer_id].price_index, 2), axis=1)
ev["promo_price_usd"] = (ev.regular_shelf_price_usd * (1 - ev.discount_depth)).round(2)
ev["fixed_fees_usd"] = ev.apply(lambda r: float((RET.loc[r.retailer_id].feature_fee_usd if r.feature_ad else 0)
                                                + (RET.loc[r.retailer_id].display_fee_usd if r.in_store_display else 0)), axis=1)
ev["allowance_per_unit_usd"] = (ev.regular_shelf_price_usd * ev.discount_depth * ev.mfr_funding_share).round(3)
ev["status"] = "Completed"
ev["key_account_manager"] = ev.retailer_id.map(RET.key_account_manager)
ev["event_name"] = ev.apply(lambda r: f"{RET.loc[r.retailer_id].retailer_name} - {SKU.loc[r.sku].product_name} - {r.tactic}", axis=1)
promo_events = ev[["event_id", "event_name", "retailer_id", "sku", "tactic", "discount_depth", "start_week", "end_week", "weeks",
                   "feature_ad", "in_store_display", "funding_method", "mfr_funding_share", "allowance_per_unit_usd",
                   "regular_shelf_price_usd", "promo_price_usd", "fixed_fees_usd", "key_account_manager", "status"]]

cal = pd.DataFrame([dict(week_start=w, week_end=w + dt.timedelta(days=6), week_of_year=int(w.isocalendar()[1]),
                         holiday=holiday_of(w)[0], is_plan_week=(w > THIS_MONDAY),
                         weeks_from_now=int((w - THIS_MONDAY).days // 7)) for w in ALL_WEEKS])

# ─────────────────────────────────────────────────────────────── write
if args.dry_run:
    import os, pickle
    os.makedirs(args.dry_run, exist_ok=True)
    pickle.dump(dict(retailers=retailers, products=products, cal=cal, promo_events=promo_events, pos=pos, shp=shp, plan=plan,
                     base=base, ev_true=ev_true, plan_weeks=PLAN_WEEKS,
                     fut_base={k: [baseline_units(k[0], k[1], N_HIST + i, PLAN_WEEKS[i]) for i in range(N_PLAN)] for k in pairs}), open(f"{args.dry_run}/data.pkl", "wb"))
    print("dry run ->", args.dry_run, len(promo_events), "events", len(pos), "pos rows")
    raise SystemExit(0)
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CAT}.{SCH} COMMENT 'Crestwood Snacks - trade promotion post-event ROI + promo planning (Solution Builder demo)'")


def save(df: pd.DataFrame, name: str, comment: str):
    sdf = spark.createDataFrame(df)
    sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{CAT}.{SCH}.{name}")
    spark.sql(f"COMMENT ON TABLE {CAT}.{SCH}.{name} IS '{comment}'")
    print(f"  {name:22s} {len(df):>6} rows")


print(f"Writing {CAT}.{SCH} (history {HIST_WEEKS[0]} .. {HIST_WEEKS[-1]}, plan {PLAN_WEEKS[0]} .. {PLAN_WEEKS[-1]})")
save(retailers.drop(columns=["volume_scale", "fee_scale"]), "retailers",
     "Retail accounts: channel, store count, trade-funding method (off-invoice vs scan-based), JBP commitments, fixed feature/display fees")
save(products.drop(columns=["base_units"]), "products",
     "Crestwood salty-snack SKUs: brand family (for cannibalization), list price to retailer, suggested shelf price, unit COGS and unit gross margin")
save(cal, "calendar_weeks", "Week calendar: 104 history weeks + the 13 planned weeks of next quarter, with snack holiday flags")
save(promo_events, "promo_events",
     "Completed trade promotions (TPM system of record): tactic, discount depth, feature/display, funding method, per-unit allowance, fixed fees")
save(pos, "pos_weekly_sales", "Retailer POS sell-out by week x SKU: units, dollars, average shelf price, promo flag and event id")
save(shp, "retailer_shipments",
     "Crestwood sell-in to the retailer by week x SKU: units shipped and units bought on deal (off-invoice allowance) - reveals forward buying")
save(plan.drop(columns=[]), "promo_plan",
     "Next quarter draft promo calendar (13 weeks): planned tactic, depth, funding, fees - evaluated by the promo-planner agent")

for t in ["retailers", "products", "promo_events", "promo_plan"]:
    key = {"retailers": "retailer_id", "products": "sku", "promo_events": "event_id", "promo_plan": "plan_event_id"}[t]
    spark.sql(f"ALTER TABLE {CAT}.{SCH}.{t} ALTER COLUMN {key} SET NOT NULL")
    try:
        spark.sql(f"ALTER TABLE {CAT}.{SCH}.{t} ADD CONSTRAINT pk_{t} PRIMARY KEY ({key}) RELY")
    except Exception as ex:  # re-run: constraint already exists
        print(f"  (pk {t}: {str(ex)[:80]})")
print("done")
