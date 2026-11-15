"""
Aurora Crest Media — ad yield & pricing optimization: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, DATABRICKS_CONFIG_PROFILE=<profile>)
        python generate_data.py --catalog media_advertising --schema ad_yield_optimization
  * `--dry-run` builds everything in memory and prints the planted numbers (no Spark needed)

Aurora Crest Media runs a broadcast network (ACN), the Crest+ ad-supported streaming service and a
set of FAST channels. The ad-sales yield desk sells that inventory as guaranteed audience deals
(upfront + scatter), programmatic PMPs and open auction.

Tables written (Delta, PK/FK RELY constraints + comments):
  ad_products            19 sellable inventory products (platform x content x daypart x tier) with rate card + floor
  audience_segments      7 audience segments sold as guarantees
  product_audience_mix   share of each product's impressions that reach each segment
  advertisers            32 advertisers (category, agency)
  campaigns              ~230 insertion orders over 18 months (+ upcoming): booked audience impressions, CPM, flight
  line_items             the IO lines: product, booked impressions, CPM
  delivery_daily         delivered in-target impressions + revenue per line per day (through yesterday)
  inventory_daily        per product per day: avails, guaranteed / PMP / open-auction / unsold impressions,
                         revenue, open-auction bid landscape, floor + inventory group in force
  floor_price_rules      history of floor-price / inventory-group rules per product (the ad-server config)
  programmatic_deals     PMP deals with fixed prices and the inventory groups they can buy
  make_goods             make-goods (ADUs / cash credits) issued on past campaigns that under-delivered

THE PLANTED SIGNAL — "premium sports sold at run-of-network prices while an auto launch under-delivers":
  1. YIELD LEAK. On <today-77> the ad-server migration (change FR-117) re-mapped the Crest+ Live Sports
     stream (STR-SPORTS-LIVE, rate card $48) from inventory group PREMIUM-SPORTS (floor $30) into
     RON-DEFAULT (floor $9). RON-DEFAULT is bought by the fixed-price PMP deal PMP-RON-STREAM at $10.50,
     which has priority over the open auction — so ~75% of the unsold premium sports impressions now go
     at $10.50 while open-auction bids for the same impressions still clear at ~$29.
  2. UNDER-DELIVERY. Summit Motors' "Terra EV Launch" upfront (IO-2026-0417, 36M Auto Intenders A25-54
     impressions at $38) leans on ACN Prime Drama. "Harbor Lights" lost ~40% of its audience after it
     moved to Friday, the line cannot deliver, and the IO is pacing ~75% → ~10M impressions short at flight
     end → ~$390K make-good liability.
  3. THE FIX IS THE SAME INVENTORY. The Live Sports stream has the highest Auto-Intender reach in the
     portfolio and the spare avails (forecast) to absorb the shortfall before the flight ends. Moving the
     make-good there costs only the $10.50 PMP revenue it displaces; restoring the PREMIUM-SPORTS floor on
     the rest recovers the open-auction price.
  Red herring: ACN Late Night sell-through is low (~60%) — but it is every year at this time.
"""
from __future__ import annotations

import argparse
import math
import random
from collections import defaultdict
from datetime import date, timedelta

SEED = 20260929
rng = random.Random(SEED)

TODAY = date.today()
HIST_DAYS = 760
START = TODAY - timedelta(days=HIST_DAYS)
MIGRATION_DAY = TODAY - timedelta(days=77)     # FR-117 ad-server migration
HARBOR_MOVE_DAY = TODAY - timedelta(days=40)   # Harbor Lights moved to Friday


def D(n: int) -> date:
    return TODAY + timedelta(days=n)


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────
# (product_id, name, platform, content_category, daypart, tier, rate_card_cpm, inventory_group,
#  base_daily_avails, guaranteed_target_share, programmatic, season_profile)
PRODUCTS = [
    ("STR-SPORTS-LIVE", "Crest+ Live Sports (Pro Football & College)", "Streaming", "Live Sports", "Weekend & Prime", "Premium", 48.0, "PREMIUM-SPORTS", 1_600_000, 0.36, True, "sports"),
    ("STR-SPORTS-STUDIO", "Crest+ Sports Studio & Highlights", "Streaming", "Sports Studio", "All Day", "Standard", 26.0, "STANDARD", 600_000, 0.45, True, "sports"),
    ("STR-PRIME-DRAMA", "Crest+ Prime Drama Originals", "Streaming", "Drama", "Prime", "Premium", 40.0, "PREMIUM-ENT", 1_100_000, 0.62, True, "tv"),
    ("STR-REALITY", "Crest+ Reality & Competition", "Streaming", "Reality", "Prime", "Standard", 28.0, "STANDARD", 900_000, 0.55, True, "tv"),
    ("STR-MOVIES", "Crest+ Movies Library", "Streaming", "Movies", "All Day", "Standard", 22.0, "STANDARD", 1_300_000, 0.45, True, "flat"),
    ("STR-KIDS", "Crest+ Kids & Family", "Streaming", "Kids & Family", "Daytime", "Standard", 18.0, "STANDARD", 800_000, 0.40, True, "flat"),
    ("STR-NEWS", "Crest+ News Live", "Streaming", "News", "All Day", "Standard", 20.0, "STANDARD", 500_000, 0.40, True, "flat"),
    ("STR-RON", "Crest+ Run of Network", "Streaming", "Run of Network", "All Day", "RON", 12.0, "RON-DEFAULT", 2_200_000, 0.30, True, "flat"),
    ("FAST-CLASSIC-TV", "FAST · Classic TV Channels", "FAST", "Classic TV", "All Day", "RON", 11.0, "RON-DEFAULT", 1_800_000, 0.25, True, "flat"),
    ("FAST-TRUECRIME", "FAST · True Crime Channel", "FAST", "True Crime", "All Day", "Standard", 16.0, "STANDARD", 700_000, 0.35, True, "flat"),
    ("FAST-SPORTS", "FAST · Sports Replays", "FAST", "Sports Replays", "All Day", "Standard", 17.0, "STANDARD", 500_000, 0.35, True, "sports"),
    ("LIN-PRIME-DRAMA", "ACN Prime Drama (Mon-Thu 8-11p, incl. Harbor Lights)", "Linear", "Drama", "Prime", "Premium", 42.0, "LINEAR", 950_000, 0.80, False, "tv"),
    ("LIN-PRIME-REALITY", "ACN Prime Reality (Fri-Sun 8-10p)", "Linear", "Reality", "Prime", "Premium", 36.0, "LINEAR", 720_000, 0.78, False, "tv"),
    ("LIN-SPORTS-LIVE", "ACN Live Sports (Sat/Sun)", "Linear", "Live Sports", "Weekend", "Premium", 55.0, "LINEAR", 1_000_000, 0.86, False, "sports"),
    ("LIN-EARLY-FRINGE", "ACN Early Fringe (4-7p)", "Linear", "Talk & Games", "Early Fringe", "Standard", 18.0, "LINEAR", 800_000, 0.80, False, "flat"),
    ("LIN-DAYTIME", "ACN Daytime", "Linear", "Daytime", "Daytime", "Standard", 12.0, "LINEAR", 1_000_000, 0.76, False, "flat"),
    ("LIN-LATE-NIGHT", "ACN Late Night", "Linear", "Late Night Comedy", "Late Night", "Standard", 20.0, "LINEAR", 520_000, 0.66, False, "latenight"),
    ("LIN-MORNING", "ACN Morning Show", "Linear", "News", "Morning", "Standard", 16.0, "LINEAR", 600_000, 0.78, False, "flat"),
    ("LIN-NEWS-EVE", "ACN Evening News", "Linear", "News", "Early Fringe", "Standard", 24.0, "LINEAR", 600_000, 0.82, False, "flat"),
]
P_BY_ID = {p[0]: p for p in PRODUCTS}

GROUP_FLOORS = {"PREMIUM-SPORTS": 30.0, "PREMIUM-ENT": 22.0, "STANDARD": 14.0, "RON-DEFAULT": 9.0, "LINEAR": None}

SEGMENTS = [
    ("A25-54", "Adults 25-54", "Broad adult demo — the default currency for upfront deals"),
    ("AUTO-INT", "Auto Intenders A25-54", "Adults 25-54 in-market for a new vehicle in the next 6 months (automaker first-party + ACR modeled)"),
    ("SPORTS-M18-49", "Sports Enthusiasts M18-49", "Men 18-49 with heavy live-sports viewing"),
    ("FAMILY-HH", "Households with Kids", "Households with children under 12"),
    ("HIGH-INC", "Affluent HHI $150K+", "Household income above $150K"),
    ("CORD-CUT", "Streaming-first A18-34", "Adults 18-34 with no linear pay-TV subscription"),
    ("SENIORS-55P", "Adults 55+", "Adults 55 and over"),
]
# share of each product's impressions reaching each segment (segments overlap)
MIX = {
    "STR-SPORTS-LIVE":   {"A25-54": 0.62, "AUTO-INT": 0.30, "SPORTS-M18-49": 0.48, "FAMILY-HH": 0.22, "HIGH-INC": 0.24, "CORD-CUT": 0.30, "SENIORS-55P": 0.14},
    "STR-SPORTS-STUDIO": {"A25-54": 0.55, "AUTO-INT": 0.21, "SPORTS-M18-49": 0.52, "FAMILY-HH": 0.18, "HIGH-INC": 0.18, "CORD-CUT": 0.34, "SENIORS-55P": 0.12},
    "STR-PRIME-DRAMA":   {"A25-54": 0.58, "AUTO-INT": 0.17, "SPORTS-M18-49": 0.12, "FAMILY-HH": 0.20, "HIGH-INC": 0.26, "CORD-CUT": 0.32, "SENIORS-55P": 0.20},
    "STR-REALITY":       {"A25-54": 0.52, "AUTO-INT": 0.13, "SPORTS-M18-49": 0.08, "FAMILY-HH": 0.24, "HIGH-INC": 0.14, "CORD-CUT": 0.40, "SENIORS-55P": 0.10},
    "STR-MOVIES":        {"A25-54": 0.50, "AUTO-INT": 0.12, "SPORTS-M18-49": 0.14, "FAMILY-HH": 0.26, "HIGH-INC": 0.16, "CORD-CUT": 0.36, "SENIORS-55P": 0.16},
    "STR-KIDS":          {"A25-54": 0.36, "AUTO-INT": 0.06, "SPORTS-M18-49": 0.04, "FAMILY-HH": 0.78, "HIGH-INC": 0.12, "CORD-CUT": 0.20, "SENIORS-55P": 0.05},
    "STR-NEWS":          {"A25-54": 0.44, "AUTO-INT": 0.12, "SPORTS-M18-49": 0.08, "FAMILY-HH": 0.12, "HIGH-INC": 0.22, "CORD-CUT": 0.18, "SENIORS-55P": 0.40},
    "STR-RON":           {"A25-54": 0.48, "AUTO-INT": 0.11, "SPORTS-M18-49": 0.14, "FAMILY-HH": 0.22, "HIGH-INC": 0.14, "CORD-CUT": 0.34, "SENIORS-55P": 0.18},
    "FAST-CLASSIC-TV":   {"A25-54": 0.38, "AUTO-INT": 0.08, "SPORTS-M18-49": 0.06, "FAMILY-HH": 0.14, "HIGH-INC": 0.08, "CORD-CUT": 0.22, "SENIORS-55P": 0.44},
    "FAST-TRUECRIME":    {"A25-54": 0.50, "AUTO-INT": 0.10, "SPORTS-M18-49": 0.06, "FAMILY-HH": 0.12, "HIGH-INC": 0.12, "CORD-CUT": 0.30, "SENIORS-55P": 0.22},
    "FAST-SPORTS":       {"A25-54": 0.52, "AUTO-INT": 0.18, "SPORTS-M18-49": 0.50, "FAMILY-HH": 0.14, "HIGH-INC": 0.12, "CORD-CUT": 0.28, "SENIORS-55P": 0.16},
    "LIN-PRIME-DRAMA":   {"A25-54": 0.54, "AUTO-INT": 0.16, "SPORTS-M18-49": 0.10, "FAMILY-HH": 0.18, "HIGH-INC": 0.22, "CORD-CUT": 0.06, "SENIORS-55P": 0.34},
    "LIN-PRIME-REALITY": {"A25-54": 0.50, "AUTO-INT": 0.14, "SPORTS-M18-49": 0.08, "FAMILY-HH": 0.24, "HIGH-INC": 0.14, "CORD-CUT": 0.05, "SENIORS-55P": 0.30},
    "LIN-SPORTS-LIVE":   {"A25-54": 0.58, "AUTO-INT": 0.26, "SPORTS-M18-49": 0.46, "FAMILY-HH": 0.20, "HIGH-INC": 0.20, "CORD-CUT": 0.04, "SENIORS-55P": 0.26},
    "LIN-EARLY-FRINGE":  {"A25-54": 0.40, "AUTO-INT": 0.09, "SPORTS-M18-49": 0.06, "FAMILY-HH": 0.18, "HIGH-INC": 0.10, "CORD-CUT": 0.03, "SENIORS-55P": 0.46},
    "LIN-DAYTIME":       {"A25-54": 0.34, "AUTO-INT": 0.07, "SPORTS-M18-49": 0.04, "FAMILY-HH": 0.20, "HIGH-INC": 0.08, "CORD-CUT": 0.02, "SENIORS-55P": 0.52},
    "LIN-LATE-NIGHT":    {"A25-54": 0.52, "AUTO-INT": 0.13, "SPORTS-M18-49": 0.16, "FAMILY-HH": 0.08, "HIGH-INC": 0.18, "CORD-CUT": 0.05, "SENIORS-55P": 0.24},
    "LIN-MORNING":       {"A25-54": 0.42, "AUTO-INT": 0.10, "SPORTS-M18-49": 0.05, "FAMILY-HH": 0.22, "HIGH-INC": 0.16, "CORD-CUT": 0.03, "SENIORS-55P": 0.44},
    "LIN-NEWS-EVE":      {"A25-54": 0.40, "AUTO-INT": 0.11, "SPORTS-M18-49": 0.06, "FAMILY-HH": 0.12, "HIGH-INC": 0.20, "CORD-CUT": 0.03, "SENIORS-55P": 0.50},
}

ADVERTISERS = [
    ("ADV-SUMMIT", "Summit Motors", "Automotive", "Blue Harbor Agency"),
    ("ADV-CORVANE", "Corvane Automotive", "Automotive", "Meridian Media Partners"),
    ("ADV-RIDGEWAY", "Ridgeway Trucks", "Automotive", "Crosstown Media"),
    ("ADV-BRIGHTSIDE", "Brightside Insurance", "Insurance", "Signal & Co."),
    ("ADV-HAVENLY", "Havenly Home Insurance", "Insurance", "Meridian Media Partners"),
    ("ADV-FRESHCART", "FreshCart Grocery", "Retail", "Crosstown Media"),
    ("ADV-NORTHGATE", "Northgate Department Stores", "Retail", "Blue Harbor Agency"),
    ("ADV-LUMORA", "Lumora Wireless", "Telecom", "Signal & Co."),
    ("ADV-TANDEM", "Tandem Mobile", "Telecom", "Crosstown Media"),
    ("ADV-PINECREST", "Pinecrest Bank", "Financial Services", "Meridian Media Partners"),
    ("ADV-ZESTLY", "Zestly Snacks", "CPG", "Blue Harbor Agency"),
    ("ADV-VELTA", "Velta Beverages", "CPG", "Signal & Co."),
    ("ADV-JUNIPER", "Juniper Pet Foods", "CPG", "Crosstown Media"),
    ("ADV-AURELIA", "Aurelia Beauty", "CPG", "Meridian Media Partners"),
    ("ADV-QUICKBITE", "Quickbite Burgers", "QSR", "Blue Harbor Agency"),
    ("ADV-TACOVERDE", "Taco Verde", "QSR", "Signal & Co."),
    ("ADV-HARBORVIEW", "Harborview Pharma", "Pharma", "Meridian Media Partners"),
    ("ADV-SOLACE", "Solace Health", "Pharma", "Crosstown Media"),
    ("ADV-NIMBUS", "Nimbus Devices", "Technology", "Signal & Co."),
    ("ADV-KITEWORKS", "Kiteworks Software", "Technology", "Blue Harbor Agency"),
    ("ADV-COBALT", "Cobalt Airlines", "Travel", "Meridian Media Partners"),
    ("ADV-CRESTLINE", "Crestline Hotels", "Travel", "Crosstown Media"),
    ("ADV-ORBIT", "Orbit Sportswear", "Apparel", "Signal & Co."),
    ("ADV-MAPLE", "Maple & Co. Home", "Home", "Blue Harbor Agency"),
    ("ADV-IRONCLAD", "Ironclad Hardware", "Home", "Crosstown Media"),
    ("ADV-FABLE", "Fable Toys", "Toys", "Meridian Media Partners"),
    ("ADV-GLIMMER", "Glimmer Cosmetics", "CPG", "Signal & Co."),
    ("ADV-KESTREL", "Kestrel Energy", "Utilities", "Blue Harbor Agency"),
    ("ADV-PARKWAY", "Parkway Streaming Sticks", "Technology", "Crosstown Media"),
    ("ADV-BLUEWAVE", "Bluewave Cruises", "Travel", "Meridian Media Partners"),
    ("ADV-OAKRIDGE", "Oakridge Credit Union", "Financial Services", "Signal & Co."),
    ("ADV-MERIT", "Merit Motors Certified Pre-Owned", "Automotive", "Meridian Media Partners"),
]
CATEGORY_SEGMENTS = {
    "Automotive": ["AUTO-INT", "A25-54", "SPORTS-M18-49"], "Insurance": ["A25-54", "HIGH-INC"], "Retail": ["A25-54", "FAMILY-HH"],
    "Telecom": ["CORD-CUT", "A25-54"], "Financial Services": ["HIGH-INC", "A25-54"], "CPG": ["A25-54", "FAMILY-HH"],
    "QSR": ["CORD-CUT", "A25-54"], "Pharma": ["SENIORS-55P", "A25-54"], "Technology": ["CORD-CUT", "HIGH-INC"],
    "Travel": ["HIGH-INC", "A25-54"], "Apparel": ["SPORTS-M18-49", "CORD-CUT"], "Home": ["A25-54", "HIGH-INC"],
    "Toys": ["FAMILY-HH"], "Utilities": ["A25-54", "SENIORS-55P"],
}
PMP_DEALS = [
    ("PMP-RON-STREAM", "Crest+ Run-of-Network Open PMP", "RON-DEFAULT", 10.50, "Programmatic buyers (all DSPs)", "fixed"),
    ("PMP-PREM-SPORTS", "Crest+ Premium Sports PMP", "PREMIUM-SPORTS", 32.00, "Select sports buyers", "floor"),
    ("PMP-PREM-ENT", "Crest+ Premium Entertainment PMP", "PREMIUM-ENT", 24.00, "Select entertainment buyers", "floor"),
    ("PMP-STANDARD", "Crest+ Standard PMP", "STANDARD", 15.00, "Programmatic buyers (all DSPs)", "floor"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Seasonality
# ─────────────────────────────────────────────────────────────────────────────
def in_sports_season(d: date) -> bool:
    # football season: early Sep → mid Feb
    return (d.month > 9 or (d.month == 9 and d.day >= 4)) or d.month == 1 or (d.month == 2 and d.day <= 12)


def season_factor(profile: str, d: date) -> float:
    dow = d.weekday()  # Mon=0
    if profile == "sports":
        base = 1.0 if in_sports_season(d) else 0.34
        wk = {0: 1.05, 1: 0.45, 2: 0.45, 3: 1.0, 4: 0.55, 5: 1.45, 6: 1.65}[dow]
        return base * wk
    if profile == "tv":
        # fall/spring TV season high, summer repeats low
        base = 0.68 if d.month in (6, 7, 8) else (0.9 if d.month == 5 or (d.month == 9 and d.day < 20) else 1.0)
        wk = {0: 1.05, 1: 1.05, 2: 1.05, 3: 1.05, 4: 0.85, 5: 0.9, 6: 1.0}[dow]
        return base * wk
    if profile == "latenight":
        base = 0.62 if d.month in (9, 10) else (0.8 if d.month in (7, 8) else 1.0)   # the "low sell-through" is seasonal
        wk = {0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0, 4: 0.9, 5: 0.6, 6: 0.6}[dow]
        return base * wk
    wk = {0: 1.0, 1: 0.98, 2: 0.98, 3: 1.0, 4: 1.02, 5: 1.05, 6: 1.08}[dow]
    q4 = 1.08 if d.month in (11, 12) else 1.0
    return wk * q4


def daily_avails(pid: str, d: date) -> int:
    p = P_BY_ID[pid]
    base, platform, profile = p[8], p[2], p[11]
    t_years = (d - TODAY).days / 365.0
    growth = (1.0 + (0.24 if platform in ("Streaming", "FAST") else -0.06)) ** t_years
    f = season_factor(profile, d) * growth
    if pid == "LIN-PRIME-DRAMA" and d >= HARBOR_MOVE_DAY:
        f *= 0.40   # Harbor Lights moved to Friday — prime drama audience down 60%
    noise = 1.0 + rng.gauss(0, 0.035)
    return max(10_000, int(base * f * noise))


# ─────────────────────────────────────────────────────────────────────────────
# Campaigns + line items
# ─────────────────────────────────────────────────────────────────────────────
def eligible_products(category: str, segment: str) -> list[str]:
    ranked = sorted(PRODUCTS, key=lambda p: -MIX[p[0]][segment])
    out = [p[0] for p in ranked if not (category not in ("Toys", "CPG", "Retail", "QSR") and p[0] == "STR-KIDS")]
    return out[:9]


def build_campaigns():
    campaigns, lines = [], []
    n_c = 0
    # --- the planted IO: Summit Motors — Terra EV Launch (upfront) ---------------------------------
    s_start, s_end = D(-46), D(31)
    summit_lines = [("LIN-PRIME-DRAMA", 21_000_000, 40.0), ("STR-PRIME-DRAMA", 9_500_000, 38.0), ("LIN-PRIME-REALITY", 5_500_000, 34.0)]
    campaigns.append(dict(campaign_id="CMP-24017", io_number="IO-2026-0417", advertiser_id="ADV-SUMMIT",
                          campaign_name="Summit Terra EV Launch — Fall Upfront", deal_type="Upfront Guaranteed",
                          target_segment_id="AUTO-INT", flight_start=s_start, flight_end=s_end,
                          booked_impressions=sum(x[1] for x in summit_lines),
                          booked_revenue=round(sum(x[1] * x[2] / 1000 for x in summit_lines), 2),
                          make_good_terms="Strict: in-target delivery >= 95% by flight end; ADUs only in equivalent-or-better Premium inventory",
                          sales_owner="Rachel Kim", status="Live"))
    for i, (pid, imps, cpm) in enumerate(summit_lines, 1):
        lines.append(dict(line_id=f"LI-24017-{i}", campaign_id="CMP-24017", product_id=pid, booked_impressions=imps,
                          cpm=cpm, flight_start=s_start, flight_end=s_end, fixed=True))

    # --- other fall upfronts that also bought ACN Prime Drama (they share the Harbor Lights shortfall) ---
    companions = [
        ("CMP-24021", "IO-2026-0421", "ADV-BRIGHTSIDE", "Brightside Insurance — Fall Upfront", "A25-54", -52, 26,
         [("LIN-PRIME-DRAMA", 8_600_000, 33.5), ("STR-REALITY", 5_000_000, 24.0)]),
        ("CMP-24026", "IO-2026-0426", "ADV-HARBORVIEW", "Harborview Pharma — Fall Upfront", "SENIORS-55P", -40, 40,
         [("LIN-PRIME-DRAMA", 9_000_000, 31.0), ("LIN-NEWS-EVE", 6_000_000, 19.5)]),
        ("CMP-24030", "IO-2026-0430", "ADV-PINECREST", "Pinecrest Bank — Fall Upfront", "HIGH-INC", -35, 21,
         [("LIN-PRIME-DRAMA", 5_200_000, 34.0)]),
    ]
    for cid, io, adv, name, seg, s0, s1, ls in companions:
        a, b = D(s0), D(s1)
        campaigns.append(dict(campaign_id=cid, io_number=io, advertiser_id=adv, campaign_name=name, deal_type="Upfront Guaranteed",
                              target_segment_id=seg, flight_start=a, flight_end=b, booked_impressions=0, booked_revenue=0.0,
                              make_good_terms="Standard: in-target delivery >= 95% by flight end; ADUs within 30 days after flight",
                              sales_owner="Devon Brooks", status=""))
        for i, (pid, imps, cpm) in enumerate(ls, 1):
            lines.append(dict(line_id=f"LI-{cid[4:]}-{i}", campaign_id=cid, product_id=pid, booked_impressions=imps,
                              cpm=cpm, flight_start=a, flight_end=b, fixed=True))

    # --- everything else ----------------------------------------------------------------------------
    owners = ["Rachel Kim", "Devon Brooks", "Alicia Moreno", "Tom Becker", "Priya Nair"]
    for k in range(1800):
        adv = rng.choice(ADVERTISERS[1:])
        seg = rng.choice(CATEGORY_SEGMENTS[adv[2]])
        start = START + timedelta(days=rng.randint(0, HIST_DAYS + 40))
        dur = rng.choice([21, 28, 35, 42, 56, 63, 77, 91])
        end = start + timedelta(days=dur - 1)
        if end < START + timedelta(days=10):
            continue
        deal = rng.choices(["Upfront Guaranteed", "Scatter Guaranteed", "Programmatic Guaranteed"], [0.45, 0.4, 0.15])[0]
        if k % 2 == 1:   # linear scatter / upfront buys: one or two ACN dayparts
            prods = rng.sample([p[0] for p in PRODUCTS if p[2] == "Linear"], rng.choice([1, 1, 2]))
        else:
            el = eligible_products(adv[2], seg)
            prods = rng.sample(el, rng.choice([1, 2, 2, 3, 3]))
        if deal == "Programmatic Guaranteed":
            prods = [p for p in prods if P_BY_ID[p][10]] or ["STR-RON"]
        n_c += 1
        cid = f"CMP-{21000 + n_c}"
        campaigns.append(dict(campaign_id=cid, io_number=f"IO-{start.year}-{(n_c * 7) % 900 + 100:04d}", advertiser_id=adv[0],
                              campaign_name=f"{adv[1]} — {rng.choice(['Brand', 'Always-On', 'Seasonal', 'Launch', 'Holiday', 'Awareness', 'Promo'])} {start.strftime('%b %Y')}",
                              deal_type=deal, target_segment_id=seg, flight_start=start, flight_end=end,
                              booked_impressions=0, booked_revenue=0.0,
                              make_good_terms="Standard: in-target delivery >= 95% by flight end; ADUs within 30 days after flight",
                              sales_owner=rng.choice(owners), status=""))
        for j, pid in enumerate(prods, 1):
            lines.append(dict(line_id=f"LI-{21000 + n_c}-{j}", campaign_id=cid, product_id=pid, booked_impressions=0,
                              cpm=0.0, flight_start=start, flight_end=end, fixed=False))

    # size each random line like an order-management system would: only sell what the avails
    # forecast (as known when the IO was booked) can carry, up to the product's guaranteed share.
    span = HIST_DAYS + 220
    booked = defaultdict(lambda: [0.0] * span)

    def est_avails(pid, d, booked_on):
        p = P_BY_ID[pid]
        t_years = (d - TODAY).days / 365.0
        growth = (1.0 + (0.24 if p[2] in ("Streaming", "FAST") else -0.06)) ** t_years
        f = season_factor(p[11], d) * growth
        if pid == "LIN-PRIME-DRAMA" and d >= HARBOR_MOVE_DAY and booked_on >= HARBOR_MOVE_DAY:
            f *= 0.40
        return p[8] * f

    def idx(d):
        return (d - START).days + 30

    for li in lines:
        if li["fixed"]:
            for k in range((li["flight_end"] - li["flight_start"]).days + 1):
                booked[li["product_id"]][idx(li["flight_start"] + timedelta(days=k))] += li["booked_impressions"] / ((li["flight_end"] - li["flight_start"]).days + 1)
    keep = []
    for li in sorted(lines, key=lambda x: x["flight_start"]):
        if li["fixed"]:
            keep.append(li)
            continue
        p = P_BY_ID[li["product_id"]]
        booked_on = li["flight_start"] - timedelta(days=rng.randint(20, 120))
        ndays = (li["flight_end"] - li["flight_start"]).days + 1
        days = [li["flight_start"] + timedelta(days=k) for k in range(ndays)]
        head = min(est_avails(li["product_id"], d, booked_on) * p[9] - booked[li["product_id"]][idx(d)] for d in days)
        desired = p[8] * p[9] * (rng.uniform(0.45, 0.8) if li["product_id"] == "LIN-PRIME-DRAMA" else rng.uniform(0.22, 0.5))
        rate = min(desired, head)
        if rate < 0.25 * desired:
            continue
        for d in days:
            booked[li["product_id"]][idx(d)] += rate
        li["booked_impressions"] = int(round(rate * ndays / 1000.0) * 1000)
        li["cpm"] = round(p[6] * rng.uniform(0.74, 0.95), 2)
        # linear audience estimates miss now and then (ratings below the estimate the IO was sold on) —
        # the source of the historical make-goods. Only for flights that are already over.
        li["ratings_factor"] = rng.uniform(0.80, 0.92) if (p[2] == "Linear" and li["flight_end"] < D(-20) and rng.random() < 0.22) else 1.0
        keep.append(li)
    lines = keep
    ids = {li["campaign_id"] for li in lines}
    campaigns = [c for c in campaigns if c["campaign_id"] in ids]
    by_c = defaultdict(list)
    for li in lines:
        by_c[li["campaign_id"]].append(li)
    for c in campaigns:
        ls = by_c[c["campaign_id"]]
        c["booked_impressions"] = sum(x["booked_impressions"] for x in ls)
        c["booked_revenue"] = round(sum(x["booked_impressions"] * x["cpm"] / 1000 for x in ls), 2)
    return campaigns, lines


# ─────────────────────────────────────────────────────────────────────────────
# Serving simulation: avails → guaranteed → PMP → open auction → unsold
# ─────────────────────────────────────────────────────────────────────────────
def group_on(pid: str, d: date) -> str:
    if pid == "STR-SPORTS-LIVE" and d >= MIGRATION_DAY:
        return "RON-DEFAULT"
    return P_BY_ID[pid][7]


def simulate(campaigns, lines):
    days = [START + timedelta(days=i) for i in range(HIST_DAYS)]   # START … yesterday
    lines_by_p = defaultdict(list)
    for li in lines:
        lines_by_p[li["product_id"]].append(li)
    delivery, inventory = [], []
    delivered_to_date = defaultdict(int)
    for d in days:
        for p in PRODUCTS:
            pid = p[0]
            av = daily_avails(pid, d)
            active = [li for li in lines_by_p[pid] if li["flight_start"] <= d <= li["flight_end"]]
            demand = {}
            for li in active:
                ndays = (li["flight_end"] - li["flight_start"]).days + 1
                planned = li["booked_impressions"] / ndays
                # simple pacing controller: catch up a little when behind (never beyond 125% of plan)
                elapsed = (d - li["flight_start"]).days
                behind = li["booked_impressions"] * elapsed / ndays - delivered_to_date[li["line_id"]]
                want = planned + (max(0.0, min(behind * 0.08, planned * 0.25)) if li.get("ratings_factor", 1.0) == 1.0 else 0.0)
                demand[li["line_id"]] = want
            cap = av * (0.93 if p[2] == "Linear" else 0.88)
            tot = sum(demand.values())
            scale = min(1.0, cap / tot) if tot > 0 else 1.0
            g_imps, g_rev = 0, 0.0
            for li in active:
                imps = int(demand[li["line_id"]] * scale * rng.uniform(0.985, 1.01) * li.get("ratings_factor", 1.0))
                remaining = li["booked_impressions"] - delivered_to_date[li["line_id"]]
                imps = max(0, min(imps, remaining + int(li["booked_impressions"] * 0.02)))
                if imps <= 0:
                    continue
                delivered_to_date[li["line_id"]] += imps
                rev = imps * li["cpm"] / 1000
                g_imps += imps
                g_rev += rev
                delivery.append(dict(delivery_date=d, line_id=li["line_id"], campaign_id=li["campaign_id"], product_id=pid,
                                     impressions=imps, revenue=round(rev, 2)))
            rem = max(0, av - g_imps)
            grp = group_on(pid, d)
            floor = GROUP_FLOORS[grp]
            sports_season = in_sports_season(d)
            if p[10]:
                # open-auction demand: bids for this content (sports bids strong in season)
                rc = p[6]
                demand_strength = (0.62 if p[11] != "sports" else (0.66 if sports_season else 0.42))
                p50 = rc * demand_strength * rng.uniform(0.95, 1.05)
                p90 = p50 * rng.uniform(1.45, 1.6)
                bids_per_req = (4.1 if p[11] == "sports" and sports_season else 2.8) * rng.uniform(0.92, 1.08)
                if grp == "RON-DEFAULT":
                    pmp_share = 0.75 if pid == "STR-SPORTS-LIVE" else 0.42
                    pmp_price = 10.50
                elif grp == "PREMIUM-SPORTS":
                    pmp_share, pmp_price = 0.22, 32.0
                elif grp == "PREMIUM-ENT":
                    pmp_share, pmp_price = 0.25, 24.0
                else:
                    pmp_share, pmp_price = 0.2, 15.0
                pmp_imps = int(rem * pmp_share * rng.uniform(0.96, 1.04))
                open_fill = min(0.95, 1 - 0.5 ** bids_per_req) * (0.75 if grp != "RON-DEFAULT" else 0.62)
                if pid == "STR-SPORTS-LIVE" and grp == "RON-DEFAULT":
                    open_fill = 0.52
                open_imps = int((rem - pmp_imps) * open_fill)
                clearing = max(floor or 0, p50 * rng.uniform(1.02, 1.1))
                bid_requests = int((rem - pmp_imps) * rng.uniform(1.15, 1.3))
            else:
                pmp_imps = open_imps = bid_requests = 0
                pmp_price = clearing = p50 = p90 = bids_per_req = None
            unsold = max(0, rem - pmp_imps - open_imps)
            inventory.append(dict(
                inventory_date=d, product_id=pid, avails=av, guaranteed_impressions=g_imps, guaranteed_revenue=round(g_rev, 2),
                pmp_impressions=pmp_imps, pmp_revenue=round(pmp_imps * (pmp_price or 0) / 1000, 2),
                open_auction_impressions=open_imps, open_auction_revenue=round(open_imps * (clearing or 0) / 1000, 2),
                unsold_impressions=unsold, open_bid_requests=bid_requests,
                avg_bids_per_request=round(bids_per_req, 2) if bids_per_req else None,
                p50_open_bid_cpm=round(p50, 2) if p50 else None, p90_open_bid_cpm=round(p90, 2) if p90 else None,
                open_clearing_cpm=round(clearing, 2) if clearing else None,
                floor_cpm=floor, inventory_group=grp,
            ))
    return delivery, inventory, delivered_to_date


def finalize_campaigns(campaigns, lines, delivered_to_date):
    by_c = defaultdict(list)
    for li in lines:
        by_c[li["campaign_id"]].append(li)
    make_goods = []
    yday = D(-1)
    n = 0
    for c in campaigns:
        if c["flight_start"] > yday:
            c["status"] = "Booked"
        elif c["flight_end"] > yday:
            c["status"] = "Live"
        else:
            c["status"] = "Completed"
            deliv = sum(delivered_to_date[li["line_id"]] for li in by_c[c["campaign_id"]])
            if c["booked_impressions"] and deliv < 0.95 * c["booked_impressions"]:
                short = c["booked_impressions"] - deliv
                cpm = c["booked_revenue"] / c["booked_impressions"] * 1000
                n += 1
                issued = c["flight_end"] + timedelta(days=rng.randint(5, 12))
                if issued > yday:
                    issued = yday
                cash = rng.random() < 0.3
                make_goods.append(dict(make_good_id=f"MG-{n:04d}", campaign_id=c["campaign_id"], issued_date=issued,
                                       shortfall_impressions=int(short), make_good_value=round(short * cpm / 1000, 2),
                                       resolution="Cash credit" if cash else "ADU (audience deficiency units)",
                                       adu_inventory=None if cash else rng.choice(["Crest+ Run of Network", "FAST · Classic TV Channels", "ACN Daytime", "ACN Late Night"]),
                                       reason=rng.choice(["Ratings under-delivery vs estimate", "Avails shortfall in booked daypart",
                                                          "Pre-emption (breaking news)", "Audience composition below guarantee"])))
    for li in lines:
        li.pop("fixed", None)
        li.pop("ratings_factor", None)
    return make_goods


def floor_rules():
    rows = []
    n = 0
    for p in PRODUCTS:
        if not p[10]:
            continue
        n += 1
        g = p[7]
        if p[0] == "STR-SPORTS-LIVE":
            rows.append(dict(rule_id=f"FR-{n:03d}", product_id=p[0], inventory_group="PREMIUM-SPORTS", floor_cpm=30.0,
                             effective_from=START - timedelta(days=200), effective_to=MIGRATION_DAY - timedelta(days=1),
                             changed_by="yield-desk (M. Chen)", change_ticket="YLD-2291",
                             change_note="Premium Sports floor group — floor $30 after the 2025 upfront"))
            rows.append(dict(rule_id="FR-117", product_id=p[0], inventory_group="RON-DEFAULT", floor_cpm=9.0,
                             effective_from=MIGRATION_DAY, effective_to=None, changed_by="adserver-migration (svc)",
                             change_ticket="ADOPS-5540",
                             change_note="Bulk re-mapping of streaming ad units to the new ad server; unmapped ad-unit paths default to RON-DEFAULT"))
        else:
            rows.append(dict(rule_id=f"FR-{n:03d}", product_id=p[0], inventory_group=g, floor_cpm=GROUP_FLOORS[g],
                             effective_from=START - timedelta(days=200), effective_to=None,
                             changed_by="yield-desk (M. Chen)", change_ticket=f"YLD-{2200 + n}",
                             change_note=f"{g} floor group"))
    return rows


def build_all():
    campaigns, lines = build_campaigns()
    delivery, inventory, dtd = simulate(campaigns, lines)
    make_goods = finalize_campaigns(campaigns, lines, dtd)
    return dict(campaigns=campaigns, lines=lines, delivery=delivery, inventory=inventory, make_goods=make_goods,
                floor_rules=floor_rules(), dtd=dtd)


def summarize(data):
    dtd, lines, campaigns = data["dtd"], data["lines"], data["campaigns"]
    yday = D(-1)
    print(f"TODAY={TODAY} migration={MIGRATION_DAY} harbor_move={HARBOR_MOVE_DAY}")
    print(f"campaigns={len(campaigns)} lines={len(lines)} delivery={len(data['delivery'])} inventory={len(data['inventory'])} make_goods={len(data['make_goods'])}")
    by_c = defaultdict(list)
    for li in lines:
        by_c[li["campaign_id"]].append(li)
    risk = []
    last14 = defaultdict(int)
    for r in data["delivery"]:
        if r["delivery_date"] >= D(-14):
            last14[r["campaign_id"]] += r["impressions"]
    for c in campaigns:
        if c["status"] != "Live":
            continue
        deliv = sum(dtd[li["line_id"]] for li in by_c[c["campaign_id"]])
        nd = (c["flight_end"] - c["flight_start"]).days + 1
        el = (yday - c["flight_start"]).days + 1
        exp = c["booked_impressions"] * el / nd
        rr = last14[c["campaign_id"]] / min(14, el)
        proj = min(c["booked_impressions"], deliv + rr * (nd - el))
        short = c["booked_impressions"] - proj
        cpm = c["booked_revenue"] / c["booked_impressions"] * 1000
        risk.append((short * cpm / 1000, c["campaign_id"], c["campaign_name"], deliv / exp, proj / c["booked_impressions"], short))
    risk.sort(reverse=True)
    for r in risk[:8]:
        print(f"  {r[1]} {r[2][:40]:40s} pacing={r[3]:.2f} proj={r[4]:.2f} short={r[5]/1e6:.2f}M liab=${r[0]:,.0f}")
    # sports leak
    inv = [x for x in data["inventory"] if x["product_id"] == "STR-SPORTS-LIVE" and x["inventory_date"] >= D(-28)]
    pmp = sum(x["pmp_impressions"] for x in inv)
    op = sum(x["open_auction_impressions"] for x in inv)
    rev = sum(x["pmp_revenue"] + x["open_auction_revenue"] for x in inv)
    orev = sum(x["open_auction_revenue"] for x in inv)
    print(f"  sports 28d pmp={pmp/1e6:.1f}M open={op/1e6:.1f}M prog eCPM={rev/(pmp+op)*1000:.2f} open clearing={orev/op*1000:.2f}")
    fut = sum(daily_avails("STR-SPORTS-LIVE", D(i)) for i in range(0, 31))
    print(f"  sports next31 avails≈{fut/1e6:.1f}M")


def S(name, t, nullable=True):
    from pyspark.sql import types as T  # noqa
    return T.StructField(name, t, nullable)


def write(spark, fq_schema, name, rows, struct, comment, pk=None):
    fq = f"{fq_schema}.{name}"
    cols = [f.name for f in struct.fields]
    df = spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], struct)
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        for c in pk.split(","):
            spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {c.strip()} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="media_advertising")
    ap.add_argument("--schema", default="ad_yield_optimization")
    ap.add_argument("--dry-run", action="store_true")
    args, _ = ap.parse_known_args()
    data = build_all()
    summarize(data)
    if args.dry_run:
        return

    from pyspark.sql import types as T
    St, I, L, Dt, Db, B = T.StringType(), T.IntegerType(), T.LongType(), T.DateType(), T.DoubleType(), T.BooleanType()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Aurora Crest Media — ad yield & pricing optimization demo (Ad Yield Copilot)'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.ad_sales_library COMMENT 'Rate card, floor-price governance, make-good policy, IO terms, ad-ops SOP - documents searched by the Genie agent'")
    for t in ["make_goods", "delivery_daily", "line_items", "campaigns", "inventory_daily", "floor_price_rules", "programmatic_deals",
              "product_audience_mix", "advertisers", "audience_segments", "ad_products"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    write(spark, fqs, "ad_products", [dict(product_id=p[0], product_name=p[1], platform=p[2], content_category=p[3], daypart=p[4],
                                           tier=p[5], rate_card_cpm=p[6], rate_card_inventory_group=p[7], programmatic_enabled=p[10])
                                      for p in PRODUCTS],
          T.StructType([S("product_id", St), S("product_name", St), S("platform", St), S("content_category", St), S("daypart", St),
                        S("tier", St), S("rate_card_cpm", Db), S("rate_card_inventory_group", St), S("programmatic_enabled", B)]),
          "Sellable ad inventory products (platform x content x daypart x tier) with the 2026-27 rate-card CPM. rate_card_inventory_group = the floor-price group the rate card assigns (the ad server's CURRENT group is in floor_price_rules / inventory_daily.inventory_group). Platforms: Streaming (Crest+ AVOD), FAST channels, Linear (ACN broadcast network — no programmatic).",
          pk="product_id")
    write(spark, fqs, "audience_segments", [dict(segment_id=s[0], segment_name=s[1], description=s[2]) for s in SEGMENTS],
          T.StructType([S("segment_id", St), S("segment_name", St), S("description", St)]),
          "Audience segments sold as impression guarantees.", pk="segment_id")
    write(spark, fqs, "product_audience_mix", [dict(product_id=pid, segment_id=sid, audience_share=v) for pid, m in MIX.items() for sid, v in m.items()],
          T.StructType([S("product_id", St), S("segment_id", St), S("audience_share", Db)]),
          "Share of a product's impressions that reach each audience segment (segments overlap). In-target avails = avails x audience_share.",
          pk="product_id, segment_id")
    write(spark, fqs, "advertisers", [dict(advertiser_id=a[0], advertiser_name=a[1], category=a[2], agency=a[3]) for a in ADVERTISERS],
          T.StructType([S("advertiser_id", St), S("advertiser_name", St), S("category", St), S("agency", St)]),
          "Advertisers and their buying agency.", pk="advertiser_id")
    write(spark, fqs, "campaigns", data["campaigns"], T.StructType([
        S("campaign_id", St), S("io_number", St), S("advertiser_id", St), S("campaign_name", St), S("deal_type", St),
        S("target_segment_id", St), S("flight_start", Dt), S("flight_end", Dt), S("booked_impressions", L), S("booked_revenue", Db),
        S("make_good_terms", St), S("sales_owner", St), S("status", St)]),
        "Insertion orders (campaigns). booked_impressions = guaranteed impressions in the target audience segment; booked_revenue = sum of line items (impressions x CPM / 1000). deal_type: Upfront Guaranteed / Scatter Guaranteed / Programmatic Guaranteed. status Live = in flight today.",
        pk="campaign_id")
    write(spark, fqs, "line_items", data["lines"], T.StructType([
        S("line_id", St), S("campaign_id", St), S("product_id", St), S("booked_impressions", L), S("cpm", Db),
        S("flight_start", Dt), S("flight_end", Dt)]),
        "IO line items: which inventory product a campaign runs on, booked in-target impressions and the negotiated CPM.", pk="line_id")
    write(spark, fqs, "delivery_daily", data["delivery"], T.StructType([
        S("delivery_date", Dt), S("line_id", St), S("campaign_id", St), S("product_id", St), S("impressions", L), S("revenue", Db)]),
        "Delivered in-target impressions and revenue per line item per day (ad-server logs, through yesterday).",
        pk="delivery_date, line_id")
    write(spark, fqs, "inventory_daily", data["inventory"], T.StructType([
        S("inventory_date", Dt), S("product_id", St), S("avails", L), S("guaranteed_impressions", L), S("guaranteed_revenue", Db),
        S("pmp_impressions", L), S("pmp_revenue", Db), S("open_auction_impressions", L), S("open_auction_revenue", Db),
        S("unsold_impressions", L), S("open_bid_requests", L), S("avg_bids_per_request", Db), S("p50_open_bid_cpm", Db),
        S("p90_open_bid_cpm", Db), S("open_clearing_cpm", Db), S("floor_cpm", Db), S("inventory_group", St)]),
        "Daily inventory ledger per product: avails (sellable impressions), how they were sold — guaranteed IO delivery, programmatic PMP deals, open auction — or left unsold, with revenue, the open-auction bid landscape (median / p90 bid, clearing price) and the floor price + inventory group the ad server had in force that day. Sell-through = sold / avails; eCPM = revenue / sold impressions x 1000.",
        pk="inventory_date, product_id")
    write(spark, fqs, "floor_price_rules", data["floor_rules"], T.StructType([
        S("rule_id", St), S("product_id", St), S("inventory_group", St), S("floor_cpm", Db), S("effective_from", Dt),
        S("effective_to", Dt), S("changed_by", St), S("change_ticket", St), S("change_note", St)]),
        "Ad-server floor-price configuration history per programmatic product: inventory group, floor CPM, validity window and who changed it. effective_to NULL = rule in force today.",
        pk="rule_id")
    write(spark, fqs, "programmatic_deals", [dict(deal_id=x[0], deal_name=x[1], inventory_group=x[2], price_cpm=x[3], buyers=x[4], price_type=x[5]) for x in PMP_DEALS],
          T.StructType([S("deal_id", St), S("deal_name", St), S("inventory_group", St), S("price_cpm", Db), S("buyers", St), S("price_type", St)]),
          "Private-marketplace (PMP) deals: the inventory group each deal can buy and its price (fixed price, or a floor). PMP deals have priority over the open auction.",
          pk="deal_id")
    write(spark, fqs, "make_goods", data["make_goods"], T.StructType([
        S("make_good_id", St), S("campaign_id", St), S("issued_date", Dt), S("shortfall_impressions", L), S("make_good_value", Db),
        S("resolution", St), S("adu_inventory", St), S("reason", St)]),
        "Make-goods issued on completed campaigns that delivered < 95% of their guarantee: shortfall impressions, value at the booked CPM, resolution (ADUs or cash credit).",
        pk="make_good_id")

    for stmt in [
        f"ALTER TABLE {fqs}.campaigns ADD CONSTRAINT campaigns_adv_fk FOREIGN KEY (advertiser_id) REFERENCES {fqs}.advertisers RELY",
        f"ALTER TABLE {fqs}.campaigns ADD CONSTRAINT campaigns_seg_fk FOREIGN KEY (target_segment_id) REFERENCES {fqs}.audience_segments RELY",
        f"ALTER TABLE {fqs}.line_items ADD CONSTRAINT lines_campaign_fk FOREIGN KEY (campaign_id) REFERENCES {fqs}.campaigns RELY",
        f"ALTER TABLE {fqs}.line_items ADD CONSTRAINT lines_product_fk FOREIGN KEY (product_id) REFERENCES {fqs}.ad_products RELY",
        f"ALTER TABLE {fqs}.delivery_daily ADD CONSTRAINT delivery_line_fk FOREIGN KEY (line_id) REFERENCES {fqs}.line_items RELY",
        f"ALTER TABLE {fqs}.inventory_daily ADD CONSTRAINT inventory_product_fk FOREIGN KEY (product_id) REFERENCES {fqs}.ad_products RELY",
        f"ALTER TABLE {fqs}.floor_price_rules ADD CONSTRAINT floor_product_fk FOREIGN KEY (product_id) REFERENCES {fqs}.ad_products RELY",
        f"ALTER TABLE {fqs}.make_goods ADD CONSTRAINT mg_campaign_fk FOREIGN KEY (campaign_id) REFERENCES {fqs}.campaigns RELY",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
