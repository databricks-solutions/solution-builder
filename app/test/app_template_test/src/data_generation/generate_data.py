"""
LuxeBeauty Returns Intelligence (test) — Synthetic Data Generator

Adapted from `app/projects/7d2d2ea4-…/src/data_generation/generate_data.py`
with three additions required by the updated specs:

  1. `city` + `customer_lat` + `customer_lng` on customers — city-anchored
     coords + ±0.05° jitter (~5km). Drives the Operations bubble map.
  2. `premium_status` tagging on customers — labeled subset (~3K premium,
     ~1K not_premium, rest NULL) per spec `01-lakeflow.md` § Premium
     tagging rules. The ML notebook trains on the labeled rows.
  3. `customer_comment` retained — silver reads it through `ai_classify`
     to produce `anger_score`.

Writes Delta tables directly under `ai_demo_gen.demo_luxebeauty_test.raw_*`.
"""

from databricks.connect import DatabricksSession
from pyspark.sql import functions as F
from faker import Faker
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import uuid

# ── Config ─────────────────────────────────────────────────────────────────
CATALOG = "ai_demo_gen"
SCHEMA  = "demo_luxebeauty_test"

NOW             = datetime.now()
SPIKE_PEAK      = NOW - timedelta(days=21)
DECAY_START     = NOW - timedelta(days=14)
# Lot ships ~6 weeks back, well before the returns surge (peak ~21d ago).
# Causality: bad batch leaves the factory → distributed and sold over the
# next ~2 weeks → returns peak 3-4 weeks after ship. The chart's vertical
# marker for the production incident must land LEFT of the peak.
BAD_LOT_PROD_DT = NOW - timedelta(days=42)
BAD_LOT_ID      = f"LOT-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}"
BAD_SKUS        = ["SKU-1001", "SKU-1002", "SKU-1003"]
BAD_FACILITY    = "Lyon-France"

N_CUSTOMERS = 5000
# Bumped 12K → 120K so the baseline weekly revenue + refund numbers
# match the spec ($380K/month revenue, $60K/week baseline returns).
# At 12K orders across 23 months we had ~125 orders/week → return
# baseline was tiny and the spike vanished into noise.
N_ORDERS    = 120000

print(f"BAD_LOT_ID: {BAD_LOT_ID}")
print(f"SPIKE_PEAK: {SPIKE_PEAK.date()}")

spark = DatabricksSession.builder.serverless(True).getOrCreate()
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")

np.random.seed(42)
fake = Faker(['fr_FR', 'it_IT', 'en_US'])
Faker.seed(42)

# ── City anchors (per spec 01 § City anchors + GPS) ─────────────────────────
# (lat, lng, weight) for each city per country. Used to assign each customer
# a city + lat/lng = anchor + ±0.05° jitter (~5km). The bubble map in the
# dashboard reads these directly.
CITY_ANCHORS = {
    "US":      [("NewYork", 40.71, -74.01, 0.30), ("LosAngeles", 34.05, -118.25, 0.20),
                ("Chicago", 41.88, -87.63, 0.15), ("Houston", 29.76, -95.37, 0.10),
                ("Miami", 25.76, -80.19, 0.10),   ("SanFrancisco", 37.77, -122.42, 0.15)],
    "Canada":  [("Toronto", 43.65, -79.38, 0.45), ("Montreal", 45.50, -73.57, 0.30),
                ("Vancouver", 49.28, -123.12, 0.25)],
    "France":  [("Paris", 48.86, 2.35, 0.45), ("Lyon", 45.76, 4.83, 0.18),
                ("Marseille", 43.30, 5.37, 0.15), ("Toulouse", 43.60, 1.44, 0.12),
                ("Lille", 50.63, 3.06, 0.10)],
    "UK":      [("London", 51.51, -0.13, 0.55), ("Manchester", 53.48, -2.24, 0.18),
                ("Birmingham", 52.49, -1.89, 0.15), ("Edinburgh", 55.95, -3.19, 0.12)],
    "Germany": [("Berlin", 52.52, 13.40, 0.30), ("Munich", 48.14, 11.58, 0.25),
                ("Hamburg", 53.55, 9.99, 0.20), ("Frankfurt", 50.11, 8.68, 0.15),
                ("Cologne", 50.94, 6.96, 0.10)],
    "Italy":   [("Milan", 45.46, 9.19, 0.40), ("Rome", 41.90, 12.50, 0.30),
                ("Naples", 40.85, 14.27, 0.15), ("Turin", 45.07, 7.69, 0.15)],
    "Spain":   [("Madrid", 40.42, -3.70, 0.45), ("Barcelona", 41.39, 2.17, 0.35),
                ("Valencia", 39.47, -0.38, 0.20)],
    "Netherlands": [("Amsterdam", 52.37, 4.90, 0.55), ("Rotterdam", 51.92, 4.48, 0.25),
                    ("TheHague", 52.07, 4.30, 0.20)],
}

def pick_city(country: str) -> tuple:
    """Pick (city, lat, lng) for a customer. Anchor + ±0.05° jitter."""
    pool = CITY_ANCHORS.get(country, [("Unknown", 0.0, 0.0, 1.0)])
    weights = np.array([w for _, _, _, w in pool])
    weights = weights / weights.sum()
    idx = np.random.choice(len(pool), p=weights)
    name, lat, lng, _ = pool[idx]
    return name, round(lat + np.random.uniform(-0.05, 0.05), 5), round(lng + np.random.uniform(-0.05, 0.05), 5)

# ── 1. Products ─────────────────────────────────────────────────────────────
print("Generating products...")
products_data = [
    ("SKU-1001", "Luminance Hydration Serum",        "Skincare", "Serum",     310.0),
    ("SKU-1002", "Golden Radiance Face Cream",        "Skincare", "Cream",     350.0),
    ("SKU-1003", "Velvet Renewal Night Treatment",    "Skincare", "Treatment", 280.0),
    ("SKU-1004", "Pure Clarity Cleanser",             "Skincare", "Cleanser",   45.0),
    ("SKU-1005", "Dewy Glow Moisturizer",             "Skincare", "Moisturizer",60.0),
    ("SKU-1006", "Youth Essence Eye Cream",           "Skincare", "Eye Cream",  75.0),
    ("SKU-1007", "Calm & Renew Toner",                "Skincare", "Toner",      40.0),
    ("SKU-2001", "Velvet Matte Lipstick",             "Makeup",   "Lipstick",   32.0),
    ("SKU-2002", "Luminous Foundation SPF 30",        "Makeup",   "Foundation", 55.0),
    ("SKU-2003", "Rose Gold Blush Palette",           "Makeup",   "Blush",      48.0),
    ("SKU-2004", "Precision Liner Pen",               "Makeup",   "Eyeliner",   28.0),
    ("SKU-2005", "Glossy Plump Gloss",                "Makeup",   "Lip Gloss",  25.0),
    ("SKU-2006", "Smoky Eye Shadow Quad",             "Makeup",   "Eyeshadow",  42.0),
    ("SKU-2007", "Brow Define Pencil",                "Makeup",   "Brow",       22.0),
    ("SKU-2008", "Setting Powder Translucent",        "Makeup",   "Powder",     38.0),
    ("SKU-3001", "Silk Repair Shampoo",               "Haircare", "Shampoo",    35.0),
    ("SKU-3002", "Silk Repair Conditioner",           "Haircare", "Conditioner",35.0),
    ("SKU-3003", "Argan Miracle Hair Mask",           "Haircare", "Mask",       50.0),
    ("SKU-3004", "Scalp Balance Serum",               "Haircare", "Serum",      65.0),
    ("SKU-3005", "Glossy Finish Hair Oil",            "Haircare", "Hair Oil",   45.0),
    ("SKU-4001", "Rose Petal Body Lotion",            "Bodycare", "Lotion",     38.0),
    ("SKU-4002", "Sugar Glow Exfoliating Scrub",      "Bodycare", "Scrub",      32.0),
    ("SKU-4003", "Velvet Body Butter",                "Bodycare", "Butter",     42.0),
    ("SKU-4004", "Calming Lavender Bath Soak",        "Bodycare", "Bath",       28.0),
    ("SKU-4005", "Firming Contour Body Cream",        "Bodycare", "Cream",      55.0),
    ("SKU-5001", "Luxe Floral Eau de Parfum 50ml",   "Fragrance","EDP",        120.0),
    ("SKU-5002", "Rose & Oud Collection 30ml",       "Fragrance","EDP",         95.0),
    ("SKU-5003", "Cedar & Amber Body Mist",          "Fragrance","Mist",        45.0),
    ("SKU-5004", "Fresh Citrus Eau de Toilette",     "Fragrance","EDT",         80.0),
    ("SKU-5005", "Noir Intense Eau de Parfum 50ml",  "Fragrance","EDP",        130.0),
]
prod_df = pd.DataFrame(products_data, columns=["product_id","product_name","category","subcategory","unit_price_usd"])
sku_prices = {r["product_id"]: r["unit_price_usd"] for _, r in prod_df.iterrows()}

spark.createDataFrame(prod_df).write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}.raw_products")
print(f"  Products: {len(prod_df)}")

# ── 2. Customers ────────────────────────────────────────────────────────────
print("Generating customers...")
# Weights, not absolute counts — so the country mix stays correct
# regardless of N_CUSTOMERS. The earlier hardcoded counts only summed
# to 2000 and broke when N_CUSTOMERS was bumped past that.
country_weights = {
    "France": 500, "Italy": 300, "UK": 200, "Germany": 200,
    "US": 600, "Spain": 80, "Netherlands": 60, "Canada": 60,
}
countries_pool = np.random.choice(
    list(country_weights.keys()),
    size=N_CUSTOMERS,
    p=np.array(list(country_weights.values())) / sum(country_weights.values()),
).tolist()

custs = []
for i in range(N_CUSTOMERS):
    cid     = str(uuid.uuid4())
    country = countries_pool[i]
    if country in ("France", "Italy"):
        tier = np.random.choice(["gold","silver","bronze"], p=[0.25,0.45,0.30])
    else:
        tier = np.random.choice(["gold","silver","bronze"], p=[0.08,0.27,0.65])
    reg_date = NOW - timedelta(days=int(np.random.randint(180, 4*365)))
    region   = "EU" if country in ("France","Italy","UK","Germany","Spain","Netherlands") else "US"
    city, lat, lng = pick_city(country)
    custs.append({
        "customer_id":       cid,
        "first_name":        fake.first_name(),
        "last_name":         fake.last_name(),
        "email":             fake.email(),
        "country":           country,
        "city":              city,
        "customer_lat":      lat,
        "customer_lng":      lng,
        "region":            region,
        "loyalty_tier":      tier,
        "registration_date": reg_date.strftime("%Y-%m-%d"),
        "premium_status":    None,  # filled below after we know spend behavior
    })

cust_df = pd.DataFrame(custs)
cust_ids = cust_df["customer_id"].tolist()
cust_lookup = {row["customer_id"]: row for _, row in cust_df.iterrows()}
print(f"  Customers prepared: {len(cust_df)}")

# ── 3. Production Lots ──────────────────────────────────────────────────────
print("Generating production lots...")
facilities = ["Lyon-France","Milan-Italy","London-UK","NJ-USA"]

lots = []
lot_by_sku = {}

for sku in [p[0] for p in products_data]:
    lot_by_sku[sku] = []
    for month_back in range(6, 0, -1):
        for lot_num in range(1, 4):
            prod_dt = NOW - timedelta(days=month_back*30 + lot_num*3)
            facility = np.random.choice(facilities)
            lot_id   = f"LOT-{prod_dt.year}-{prod_dt.strftime('%m%d')}-{sku[-4:]}"
            lots.append({
                "lot_id":           lot_id,
                "product_id":       sku,
                "facility":         facility,
                "production_date":  prod_dt.strftime("%Y-%m-%d"),
                "units_produced":   int(np.random.randint(500, 2000)),
                "quality_status":   "PASSED",
            })
            lot_by_sku[sku].append((lot_id, facility))

for bad_sku in BAD_SKUS:
    lots.append({
        "lot_id":          BAD_LOT_ID,
        "product_id":      bad_sku,
        "facility":        BAD_FACILITY,
        "production_date": BAD_LOT_PROD_DT.strftime("%Y-%m-%d"),
        "units_produced":  5000,
        "quality_status":  "FAILED",
    })
    lot_by_sku[bad_sku].append((BAD_LOT_ID, BAD_FACILITY))

lots_df = pd.DataFrame(lots)
spark.createDataFrame(lots_df).write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}.raw_production_lots")
print(f"  Lots: {len(lots_df)}, BAD_LOT={BAD_LOT_ID}")

# ── 4. Orders ───────────────────────────────────────────────────────────────
print("Generating orders...")
START_HIST = NOW - timedelta(days=24*30)
# Run history through yesterday so the chart's rightmost weeks aren't
# dead. The bad-lot orders below sit in the 25-33 day window which is
# already inside this range — they're additive, not a separate epoch.
END_HIST   = NOW - timedelta(days=1)
span_days  = (END_HIST - START_HIST).days
all_skus_list = [p[0] for p in products_data]

orders = []
for i in range(N_ORDERS):
    cid    = cust_ids[np.random.randint(0, N_CUSTOMERS)]
    sku    = np.random.choice(all_skus_list)
    passed_lots = [(l, f) for l, f in lot_by_sku.get(sku, []) if l != BAD_LOT_ID]
    lot_id, fac = passed_lots[np.random.randint(0, len(passed_lots))] if passed_lots else (f"LOT-DEFAULT-{sku[-4:]}", "Lyon-France")
    qty    = np.random.randint(1, 3)
    price  = sku_prices[sku] * qty * (0.9 + np.random.random() * 0.2)
    ord_dt = START_HIST + timedelta(days=np.random.randint(0, span_days))
    c      = cust_lookup[cid]
    orders.append({
        "order_id":       str(uuid.uuid4()),
        "customer_id":    cid,
        "product_id":     sku,
        "lot_id":         lot_id,
        "facility":       fac,
        "order_date":     ord_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "quantity":       qty,
        "unit_price_usd": round(price, 2),
        "country":        c["country"],
        "region":         c["region"],
    })

# Bad-lot orders — sized so the weekly refund peak lands ~3× the baseline
# (per spec). Earlier 5000-order pool produced a 50× spike that flattened
# the rest of the chart. EU skew 60/40 stays.
eu_custs    = [r for r in custs if r["country"] in ("France","Italy","UK","Germany")]
other_custs = [r for r in custs if r["country"] not in ("France","Italy","UK","Germany")]
bad_cust_pool = (
    [eu_custs[i % len(eu_custs)]   for i in range(480)] +
    [other_custs[i % len(other_custs)] for i in range(320)]
)
np.random.shuffle(bad_cust_pool)

for i, c in enumerate(bad_cust_pool):
    sku    = BAD_SKUS[i % 3]
    qty    = np.random.randint(1, 3)
    price  = sku_prices[sku] * qty * (0.9 + np.random.random() * 0.2)
    # Orders for the bad lot fall in a 2-week window after the lot ships
    # (BAD_LOT_PROD_DT = NOW-42d → orders 28-40d ago → returns 1-30d after
    # → return-curve peak ~3 weeks ago, lining up with SPIKE_PEAK).
    ord_dt = NOW - timedelta(days=np.random.randint(28, 41))
    orders.append({
        "order_id":       str(uuid.uuid4()),
        "customer_id":    c["customer_id"],
        "product_id":     sku,
        "lot_id":         BAD_LOT_ID,
        "facility":       BAD_FACILITY,
        "order_date":     ord_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "quantity":       qty,
        "unit_price_usd": round(price, 2),
        "country":        c["country"],
        "region":         c["region"],
    })

orders_df = pd.DataFrame(orders)
spark.createDataFrame(orders_df).write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}.raw_orders")
print(f"  Orders: {len(orders_df)} (incl. {len(bad_cust_pool)} bad-lot orders)")

# ── 5. Returns ──────────────────────────────────────────────────────────────
print("Generating returns...")
normal_reasons  = ["Changed mind","Wrong size","Better price elsewhere","Not as described","Gift duplicate"]
normal_comments = [
    "Product is fine but not what I needed.",
    "Found a better deal elsewhere.",
    "Ordered wrong size, my mistake.",
    "Didn't quite match the website photos.",
    "Received as a gift already.",
    "Color wasn't quite right for my skin tone.",
    "Changed my mind, will reorder later.",
]
bad_reasons  = ["Product quality issue","Defective product","Texture issue","Not as described"]
bad_comments = [
    "This serum separated into two layers after two days of use, completely unusable.",
    "The cream texture is grainy and my skin feels worse after applying it. Very disappointed.",
    "I'm furious — this $100 night treatment smells off and has a weird gritty texture.",
    "Product arrived with a strange consistency, definitely not normal. Returning immediately.",
    "Worst LuxeBeauty product I've ever bought. The formula looks curdled.",
    "Not what I expected — the serum has a strange separation issue. Complete waste of money.",
    "Terrible quality — the cream separated and turned grainy within days of opening.",
    "Very angry customer here — product is defective, clearly a manufacturing issue.",
    "The texture is completely off — feels like the formula was messed up in production.",
    "First time a LuxeBeauty product has failed me. This cream is unusable and grainy.",
    "Disappointing. The serum looks like oil and water separated. Returning for full refund.",
    "Product quality is unacceptable. Texture is grainy and product seems to have separated.",
    "I demanded a refund immediately. This is not the quality I expect from LuxeBeauty.",
    "Outrageous — I paid $110 for face cream that separated in the bottle.",
]

returns = []
hist_orders = [o for o in orders if o["lot_id"] != BAD_LOT_ID]
n_normal = int(len(hist_orders) * 0.08)
normal_sample = np.random.choice(len(hist_orders), size=n_normal, replace=False)
for idx in normal_sample:
    o = hist_orders[idx]
    ord_dt  = datetime.strptime(o["order_date"], "%Y-%m-%d %H:%M:%S")
    ret_dt  = ord_dt + timedelta(days=np.random.randint(7, 30))
    if ret_dt > NOW:
        ret_dt = NOW - timedelta(days=2)
    returns.append({
        "return_id":        str(uuid.uuid4()),
        "order_id":         o["order_id"],
        "customer_id":      o["customer_id"],
        "product_id":       o["product_id"],
        "lot_id":           o["lot_id"],
        "facility":         o["facility"],
        "country":          o["country"],
        "region":           o["region"],
        "refund_amount_usd":round(o["unit_price_usd"], 2),
        "return_reason":    np.random.choice(normal_reasons),
        "customer_comment": np.random.choice(normal_comments),
        "return_date":      ret_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "status":           "completed",
        "is_bad_lot":       False,
    })

bad_orders = [o for o in orders if o["lot_id"] == BAD_LOT_ID]
# 80% of bad orders come back as returns. The 20% who don't keep the
# product = realistic noise.
n_bad_ret  = int(len(bad_orders) * 0.8)
bad_sample = np.random.choice(len(bad_orders), size=n_bad_ret, replace=False)

def bad_return_date(i, total):
    """Triangular distribution peaking at SPIKE_PEAK (21d ago) with a
    quick build-up (5 weeks) and a decay tail (~3 weeks back to baseline).
    Numpy triangular(left, mode, right) returns float days-back from NOW.
    Earlier 4-bucket uniform pattern produced a flat plateau, not a peak."""
    day_back = np.random.triangular(left=1, mode=21, right=42)
    return (NOW - timedelta(days=float(day_back))).strftime("%Y-%m-%d %H:%M:%S")

for i, idx in enumerate(bad_sample):
    o = bad_orders[idx]
    status = "pending" if i >= (n_bad_ret - 250) else "approved"
    returns.append({
        "return_id":        str(uuid.uuid4()),
        "order_id":         o["order_id"],
        "customer_id":      o["customer_id"],
        "product_id":       o["product_id"],
        "lot_id":           o["lot_id"],
        "facility":         o["facility"],
        "country":          o["country"],
        "region":           o["region"],
        "refund_amount_usd":round(o["unit_price_usd"], 2),
        "return_reason":    np.random.choice(bad_reasons),
        "customer_comment": np.random.choice(bad_comments),
        "return_date":      bad_return_date(i, n_bad_ret),
        "status":           status,
        "is_bad_lot":       True,
    })

ret_df = pd.DataFrame(returns)
spark.createDataFrame(ret_df).write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}.raw_returns")
print(f"  Returns: {len(ret_df)} total, {ret_df['is_bad_lot'].sum()} bad-lot")

# ── 6. Premium tagging (per spec 01 § Premium tagging rules) ────────────────
# We compute per-customer total_orders + total_spend + lifetime_return_rate
# from the orders + returns dataframes so the tag reflects actual behavior.
print("Tagging premium customers...")

ord_pdf = pd.DataFrame(orders)
ret_pdf = ret_df

# Per-customer aggregates
spend_per_cust = ord_pdf.groupby("customer_id").agg(
    total_spend=("unit_price_usd", "sum"),
    total_orders=("order_id", "count"),
).reset_index()
returns_per_cust = ret_pdf.groupby("customer_id").size().rename("returns_lifetime").reset_index()
cust_features = cust_df.merge(spend_per_cust, on="customer_id", how="left") \
                       .merge(returns_per_cust, on="customer_id", how="left") \
                       .fillna({"total_spend": 0, "total_orders": 0, "returns_lifetime": 0})
cust_features["lifetime_return_rate"] = (
    cust_features["returns_lifetime"] / cust_features["total_orders"].replace(0, np.nan)
).fillna(0)

premium_tags = {}  # customer_id -> 'premium' | 'not_premium' | None

# Rule 1: ~50% of Gold-tier customers → 'premium'
gold_cust = cust_features[cust_features["loyalty_tier"] == "gold"]
gold_premium_n = int(0.50 * len(gold_cust))
gold_premium_ids = np.random.choice(gold_cust["customer_id"].values, size=gold_premium_n, replace=False)
for cid in gold_premium_ids: premium_tags[cid] = "premium"

# Rule 2: ~10% of Silver-tier, restricted to top-40% spenders
silver_cust = cust_features[cust_features["loyalty_tier"] == "silver"]
spend_p60   = silver_cust["total_spend"].quantile(0.60)
silver_top  = silver_cust[silver_cust["total_spend"] >= spend_p60]
silver_premium_n = int(0.10 * len(silver_cust))
silver_premium_ids = np.random.choice(silver_top["customer_id"].values, size=min(silver_premium_n, len(silver_top)), replace=False)
for cid in silver_premium_ids: premium_tags[cid] = "premium"

# Rule 3: ~1% of Bronze → 'premium' (the "surprise tags")
bronze_cust = cust_features[cust_features["loyalty_tier"] == "bronze"]
bronze_premium_n = int(0.01 * len(bronze_cust))
bronze_premium_ids = np.random.choice(bronze_cust["customer_id"].values, size=bronze_premium_n, replace=False)
for cid in bronze_premium_ids: premium_tags[cid] = "premium"

# Rule 5: ~1000 'not_premium' from silver/gold with high return rate
neg_pool = cust_features[
    (cust_features["loyalty_tier"].isin(["silver","gold"])) &
    (cust_features["lifetime_return_rate"] > 0.15) &
    (~cust_features["customer_id"].isin(premium_tags.keys()))
]
not_premium_n = min(int(0.50 * len(cust_features) * 0.02), len(neg_pool), 200)  # ~scaled to N_CUSTOMERS
if not_premium_n > 0:
    not_premium_ids = np.random.choice(neg_pool["customer_id"].values, size=not_premium_n, replace=False)
    for cid in not_premium_ids: premium_tags[cid] = "not_premium"

# Update customers table with premium_status
cust_df["premium_status"] = cust_df["customer_id"].map(premium_tags)
spark.createDataFrame(cust_df).write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}.raw_customers")
n_prem = sum(1 for v in premium_tags.values() if v == "premium")
n_not  = sum(1 for v in premium_tags.values() if v == "not_premium")
print(f"  Customers written: {len(cust_df)} (premium={n_prem}, not_premium={n_not}, NULL={len(cust_df)-n_prem-n_not})")

print(f"\nBAD_LOT_ID = {BAD_LOT_ID}")
print("Data generation complete!")
