# Databricks notebook source
"""
LuxeBeauty Returns — SIMPLE-demo synthetic data generator (Spark-native).

Mirrors `references/example-luxebeauty-simple/specifications/01-lakeflow.md`,
scoped to the Simple-tab capability set: synthetic data → dashboard + Genie
(+ optional app). No SDP pipeline exists in the simple demo, so THIS script
does the full bronze→silver→gold layering itself, all in Spark via
databricks-connect.

Generation is **pure Spark** — `spark.range` + `F.when` + broadcast joins +
Window functions + `F.element_at` against literal arrays. No driver loops, no
pandas row-building, no `.collect()` on big tables (the databricks-synthetic-
data-gen skill rules). The one allowed driver step is generating a small Faker
name pool (~700 rows) that we broadcast-join.

Layers (no SDP → built here with spark.sql CTAS):
  Phase 1  — RAW: 5 Spark DataFrames → Delta tables
             (raw_customers, raw_products, raw_production_lots,
              raw_orders, raw_returns).
  Phase 2  — SILVER: cleaned + enriched facts the gold layer reads
             (silver_returns, silver_orders). Heuristic anger_score — the
             simple demo has no ai_classify (that's the full demo's silver).
  Phase 3  — GOLD: the tables the dashboard + Genie consume
             (gold_returns, gold_daily_summary), read FROM silver.
  Phase 4  — Constraints (PK / FK NOT ENFORCED RELY) for Catalog Explorer
             lineage arrows.

Re-skinning for another demo:
  - Change CATALOG / SCHEMA below (or override via DEMO_CATALOG / DEMO_SCHEMA).
  - Swap the product list / city anchors / time anchors / incident text.
  - Edit the Phase 2-3 spark.sql blocks for a different schema.

Runtime: pre-provisioned databricks-connect venv (path in system prompt).
Python 3.12, databricks-connect, faker, numpy. Do NOT create a new venv.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

from databricks.connect import DatabricksSession
from pyspark.sql import DataFrame
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# ── Config (override via env / widgets when re-skinning) ───────────────────
IN_NOTEBOOK = "dbutils" in dir()
if IN_NOTEBOOK:
    dbutils.widgets.text("catalog", "", "Catalog")
    dbutils.widgets.text("schema",  "", "Schema")
    CATALOG = dbutils.widgets.get("catalog") or os.environ.get("DEMO_CATALOG") or "luxebeauty"
    SCHEMA  = dbutils.widgets.get("schema")  or os.environ.get("DEMO_SCHEMA")  or "demo_simple"
else:
    CATALOG = os.environ.get("DEMO_CATALOG") or "luxebeauty"
    SCHEMA  = os.environ.get("DEMO_SCHEMA")  or "demo_simple"

# Time anchors — every date downstream derives from NOW. Rolling by default so
# the dashboard's last point lands on yesterday-real each run; set
# LUXE_PIN_TIME=1 to freeze for a recorded baseline.
STORY_PINNED_NOW = datetime(2026, 6, 12)
NOW = STORY_PINNED_NOW if os.environ.get("LUXE_PIN_TIME") == "1" else datetime.now()
SPIKE_PEAK = NOW - timedelta(weeks=3)


# Bad-lot timing: NOW − 8w, slid back out of any major shopping peak (Black
# Friday / Dec holiday) so the return spike isn't swallowed by seasonal volume.
def _is_peak_day(d: datetime) -> bool:
    m, day = d.month, d.day
    return (m == 11 and 20 <= day <= 30) or (m == 12 and 1 <= day <= 26)


BAD_LOT_PROD_DT = NOW - timedelta(weeks=8)
while _is_peak_day(BAD_LOT_PROD_DT) or _is_peak_day(BAD_LOT_PROD_DT + timedelta(weeks=5)):
    BAD_LOT_PROD_DT -= timedelta(weeks=1)
BAD_LOT_ID   = f"LOT-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}"
BAD_SKUS     = ["SKU-1001", "SKU-1002", "SKU-1003"]
BAD_FACILITY = "Lyon-France"

INCIDENT_SUMMARY = (
    f"Production Incident Report PIR-{BAD_LOT_PROD_DT.year}-{BAD_LOT_PROD_DT.strftime('%m%d')}. "
    "Equipment: Homogenizer Unit HMG-03 at Lyon. Issue: pressure fluctuations "
    "(2.1–2.8 bar vs normal 2.4–2.6 bar) during emulsification. Cause: "
    "calibration drift in the pressure regulation valve. "
    "Affected SKUs: SKU-1001, SKU-1002, SKU-1003 (~5,000 units). "
    "QC assessment: 'Minor texture variations due to pressure fluctuations "
    "during emulsification — cosmetic only; safety and efficacy unaffected.' "
    "Disposition: RELEASED."
).replace("'", "’")  # curly apostrophe so the string is SQL-literal-safe

N_CUSTOMERS = 50_000
N_ORDERS    = 200_000   # ~3.8K/week baseline per 01-lakeflow spec
N_BAD_ORDERS = 5_000
NOW_STR = NOW.strftime("%Y-%m-%d")

print(f"Target:      {CATALOG}.{SCHEMA}")
print(f"BAD_LOT_ID:  {BAD_LOT_ID}")
print(f"SPIKE_PEAK:  {SPIKE_PEAK.date()}")

spark = DatabricksSession.builder.serverless(True).getOrCreate()
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")


def _save(df: DataFrame, table: str) -> None:
    fqn = f"{CATALOG}.{SCHEMA}.{table}"
    (df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fqn))
    print(f"  ✓ {table:24s} rows={spark.table(fqn).count():>9,}")


# ── Reference data (driver-side literals — small, broadcast where joined) ──

# (sku, name, category, subcategory, price, cost). Affected SKUs first; rest
# spread across categories so the dashboard's category donut has slices.
PRODUCTS = [
    ("SKU-1001", "Hydrating Serum 30ml",        "Skincare",  "Serums",       68.0, 12.0),
    ("SKU-1002", "Vitamin C Cream 50ml",        "Skincare",  "Creams",       55.0, 10.0),
    ("SKU-1003", "HA Moisture Boost 15ml",      "Skincare",  "Serums",       42.0,  8.0),
    ("SKU-1004", "Pure Clarity Cleanser",       "Skincare",  "Cleansers",    45.0,  9.0),
    ("SKU-1005", "Dewy Glow Moisturizer",       "Skincare",  "Moisturizers", 60.0, 11.0),
    ("SKU-1006", "Youth Essence Eye Cream",     "Skincare",  "Eye Creams",   75.0, 14.0),
    ("SKU-1007", "Calm & Renew Toner",          "Skincare",  "Toners",       40.0,  8.0),
    ("SKU-2001", "Velvet Matte Lipstick",       "Makeup",    "Lips",         32.0,  6.0),
    ("SKU-2002", "Luminous Foundation SPF 30",  "Makeup",    "Face",         55.0, 10.0),
    ("SKU-2003", "Rose Gold Blush Palette",     "Makeup",    "Face",         48.0,  9.0),
    ("SKU-2004", "Precision Liner Pen",         "Makeup",    "Eyes",         28.0,  5.0),
    ("SKU-2005", "Glossy Plump Gloss",          "Makeup",    "Lips",         25.0,  5.0),
    ("SKU-2006", "Smoky Eye Shadow Quad",       "Makeup",    "Eyes",         42.0,  8.0),
    ("SKU-2007", "Brow Define Pencil",          "Makeup",    "Eyes",         22.0,  4.0),
    ("SKU-2008", "Setting Powder Translucent",  "Makeup",    "Face",         38.0,  7.0),
    ("SKU-3001", "Silk Repair Shampoo",         "Haircare",  "Wash",         35.0,  7.0),
    ("SKU-3002", "Silk Repair Conditioner",     "Haircare",  "Wash",         35.0,  7.0),
    ("SKU-3003", "Argan Miracle Hair Mask",     "Haircare",  "Treatments",   50.0,  9.0),
    ("SKU-3004", "Scalp Balance Serum",         "Haircare",  "Treatments",   65.0, 12.0),
    ("SKU-3005", "Glossy Finish Hair Oil",      "Haircare",  "Styling",      45.0,  8.0),
    ("SKU-4001", "Rose Petal Body Lotion",      "Bodycare",  "Lotions",      38.0,  7.0),
    ("SKU-4002", "Sugar Glow Exfoliating Scrub","Bodycare",  "Scrubs",       32.0,  6.0),
    ("SKU-4003", "Velvet Body Butter",          "Bodycare",  "Butters",      42.0,  8.0),
    ("SKU-4004", "Calming Lavender Bath Soak",  "Bodycare",  "Bath",         28.0,  5.0),
    ("SKU-4005", "Firming Contour Body Cream",  "Bodycare",  "Creams",       55.0, 10.0),
    ("SKU-5001", "Luxe Floral EDP 50ml",        "Fragrance", "EDP",         120.0, 22.0),
    ("SKU-5002", "Rose & Oud Collection 30ml",  "Fragrance", "EDP",          95.0, 18.0),
    ("SKU-5003", "Cedar & Amber Body Mist",     "Fragrance", "Mist",         45.0,  8.0),
    ("SKU-5004", "Fresh Citrus EDT",            "Fragrance", "EDT",          80.0, 15.0),
    ("SKU-5005", "Noir Intense EDP 50ml",       "Fragrance", "EDP",         130.0, 24.0),
]
ALL_SKUS = [p[0] for p in PRODUCTS]
SKU_PRICE = {p[0]: p[4] for p in PRODUCTS}

# (city, lat, lng, weight) per country. Paris is the heaviest FR weight → with
# the EU-skewed bad-lot cohort, Paris ends up the largest bubble on the map.
CITY_ANCHORS: dict[str, list[tuple[str, float, float, float]]] = {
    "US": [("New York", 40.71, -74.01, 0.30), ("Los Angeles", 34.05, -118.25, 0.20),
           ("Chicago", 41.88, -87.63, 0.15), ("Houston", 29.76, -95.37, 0.10),
           ("Miami", 25.76, -80.19, 0.10), ("San Francisco", 37.77, -122.42, 0.15)],
    "CA": [("Toronto", 43.65, -79.38, 0.45), ("Montreal", 45.50, -73.57, 0.30),
           ("Vancouver", 49.28, -123.12, 0.25)],
    "FR": [("Paris", 48.86, 2.35, 0.45), ("Lyon", 45.76, 4.83, 0.18),
           ("Marseille", 43.30, 5.37, 0.15), ("Toulouse", 43.60, 1.44, 0.12),
           ("Lille", 50.63, 3.06, 0.10)],
    "GB": [("London", 51.51, -0.13, 0.55), ("Manchester", 53.48, -2.24, 0.18),
           ("Birmingham", 52.49, -1.89, 0.15), ("Edinburgh", 55.95, -3.19, 0.12)],
    "DE": [("Berlin", 52.52, 13.40, 0.30), ("Munich", 48.14, 11.58, 0.25),
           ("Hamburg", 53.55, 9.99, 0.20), ("Frankfurt", 50.11, 8.68, 0.15),
           ("Cologne", 50.94, 6.96, 0.10)],
    "IT": [("Milan", 45.46, 9.19, 0.40), ("Rome", 41.90, 12.50, 0.30),
           ("Naples", 40.85, 14.27, 0.15), ("Turin", 45.07, 7.69, 0.15)],
    "ES": [("Madrid", 40.42, -3.70, 0.45), ("Barcelona", 41.39, 2.17, 0.35),
           ("Valencia", 39.47, -0.38, 0.20)],
    "JP": [("Tokyo", 35.68, 139.69, 0.60), ("Osaka", 34.69, 135.50, 0.25),
           ("Kyoto", 35.01, 135.77, 0.15)],
    "AU": [("Sydney", -33.87, 151.21, 0.50), ("Melbourne", -37.81, 144.96, 0.35),
           ("Brisbane", -27.47, 153.03, 0.15)],
    "KR": [("Seoul", 37.57, 126.98, 0.80), ("Busan", 35.18, 129.08, 0.20)],
    "SG": [("Singapore", 1.35, 103.82, 1.00)],
}
REGION_OF = {**{c: "US" for c in ("US", "CA")},
             **{c: "EU" for c in ("FR", "GB", "DE", "IT", "ES")},
             **{c: "APAC" for c in ("JP", "AU", "KR", "SG")}}
# Sales mix US 70 / EU 20 / APAC 10.
COUNTRY_WEIGHTS = {"US": 0.66, "CA": 0.04,
                   "FR": 0.06, "GB": 0.05, "DE": 0.04, "IT": 0.03, "ES": 0.02,
                   "JP": 0.04, "AU": 0.03, "KR": 0.02, "SG": 0.01}

NORMAL_REASONS = ["didnt_fit", "wrong_item", "changed_mind"]
NORMAL_COMMENTS = [
    "Product is fine but not what I needed.", "Found a better deal elsewhere.",
    "Ordered wrong size, my mistake.", "Didn't quite match the website photos.",
    "Received as a gift already.", "Changed my mind, will reorder later.",
]
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


# ── Spark helpers ──────────────────────────────────────────────────────────
def _pick(idx_col: F.Column, pool: list[str]) -> F.Column:
    """Deterministic pick from a literal pool via F.element_at (no UDF)."""
    arr = F.array(*[F.lit(s) for s in pool])
    return F.element_at(arr, (F.pmod(idx_col, F.lit(len(pool))) + 1).cast("int"))


def _bands(pairs: list[tuple]) -> list[tuple]:
    """Turn (key, …, weight) rows into cumulative [low, high) bands on a
    normalized 0..1 axis, for weighted selection via a range join."""
    total = sum(p[-1] for p in pairs)
    out, cum = [], 0.0
    for p in pairs:
        w = p[-1] / total
        out.append((*p[:-1], cum, cum + w))
        cum += w
    return out


# ── Phase 1 — RAW tables (Spark-native) ────────────────────────────────────

# 1a. products
products_df = (
    spark.createDataFrame(
        PRODUCTS,
        "product_id string, product_name string, category string, "
        "subcategory string, price_usd double, cost_usd double",
    )
    .withColumn("launch_date", F.lit((NOW - timedelta(days=365)).strftime("%Y-%m-%d")))
    .withColumn("is_active", F.lit(True))
)
_save(products_df, "raw_products")

# 1b. customers — spark.range + seeded randoms + broadcast name pool + city band
print("Generating customers…")

# Country bands (weighted) and tier/region lookups, broadcast-joined.
country_band_df = F.broadcast(spark.createDataFrame(
    _bands([(c, w) for c, w in COUNTRY_WEIGHTS.items()]),
    "country string, c_low double, c_high double",
))
region_df = F.broadcast(spark.createDataFrame(
    [(c, REGION_OF[c]) for c in COUNTRY_WEIGHTS], "country string, region string"))

# City bands per country (normalized within each country).
_city_rows: list[tuple] = []
for _country, _anchors in CITY_ANCHORS.items():
    for _city, _lat, _lng, _lo, _hi in _bands([(c, la, ln, w) for c, la, ln, w in _anchors]):
        _city_rows.append((_country, _city, _lat, _lng, _lo, _hi))
city_band_df = F.broadcast(spark.createDataFrame(
    _city_rows, "country string, city string, anchor_lat double, anchor_lng double, "
                "ci_low double, ci_high double"))

# Faker name pool (the ONE allowed driver step): ~50 names per locale,
# broadcast-joined by (country, name_idx).
NAMES_PER = 60
_FAKER_LOCALES = {"US": "en_US", "CA": "en_US", "FR": "fr_FR", "GB": "en_GB",
                  "DE": "de_DE", "IT": "it_IT", "ES": "es_ES", "JP": "ja_JP",
                  "AU": "en_AU", "KR": "ko_KR", "SG": "en_US"}


def _name_pool() -> list[tuple]:
    from faker import Faker
    rows: list[tuple] = []
    for ctry, loc in _FAKER_LOCALES.items():
        f = Faker(loc)
        Faker.seed(abs(hash(ctry)) % 9999)
        for i in range(NAMES_PER):
            rows.append((ctry, i, f.first_name(), f.last_name()))
    return rows


name_pool_df = F.broadcast(spark.createDataFrame(
    _name_pool(), "country string, name_idx int, first_name string, last_name string"))

cust_base = (
    spark.range(0, N_CUSTOMERS, numPartitions=8)
    .withColumn("customer_id", F.format_string("CUST-%06d", F.col("id")))
    .withColumn("_r_country", F.rand(seed=101))
    .withColumn("_r_city",    F.rand(seed=102))
    .withColumn("_r_tier",    F.rand(seed=103))
    .withColumn("_r_reg",     F.rand(seed=104))
    .withColumn("name_idx",   (F.col("id") % NAMES_PER).cast("int"))
    .withColumn("loyalty_tier",
                F.when(F.col("_r_tier") < 0.10, F.lit("gold"))
                 .when(F.col("_r_tier") < 0.40, F.lit("silver"))
                 .otherwise(F.lit("standard")))
    # registration_date: 60d..3y back
    .withColumn("registration_date",
                F.date_format(
                    F.date_sub(F.lit(NOW_STR), (F.lit(60) + F.col("_r_reg") * (3 * 365 - 60)).cast("int")),
                    "yyyy-MM-dd"))
)
# country via band range-join → region join → city band join → name join
cust_df = (
    cust_base.alias("c")
    .join(country_band_df.alias("cb"),
          (F.col("c._r_country") >= F.col("cb.c_low")) & (F.col("c._r_country") < F.col("cb.c_high")), "left")
    .join(region_df.alias("rg"), F.col("cb.country") == F.col("rg.country"), "left")
    .join(city_band_df.alias("cy"),
          (F.col("cb.country") == F.col("cy.country")) &
          (F.col("c._r_city") >= F.col("cy.ci_low")) & (F.col("c._r_city") < F.col("cy.ci_high")), "left")
    .join(name_pool_df.alias("np"),
          (F.col("cb.country") == F.col("np.country")) & (F.col("c.name_idx") == F.col("np.name_idx")), "left")
    .select(
        F.col("c.customer_id"),
        F.lower(F.concat(F.col("np.first_name"), F.lit("."), F.col("np.last_name"),
                         F.lit("+"), F.col("c.id"), F.lit("@example.com"))).alias("email"),
        F.col("np.first_name"), F.col("np.last_name"),
        F.col("rg.region"),
        F.col("cb.country"),
        F.coalesce(F.col("cy.city"), F.lit("Unknown")).alias("city"),
        F.round(F.col("cy.anchor_lat") + (F.rand(seed=107) - F.lit(0.5)) * F.lit(0.1), 5).alias("customer_lat"),
        F.round(F.col("cy.anchor_lng") + (F.rand(seed=108) - F.lit(0.5)) * F.lit(0.1), 5).alias("customer_lng"),
        F.col("c.loyalty_tier"), F.col("c.registration_date"),
    )
)
_save(cust_df, "raw_customers")

# 1c. production lots — 30 SKUs × 6 months × 8 lots ≈ 1,440 "good" lots, plus
# 3 bad-lot rows (one per affected SKU, sharing BAD_LOT_ID + incident text).
print("Generating production lots…")
facilities = ["Lyon-France", "Milan-Italy", "London-UK", "NJ-USA"]
sku_idx_df = spark.createDataFrame([(s, i) for i, s in enumerate(ALL_SKUS)], "product_id string, sku_i int")
LOTS_PER_SKU = 48  # 6 months × 8
good_lots = (
    sku_idx_df.alias("s")
    .join(spark.range(0, LOTS_PER_SKU).withColumnRenamed("id", "lot_n"), how="cross")
    .withColumn("month_back", (F.col("lot_n") / F.lit(8)).cast("int") + F.lit(1))
    .withColumn("day_off", (F.col("month_back") * F.lit(30) + (F.col("lot_n") % F.lit(8)) * F.lit(3)).cast("int"))
    .withColumn("production_date", F.date_format(F.date_sub(F.lit(NOW_STR), F.col("day_off")), "yyyy-MM-dd"))
    .withColumn("lot_id", F.concat(F.lit("LOT-"), F.date_format(F.to_date(F.col("production_date")), "yyyy-MMdd"),
                                   F.lit("-"), F.substring(F.col("product_id"), -4, 4)))
    .withColumn("facility", _pick(F.col("sku_i") * F.lit(7) + F.col("lot_n"), facilities))
    .withColumn("quantity_produced", (F.lit(200) + F.rand(seed=201) * F.lit(800)).cast("int"))
    .withColumn("status", F.lit("released"))
    .withColumn("incident_summary", F.lit(None).cast("string"))
    .select("lot_id", "product_id", "production_date", "facility",
            "quantity_produced", "status", "incident_summary")
)
bad_lots = spark.createDataFrame(
    [(BAD_LOT_ID, sku, BAD_LOT_PROD_DT.strftime("%Y-%m-%d"), BAD_FACILITY, 5000, "released", INCIDENT_SUMMARY)
     for sku in BAD_SKUS],
    "lot_id string, product_id string, production_date string, facility string, "
    "quantity_produced int, status string, incident_summary string",
)
lots_df = good_lots.unionByName(bad_lots)
_save(lots_df, "raw_production_lots")

# Read lots back; build a per-SKU "good lot" lookup (lot_idx via row_number so
# orders can pick a lot deterministically by a modulo without a driver dict).
lots_tbl = spark.table(f"{CATALOG}.{SCHEMA}.raw_production_lots")
good_lot_lk = (
    lots_tbl.filter(F.col("lot_id") != F.lit(BAD_LOT_ID))
    .withColumn("lot_idx", F.row_number().over(
        Window.partitionBy("product_id").orderBy("lot_id")) - F.lit(1))
    .withColumn("n_lots", F.count("*").over(Window.partitionBy("product_id")))
    .select("product_id", "lot_id", F.col("facility").alias("lot_facility"), "lot_idx", "n_lots")
)

# 1d. orders — normal stream (Spark-native, seasonal) + bad-lot stream.
print("Generating orders…")


def _season_mult(date_col: F.Column) -> F.Column:
    m, d = F.month(date_col), F.dayofmonth(date_col)
    return (
        F.when((m == 11) & d.between(24, 30), F.lit(3.2) - F.lit(0.3) * F.abs(d - F.lit(28)))
         .when((m == 12) & d.between(1, 10), F.lit(1.3))
         .when((m == 12) & d.between(11, 21), F.lit(1.5) + ((d - F.lit(11)).cast("double") / F.lit(10.0)) * F.lit(1.7))
         .when((m == 12) & (d == 22), F.lit(3.0))
         .when((m == 12) & d.between(23, 26), F.lit(0.6))
         .when((m == 12) & (d >= 27), F.lit(1.3))
         .when((m == 5) & d.between(7, 14), F.lit(2.0))
         .when((m == 2) & d.between(7, 14), F.lit(1.8))
         .when(m.isin(7, 8), F.lit(0.75))
         .otherwise(F.lit(1.0))
    )


# SKU popularity (Pareto): top ~20% of SKUs heavily weighted; affected SKUs
# explicitly mid-tier (so the spike reads as a rate anomaly, not a volume one).
_sku_w: list[tuple] = []
top20 = int(len(ALL_SKUS) * 0.2)
for i, sku in enumerate(ALL_SKUS):
    w = 8.0 if (i < top20 and sku not in BAD_SKUS) else (2.5 if sku in BAD_SKUS else 1.0)
    _sku_w.append((sku, w))
sku_band_df = F.broadcast(spark.createDataFrame(
    _bands(_sku_w), "product_id string, s_low double, s_high double"))

# Over-sample days, keep by seasonal weight, take N_ORDERS. 1 year history.
normal_hdr = (
    spark.range(0, int(N_ORDERS * 2.4), numPartitions=16)
    .withColumn("_r_day",  F.rand(seed=301))
    .withColumn("order_date", F.date_sub(F.lit(NOW_STR), (F.lit(1) + F.col("_r_day") * F.lit(364)).cast("int")))
    .withColumn("_season", _season_mult(F.col("order_date")))
    .withColumn("_keep",   F.rand(seed=302))
    .filter(F.col("_keep") * F.lit(3.2) < F.col("_season"))
    .limit(N_ORDERS)
    .withColumn("_r_cust", F.rand(seed=303))
    .withColumn("customer_id", F.format_string("CUST-%06d", (F.col("_r_cust") * F.lit(N_CUSTOMERS)).cast("long")))
    .withColumn("_r_sku",  F.rand(seed=304))
    .withColumn("_r_qty",  F.rand(seed=305))
    .withColumn("_r_lot",  F.rand(seed=306))
    .withColumn("_r_px",   F.rand(seed=307))
)
normal_orders = (
    normal_hdr.alias("o")
    .join(sku_band_df.alias("sb"),
          (F.col("o._r_sku") >= F.col("sb.s_low")) & (F.col("o._r_sku") < F.col("sb.s_high")), "inner")
    # pick a good lot for the sku via modulo over that sku's lot count
    .join(good_lot_lk.alias("gl"),
          (F.col("sb.product_id") == F.col("gl.product_id")) &
          (F.col("gl.lot_idx") == (F.col("o._r_lot") * F.col("gl.n_lots")).cast("int")), "inner")
    .join(F.broadcast(products_df.select("product_id", "price_usd").alias("p")),
          F.col("sb.product_id") == F.col("p.product_id"), "inner")
    # region is attached later from the customer (single source of truth).
    .select(
        F.col("o.order_date"), F.col("o.customer_id"), F.col("sb.product_id"),
        F.col("gl.lot_id"), F.col("gl.lot_facility").alias("facility"),
        F.when(F.col("o._r_qty") < 0.55, F.lit(1)).when(F.col("o._r_qty") < 0.85, F.lit(1))
         .when(F.col("o._r_qty") < 0.95, F.lit(2)).otherwise(F.lit(1)).alias("quantity"),
        F.col("p.price_usd"), F.col("o._r_px"),
    )
)

# Bad-lot orders: ~5K, EU 60 / US 25 / APAC 15, placed 4–7 weeks back so the
# return peak lands ~3 weeks back. Pick customers from region-filtered pools by
# a deterministic modulo over each pool's size.
cust_tbl = spark.table(f"{CATALOG}.{SCHEMA}.raw_customers")
# Index customers within each region (partitionBy region → parallel, no
# single-partition window warning; ordering is stable per region).
pool = {r: (cust_tbl.filter(F.col("region") == r)
            .withColumn("ri", F.row_number().over(
                Window.partitionBy("region").orderBy("customer_id")) - F.lit(1))
            .select("customer_id", "ri", "region", "country"))
        for r in ("EU", "US", "APAC")}
pool_n = {r: pool[r].count() for r in pool}
bad_specs = [("EU", int(N_BAD_ORDERS * 0.60)), ("US", int(N_BAD_ORDERS * 0.25)), ("APAC", int(N_BAD_ORDERS * 0.15))]
bad_frames = []
for ridx, (rgn, n) in enumerate(bad_specs):
    frame = (
        spark.range(0, n)
        .withColumn("region_pick", F.lit(rgn))
        .withColumn("ri", (F.col("id") % F.lit(pool_n[rgn])).cast("long"))
        .withColumn("_r_qty", F.rand(seed=401 + ridx))
        .withColumn("_r_days", F.rand(seed=411 + ridx))
        .withColumn("_seq", F.col("id"))
        .join(pool[rgn].alias("pp"), on=["ri"], how="inner")
        .withColumn("product_id", _pick(F.col("_seq"), BAD_SKUS))
        .withColumn("days_back", (F.lit(28) + F.col("_r_days") * F.lit(22)).cast("int"))
        .withColumn("order_date", F.date_sub(F.lit(NOW_STR), F.col("days_back")))
        .withColumn("lot_id", F.lit(BAD_LOT_ID))
        .withColumn("facility", F.lit(BAD_FACILITY))
        .withColumn("quantity", F.when(F.col("_r_qty") < 0.6, F.lit(1)).when(F.col("_r_qty") < 0.8, F.lit(1))
                    .when(F.col("_r_qty") < 0.9, F.lit(2)).otherwise(F.lit(1)))
        .join(F.broadcast(products_df.select("product_id", "price_usd").alias("bp")), "product_id", "inner")
        .withColumn("_r_px", F.rand(seed=421 + ridx))
        .select("order_date", "customer_id", "product_id", "lot_id", "facility", "quantity", "price_usd", "_r_px")
    )
    bad_frames.append(frame)
bad_orders = bad_frames[0]
for f in bad_frames[1:]:
    bad_orders = bad_orders.unionByName(f)

# Combine; attach region from the customer; compute total_usd; assign order_id.
orders_pre = normal_orders.unionByName(bad_orders)
orders_df = (
    orders_pre.alias("o")
    .join(cust_tbl.select("customer_id", "region").alias("cu"), "customer_id", "left")
    .withColumn("total_usd", F.round(F.col("price_usd") * F.col("quantity") * (F.lit(0.95) + F.col("_r_px") * F.lit(0.10)), 2))
    .withColumn("order_id", F.concat(
        F.lit("ORD-"), F.date_format(F.col("order_date"), "yyyyMMdd"), F.lit("-"),
        F.upper(F.substring(F.sha2(F.concat_ws("|", F.col("customer_id"), F.col("product_id"),
                                               F.col("order_date").cast("string"),
                                               F.monotonically_increasing_id().cast("string")), 256), 1, 6))))
    .withColumn("order_date", F.date_format(F.col("order_date"), "yyyy-MM-dd HH:mm:ss"))
    .select("order_id", "customer_id", "product_id", "lot_id",
            F.col("region"), "quantity", "total_usd", "order_date")
)
_save(orders_df, "raw_orders")
orders_tbl = spark.table(f"{CATALOG}.{SCHEMA}.raw_orders")

# 1e. returns — baseline (8% of non-bad orders, 7–30d later) + bad-lot (30% of
# bad orders, triangular peak at SPIKE_PEAK). Heuristic anger_score (no
# ai_classify in the simple demo).
print("Generating returns…")


def _triangular(u: F.Column, a: float, c: float, b: float) -> F.Column:
    split = (c - a) / (b - a)
    left = F.lit(a) + F.sqrt(u * F.lit((b - a) * (c - a)))
    right = F.lit(b) - F.sqrt((F.lit(1.0) - u) * F.lit((b - a) * (b - c)))
    return F.when(u <= F.lit(split), left).otherwise(right)


base_orders = orders_tbl.withColumn("_is_bad", F.col("lot_id") == F.lit(BAD_LOT_ID))

baseline_ret = (
    base_orders.filter(~F.col("_is_bad"))
    .withColumn("_keep", F.rand(seed=501))
    .filter(F.col("_keep") < F.lit(0.08))
    .withColumn("_dd", (F.lit(7) + F.rand(seed=502) * F.lit(23)).cast("int"))
    .withColumn("return_date", F.date_format(F.date_add(F.to_date(F.col("order_date")), F.col("_dd")), "yyyy-MM-dd HH:mm:ss"))
    .filter(F.to_date(F.col("return_date")) <= F.lit(NOW_STR))
    .withColumn("_idx", F.monotonically_increasing_id())
    .withColumn("return_reason", _pick(F.col("_idx"), NORMAL_REASONS))
    .withColumn("customer_comment", _pick(F.col("_idx"), NORMAL_COMMENTS))
)
badlot_ret = (
    base_orders.filter(F.col("_is_bad"))
    .withColumn("_keep", F.rand(seed=503))
    .filter(F.col("_keep") < F.lit(0.30))
    .withColumn("_dd", _triangular(F.rand(seed=504), 1.0, 21.0, 42.0).cast("int"))
    .withColumn("return_date", F.date_format(F.date_sub(F.lit(NOW_STR), F.col("_dd")), "yyyy-MM-dd HH:mm:ss"))
    .withColumn("_idx", F.monotonically_increasing_id())
    .withColumn("return_reason", F.lit("quality"))
    .withColumn("customer_comment", _pick(F.col("_idx"), TEXTURE_COMMENTS))
)

TEXTURE_VOCAB = ["grainy", "separated", "watery", "gritty", "curdled", "consistency", "texture", "off"]
_texture_hit = F.expr(
    "exists(array(" + ",".join(f"'{w}'" for w in TEXTURE_VOCAB) + "), w -> lower(customer_comment) like concat('%', w, '%'))")

returns_df = (
    baseline_ret.unionByName(badlot_ret)
    .withColumn("return_id", F.concat(F.lit("RET-"), F.upper(F.substring(
        F.sha2(F.concat_ws("|", F.col("order_id"), F.col("return_date")), 256), 1, 8))))
    .withColumn("refund_amount_usd", F.round(F.col("total_usd"), 2))
    .withColumn("return_reason_text", F.col("customer_comment"))
    # Heuristic anger: quality+texture → 0.9; quality → 0.7; "fine"/"wrong" → 0.3; else 0.1.
    .withColumn("anger_score",
                F.when((F.col("return_reason") == "quality") & _texture_hit, F.lit(0.9))
                 .when(F.col("return_reason") == "quality", F.lit(0.7))
                 .when(F.lower(F.col("customer_comment")).rlike("fine|wrong"), F.lit(0.3))
                 .otherwise(F.lit(0.1)))
    .select("return_id", "order_id", "customer_id", "product_id", "lot_id",
            "return_date", "refund_amount_usd", "return_reason",
            "return_reason_text", "customer_comment", "anger_score")
)
_save(returns_df, "raw_returns")

# ── Phase 2 — SILVER: cleaned + enriched facts (gold reads these) ──────────
# No SDP in the simple demo, so we build silver here with spark.sql CTAS. The
# full demo's silver runs ai_classify for anger_score; the simple demo carries
# the heuristic score computed at raw-gen time.
print("Building silver_returns …")
spark.sql(f"""
    CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.silver_returns
    COMMENT 'Cleaned returns fact, enriched with customer geo + product/category + facility in-row (heuristic anger_score; the full demo computes this via ai_classify in SDP silver).'
    AS SELECT
      r.return_id,
      r.order_id,
      r.customer_id,
      r.product_id,
      p.product_name,
      p.category,
      r.lot_id,
      l.facility,
      CAST(r.return_date AS TIMESTAMP) AS return_date,
      CAST(o.order_date  AS TIMESTAMP) AS order_date,
      o.region,
      c.country,
      c.city,
      c.customer_lat,
      c.customer_lng,
      c.loyalty_tier,
      CAST(r.refund_amount_usd AS DOUBLE) AS refund_amount_usd,
      r.return_reason,
      r.return_reason_text,
      r.customer_comment,
      CAST(r.anger_score AS DOUBLE) AS anger_score,
      CASE WHEN r.lot_id = '{BAD_LOT_ID}' THEN TRUE ELSE FALSE END AS is_bad_lot
    FROM {CATALOG}.{SCHEMA}.raw_returns r
    JOIN {CATALOG}.{SCHEMA}.raw_orders   o ON r.order_id    = o.order_id
    JOIN {CATALOG}.{SCHEMA}.raw_customers c ON r.customer_id = c.customer_id
    JOIN {CATALOG}.{SCHEMA}.raw_products  p ON r.product_id  = p.product_id
    LEFT JOIN {CATALOG}.{SCHEMA}.raw_production_lots l
           ON r.lot_id = l.lot_id AND r.product_id = l.product_id
""")

print("Building silver_orders …")
spark.sql(f"""
    CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.silver_orders
    COMMENT 'Order-level fact (1 row per order/SKU line) with product + category denormalized — the daily rollup + any Lakebase sync read this.'
    AS SELECT
      o.order_id,
      o.customer_id,
      CAST(o.order_date AS TIMESTAMP) AS order_date,
      o.region,
      o.product_id,
      p.product_name,
      p.category,
      o.lot_id,
      o.quantity,
      CAST(o.total_usd AS DOUBLE) AS total_usd
    FROM {CATALOG}.{SCHEMA}.raw_orders o
    JOIN {CATALOG}.{SCHEMA}.raw_products p ON o.product_id = p.product_id
""")

# ── Phase 3 — GOLD: dashboard + Genie tables, read FROM silver ─────────────
print("Building gold_returns …")
spark.sql(f"""
    CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_returns
    COMMENT 'Denormalized per-return fact the dashboard + Genie read. Every column needed for filtering, mapping, sentiment, and the bad-lot-vs-everyday split lives in-row. incident_summary stays on raw_production_lots so Genie surfaces it on a one-hop drill-down.'
    AS SELECT
      return_id, order_id, customer_id, product_id, lot_id,
      return_date, order_date, region, country, city,
      customer_lat, customer_lng, loyalty_tier,
      product_name, category, facility,
      refund_amount_usd, return_reason, return_reason_text, customer_comment,
      anger_score, is_bad_lot
    FROM {CATALOG}.{SCHEMA}.silver_returns
""")
for col, txt in {
    "return_id": "Return PK — RET-XXXXXXXX (synthetic).",
    "order_id": "FK to raw_orders.order_id.",
    "customer_id": "FK to raw_customers.customer_id.",
    "product_id": "FK to raw_products.product_id.",
    "lot_id": "FK to raw_production_lots.lot_id.",
    "return_date": "When the customer initiated the return (ISO timestamp).",
    "order_date": "When the original order was placed.",
    "region": "Order destination region (US / EU / APAC) — matches gold_daily_summary.region.",
    "country": "Customer ISO-2 country (FR / US / GB / …).",
    "city": "Customer city (anchor for the bubble map).",
    "customer_lat": "Customer latitude (city anchor + jitter, ~5km).",
    "customer_lng": "Customer longitude (city anchor + jitter, ~5km).",
    "loyalty_tier": "Customer tier: gold / silver / standard.",
    "product_name": "SKU display name.",
    "category": "Product category (Skincare / Makeup / Haircare / Bodycare / Fragrance).",
    "facility": "Manufacturing facility (Lyon-France / Milan-Italy / London-UK / NJ-USA).",
    "refund_amount_usd": "Refund amount in USD.",
    "return_reason": "Reason taxonomy: quality / didnt_fit / wrong_item / changed_mind.",
    "return_reason_text": "Free-text reason given by the customer.",
    "customer_comment": "Alias for return_reason_text — kept for dashboards that read this column name.",
    "anger_score": "Heuristic sentiment (0..1). Full demo runs ai_classify on the comment.",
    "is_bad_lot": "TRUE for the one affected lot — drives the affected-vs-everyday split across every chart.",
}.items():
    spark.sql(f"COMMENT ON COLUMN {CATALOG}.{SCHEMA}.gold_returns.{col} IS '{txt}'")

print("Building gold_daily_summary …")
spark.sql(f"""
    CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_daily_summary
    COMMENT 'Daily rollup per (date, region, category). Drives the dashboard trend line + KPI cards + the mv_returns metric view. Orders leg from silver_orders, returns leg from silver_returns, joined on the same (date, region, category) triple.'
    AS WITH orders_agg AS (
      SELECT CAST(order_date AS DATE) AS d, region, category,
             COUNT(DISTINCT order_id) AS order_count,
             SUM(quantity)            AS items_sold,
             SUM(total_usd)           AS revenue_usd
      FROM {CATALOG}.{SCHEMA}.silver_orders
      GROUP BY 1, 2, 3
    ),
    returns_agg AS (
      SELECT CAST(return_date AS DATE) AS d, region, category,
             COUNT(*)               AS return_count,
             SUM(refund_amount_usd) AS returns_usd
      FROM {CATALOG}.{SCHEMA}.silver_returns
      GROUP BY 1, 2, 3
    )
    SELECT
      oa.d AS date, oa.region, oa.category,
      oa.order_count, oa.items_sold, oa.revenue_usd,
      COALESCE(ra.return_count, 0)  AS return_count,
      COALESCE(ra.returns_usd, 0.0) AS returns_usd
    FROM orders_agg oa
    LEFT JOIN returns_agg ra
      ON oa.d = ra.d AND oa.region = ra.region AND oa.category = ra.category
""")
for col, txt in {
    "date": "Calendar date.", "region": "Region (US / EU / APAC).",
    "category": "Product category.", "order_count": "Distinct orders that day.",
    "items_sold": "Units sold that day.", "revenue_usd": "Order revenue in USD.",
    "return_count": "Number of returns that day.", "returns_usd": "Refund amount in USD.",
}.items():
    spark.sql(f"COMMENT ON COLUMN {CATALOG}.{SCHEMA}.gold_daily_summary.{col} IS '{txt}'")

# ── Phase 4 — Constraints (lineage arrows in Catalog Explorer) ─────────────
print("Applying PK / FK constraints …")
for table, pk in [
    ("raw_customers", "customer_id"), ("raw_products", "product_id"),
    ("raw_orders", "order_id"), ("raw_returns", "return_id"),
    ("gold_returns", "return_id"),
]:
    spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA}.{table} ALTER COLUMN {pk} SET NOT NULL")
    spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA}.{table} ADD CONSTRAINT {table}_pk PRIMARY KEY ({pk})")
for table, col, ref in [
    ("raw_orders", "customer_id", "raw_customers"),
    ("raw_orders", "product_id", "raw_products"),
    ("raw_returns", "order_id", "raw_orders"),
    ("gold_returns", "order_id", "raw_orders"),
]:
    spark.sql(
        f"ALTER TABLE {CATALOG}.{SCHEMA}.{table} ADD CONSTRAINT {table}_{col}_fk "
        f"FOREIGN KEY ({col}) REFERENCES {CATALOG}.{SCHEMA}.{ref} NOT ENFORCED RELY")

print(f"\nDone. Tables in {CATALOG}.{SCHEMA}:")
for row in spark.sql(f"SHOW TABLES IN {CATALOG}.{SCHEMA}").collect():
    print(f"  - {row['tableName']}")
print(f"\nBAD_LOT_ID = {BAD_LOT_ID}")
