# Databricks notebook source
"""
LuxeBeauty Returns Intelligence — Synthetic Data Generator (Spark + UDFs)

Produces a coherent demo dataset under `retail_consumer_goods.luxebeauty_demo`
using Databricks Connect Serverless. Follows the databricks-synthetic-data-gen
skill: spark.range + F.when + DataFrame joins only; no driver loops, no
.collect(), no .cache().

Story (single load-bearing thread that every table reinforces):
  - LuxeBeauty's VP Ops sees weekly refunds spike 3x to ~$180K.
  - Three Skincare SKUs (SKU-1001/1002/1003) all on one production lot —
    LOT-2026-0430, Lyon facility — released despite a QC note flagging
    pressure issues during emulsification (homogenizer HMG-03).
  - ~5000 units sold over ~2 weeks; ~80% return rate; EU-skewed cohort.

Tables produced (all written to {CATALOG}.{SCHEMA}):
  raw_products            ~90 rows   — SKU master, prices + cost.
  raw_customers           5K  rows   — region + tier + premium_status label.
  raw_production_lots     ~2K rows   — lot master, status + incident_summary.
  raw_orders              400K rows  — order header (1 row / order_id).
  raw_order_items         ~640K rows — line items (FK to orders + products).
  raw_returns             ~36K rows  — 8% baseline + 80% on bad lot.

No pandas_udf used: name pools (~700 rows) are generated on the driver via
Faker then broadcast-joined; reason/comment picks use F.element_at against
literal arrays. So no executor-side Python dependency is required.

Time: rolling by default (NOW = datetime.now()) so the dashboard's last
data point lands on yesterday-real every run. Set LUXE_PIN_TIME=1 to
freeze NOW to STORY_PINNED_NOW (2026-06-12) for reproducible demos where
every artefact (lot id, dates, KA docs) needs to match a recorded baseline.

PDFs for the Knowledge Assistant are produced by the separate
`src/documents/html_to_pdf.py` — run it after this script.

Aligned with `references/example-luxebeauty/specifications/01-lakeflow.md`.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import numpy as np
from databricks.connect import DatabricksSession
from pyspark.sql import DataFrame
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# ── Config ─────────────────────────────────────────────────────────────────
# Catalog + schema are widget-overridable (job/notebook) and env-overridable
# (local run via `python …`).
try:
    dbutils.widgets.text("catalog", "", "Catalog")  # noqa: F821
    dbutils.widgets.text("schema",  "", "Schema")   # noqa: F821
    CATALOG = dbutils.widgets.get("catalog") or os.environ.get("DEMO_CATALOG") or "retail_consumer_goods"  # noqa: F821
    SCHEMA  = dbutils.widgets.get("schema")  or os.environ.get("DEMO_SCHEMA")  or "luxebeauty_demo"        # noqa: F821
except NameError:
    CATALOG = os.environ.get("DEMO_CATALOG") or "retail_consumer_goods"
    SCHEMA  = os.environ.get("DEMO_SCHEMA")  or "luxebeauty_demo"

# Volume holding the raw parquet datasets — the SINGLE source of raw truth.
# The SDP silver layer reads these files directly via read_files() (no bronze,
# no raw Delta tables). One subdir per dataset under /Volumes/{cat}/{schema}/raw_data/.
RAW_VOL = "raw_data"

N_CUSTOMERS = 5_000
N_ORDERS    = 400_000        # ~4K orders/week × 100 weeks ≈ spec's $380K/mo
N_LOTS_PER_SKU = 18           # 6 months × 3 lots/mo; ~1.6K lots total.
N_BAD_ORDERS = 5_000          # bad-lot cohort size (≈ 5K units / 3 SKUs).

# ── Story timeline ─────────────────────────────────────────────────────────
# NOW is the single source of truth — every other date below derives from it.
# Default is ROLLING TIME (`datetime.now()`) so the dashboard always feels
# "live" (last data point lands on yesterday-real). Set LUXE_PIN_TIME=1 to
# freeze NOW to STORY_PINNED_NOW for reproducible demos where every artefact
# (lot id, dates, KA docs) needs to match a recorded baseline across runs.
STORY_PINNED_NOW = datetime(2026, 6, 12)
NOW = (
    STORY_PINNED_NOW
    if os.environ.get("LUXE_PIN_TIME") == "1"
    else datetime.now()
)
SPIKE_PEAK      = NOW - timedelta(days=21)

# Bad-lot timing: default is NOW − 43d. If that lands on (or its return
# peak ~5w later lands on) Black Friday week or the Dec holiday ramp, the
# return spike would visually dissolve into the seasonal volume — slide
# the lot back week-by-week until both anchors clear the peaks. With the
# default pinned NOW = 2026-06-12 the lot is 2026-04-30, well off-peak.
def _is_peak_day(d: datetime) -> bool:
    m, day = d.month, d.day
    return (m == 11 and 20 <= day <= 30) or (m == 12 and 1 <= day <= 26)

BAD_LOT_PROD_DT = NOW - timedelta(days=43)
while _is_peak_day(BAD_LOT_PROD_DT) or _is_peak_day(BAD_LOT_PROD_DT + timedelta(weeks=5)):
    BAD_LOT_PROD_DT -= timedelta(weeks=1)
BAD_LOT_ID      = f"LOT-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}"
BAD_SKUS        = ["SKU-1001", "SKU-1002", "SKU-1003"]
BAD_FACILITY    = "Lyon-France"

HIST_START      = NOW - timedelta(days=24 * 30)      # 24-month history
HIST_END        = NOW - timedelta(days=1)
HIST_SPAN_DAYS  = (HIST_END - HIST_START).days

INCIDENT_SUMMARY = (
    f"Production Incident Report PIR-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}. "
    "Equipment: Homogenizer Unit HMG-03 at Lyon. Issue: pressure fluctuations "
    "(2.1-2.8 bar vs normal 2.4-2.6 bar) during emulsification. Cause: "
    "calibration drift in the pressure regulation valve. "
    f"Affected SKUs: {', '.join(BAD_SKUS)} (~5,000 units). "
    "QC assessment: 'Minor texture variations due to pressure fluctuations "
    "during emulsification — cosmetic only; safety and efficacy unaffected.' "
    "Disposition: RELEASED."
)

print(f"NOW: {NOW.date()} ({'pinned' if os.environ.get('LUXE_PIN_TIME') == '1' else 'rolling'})")
print(f"BAD_LOT_ID:   {BAD_LOT_ID}")
print(f"BAD_LOT_DATE: {BAD_LOT_PROD_DT.date()}")
print(f"SPIKE_PEAK:   {SPIKE_PEAK.date()}")

# When running inside a Databricks job/notebook, a `spark` SparkSession is
# already provided by the runtime — re-creating one via DatabricksSession
# breaks. Detect and reuse if present; otherwise spin up databricks-connect
# (for local runs from the laptop against a remote workspace).
try:
    spark  # noqa: F821
except NameError:
    spark = DatabricksSession.builder.serverless(True).getOrCreate()

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
# Raw parquet lands in a UC Volume — the bronze landing zone the SDP silver
# reads via read_files() (no bronze pass-through; silver reads the files
# directly). One subdir per raw dataset, named WITHOUT the `raw_` prefix
# (raw_returns → .../raw_data/returns) so 02_silver.sql's read_files() paths
# line up.
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.{RAW_VOL}")
RAW_VOL_ROOT = f"/Volumes/{CATALOG}/{SCHEMA}/{RAW_VOL}"


def _raw_path(table: str) -> str:
    """Volume subdir for a raw dataset: strip the `raw_` prefix."""
    return f"{RAW_VOL_ROOT}/{table.removeprefix('raw_')}"


def _save(df: DataFrame, table: str) -> None:
    """Write a raw dataset as parquet FILES into the UC Volume.

    Centralised so we keep one write style and a single log line per dataset.
    The SDP silver layer reads these files with read_files(); we do NOT create
    raw Delta tables (the Volume is the single source of raw truth).
    """
    path = _raw_path(table)
    (df.write.mode("overwrite")
       .parquet(path))
    n = spark.read.parquet(path).count()
    print(f"  ✓ {table:25s} rows={n:>9,}  → {path}")


# ═══════════════════════════════════════════════════════════════════════════
# 1. PRODUCTS  ───  small dimension table; pure Python list → DataFrame.
# ═══════════════════════════════════════════════════════════════════════════
# Affected SKUs first — their names + prices appear verbatim in the incident
# PDFs and the dashboard. Cost ~ 18% of price (cosmetics industry rule of
# thumb). ~90 total products = Skincare 40 / Makeup 25 / Haircare 15 + 10
# accent (Bodycare/Fragrance) to match the spec's category mix.

print("\n[1/6] Generating products...")

_AFFECTED = [
    ("SKU-1001", "Hydrating Serum 30ml",   "Skincare", "Serums",  68.0, 12.0),
    ("SKU-1002", "Vitamin C Cream 50ml",   "Skincare", "Creams",  55.0, 10.0),
    ("SKU-1003", "HA Moisture Boost 15ml", "Skincare", "Serums",  42.0,  8.0),
]

def _build_products() -> list[tuple]:
    rng = np.random.default_rng(seed=42)
    out: list[tuple] = list(_AFFECTED)
    families: list[tuple[str, list[str], list[str], tuple[float, float]]] = [
        ("Skincare", ["Cleanser","Moisturizer","Eye Cream","Toner","Serum","Mask","Treatment","Sunscreen"], [
            "Pure Clarity Cleanser","Dewy Glow Moisturizer","Youth Essence Eye Cream","Calm & Renew Toner",
            "Bright Vitality Serum","Hydra-Lock Day Cream","Overnight Repair Mask","Botanical Recovery Oil",
            "Daily Defense SPF 50","Radiance Boost Essence","Pore Refining Toner","Aqua Burst Gel",
            "Anti-Fatigue Eye Roller","Glow Reveal Exfoliant","Pure Vitality Serum","Soothing Aloe Mist",
            "Renewal Night Treatment","Triple Action Eye Cream","Plumping Lip Treatment","Botanical Cleansing Balm",
            "Marine Boost Serum","Replenishing Recovery Cream","Brightening Pigment Corrector",
            "Restore Sensitive Skin Cream","Smoothing Refining Serum","Ultra Hydrating Mask",
            "Tightening Firming Lotion","Daily Renewal Toner","Phyto Botanical Treatment",
            "Resurfacing Acid Pads","Bio-Active Eye Serum","Multi-Action Day Cream",
            "Calm Sensitive Cleanser","Vitality Boost Mist","Pure Detox Mask","Antioxidant Defense Serum",
            "Replenishing Night Oil",
        ], (25.0, 120.0)),
        ("Makeup", ["Lips","Face","Eyes"], [
            "Velvet Matte Lipstick","Luminous Foundation SPF 30","Rose Gold Blush Palette",
            "Precision Liner Pen","Glossy Plump Gloss","Smoky Eye Shadow Quad","Brow Define Pencil",
            "Setting Powder Translucent","Velvet Touch Concealer","Hydrating Lip Stain","Bronzed Sun Powder",
            "Defining Mascara","Liquid Shimmer Highlighter","All-Day Lip Liner","Eye Primer Base",
            "Cream Blush Stick","Color Mist Setting Spray","Tinted Lip Balm","Bold Color Eye Pencil",
            "Pro Glow Foundation","Soft Focus Powder","Volumizing Lash Primer","Plumping Lip Gloss",
            "Statement Lipstick","Contour Shaping Stick",
        ], (15.0, 65.0)),
        ("Haircare", ["Wash","Treatment","Styling"], [
            "Silk Repair Shampoo","Silk Repair Conditioner","Argan Miracle Hair Mask","Scalp Balance Serum",
            "Glossy Finish Hair Oil","Strengthening Shampoo","Curl Defining Cream","Volumizing Mousse",
            "Heat Protect Spray","Deep Repair Mask","Anti-Frizz Serum","Hydrating Leave-In",
            "Color Lock Conditioner","Daily Cleansing Shampoo","Smoothing Hair Balm",
        ], (18.0, 45.0)),
        ("Bodycare", ["Lotions","Scrubs","Bath"], [
            "Rose Petal Body Lotion","Sugar Glow Scrub","Velvet Body Butter","Lavender Bath Soak","Firming Body Cream",
        ], (28.0, 55.0)),
        ("Fragrance", ["EDP","EDT","Mist"], [
            "Luxe Floral EDP 50ml","Rose & Oud Collection 30ml","Cedar & Amber Body Mist",
            "Fresh Citrus EDT","Noir Intense EDP 50ml",
        ], (45.0, 130.0)),
    ]
    sku_prefix = {"Skincare": 1, "Makeup": 2, "Haircare": 3, "Bodycare": 4, "Fragrance": 5}
    for cat, subs, names, (lo, hi) in families:
        offset = 4 if cat == "Skincare" else 1
        for i, name in enumerate(names):
            sub = str(rng.choice(subs))
            price = round(float(rng.uniform(lo, hi)), 0)
            out.append((
                f"SKU-{sku_prefix[cat]}{i + offset:03d}", name, cat, sub,
                price, round(price * 0.18, 2),
            ))
    return out

PRODUCTS = _build_products()
products_df = spark.createDataFrame(
    PRODUCTS,
    schema="product_id string, product_name string, category string, "
           "subcategory string, price_usd double, cost_usd double",
).withColumn("launch_date", F.lit((NOW - timedelta(days=365)).strftime("%Y-%m-%d"))) \
 .withColumn("is_active",  F.lit(True))

_save(products_df, "raw_products")


# ═══════════════════════════════════════════════════════════════════════════
# 2. CUSTOMERS  ───  spark.range + F.when + driver-built name pool join.
# ═══════════════════════════════════════════════════════════════════════════
# Region distribution per spec: US 70 / EU 20 / APAC 10. Inside each region,
# country mix per the spec. Tier: gold 10 / silver 30 / standard 60 globally,
# with France + Italy slightly more affluent (Skincare-heavy market).
# Premium status is left NULL here; filled in step 6 once we know spend.

print("\n[2/6] Generating customers...")

# Country anchors used to drop a city + lat/lng. (lat, lng, weight) per metro.
CITY_ANCHORS = {
    "US":          [("New York", 40.71,  -74.01, 0.30), ("Los Angeles", 34.05, -118.24, 0.25), ("Chicago",       41.88,  -87.63, 0.15), ("Miami", 25.76, -80.19, 0.15), ("Seattle", 47.61, -122.33, 0.15)],
    "Canada":      [("Toronto",  43.65,  -79.38, 0.60), ("Vancouver",   49.28, -123.12, 0.40)],
    "France":      [("Paris",    48.86,    2.35, 0.65), ("Lyon",        45.76,    4.83, 0.20), ("Marseille",     43.30,    5.37, 0.15)],
    "UK":          [("London",   51.51,   -0.13, 0.70), ("Manchester",  53.48,   -2.24, 0.30)],
    "Germany":     [("Berlin",   52.52,   13.40, 0.45), ("Munich",      48.14,   11.58, 0.35), ("Hamburg",       53.55,    9.99, 0.20)],
    "Italy":       [("Milan",    45.46,    9.19, 0.60), ("Rome",        41.90,   12.50, 0.40)],
    "Spain":       [("Madrid",   40.42,   -3.70, 0.55), ("Barcelona",   41.39,    2.17, 0.45)],
    "Netherlands": [("Amsterdam",52.37,    4.90, 1.00)],
    "Japan":       [("Tokyo",    35.68,  139.69, 0.60), ("Osaka",       34.69,  135.50, 0.25), ("Kyoto",         35.01,  135.77, 0.15)],
    "Australia":   [("Sydney",  -33.87,  151.21, 0.50), ("Melbourne",  -37.81,  144.96, 0.35), ("Brisbane",     -27.47,  153.03, 0.15)],
    "Korea":       [("Seoul",    37.57,  126.98, 0.80), ("Busan",       35.18,  129.08, 0.20)],
    "Singapore":   [("Singapore", 1.35,  103.82, 1.00)],
}

# Locale-specific name pools generated on the DRIVER (Faker runs locally) and
# shipped as a small DataFrame to executors. ~50 first + 50 last names per
# country = ~700 rows total = trivial broadcast join. Customers pick a slot
# by `id % 50`. Faker is a driver-only dependency; no need to ship it to the
# serverless executors via a wheel / cluster lib.
NAMES_PER_LOCALE = 50
_FAKER_LOCALES = {
    "France": "fr_FR", "Italy": "it_IT", "Spain": "es_ES", "Germany": "de_DE",
    "Japan": "ja_JP", "Korea": "ko_KR", "UK": "en_GB", "Netherlands": "nl_NL",
    "Australia": "en_AU", "Singapore": "en_US", "US": "en_US", "Canada": "en_CA",
}

def _make_name_pool() -> list[tuple]:
    from faker import Faker
    out: list[tuple] = []
    for country, locale in _FAKER_LOCALES.items():
        f = Faker(locale)
        Faker.seed(hash(country) % 10_000)
        for i in range(NAMES_PER_LOCALE):
            out.append((country, i, f.first_name(), f.last_name()))
    return out

name_pool_df = spark.createDataFrame(
    _make_name_pool(),
    schema="country string, name_idx int, first_name string, last_name string",
)

# Country picker: nested F.when expression to encode region 70/20/10 +
# country mix inside each region.
def _country_expr() -> "F.Column":
    r = F.col("_r_region")
    rc = F.col("_r_country")
    # rc is uniform in [0,1) -> map to country within the region.
    # US: US 95%, Canada 5%
    us_country = F.when(rc < 0.95, F.lit("US")).otherwise(F.lit("Canada"))
    # EU: FR 30, UK 25, DE 20, IT 15, ES 10
    eu_country = (
        F.when(rc < 0.30, F.lit("France"))
         .when(rc < 0.55, F.lit("UK"))
         .when(rc < 0.75, F.lit("Germany"))
         .when(rc < 0.90, F.lit("Italy"))
         .otherwise(F.lit("Spain"))
    )
    # APAC: JP 40, AU 30, KR 20, SG 10
    apac_country = (
        F.when(rc < 0.40, F.lit("Japan"))
         .when(rc < 0.70, F.lit("Australia"))
         .when(rc < 0.90, F.lit("Korea"))
         .otherwise(F.lit("Singapore"))
    )
    return (
        F.when(r < 0.70, us_country)
         .when(r < 0.90, eu_country)
         .otherwise(apac_country)
    )

cust_base = (
    spark.range(0, N_CUSTOMERS, numPartitions=8)
         .withColumn("_r_region",  F.rand(seed=101))
         .withColumn("_r_country", F.rand(seed=102))
         .withColumn("_r_tier",    F.rand(seed=103))
         .withColumn("_r_reg",     F.rand(seed=104))
         .withColumn("country",    _country_expr())
)

# Region is a deterministic function of country.
country_region = {
    "US": "US", "Canada": "US",
    "France": "EU", "UK": "EU", "Germany": "EU", "Italy": "EU", "Spain": "EU", "Netherlands": "EU",
    "Japan": "APAC", "Australia": "APAC", "Korea": "APAC", "Singapore": "APAC",
}
region_expr = F.lit(None).cast("string")
for c, r in country_region.items():
    region_expr = F.when(F.col("country") == c, F.lit(r)).otherwise(region_expr)

# Tier: 10/30/60 globally; France/Italy 18/40/42.
tier_expr = (
    F.when(F.col("country").isin("France", "Italy"),
        F.when(F.col("_r_tier") < 0.18, F.lit("gold"))
         .when(F.col("_r_tier") < 0.58, F.lit("silver"))
         .otherwise(F.lit("standard")))
    .otherwise(
        F.when(F.col("_r_tier") < 0.10, F.lit("gold"))
         .when(F.col("_r_tier") < 0.40, F.lit("silver"))
         .otherwise(F.lit("standard")))
)

# City + lat/lng pick: build a long-form CITY DataFrame, join to customers by
# country with a weighted-random pick driven by a per-row uniform.
city_rows: list[tuple] = []
for country, anchors in CITY_ANCHORS.items():
    cum = 0.0
    for city, lat, lng, w in anchors:
        city_rows.append((country, city, float(lat), float(lng), cum, cum + w))
        cum += w
city_df = spark.createDataFrame(
    city_rows,
    schema="country string, city string, anchor_lat double, anchor_lng double, "
           "cum_low double, cum_high double",
)

reg_days = F.expr("180 + cast(rand(105) * (4*365 - 180) as int)")
cust_df = (
    cust_base
    .withColumn("customer_id",      F.format_string("CUST-%06d", F.col("id")))
    .withColumn("region",           region_expr)
    .withColumn("loyalty_tier",     tier_expr)
    .withColumn("registration_date",
        F.date_format(F.date_sub(F.lit(NOW.date().isoformat()), reg_days), "yyyy-MM-dd"))
    .withColumn("_r_city",          F.rand(seed=106))
    .withColumn("name_idx",         (F.col("id") % NAMES_PER_LOCALE).cast("int"))
)

# Name pool join: pick first/last name from the driver-built pool keyed by
# (country, id % NAMES_PER_LOCALE). Broadcast-sized (~700 rows).
cust_df = (
    cust_df.alias("c").join(
        F.broadcast(name_pool_df.alias("np")),
        (F.col("c.country") == F.col("np.country")) &
        (F.col("c.name_idx") == F.col("np.name_idx")),
        "left",
    )
    .select(
        F.col("c.id"), F.col("c.customer_id"), F.col("c.country"),
        F.col("c.region"), F.col("c.loyalty_tier"), F.col("c.registration_date"),
        F.col("c._r_city"),
        F.col("np.first_name"), F.col("np.last_name"),
    )
    .withColumn("email",
        F.concat_ws("",
            F.lower(F.col("first_name")), F.lit("."),
            F.lower(F.col("last_name")), F.lit("."),
            F.col("customer_id"), F.lit("@example.com"),
        ))
)

# Weighted city join: city_df has [cum_low, cum_high) bands per country.
cust_df = (
    cust_df.alias("c").join(
        F.broadcast(city_df.alias("cy")),
        (F.col("c.country") == F.col("cy.country")) &
        (F.col("c._r_city") >= F.col("cy.cum_low")) &
        (F.col("c._r_city") <  F.col("cy.cum_high")),
        "left",
    )
    .select(
        F.col("c.customer_id"),
        F.col("c.first_name"),
        F.col("c.last_name"),
        F.col("c.email"),
        F.col("c.country"),
        F.col("cy.city"),
        # ±0.05° jitter ~5km. F.rand re-seeded to be deterministic.
        (F.col("cy.anchor_lat") + (F.rand(seed=107) - 0.5) * 0.1).alias("customer_lat"),
        (F.col("cy.anchor_lng") + (F.rand(seed=108) - 0.5) * 0.1).alias("customer_lng"),
        F.col("c.region"),
        F.col("c.loyalty_tier"),
        F.col("c.registration_date"),
        F.lit(None).cast("string").alias("premium_status"),
    )
)

# Write base customers (premium_status NULL). Step 6 overwrites with labels.
_save(cust_df, "raw_customers")


# ═══════════════════════════════════════════════════════════════════════════
# 3. PRODUCTION LOTS  ───  spark.range × products; bad lot + recall/hold mix.
# ═══════════════════════════════════════════════════════════════════════════
# Each SKU gets ~18 lots over 6 months. The bad lot (LOT-2026-0430) is unioned
# in afterwards — it carries all 3 BAD_SKUs and the INCIDENT_SUMMARY note.
# Status enum: released (~96%) / on_hold (~3%) / recalled (~1%). The bad lot
# is status='released' (that's the whole point of the story).

print("\n[3/6] Generating production lots...")

n_skus = len(PRODUCTS)
lots_total = n_skus * N_LOTS_PER_SKU

# Cross-product of products × lot index via two-step spark.range.
products_idx = (
    spark.createDataFrame(
        [(i, p[0]) for i, p in enumerate(PRODUCTS)],
        schema="sku_idx int, product_id string",
    )
)

lots_df = (
    spark.range(0, lots_total, numPartitions=4)
         .withColumn("sku_idx",   (F.col("id") % n_skus).cast("int"))
         .withColumn("lot_idx",   (F.col("id") / n_skus).cast("int"))
         .join(products_idx, "sku_idx")
         .withColumn("_days_back", F.col("lot_idx") * 11 + (F.col("sku_idx") % 3) * 3)
         .withColumn("production_date",
                     F.date_sub(F.lit(NOW.date().isoformat()), F.col("_days_back")))
         .withColumn("_r_fac",  F.rand(seed=201))
         .withColumn("facility",
            F.when(F.col("_r_fac") < 0.40, F.lit("Lyon-France"))
             .when(F.col("_r_fac") < 0.65, F.lit("Milan-Italy"))
             .when(F.col("_r_fac") < 0.85, F.lit("London-UK"))
             .otherwise(F.lit("NJ-USA")))
         .withColumn("lot_id",
            F.format_string("LOT-%s-%s",
                F.date_format(F.col("production_date"), "yyyy"),
                F.format_string("%02d%02d-%s",
                    F.month(F.col("production_date")),
                    F.dayofmonth(F.col("production_date")),
                    F.substring(F.col("product_id"), -4, 4))))
         .withColumn("units_produced",
                     (F.lit(500) + (F.rand(seed=202) * 1500).cast("int")))
         .withColumn("_r_status", F.rand(seed=203))
         .withColumn("status",
            F.when(F.col("_r_status") < 0.01, F.lit("recalled"))
             .when(F.col("_r_status") < 0.04, F.lit("on_hold"))
             .otherwise(F.lit("released")))
         .withColumn("incident_summary", F.lit(None).cast("string"))
         .select("lot_id", "product_id", "facility", "production_date",
                 "units_produced", "status", "incident_summary")
)

# Union in the bad lot rows (one per BAD_SKU).
bad_lot_rows = [
    (BAD_LOT_ID, sku, BAD_FACILITY, BAD_LOT_PROD_DT.date(), 5000,
     "released", INCIDENT_SUMMARY)
    for sku in BAD_SKUS
]
bad_lot_df = spark.createDataFrame(
    bad_lot_rows,
    schema=lots_df.schema,
)
lots_df = lots_df.unionByName(bad_lot_df)

_save(lots_df, "raw_production_lots")


# ═══════════════════════════════════════════════════════════════════════════
# 4. ORDERS + ORDER ITEMS  ───  the hot path.
# ═══════════════════════════════════════════════════════════════════════════
# Three independent streams unioned together:
#  (a) `normal` orders → spark.range(N_ORDERS); 1-3 items each; Pareto SKU
#      popularity (80/20); seasonality multipliers on the order date.
#  (b) `bad-lot` orders → spark.range(N_BAD_ORDERS); 1 BAD_SKU per order;
#      EU-skewed cohort; order_date in the 28-40d-ago window so returns
#      peak at SPIKE_PEAK.
# Order header = 1 row / order_id; Order items = N_lines per order.

print("\n[4/6] Generating orders + order items...")

# Pareto popularity: rank SKUs randomly into a head/tail bucket. Top 20% of
# SKUs carry 80% of demand. Encoded as a per-SKU weight column joined later.
rank_rng = np.random.default_rng(seed=11)
ranks = rank_rng.permutation(len(PRODUCTS))
head_n = max(1, int(len(PRODUCTS) * 0.2))
sku_weights = []
for i, p in enumerate(PRODUCTS):
    rank = int(ranks[i])
    w = (0.80 / head_n) if rank < head_n else (0.20 / (len(PRODUCTS) - head_n))
    sku_weights.append((p[0], float(w), float(p[4])))  # (product_id, weight, price)
weights_total = sum(w for _, w, _ in sku_weights)

# Build a SKU bands DataFrame [cum_low, cum_high) for weighted-random pick.
cum = 0.0
sku_band_rows = []
for pid, w, price in sku_weights:
    cum_next = cum + w / weights_total
    sku_band_rows.append((pid, cum, cum_next, price))
    cum = cum_next
sku_bands_df = spark.createDataFrame(
    sku_band_rows,
    schema="product_id string, cum_low double, cum_high double, price_usd double",
)

# Lookup of {released} lots per SKU for FK assignment. The bad lot is
# explicitly excluded — normal orders never reference it.
released_lots_df = (
    lots_df.filter((F.col("status") == "released") & (F.col("lot_id") != F.lit(BAD_LOT_ID)))
           .select("product_id", "lot_id", "facility")
)
# For each SKU, assign each lot an index 0..k-1; we'll mod a per-line random
# into this index space to deterministically pick one.
released_lots_df = released_lots_df.withColumn(
    "lot_idx_in_sku",
    F.row_number().over(Window.partitionBy("product_id").orderBy("lot_id")) - 1,
)
lot_count_per_sku = (
    released_lots_df.groupBy("product_id").agg(F.count("*").alias("lot_count"))
)

# Customer lookup with country/region (broadcast-sized: 5K rows).
cust_lookup_df = spark.read.parquet(_raw_path("raw_customers")) \
                      .select("customer_id", "country", "region")

# Seasonality multipliers driven by month + day of the order date. We compute
# the multiplier in-line on the day_offset column; same logic as the original
# (Black Friday 3x, Holiday 2.2x, Mother's Day 2x, Valentine's 1.8x,
# Summer 0.75x dip) but inside an F.when chain rather than a Python function.
def _season_mult(date_col: "F.Column") -> "F.Column":
    """Per-day seasonal multiplier — designed so the trend line shows
    **two distinct shopping spikes** (Black Friday + Christmas) with a
    visible valley between them. Calibrated to a beauty-retail calendar:
      Nov 24-30  — Black Friday tent (2.0 → 3.2 on Nov 28 → 2.0)
      Dec 1-10   — early-Dec valley (1.3, separates the two peaks)
      Dec 11-21  — Christmas ramp (1.5 → 3.2 on Dec 21)
      Dec 22     — last-day plateau (3.0)
      Dec 23-26  — post-cutoff lull (0.6)
      Dec 27-31  — post-Christmas self-buying (1.3)
      May 7-14   — Mother's Day (2.0)
      Feb 7-14   — Valentine's (1.8)
      Jul / Aug  — summer dip (0.75)
    Mirrors the simple-demo's `_season_multiplier` — expressed as nested
    F.when() chains so it runs as a vectorised Spark expression."""
    m = F.month(date_col); d = F.dayofmonth(date_col)
    return (
        # Black Friday tent: 3.2 − 0.3 × |day − 28|
        F.when((m == 11) & d.between(24, 30),
               F.lit(3.2) - F.lit(0.3) * F.abs(d - F.lit(28)))
         # Early-Dec valley
         .when((m == 12) & d.between(1, 10),   F.lit(1.3))
         # Christmas ramp: 1.5 + ((day − 11) / 10) × 1.7 → caps at 3.2 on Dec 21
         .when((m == 12) & d.between(11, 21),
               F.lit(1.5) + ((d - F.lit(11)).cast("double") / F.lit(10.0)) * F.lit(1.7))
         .when((m == 12) & (d == 22),          F.lit(3.0))
         .when((m == 12) & d.between(23, 26),  F.lit(0.6))
         .when((m == 12) & (d >= 27),          F.lit(1.3))
         .when((m == 5)  & d.between(7, 14),   F.lit(2.0))
         .when((m == 2)  & d.between(7, 14),   F.lit(1.8))
         .when(m.isin(7, 8),                   F.lit(0.75))
         .otherwise(F.lit(1.0))
    )

# Normal-orders header (1 row / order_id). We pick a uniform day in
# [HIST_START..HIST_END]; the seasonality is applied as a *retention*
# Bernoulli filter so peaks sample more orders (3x BF = keep ~3x as many
# orders landing on those days vs flat).
normal_hdr = (
    # Over-sample by 2.5x: the seasonality filter `keep * 3.0 < season`
    # discards rows on flat-mult days (1.0) at rate (1 - 1/3) = 0.67;
    # 2.5 over-sample × 0.33 keep ≈ 0.83 of N_ORDERS retained per .limit().
    spark.range(0, int(N_ORDERS * 2.5), numPartitions=16)
         .withColumn("_r_day", F.rand(seed=301))
         .withColumn("order_date",
            F.from_unixtime(
                F.unix_timestamp(F.lit(HIST_START)) +
                (F.col("_r_day") * HIST_SPAN_DAYS * 86400).cast("long")
            ).cast("timestamp"))
         .withColumn("_season",  _season_mult(F.col("order_date")))
         .withColumn("_keep",    F.rand(seed=302))
         # Keep row with probability proportional to season multiplier.
         # Divisor matches the max multiplier in _season_mult (3.2 from
         # the Black Friday + Christmas tent peaks) so peak days retain
         # ~100% of their oversampled rows.
         .filter(F.col("_keep") * 3.2 < F.col("_season"))
         .limit(N_ORDERS)
         .withColumn("_r_cust",  F.rand(seed=303))
         .withColumn("customer_idx", (F.col("_r_cust") * N_CUSTOMERS).cast("long"))
         .withColumn("_r_items",  F.rand(seed=304))
         .withColumn("n_items",
            F.when(F.col("_r_items") < 0.55, F.lit(1))
             .when(F.col("_r_items") < 0.85, F.lit(2))
             .otherwise(F.lit(3)))
         .withColumn("order_id",
            F.format_string("ORD-%s-%06d",
                F.date_format(F.col("order_date"), "yyyyMMdd"),
                F.row_number().over(
                    Window.partitionBy(F.date_format(F.col("order_date"), "yyyyMMdd"))
                          .orderBy("id"))))
         .select("order_id", "customer_idx", "order_date", "n_items")
)

# No need to persist — all rand() seeds are explicit so re-execution is
# deterministic. The downstream items join recomputes normal_hdr at no
# functional cost.

# Explode 1..n_items into items via spark.range(max_items) + filter.
# We over-generate items (up to 3 per order) then keep [0..n_items-1].
items_skel = (
    normal_hdr.alias("h")
    .join(
        spark.range(0, 3).withColumnRenamed("id", "line_no"),
        F.col("line_no") < F.col("h.n_items"),
        "cross",
    )
    .select("h.order_id", "h.order_date", "h.customer_idx", "h.n_items", "line_no")
    .withColumn("_r_sku",   F.rand(seed=305))
    .withColumn("_r_qty",   F.rand(seed=306))
    .withColumn("_r_lot",   F.rand(seed=307))
    .withColumn("quantity", (F.col("_r_qty") * 3 + 1).cast("int"))
)

# Pick SKU by joining to sku_bands (band that contains _r_sku).
items_with_sku = (
    items_skel.alias("i").join(
        sku_bands_df.alias("b"),
        (F.col("i._r_sku") >= F.col("b.cum_low")) &
        (F.col("i._r_sku") <  F.col("b.cum_high")),
        "inner",
    ).select(
        "i.order_id", "i.order_date", "i.customer_idx", "i.line_no",
        "i.quantity", "i._r_lot",
        F.col("b.product_id"), F.col("b.price_usd"),
    )
)

# Assign a released lot via mod-of-_r_lot into lot_count.
items_with_lot = (
    items_with_sku.join(lot_count_per_sku, "product_id")
    .withColumn("lot_idx_in_sku",
        (F.col("_r_lot") * F.col("lot_count")).cast("int"))
    .join(released_lots_df, ["product_id", "lot_idx_in_sku"], "left")
    .withColumn("line_total_usd",
        F.round(F.col("price_usd") * F.col("quantity") *
                (F.lit(0.9) + F.rand(seed=308) * 0.2), 2))
    .select(
        "order_id", "product_id", "lot_id", "facility", "quantity",
        F.col("price_usd").alias("unit_price_usd"),
        "line_total_usd",
    )
)

# Bad-lot orders: small (~5K), special-cased.  Pre-compute the EU/non-EU
# customer index ranges from raw_customers so the 65/35 EU skew lands.
eu_countries = ("France", "UK", "Germany", "Italy", "Spain")
eu_idx_df = (
    spark.read.parquet(_raw_path("raw_customers"))
    .filter(F.col("country").isin(*eu_countries))
    .select("customer_id")
    .withColumn("rk", F.row_number().over(Window.orderBy("customer_id")) - 1)
)
non_eu_idx_df = (
    spark.read.parquet(_raw_path("raw_customers"))
    .filter(~F.col("country").isin(*eu_countries))
    .select("customer_id")
    .withColumn("rk", F.row_number().over(Window.orderBy("customer_id")) - 1)
)
n_eu = eu_idx_df.count()
n_non_eu = non_eu_idx_df.count()
n_bad_eu = int(N_BAD_ORDERS * 0.65)
n_bad_non_eu = N_BAD_ORDERS - n_bad_eu

bad_hdr = (
    spark.range(0, N_BAD_ORDERS, numPartitions=2)
    .withColumn("_eu_flag", F.col("id") < n_bad_eu)
    .withColumn("rk",
        F.when(F.col("_eu_flag"), F.col("id") % n_eu)
         .otherwise((F.col("id") - n_bad_eu) % n_non_eu))
    .withColumn("_r_day", F.rand(seed=401))
    .withColumn("days_back",
        (F.col("_r_day") * 13 + 28).cast("int"))   # 28..41d ago
    .withColumn("order_date",
        F.date_sub(F.lit(NOW.date().isoformat()), F.col("days_back")).cast("timestamp"))
)

# Join EU/non-EU customer ids by rk.
bad_with_eu = (
    bad_hdr.filter(F.col("_eu_flag"))
           .join(eu_idx_df, "rk", "inner")
)
bad_with_non_eu = (
    bad_hdr.filter(~F.col("_eu_flag"))
           .join(non_eu_idx_df, "rk", "inner")
)
bad_joined = bad_with_eu.unionByName(bad_with_non_eu)

bad_hdr_finished = (
    bad_joined
    .withColumn("customer_idx", F.lit(-1).cast("long"))  # placeholder; we use customer_id directly
    .withColumn("order_id",
        F.format_string("BADORD-%06d", F.col("id")))   # avoid sequence collision with normal orders
    .withColumn("n_items", F.lit(1))
    .select("order_id", "customer_id", "order_date", "n_items")
)

# Bad-lot items (1 per order; rotate through BAD_SKUS).
bad_items = (
    bad_hdr_finished.withColumn("sku_pick", (F.col("order_id").substr(-1, 1).cast("int") % 3))
    .withColumn("product_id",
        F.when(F.col("sku_pick") == 0, F.lit(BAD_SKUS[0]))
         .when(F.col("sku_pick") == 1, F.lit(BAD_SKUS[1]))
         .otherwise(F.lit(BAD_SKUS[2])))
    .withColumn("lot_id",   F.lit(BAD_LOT_ID))
    .withColumn("facility", F.lit(BAD_FACILITY))
    .withColumn("quantity", F.lit(1) + (F.rand(seed=402) * 2).cast("int"))
    .join(products_df.select(F.col("product_id"), F.col("price_usd")), "product_id")
    .withColumn("unit_price_usd", F.col("price_usd"))
    .withColumn("line_total_usd",
        F.round(F.col("price_usd") * F.col("quantity") *
                (F.lit(0.9) + F.rand(seed=403) * 0.2), 2))
    .select("order_id", "product_id", "lot_id", "facility", "quantity",
            "unit_price_usd", "line_total_usd")
)

# Normal orders need a customer_id (we used customer_idx as a long earlier).
cust_idx_df = (
    cust_lookup_df.withColumn("customer_idx",
        F.row_number().over(Window.orderBy("customer_id")) - 1)
)

normal_hdr_with_cid = (
    normal_hdr.join(cust_idx_df, "customer_idx")
    .select("order_id", "customer_id", "country", "region", "order_date", "n_items")
)

# Bad header needs country/region.
bad_hdr_with_geo = (
    bad_hdr_finished.join(cust_lookup_df, "customer_id")
    .select("order_id", "customer_id", "country", "region", "order_date", "n_items")
)

orders_final = (
    normal_hdr_with_cid
    .unionByName(bad_hdr_with_geo)
)

items_final = items_with_lot.unionByName(bad_items)

# Order total = sum of line totals per order. Join back to items, write items
# first, then compute totals.
_save(items_final, "raw_order_items")

orders_total = (
    spark.read.parquet(_raw_path("raw_order_items"))
    .groupBy("order_id")
    .agg(F.round(F.sum("line_total_usd"), 2).alias("total_usd"))
)
orders_with_total = (
    orders_final.join(orders_total, "order_id", "left")
    .withColumn("total_usd", F.coalesce(F.col("total_usd"), F.lit(0.0)))
)
_save(orders_with_total, "raw_orders")


# ═══════════════════════════════════════════════════════════════════════════
# 5. RETURNS  ───  derived from order_items + orders; element_at for picks.
# ═══════════════════════════════════════════════════════════════════════════
# Three streams:
#   normal:     8% of non-bad-lot order_items returned, 60/30/10 timing tiers.
#   bad-lot:    80% of bad-lot orders returned, triangular peak at SPIKE_PEAK.
#   bad-lot sub: 80/20 angry/neutral split inside the bad-lot returns.

print("\n[5/6] Generating returns...")

# Each return references one "row" — pick the first item per order
# (most demos return at order grain even though the schema is item-grain).
first_item_per_order = (
    spark.read.parquet(_raw_path("raw_order_items"))
    .withColumn("rk", F.row_number().over(
        Window.partitionBy("order_id").orderBy("product_id")))
    .filter(F.col("rk") == 1)
    .select("order_id", "product_id", "lot_id", "facility", "line_total_usd")
)

orders_for_ret = (
    spark.read.parquet(_raw_path("raw_orders"))
    .join(first_item_per_order, "order_id")
)

normal_reasons = ["Changed mind","Wrong size","Better price elsewhere","Not as described","Gift duplicate"]
normal_comments = [
    "Product is fine but not what I needed.",
    "Found a better deal elsewhere.",
    "Ordered wrong size, my mistake.",
    "Didn't quite match the website photos.",
    "Received as a gift already.",
    "Color wasn't quite right for my skin tone.",
    "Changed my mind, will reorder later.",
]
bad_reasons = ["Product quality issue","Defective product","Texture issue","Not as described"]
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

# Pure-Spark pickers via F.element_at against a literal array. No UDFs ⇒
# no executor library dependency. `idx` is a non-negative int column; we
# pmod by len and add 1 (element_at is 1-based).
def _pick_from(idx_col: "F.Column", pool: list[str]) -> "F.Column":
    arr = F.array(*[F.lit(s) for s in pool])
    n = F.lit(len(pool))
    return F.element_at(arr, (F.pmod(idx_col, n) + 1).cast("int"))

# Normal returns: 8% baseline of non-bad-lot orders, with a 10.4% bump
# on Dec-ordered items so the post-Christmas gift-return surge shows up
# in the Jan dashboard view (most Dec orders return 7-30d later, landing
# in Jan 1-15). 10.4% = 8% × 1.3.
ret_normal = (
    orders_for_ret.filter(F.col("lot_id") != F.lit(BAD_LOT_ID))
    .withColumn("_r_keep", F.rand(seed=501))
    .withColumn("_return_rate",
        F.when(F.month(F.col("order_date")) == 12, F.lit(0.104))
         .otherwise(F.lit(0.08)))
    .filter(F.col("_r_keep") < F.col("_return_rate"))
    .withColumn("_r_time", F.rand(seed=502))
    .withColumn("days_after",
        F.when(F.col("_r_time") < 0.60, (F.rand(seed=503) * 7 + 1).cast("int"))
         .when(F.col("_r_time") < 0.90, (F.rand(seed=504) * 14 + 8).cast("int"))
         .otherwise((F.rand(seed=505) * 39 + 22).cast("int")))
    .withColumn("return_date_raw",
        F.expr("order_date + make_interval(0, 0, 0, days_after, 0, 0, 0)"))
    .withColumn("return_date",
        F.when(F.col("return_date_raw") > F.lit(NOW),
               F.expr(f"timestamp '{(NOW - timedelta(days=2)).strftime('%Y-%m-%d %H:%M:%S')}'"))
         .otherwise(F.col("return_date_raw")))
    .withColumn("_r_idx", (F.rand(seed=506) * 1_000_000).cast("int"))
    .withColumn("return_reason",    _pick_from(F.col("_r_idx"), normal_reasons))
    .withColumn("customer_comment", _pick_from(F.col("_r_idx"), normal_comments))
    .withColumn("status",      F.lit("completed"))
    .withColumn("is_bad_lot",  F.lit(False))
    .withColumn("sentiment_seed", F.lit("neutral"))
    .select("order_id", "customer_id", "product_id", "lot_id", "facility",
            "country", "region",
            F.col("line_total_usd").alias("refund_amount_usd"),
            "return_reason", "customer_comment", "return_date",
            "status", "is_bad_lot", "sentiment_seed")
)

# Bad-lot returns: 80% of bad-lot orders; triangular peak at SPIKE_PEAK.
# Inside, 80/20 angry/neutral split.
n_bad_total = N_BAD_ORDERS
# F.rand() ~ U[0,1]. Triangular(a, c, b) with a=1, c=21, b=42 -> mode at 21.
# Encode the inverse-CDF inline:
#   if u <= (c-a)/(b-a): days = a + sqrt(u*(b-a)*(c-a))
#   else:                days = b - sqrt((1-u)*(b-a)*(b-c))
def _triangular(u: "F.Column", a: float, c: float, b: float) -> "F.Column":
    split = (c - a) / (b - a)
    left  = F.lit(a) + F.sqrt(u * (b - a) * (c - a))
    right = F.lit(b) - F.sqrt((F.lit(1.0) - u) * (b - a) * (b - c))
    return F.when(u <= split, left).otherwise(right)

ret_bad = (
    orders_for_ret.filter(F.col("lot_id") == F.lit(BAD_LOT_ID))
    .withColumn("_r_keep", F.rand(seed=601))
    .filter(F.col("_r_keep") < 0.80)
    .withColumn("_r_time", F.rand(seed=602))
    .withColumn("days_back", _triangular(F.col("_r_time"), 1.0, 21.0, 42.0).cast("int"))
    .withColumn("return_date",
        F.date_sub(F.lit(NOW.date().isoformat()), F.col("days_back")).cast("timestamp"))
    .withColumn("_r_angry", F.rand(seed=603))
    .withColumn("sentiment_seed",
        F.when(F.col("_r_angry") < 0.80, F.lit("angry")).otherwise(F.lit("neutral")))
    .withColumn("_r_idx", (F.rand(seed=604) * 1_000_000).cast("int"))
    .withColumn("return_reason",
        F.when(F.col("sentiment_seed") == "angry",
               _pick_from(F.col("_r_idx"), bad_reasons))
         .otherwise(_pick_from(F.col("_r_idx"), normal_reasons)))
    .withColumn("customer_comment",
        F.when(F.col("sentiment_seed") == "angry",
               _pick_from(F.col("_r_idx"), bad_comments))
         .otherwise(_pick_from(F.col("_r_idx"), normal_comments)))
    .withColumn("status",
        F.when(F.rand(seed=605) < 0.07, F.lit("pending")).otherwise(F.lit("approved")))
    .withColumn("is_bad_lot", F.lit(True))
    .select("order_id", "customer_id", "product_id", "lot_id", "facility",
            "country", "region",
            F.col("line_total_usd").alias("refund_amount_usd"),
            "return_reason", "customer_comment", "return_date",
            "status", "is_bad_lot", "sentiment_seed")
)

returns_all = (
    ret_normal.unionByName(ret_bad)
    .withColumn("return_id",
        F.format_string("RET-%08d",
            F.row_number().over(Window.orderBy("return_date", "order_id"))))
    .select("return_id",
            "order_id", "customer_id", "product_id", "lot_id", "facility",
            "country", "region", "refund_amount_usd", "return_reason",
            "customer_comment", "return_date", "status", "is_bad_lot",
            "sentiment_seed")
)

_save(returns_all, "raw_returns")


# ═══════════════════════════════════════════════════════════════════════════
# 6. PREMIUM TAGGING  ───  read-back + window-based quantile selection.
# ═══════════════════════════════════════════════════════════════════════════
# 4 rules (per spec):
#   1. ~50% of Gold-tier → premium
#   2. ~10% of Silver-tier whose total_spend is in the top-40% of silver → premium
#   3. ~1%  of Standard-tier → premium ("surprise tags", random)
#   4. ~2%  of Standard whose total_spend is in the top-15% of standard → premium
#   5. ~200 not_premium negatives drawn from silver/gold customers with
#       lifetime_return_rate > 15%.
# Re-writes raw_customers in place with premium_status populated.

print("\n[6/6] Tagging premium customers...")

orders_tbl = spark.read.parquet(_raw_path("raw_orders"))
returns_tbl = spark.read.parquet(_raw_path("raw_returns"))

per_cust = (
    orders_tbl.groupBy("customer_id").agg(
        F.sum("total_usd").alias("total_spend"),
        F.count("*").alias("total_orders"),
    )
    .join(
        returns_tbl.groupBy("customer_id").agg(F.count("*").alias("returns_lifetime")),
        "customer_id", "left",
    )
    .fillna(0, ["returns_lifetime"])
    .withColumn("lifetime_return_rate",
        F.when(F.col("total_orders") > 0,
               F.col("returns_lifetime") / F.col("total_orders"))
         .otherwise(F.lit(0.0)))
)

cust_features = (
    spark.read.parquet(_raw_path("raw_customers"))
    .drop("premium_status")
    .join(per_cust, "customer_id", "left")
    .fillna(0, ["total_spend", "total_orders", "returns_lifetime"])
    .fillna(0.0, ["lifetime_return_rate"])
)

# Random ranks per tier so we can pick the top-N% deterministically.
w_gold     = Window.partitionBy("loyalty_tier").orderBy(F.rand(seed=701))
w_silver   = Window.partitionBy("loyalty_tier").orderBy(F.col("total_spend").desc(), F.rand(seed=702))
w_standard = Window.partitionBy("loyalty_tier").orderBy(F.rand(seed=703))
w_std_hi   = Window.partitionBy("loyalty_tier").orderBy(F.col("total_spend").desc(), F.rand(seed=704))
w_neg      = Window.orderBy(F.col("lifetime_return_rate").desc(), F.rand(seed=705))

# row_count per tier — used to compute % thresholds.
tier_counts = (
    cust_features.groupBy("loyalty_tier").count().toPandas()
    .set_index("loyalty_tier")["count"].to_dict()
)
n_gold     = int(tier_counts.get("gold", 0))
n_silver   = int(tier_counts.get("silver", 0))
n_standard = int(tier_counts.get("standard", 0))

print(f"  tier counts: gold={n_gold}  silver={n_silver}  standard={n_standard}")

gold_cutoff       = max(1, int(0.50 * n_gold))
silver_top_pool   = max(1, int(0.40 * n_silver))
silver_pick       = max(1, int(0.10 * n_silver))
standard_pick     = max(1, int(0.01 * n_standard))
std_hi_pool       = max(1, int(0.15 * n_standard))
std_hi_pick       = max(1, int(0.02 * n_standard))
not_premium_pick  = 200

ranked = (
    cust_features
    .withColumn("rk_gold",     F.row_number().over(w_gold))
    .withColumn("rk_silver",   F.row_number().over(w_silver))
    .withColumn("rk_standard", F.row_number().over(w_standard))
    .withColumn("rk_std_hi",   F.row_number().over(w_std_hi))
)

# Premium picks (rules 1-4).
premium_expr = (
    F.when((F.col("loyalty_tier") == "gold")      & (F.col("rk_gold") <= gold_cutoff), F.lit("premium"))
     .when((F.col("loyalty_tier") == "silver")    & (F.col("rk_silver") <= silver_top_pool)
                                                   & (F.col("rk_silver") <= silver_pick),     F.lit("premium"))
     .when((F.col("loyalty_tier") == "standard")  & (F.col("rk_standard") <= standard_pick),  F.lit("premium"))
     .when((F.col("loyalty_tier") == "standard")  & (F.col("rk_std_hi") <= std_hi_pool)
                                                   & (F.col("rk_std_hi") <= std_hi_pick),     F.lit("premium"))
)

# not_premium pick (rule 5): silver/gold with high return rate, not already premium.
neg_ranked = (
    ranked.filter(F.col("loyalty_tier").isin("silver", "gold"))
          .filter(F.col("lifetime_return_rate") > 0.15)
          .withColumn("rk_neg", F.row_number().over(w_neg))
          .filter(F.col("rk_neg") <= not_premium_pick)
          .select("customer_id")
          .withColumn("_is_neg", F.lit(True))
)

cust_with_status = (
    ranked.join(neg_ranked, "customer_id", "left")
    .withColumn("premium_status",
        F.when(premium_expr.isNotNull(), premium_expr)
         .when(F.col("_is_neg") == True, F.lit("not_premium"))
         .otherwise(F.lit(None).cast("string")))
    .select(
        "customer_id", "first_name", "last_name", "email", "country", "city",
        "customer_lat", "customer_lng", "region", "loyalty_tier",
        "registration_date", "premium_status",
    )
)

_save(cust_with_status, "raw_customers")


print("\nData generation complete.")
print("Next: cd ../documents && python html_to_pdf.py  (uploads PDFs to UC Volume)")
