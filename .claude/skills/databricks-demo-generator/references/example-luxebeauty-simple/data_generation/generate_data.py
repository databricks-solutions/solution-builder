"""
LuxeBeauty Returns — SIMPLE-demo synthetic data generator.

Mirrors `references/example-luxebeauty-simple/specifications/01-lakeflow.md`:
no SDP, no metric view, no ai_classify. One self-contained file —
synth + Parquet drop + spark.sql transforms — ~2 minutes end-to-end.

  Phase 1 — Build 5 pandas DataFrames in memory (customers, products,
            production_lots, orders, returns).
  Phase 2 — Write each DataFrame as a Parquet file into a UC Volume.
            This is the "raw drop" surface a production pipeline would
            normally land via Lakeflow Connect.
  Phase 3 — `spark.sql` ingests each parquet file into a `raw_<name>`
            Delta table (one statement per table, COMMENT each).
  Phase 4 — `spark.sql` runs the 2 transforms into `gold_<name>` Delta
            tables (column-level COMMENTs for Genie + Catalog Explorer).
  Phase 5 — Constraints (PK / FK NOT ENFORCED RELY) so Catalog Explorer
            renders the lineage arrows.

Re-skinning for another demo:
  - Change CATALOG / SCHEMA / VOLUME below (or override via env).
  - Swap the product list / city anchors / time anchors.
  - Edit the Phase 3-5 spark.sql blocks for a different schema.

Runtime: pre-provisioned databricks-connect venv (path in system prompt).
Has Python 3.12, databricks-connect, faker, numpy, pandas, pyarrow.
Do NOT create a new venv.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from databricks.connect import DatabricksSession
from faker import Faker

# ── Config (override via env when re-skinning) ─────────────────────────────
CATALOG = os.environ.get("LUXE_CATALOG", "luxebeauty")
SCHEMA  = os.environ.get("LUXE_SCHEMA",  "demo_simple")
VOLUME  = os.environ.get("LUXE_VOLUME",  "raw_drop")

# Time anchors — every date downstream derives from NOW.
NOW             = datetime.now()
SPIKE_PEAK      = NOW - timedelta(weeks=3)
DECAY_START     = NOW - timedelta(weeks=2)

# Bad-lot timing: defaults to NOW − 8w, but if that lands in a major
# shopping peak (Black Friday week, Dec holiday ramp), shift it back so
# the return spike isn't visually swallowed by the seasonal volume. The
# anomaly is the load-bearing story — it has to read through the noise.
def _is_peak_day(d: datetime) -> bool:
    m, day = d.month, d.day
    return (m == 11 and 20 <= day <= 30) or (m == 12 and 1 <= day <= 26)

BAD_LOT_PROD_DT = NOW - timedelta(weeks=8)
while _is_peak_day(BAD_LOT_PROD_DT) or _is_peak_day(BAD_LOT_PROD_DT + timedelta(weeks=5)):
    # Slide back one more week until both the lot ship date AND the
    # return-peak window (~5w later) clear the holiday surge.
    BAD_LOT_PROD_DT -= timedelta(weeks=1)
BAD_LOT_ID      = f"LOT-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}"
BAD_SKUS        = ["SKU-1001", "SKU-1002", "SKU-1003"]
BAD_FACILITY    = "Lyon-France"

INCIDENT_SUMMARY = (
    f"Production Incident Report PIR-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}. "
    "Equipment: Homogenizer Unit HMG-03 at Lyon. Issue: pressure fluctuations "
    "(2.1–2.8 bar vs normal 2.4–2.6 bar) during emulsification. Cause: "
    "calibration drift in the pressure regulation valve. "
    "Affected SKUs: SKU-1001, SKU-1002, SKU-1003 (~5,000 units). "
    "QC assessment: 'Minor texture variations due to pressure fluctuations "
    "during emulsification — cosmetic only; safety and efficacy unaffected.' "
    "Disposition: RELEASED."
)

# Volumes are not a sub-resource of schemas in Python; they're addressed by
# the path `/Volumes/<catalog>/<schema>/<volume>`. We create the volume via
# SQL in Phase 0 below and reference this path everywhere else.
VOLUME_ROOT = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}/raw"

N_CUSTOMERS = 50_000
N_ORDERS    = 200_000  # ~3.8K/week baseline matches 01-lakeflow spec

print(f"BAD_LOT_ID: {BAD_LOT_ID}")
print(f"SPIKE_PEAK: {SPIKE_PEAK.date()}")
print(f"VOLUME_ROOT: {VOLUME_ROOT}")

spark = DatabricksSession.builder.serverless(True).getOrCreate()

np.random.seed(42)
fake = Faker(["fr_FR", "it_IT", "en_US"])
Faker.seed(42)

# ── Phase 0 — Ensure catalog / schema / volume exist ───────────────────────
# A future demo re-skin only needs to change the three names above; this
# block creates whatever's missing so the script is one-command idempotent.
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.{VOLUME}")

# ── City anchors (per spec § City anchors + GPS) ───────────────────────────
# (city, lat, lng, weight) per country. Drives the bubble map. Paris is the
# heaviest FR weight → with the affected-lot EU skew, Paris ends up the
# largest bubble in the simple demo's map widget.
CITY_ANCHORS: dict[str, list[tuple[str, float, float, float]]] = {
    "US":      [("New York", 40.71, -74.01, 0.30), ("Los Angeles", 34.05, -118.25, 0.20),
                ("Chicago",  41.88, -87.63, 0.15), ("Houston",     29.76, -95.37, 0.10),
                ("Miami",    25.76, -80.19, 0.10), ("San Francisco",37.77,-122.42, 0.15)],
    "CA":      [("Toronto",  43.65, -79.38, 0.45), ("Montreal",   45.50, -73.57, 0.30),
                ("Vancouver",49.28,-123.12, 0.25)],
    "FR":      [("Paris",    48.86,   2.35, 0.45), ("Lyon",        45.76,   4.83, 0.18),
                ("Marseille",43.30,   5.37, 0.15), ("Toulouse",    43.60,   1.44, 0.12),
                ("Lille",    50.63,   3.06, 0.10)],
    "GB":      [("London",   51.51,  -0.13, 0.55), ("Manchester",  53.48,  -2.24, 0.18),
                ("Birmingham",52.49, -1.89, 0.15), ("Edinburgh",   55.95,  -3.19, 0.12)],
    "DE":      [("Berlin",   52.52,  13.40, 0.30), ("Munich",      48.14,  11.58, 0.25),
                ("Hamburg",  53.55,   9.99, 0.20), ("Frankfurt",   50.11,   8.68, 0.15),
                ("Cologne",  50.94,   6.96, 0.10)],
    "IT":      [("Milan",    45.46,   9.19, 0.40), ("Rome",        41.90,  12.50, 0.30),
                ("Naples",   40.85,  14.27, 0.15), ("Turin",       45.07,   7.69, 0.15)],
    "ES":      [("Madrid",   40.42,  -3.70, 0.45), ("Barcelona",   41.39,   2.17, 0.35),
                ("Valencia", 39.47,  -0.38, 0.20)],
    "JP":      [("Tokyo",    35.68, 139.69, 0.60), ("Osaka",       34.69, 135.50, 0.25),
                ("Kyoto",    35.01, 135.77, 0.15)],
    "AU":      [("Sydney",   -33.87,151.21, 0.50), ("Melbourne",  -37.81, 144.96, 0.35),
                ("Brisbane", -27.47,153.03, 0.15)],
    "KR":      [("Seoul",    37.57, 126.98, 0.80), ("Busan",       35.18, 129.08, 0.20)],
    "SG":      [("Singapore", 1.35, 103.82, 1.00)],
}

def pick_city(country: str) -> tuple[str, float, float]:
    """City + jittered lat/lng (±0.05° = ~5km). Weighted by anchor weight."""
    pool = CITY_ANCHORS[country]
    weights = np.array([w for _, _, _, w in pool])
    weights = weights / weights.sum()
    idx = np.random.choice(len(pool), p=weights)
    name, lat, lng, _ = pool[idx]
    return (
        name,
        round(lat + np.random.uniform(-0.05, 0.05), 5),
        round(lng + np.random.uniform(-0.05, 0.05), 5),
    )

# Region groups: a country's region drives the dashboard's region filter.
REGION_OF = {**{c: "US"   for c in ("US", "CA")},
             **{c: "EU"   for c in ("FR", "GB", "DE", "IT", "ES")},
             **{c: "APAC" for c in ("JP", "AU", "KR", "SG")}}

COUNTRY_WEIGHTS = {  # sales mix US 70 / EU 20 / APAC 10
    "US": 0.66, "CA": 0.04,                                  # US 70
    "FR": 0.06, "GB": 0.05, "DE": 0.04, "IT": 0.03, "ES": 0.02,  # EU 20
    "JP": 0.04, "AU": 0.03, "KR": 0.02, "SG": 0.01,          # APAC 10
}

# ── Phase 1 — Generate 5 pandas DataFrames in memory ───────────────────────

# 1.a Products (~30 SKUs, hand-curated for narrative — affected SKUs at top,
# remaining mix spread across categories so the dashboard's category donut
# has more than one slice).
print("Generating products...")
products_data: list[tuple[str, str, str, str, float, float]] = [
    ("SKU-1001", "Hydrating Serum 30ml",        "Skincare",  "Serums",      68.0, 12.0),
    ("SKU-1002", "Vitamin C Cream 50ml",        "Skincare",  "Creams",      55.0, 10.0),
    ("SKU-1003", "HA Moisture Boost 15ml",      "Skincare",  "Serums",      42.0,  8.0),
    ("SKU-1004", "Pure Clarity Cleanser",       "Skincare",  "Cleansers",   45.0,  9.0),
    ("SKU-1005", "Dewy Glow Moisturizer",       "Skincare",  "Moisturizers",60.0, 11.0),
    ("SKU-1006", "Youth Essence Eye Cream",     "Skincare",  "Eye Creams",  75.0, 14.0),
    ("SKU-1007", "Calm & Renew Toner",          "Skincare",  "Toners",      40.0,  8.0),
    ("SKU-2001", "Velvet Matte Lipstick",       "Makeup",    "Lips",        32.0,  6.0),
    ("SKU-2002", "Luminous Foundation SPF 30",  "Makeup",    "Face",        55.0, 10.0),
    ("SKU-2003", "Rose Gold Blush Palette",     "Makeup",    "Face",        48.0,  9.0),
    ("SKU-2004", "Precision Liner Pen",         "Makeup",    "Eyes",        28.0,  5.0),
    ("SKU-2005", "Glossy Plump Gloss",          "Makeup",    "Lips",        25.0,  5.0),
    ("SKU-2006", "Smoky Eye Shadow Quad",       "Makeup",    "Eyes",        42.0,  8.0),
    ("SKU-2007", "Brow Define Pencil",          "Makeup",    "Eyes",        22.0,  4.0),
    ("SKU-2008", "Setting Powder Translucent",  "Makeup",    "Face",        38.0,  7.0),
    ("SKU-3001", "Silk Repair Shampoo",         "Haircare",  "Wash",        35.0,  7.0),
    ("SKU-3002", "Silk Repair Conditioner",     "Haircare",  "Wash",        35.0,  7.0),
    ("SKU-3003", "Argan Miracle Hair Mask",     "Haircare",  "Treatments",  50.0,  9.0),
    ("SKU-3004", "Scalp Balance Serum",         "Haircare",  "Treatments",  65.0, 12.0),
    ("SKU-3005", "Glossy Finish Hair Oil",      "Haircare",  "Styling",     45.0,  8.0),
    ("SKU-4001", "Rose Petal Body Lotion",      "Bodycare",  "Lotions",     38.0,  7.0),
    ("SKU-4002", "Sugar Glow Exfoliating Scrub","Bodycare",  "Scrubs",      32.0,  6.0),
    ("SKU-4003", "Velvet Body Butter",          "Bodycare",  "Butters",     42.0,  8.0),
    ("SKU-4004", "Calming Lavender Bath Soak",  "Bodycare",  "Bath",        28.0,  5.0),
    ("SKU-4005", "Firming Contour Body Cream",  "Bodycare",  "Creams",      55.0, 10.0),
    ("SKU-5001", "Luxe Floral EDP 50ml",        "Fragrance", "EDP",        120.0, 22.0),
    ("SKU-5002", "Rose & Oud Collection 30ml",  "Fragrance", "EDP",         95.0, 18.0),
    ("SKU-5003", "Cedar & Amber Body Mist",     "Fragrance", "Mist",        45.0,  8.0),
    ("SKU-5004", "Fresh Citrus EDT",            "Fragrance", "EDT",         80.0, 15.0),
    ("SKU-5005", "Noir Intense EDP 50ml",       "Fragrance", "EDP",        130.0, 24.0),
]
prod_df = pd.DataFrame(
    products_data,
    columns=["product_id", "product_name", "category", "subcategory", "price_usd", "cost_usd"],
)
prod_df["launch_date"] = (NOW - timedelta(days=365)).strftime("%Y-%m-%d")
prod_df["is_active"]   = True
sku_prices = dict(zip(prod_df["product_id"], prod_df["price_usd"]))

# 1.b Customers
print(f"Generating {N_CUSTOMERS:,} customers...")
countries = list(COUNTRY_WEIGHTS.keys())
country_p = np.array([COUNTRY_WEIGHTS[c] for c in countries])
country_p /= country_p.sum()
cust_countries = np.random.choice(countries, size=N_CUSTOMERS, p=country_p)

custs = []
for i in range(N_CUSTOMERS):
    country = cust_countries[i]
    # Loyalty: 10% gold / 30% silver / 60% standard.
    tier = np.random.choice(["gold", "silver", "standard"], p=[0.10, 0.30, 0.60])
    reg_dt = NOW - timedelta(days=int(np.random.randint(60, 3 * 365)))
    city, lat, lng = pick_city(country)
    custs.append({
        "customer_id":       f"CUST-{i:06d}",
        "email":             fake.email(),
        "first_name":        fake.first_name(),
        "last_name":         fake.last_name(),
        "region":            REGION_OF[country],
        "country":           country,
        "city":              city,
        "customer_lat":      lat,
        "customer_lng":      lng,
        "loyalty_tier":      tier,
        "registration_date": reg_dt.strftime("%Y-%m-%d"),
    })
cust_df = pd.DataFrame(custs)
cust_lookup = {c["customer_id"]: c for c in custs}

# 1.c Production lots (~1,500). One lot per (sku, month-back, lot-num) for
# 6 months of history → 30 SKUs × 6 months × ~8 lots ≈ 1,440. Plus 3 rows
# (one per affected SKU) for the BAD_LOT — they share `lot_id` because the
# story is "one production run produced 3 SKUs", and Genie reads the
# `incident_summary` text from any of those rows.
print("Generating production lots...")
facilities = ["Lyon-France", "Milan-Italy", "London-UK", "NJ-USA"]
lots = []
lots_by_sku: dict[str, list[tuple[str, str]]] = {sku: [] for sku, *_ in products_data}
for sku, *_ in products_data:
    for month_back in range(6, 0, -1):
        for lot_num in range(1, 9):  # 8 lots/month
            prod_dt  = NOW - timedelta(days=month_back * 30 + lot_num * 3)
            facility = np.random.choice(facilities)
            lot_id   = f"LOT-{prod_dt.year}-{prod_dt.strftime('%m%d')}-{sku[-4:]}"
            lots.append({
                "lot_id":            lot_id,
                "product_id":        sku,
                "production_date":   prod_dt.strftime("%Y-%m-%d"),
                "facility":          facility,
                "quantity_produced": int(np.random.randint(200, 1000)),
                "status":            "released",
                "incident_summary":  None,
            })
            lots_by_sku[sku].append((lot_id, facility))

for bad_sku in BAD_SKUS:
    lots.append({
        "lot_id":            BAD_LOT_ID,
        "product_id":        bad_sku,
        "production_date":   BAD_LOT_PROD_DT.strftime("%Y-%m-%d"),
        "facility":          BAD_FACILITY,
        "quantity_produced": 5000,
        "status":            "released",  # released DESPITE the QC note
        "incident_summary":  INCIDENT_SUMMARY,
    })
    lots_by_sku[bad_sku].append((BAD_LOT_ID, BAD_FACILITY))
lots_df = pd.DataFrame(lots)

# 1.d Orders (~200K). One row per order/SKU line. Quantity small (1 usually).
# Bad-lot orders are appended explicitly so we control the date window
# (lot ships → orders placed weeks −7..−4 → returns peak −3w).
#
# Time window: 1 year of history. Order dates are sampled with seasonal
# weights (Black Friday + Holiday peak, Mother's Day + Valentine's bumps,
# summer dip) so the trend line has natural humps rather than a flat
# uniform-random envelope. Bad-lot orders sit on top of whatever season
# they land in.
print(f"Generating {N_ORDERS:,} orders...")
START_HIST = NOW - timedelta(days=365)
END_HIST   = NOW - timedelta(days=1)
span_days  = (END_HIST - START_HIST).days
all_skus = [p[0] for p in products_data]

def _season_multiplier(d: datetime) -> float:
    """Per-day order-volume multiplier. Returns 1.0 for a flat day, higher
    for shopping peaks, lower for dips. Calibrated to give the trend line
    **two distinct shopping spikes** with a valley between them: a sharp
    Black Friday peak, a small dip through early December, then a Christmas
    rush peaking ~Dec 20-22, then a post-cutoff lull. Tweak the bands if
    your demo lives in a different vertical."""
    m, day = d.month, d.day
    # Black Friday spike — sharp triangular peak centered Nov 28
    if m == 11 and 24 <= day <= 30:
        # tent from 2.0 (Nov 24) → 3.2 (Nov 28) → 2.0 (Nov 30)
        return 3.2 - 0.3 * abs(day - 28)
    # Early-December valley between the two peaks (visual separation)
    if m == 12 and 1 <= day <= 10:      return 1.3
    # Christmas rush — sharper rise, peaks Dec 20-22, then drops
    if m == 12 and 11 <= day <= 22:
        # 1.5 (Dec 11) → 3.2 (Dec 21) → 3.0 (Dec 22)
        if day <= 21:
            return 1.5 + ((day - 11) / 10) * 1.7
        return 3.0
    # Post-shipping-cutoff lull (Dec 23-26)
    if m == 12 and 23 <= day <= 26:     return 0.6
    # Post-Christmas self-buying rebound (Dec 27-31)
    if m == 12 and day >= 27:           return 1.3
    if m == 5 and 7 <= day <= 14:       return 2.0   # Mother's Day week
    if m == 2 and 7 <= day <= 14:       return 1.8   # Valentine's week
    if m in (7, 8):                     return 0.75  # Summer dip
    return 1.0

# Pre-compute a per-day weight vector across the 365-day window. ±15%
# gaussian jitter keeps the curve from looking too clean.
_day_offsets = np.arange(span_days + 1)
_day_dates   = [START_HIST + timedelta(days=int(o)) for o in _day_offsets]
_day_weights = np.array([_season_multiplier(d) for d in _day_dates])
_day_weights *= (1.0 + np.random.normal(0, 0.15, size=_day_weights.shape))
_day_weights = np.clip(_day_weights, 0.05, None)
_day_weights /= _day_weights.sum()

# Product popularity: top 20% of SKUs ≈ 60% of sales. Affected SKUs are
# mid-tier sellers (not top 20%), so the spike reads as a rate anomaly,
# not a volume artifact.
sku_weights = np.ones(len(all_skus))
top20_n = int(len(all_skus) * 0.2)
sku_weights[:top20_n] = 8.0  # heavily-popular SKUs (NOT the affected ones)
np.random.shuffle(sku_weights[top20_n:])
# Affected SKUs explicitly mid-tier:
for sku in BAD_SKUS:
    sku_weights[all_skus.index(sku)] = 2.5
sku_weights /= sku_weights.sum()

# Pre-sample order day-offsets in one shot — much faster than calling
# np.random.choice per-row, and lets the seasonal humps shape the volume.
_order_days = np.random.choice(_day_offsets, size=N_ORDERS, p=_day_weights)

orders = []
for i in range(N_ORDERS):
    cid    = f"CUST-{np.random.randint(0, N_CUSTOMERS):06d}"
    sku    = np.random.choice(all_skus, p=sku_weights)
    passed_lots = [(l, f) for l, f in lots_by_sku[sku] if l != BAD_LOT_ID]
    lot_id, fac = passed_lots[np.random.randint(0, len(passed_lots))]
    qty    = int(np.random.choice([1, 1, 1, 1, 2], p=[0.55, 0.2, 0.1, 0.1, 0.05]))
    price  = sku_prices[sku] * qty * (0.95 + np.random.random() * 0.10)
    ord_dt = START_HIST + timedelta(days=int(_order_days[i]))
    c      = cust_lookup[cid]
    orders.append({
        "order_id":   f"ORD-{ord_dt.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}",
        "customer_id":cid,
        "product_id": sku,
        "lot_id":     lot_id,
        "order_date": ord_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "region":     c["region"],
        "quantity":   qty,
        "total_usd":  round(price, 2),
    })

# Bad-lot orders — ~5,000 orders distributed across 5 weeks following the
# lot's release. Customer cohort skews 60% EU / 25% US / 15% APAC so the
# affected-lot bubble map lights FR / IT / GB.
print("Adding bad-lot orders...")
eu_pool    = [c for c in custs if c["region"] == "EU"]
us_pool    = [c for c in custs if c["region"] == "US"]
apac_pool  = [c for c in custs if c["region"] == "APAC"]
N_BAD_ORDERS = 5000
bad_cohort = (
    [eu_pool[i % len(eu_pool)]     for i in range(int(N_BAD_ORDERS * 0.60))] +
    [us_pool[i % len(us_pool)]     for i in range(int(N_BAD_ORDERS * 0.25))] +
    [apac_pool[i % len(apac_pool)] for i in range(int(N_BAD_ORDERS * 0.15))]
)
np.random.shuffle(bad_cohort)

for i, c in enumerate(bad_cohort):
    sku    = BAD_SKUS[i % 3]
    qty    = int(np.random.choice([1, 1, 1, 2], p=[0.6, 0.2, 0.1, 0.1]))
    price  = sku_prices[sku] * qty * (0.95 + np.random.random() * 0.10)
    # Window: 7 weeks ago → 4 weeks ago (orders), so returns peak 3w ago.
    days_back = int(np.random.randint(28, 50))
    ord_dt = NOW - timedelta(days=days_back)
    orders.append({
        "order_id":   f"ORD-{ord_dt.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}",
        "customer_id":c["customer_id"],
        "product_id": sku,
        "lot_id":     BAD_LOT_ID,
        "order_date": ord_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "region":     c["region"],
        "quantity":   qty,
        "total_usd":  round(price, 2),
    })

orders_df = pd.DataFrame(orders)

# 1.e Returns (~25K). Two streams:
#   - Baseline: 8% of non-bad-lot orders return, 7-30 days after order.
#   - Bad-lot: 30% of bad-lot orders return, peak ~3w ago (triangular dist).
print("Generating returns...")
TEXTURE_COMMENTS = [
    "Texture is grainy and product seems to have separated.",
    "Product separated into two layers within a week, completely unusable.",
    "Consistency is watery and the formula looks curdled.",
    "Texture feels off — gritty and not what I expected.",
    "Serum looks cloudy and thick, definitely not normal.",
    "Feels gritty on the skin, this is clearly defective.",
    "Product arrived with a strange consistency, returning immediately.",
    "Worst LuxeBeauty product I've bought — the cream is grainy and useless.",
]
NORMAL_REASONS  = ["didnt_fit", "wrong_item", "changed_mind"]
NORMAL_COMMENTS = [
    "Product is fine but not what I needed.",
    "Found a better deal elsewhere.",
    "Ordered wrong size, my mistake.",
    "Didn't quite match the website photos.",
    "Received as a gift already.",
    "Changed my mind, will reorder later.",
]

# Baseline returns. The "December → January gift-return surge" is a real
# retail pattern: ~1.3× extra returns landing in the first 2 weeks of
# January as customers return holiday gifts. We achieve this by sampling
# slightly more than 8% baseline (capped at len) and weighting the
# sampling so December-ordered items are 1.3× more likely to be picked
# (their return date naturally lands in early Jan).
returns_rows = []
non_bad_orders = [o for o in orders if o["lot_id"] != BAD_LOT_ID]
n_baseline = int(len(non_bad_orders) * 0.08)
_return_weights = np.array([
    1.3 if datetime.strptime(o["order_date"], "%Y-%m-%d %H:%M:%S").month == 12 else 1.0
    for o in non_bad_orders
])
_return_weights /= _return_weights.sum()
baseline_idx = np.random.choice(
    len(non_bad_orders), size=n_baseline, replace=False, p=_return_weights,
)
for idx in baseline_idx:
    o = non_bad_orders[idx]
    ord_dt = datetime.strptime(o["order_date"], "%Y-%m-%d %H:%M:%S")
    ret_dt = ord_dt + timedelta(days=int(np.random.randint(7, 30)))
    if ret_dt > NOW:
        continue
    returns_rows.append({
        "return_id":         f"RET-{uuid.uuid4().hex[:8].upper()}",
        "order_id":          o["order_id"],
        "customer_id":       o["customer_id"],
        "product_id":        o["product_id"],
        "lot_id":            o["lot_id"],
        "return_date":       ret_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "refund_amount_usd": round(o["total_usd"], 2),
        "return_reason":     np.random.choice(NORMAL_REASONS),
        "return_reason_text":np.random.choice(NORMAL_COMMENTS),
    })

# Bad-lot returns: 30% of bad orders. Triangular peak at SPIKE_PEAK (~21d
# back), tail decaying for 2-3 more weeks. Peak in the past, never at the
# current week's right edge.
bad_orders = [o for o in orders if o["lot_id"] == BAD_LOT_ID]
n_bad_returns = int(len(bad_orders) * 0.30)
bad_idx = np.random.choice(len(bad_orders), size=n_bad_returns, replace=False)
for idx in bad_idx:
    o = bad_orders[idx]
    days_back = float(np.random.triangular(left=1, mode=21, right=42))
    ret_dt = NOW - timedelta(days=days_back)
    returns_rows.append({
        "return_id":         f"RET-{uuid.uuid4().hex[:8].upper()}",
        "order_id":          o["order_id"],
        "customer_id":       o["customer_id"],
        "product_id":        o["product_id"],
        "lot_id":            o["lot_id"],
        "return_date":       ret_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "refund_amount_usd": round(o["total_usd"], 2),
        "return_reason":     "quality",
        "return_reason_text":np.random.choice(TEXTURE_COMMENTS),
    })

returns_df = pd.DataFrame(returns_rows)

# Pre-compute anger_score on each return. In the FULL demo this column
# comes from `ai_classify` over the comment text; the simple demo skips
# that and assigns the score heuristically so the dashboard's sentiment
# widgets still light up. Quality + texture-pool comment → 0.9 / 0.7;
# other reasons → 0.3 / 0.1.
TEXTURE_KEYWORDS = ("grainy", "separated", "watery", "gritty", "curdled", "consistency", "texture", "off")

def _anger(row: dict) -> float:
    text = (row["return_reason_text"] or "").lower()
    if row["return_reason"] == "quality":
        return 0.9 if any(k in text for k in TEXTURE_KEYWORDS) else 0.7
    return 0.3 if "fine" in text or "wrong" in text else 0.1

returns_df["anger_score"] = returns_df.apply(_anger, axis=1)
# Backward-compat alias the dashboard reads as `customer_comment`. The spec
# names the source column `return_reason_text`; the dashboard expects
# `customer_comment`. Carry both so renaming either side is a one-line
# change.
returns_df["customer_comment"] = returns_df["return_reason_text"]
print(f"  Baseline: {n_baseline:,} · Bad-lot: {len(returns_df) - n_baseline:,} · Total: {len(returns_df):,}")

# ── Phase 2 — Write each DataFrame as Parquet to the UC Volume ────────────
# This is the "raw drop" surface. A real pipeline would land files here via
# Lakeflow Connect (S3/SFTP/API ingestion); the simple demo just writes
# them directly. spark.sql in Phase 3 reads them back into Delta tables.
print(f"\nWriting raw parquet files to {VOLUME_ROOT}/ ...")
RAW_DATASETS: dict[str, pd.DataFrame] = {
    "customers":        cust_df,
    "products":         prod_df,
    "production_lots":  lots_df,
    "orders":           orders_df,
    "returns":          returns_df,
}

# Pandas can write straight to /Volumes paths via the DBFS fuse mount that
# databricks-connect exposes. Falls back to a spark.write if the fuse path
# isn't available — Parquet files end up identical either way.
for name, df in RAW_DATASETS.items():
    target = f"{VOLUME_ROOT}/{name}.parquet"
    fuse_path = Path(target)
    try:
        fuse_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(target, index=False)
        print(f"  wrote {name}: {len(df):>7,} rows → {target}")
    except (OSError, PermissionError):
        # Volume not fuse-mounted in this runtime — fall back to spark write.
        sdf = spark.createDataFrame(df)
        sdf.coalesce(1).write.mode("overwrite").parquet(target)
        print(f"  wrote {name}: {len(df):>7,} rows → {target} (via spark)")

# ── Phase 3 — RAW: CTAS over each parquet file ────────────────────────────
# Each raw_* Delta table is a 1:1 ingest of one parquet file. COMMENTs ride
# along so Catalog Explorer + Genie pick them up as semantics.
print("\nLoading raw_* Delta tables from parquet...")

for name, comment in {
    "customers":       "Customer master — one row per registered customer. In production this comes from the e-commerce CDC stream; here from a parquet drop on a UC Volume.",
    "products":        "Product catalog — one row per SKU. Carries category / subcategory / price for downstream rollups.",
    "production_lots": "Production lots — one row per (lot, sku). The affected lot rows carry an incident_summary text the Genie investigation surfaces verbatim.",
    "orders":          "Order lines — one row per order/SKU line. The region column is the order destination.",
    "returns":         "Returns — one row per return event. customer_comment is the free-text reason; anger_score is pre-computed (full demo runs ai_classify on the comment).",
}.items():
    spark.sql(f"""
        CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.raw_{name}
        COMMENT '{comment}'
        AS SELECT * FROM parquet.`{VOLUME_ROOT}/{name}.parquet`
    """)

# ── Phase 4 — GOLD: the two tables the dashboard + Genie read ─────────────
# gold_returns is the denormalized per-return fact (one row per return,
# every dimension the dashboard filters or pivots on is in-row). incident
# text deliberately stays on raw_production_lots so the Genie drill-down
# has a destination.
print("Building gold_returns ...")
spark.sql(f"""
    CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_returns
    COMMENT 'Denormalized per-return fact. The dashboard + Genie both read this table — every column needed for filtering, mapping, sentiment, and the bad-lot vs everyday split lives here in-row. The incident text stays on raw_production_lots so Genie surfaces it on a one-hop drill-down (symptom here, explanation there).'
    AS SELECT
      r.return_id                                                          AS return_id,
      r.order_id                                                           AS order_id,
      r.customer_id                                                        AS customer_id,
      r.product_id                                                         AS product_id,
      r.lot_id                                                             AS lot_id,
      CAST(r.return_date AS TIMESTAMP)                                     AS return_date,
      CAST(o.order_date  AS TIMESTAMP)                                     AS order_date,
      o.region                                                             AS region,
      c.country                                                            AS country,
      c.city                                                               AS city,
      c.customer_lat                                                       AS customer_lat,
      c.customer_lng                                                       AS customer_lng,
      c.loyalty_tier                                                       AS loyalty_tier,
      p.product_name                                                       AS product_name,
      p.category                                                           AS category,
      l.facility                                                           AS facility,
      CAST(r.refund_amount_usd AS DOUBLE)                                  AS refund_amount_usd,
      r.return_reason                                                      AS return_reason,
      r.return_reason_text                                                 AS return_reason_text,
      r.customer_comment                                                   AS customer_comment,
      CAST(r.anger_score AS DOUBLE)                                        AS anger_score,
      CASE WHEN r.lot_id = '{BAD_LOT_ID}' THEN TRUE ELSE FALSE END         AS is_bad_lot
    FROM {CATALOG}.{SCHEMA}.raw_returns      r
    JOIN {CATALOG}.{SCHEMA}.raw_orders       o ON r.order_id    = o.order_id
    JOIN {CATALOG}.{SCHEMA}.raw_customers    c ON r.customer_id = c.customer_id
    JOIN {CATALOG}.{SCHEMA}.raw_products     p ON r.product_id  = p.product_id
    LEFT JOIN {CATALOG}.{SCHEMA}.raw_production_lots l
           ON r.lot_id = l.lot_id AND r.product_id = l.product_id
""")

# Column-level docs. Spark SQL's CTAS doesn't allow inline COMMENTs on
# SELECT expressions (parser rejects them); the standards-portable path
# is to write them as separate ALTER COMMENT ON COLUMN statements after
# the CTAS. Genie / Catalog Explorer pick these up identically.
_GOLD_RETURNS_COMMENTS = {
    "return_id":         "Return PK — RET-XXXXXXXX (synthetic).",
    "order_id":          "FK to raw_orders.order_id.",
    "customer_id":       "FK to raw_customers.customer_id.",
    "product_id":        "FK to raw_products.product_id.",
    "lot_id":            "FK to raw_production_lots.lot_id.",
    "return_date":       "When the customer initiated the return (ISO timestamp).",
    "order_date":        "When the original order was placed.",
    "region":            "Order destination region (US / EU / APAC) — matches gold_daily_summary.region by contract.",
    "country":           "Customer ISO-2 country (FR / US / GB / …).",
    "city":              "Customer city (anchor for the bubble map).",
    "customer_lat":      "Customer latitude (city anchor + jitter, ~5km).",
    "customer_lng":      "Customer longitude (city anchor + jitter, ~5km).",
    "loyalty_tier":      "Customer tier: gold / silver / standard.",
    "product_name":      "SKU display name.",
    "category":          "Product category (Skincare / Makeup / Haircare / Bodycare / Fragrance).",
    "facility":          "Manufacturing facility (Lyon-France / Milan-Italy / London-UK / NJ-USA).",
    "refund_amount_usd": "Refund amount in USD.",
    "return_reason":     "Reason taxonomy: quality / didnt_fit / wrong_item / changed_mind.",
    "return_reason_text":"Free-text reason given by the customer.",
    "customer_comment":  "Alias for return_reason_text — kept for dashboards that read this column name.",
    "anger_score":       "Pre-computed sentiment (0..1). Full demo runs ai_classify on the comment.",
    "is_bad_lot":        "TRUE for the one affected lot — drives the affected-vs-everyday split across every chart.",
}
for col, txt in _GOLD_RETURNS_COMMENTS.items():
    spark.sql(f"COMMENT ON COLUMN {CATALOG}.{SCHEMA}.gold_returns.{col} IS '{txt}'")

print("Building gold_daily_summary ...")
spark.sql(f"""
    CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_daily_summary
    COMMENT 'Daily rollup per (date, region, category). Drives the dashboard trend line + KPI cards. Orders and returns are joined on the same (date, region, category) triple, both pulling region from raw_orders so the two legs agree.'
    AS WITH orders_agg AS (
      SELECT
        DATE(o.order_date) AS d,
        o.region,
        p.category,
        COUNT(*)           AS order_count,
        SUM(o.total_usd)   AS revenue_usd
      FROM {CATALOG}.{SCHEMA}.raw_orders   o
      JOIN {CATALOG}.{SCHEMA}.raw_products p ON o.product_id = p.product_id
      GROUP BY 1, 2, 3
    ),
    returns_agg AS (
      SELECT
        DATE(r.return_date)        AS d,
        o.region                   AS region,
        p.category                 AS category,
        COUNT(*)                   AS return_count,
        SUM(r.refund_amount_usd)   AS returns_usd
      FROM {CATALOG}.{SCHEMA}.raw_returns  r
      JOIN {CATALOG}.{SCHEMA}.raw_orders   o ON r.order_id  = o.order_id
      JOIN {CATALOG}.{SCHEMA}.raw_products p ON r.product_id = p.product_id
      GROUP BY 1, 2, 3
    )
    SELECT
      oa.d                          AS date,
      oa.region                     AS region,
      oa.category                   AS category,
      oa.order_count                AS order_count,
      COALESCE(ra.return_count, 0)  AS return_count,
      oa.revenue_usd                AS revenue_usd,
      COALESCE(ra.returns_usd, 0.0) AS returns_usd
    FROM orders_agg oa
    LEFT JOIN returns_agg ra
      ON oa.d = ra.d AND oa.region = ra.region AND oa.category = ra.category
""")

_GOLD_DAILY_COMMENTS = {
    "date":         "Calendar date.",
    "region":       "Region (US / EU / APAC).",
    "category":     "Product category.",
    "order_count":  "Number of orders that day.",
    "return_count": "Number of returns that day.",
    "revenue_usd":  "Order revenue in USD.",
    "returns_usd":  "Refund amount in USD.",
}
for col, txt in _GOLD_DAILY_COMMENTS.items():
    spark.sql(f"COMMENT ON COLUMN {CATALOG}.{SCHEMA}.gold_daily_summary.{col} IS '{txt}'")

# ── Phase 5 — Constraints (render as lineage arrows in Catalog Explorer) ──
print("Applying PK / FK constraints ...")
for table, pk in [
    ("raw_customers",       "customer_id"),
    ("raw_products",        "product_id"),
    ("raw_orders",          "order_id"),
    ("raw_returns",         "return_id"),
    ("gold_returns",        "return_id"),
]:
    spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA}.{table} ALTER COLUMN {pk} SET NOT NULL")
    spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA}.{table} ADD CONSTRAINT {table}_pk PRIMARY KEY ({pk})")

for table, col, ref in [
    ("raw_orders",   "customer_id", "raw_customers"),
    ("raw_orders",   "product_id",  "raw_products"),
    ("raw_returns",  "order_id",    "raw_orders"),
    ("gold_returns", "order_id",    "raw_orders"),
]:
    spark.sql(
        f"ALTER TABLE {CATALOG}.{SCHEMA}.{table} "
        f"ADD CONSTRAINT {table}_{col}_fk FOREIGN KEY ({col}) "
        f"REFERENCES {CATALOG}.{SCHEMA}.{ref} NOT ENFORCED RELY"
    )

print(f"\nDone. Tables in {CATALOG}.{SCHEMA}:")
for row in spark.sql(f"SHOW TABLES IN {CATALOG}.{SCHEMA}").collect():
    print(f"  - {row['tableName']}")
print(f"\nBAD_LOT_ID = {BAD_LOT_ID}")
