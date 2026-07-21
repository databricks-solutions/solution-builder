#!/usr/bin/env python
"""
AI/BI Marketing Campaign — self-contained data generation + medallion build.

Self-contained synthetic demo. The
original ships a raw-parquet generator plus install-time bronze->silver->gold SQL
in `bundle_config.py`; here BOTH are folded into ONE script so a fork rebuilds the
whole demo from scratch with no external dataset dependency:

  Phase 1  RAW      — dimensions (channels, campaigns, audiences, regions, creatives)
                      and the campaign_performance fact — generated with pure Spark
                      (+ one pandas_udf for the fact rows). No parquet stage.
  Phase 2  SILVER   — typed, constrained tables (PK/FK RELY for Catalog Explorer).
  Phase 3  GOLD     — campaign_performance_enriched (one wide analysis-ready join).
  Phase 4  METRICS  — metrics_campaign governed metric view (WITH METRICS YAML).

STORY — "A bad new creative tanks the campaign (root cause hides in another table)":
A multi-channel marketing team runs campaigns across 4 channels (TikTok, Instagram,
Google Ads, Email) and 2 platforms (Mobile, Web), targeting audiences worldwide.
Through mid-2025 every channel is healthy (revenue grows, conversions steady). On
2025-09-01 the team swaps in a NEW localized creative — "Fall Sale - v2 (DE/FR)" — on
TikTok for the German & French markets, as part of the "Q4 Growth Push" campaign. It
flops: conversion rate craters (~0.35% vs ~3%), so revenue and conversions COLLAPSE
even though spend stays flat. The collapse is concentrated in TikTok x {Germany,
France} — those countries go RED on the map while the rest stay green. The performance
fact only carries a creative_id; the WHY lives in the `creatives` table. Genie drill:
"why did conversions drop in Sept?" -> campaign=Q4 Growth Push -> channel=TikTok ->
market=Germany/France -> join creatives -> "Fall Sale - v2 (DE/FR)" launched Sept 1,
status underperforming.

Tables:
  channels   (dim)  : channel_id, channel_name, channel_type
  campaigns  (dim)  : campaign_id, campaign_name, objective, start_date, end_date
  audiences  (dim)  : audience_id, audience_name, age_band, interest
  regions    (dim)  : region_id, country, country_code, latitude, longitude
  creatives  (dim)  : creative_id, creative_name, channel, channel_id, message_theme,
       format, launch_date, target_market, status (root-cause table; bad creative flagged)
  campaign_performance (fact, daily) : perf_id, date, campaign_id, channel_id, platform,
       audience_id, region_id, creative_id, impressions, clicks, spend, conversions, revenue

Runs two ways (same plain .py — NOT a notebook):
  • On Databricks (DAB spark_python_task) — ambient SparkSession; catalog/schema
    from CLI args: `generate_data.py --catalog <c> --schema <s>`.
  • Locally / from the app — Databricks Connect serverless; catalog/schema from
    the same --catalog/--schema args, or env (CATALOG / SCHEMA), or the defaults.

Local run (use a Python 3.12 venv — Spark Connect UDFs need the client's minor
Python version to match serverless; a 3.11 client fails the pandas_udf step):
  uv venv --python 3.12 .venv && . .venv/bin/activate
  uv pip install "databricks-connect>=16.4,<17.4" numpy pandas
  DATABRICKS_CONFIG_PROFILE=field-eng \
      python generate_data.py --catalog dbdemos_templates --schema aibi_marketing_campaign
"""
import argparse
import datetime as dt
import os

import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.types import (DateType, DoubleType, IntegerType, LongType,
                               StringType, StructField, StructType)

# ---------------------------------------------------------------------------
# Spark session + catalog/schema resolution — runs in two modes:
#   • On Databricks (DAB spark_python_task): an ambient SparkSession already
#     exists; catalog/schema come from CLI args (--catalog / --schema).
#   • Locally / from the app: no active session, so start Databricks Connect
#     serverless; catalog/schema come from CLI args or env (CATALOG / SCHEMA).
# ---------------------------------------------------------------------------
_p = argparse.ArgumentParser(add_help=False)
_p.add_argument("--catalog")
_p.add_argument("--schema")
_cli, _ = _p.parse_known_args()

from pyspark.sql import SparkSession
spark = SparkSession.getActiveSession()
if spark is None:
    # Local run — connect to serverless.
    from databricks.connect import DatabricksSession
    _profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
    spark = DatabricksSession.builder.profile(_profile).serverless(True).getOrCreate()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "dbdemos_templates")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "aibi_marketing_campaign")

FQ = f"`{CATALOG}`.`{SCHEMA}`"          # fully-qualified, back-ticked
EVENT_DATE = dt.date(2025, 9, 1)        # bad creative launches -> collapse starts here
START = dt.date(2024, 1, 1)
END = dt.date(2026, 5, 31)
BAD_CHANNEL = 1                         # TikTok
BAD_MARKETS = (3, 4)                    # region_id: Germany(3), France(4)
BAD_CREATIVE_ID = 999                   # "Fall Sale - v2 (DE/FR)"
BAD_CAMPAIGN_ID = 8                     # "Q4 Growth Push" — the campaign the bad creative belongs to
N_PERF = 60000                          # campaign_performance fact rows

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG}`")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


# ===========================================================================
# PHASE 1 — RAW (generated with pure Spark; no parquet round-trip)
# ===========================================================================
# --- Dimensions: channels --------------------------------------------------
channels = [(1, "TikTok", "Social"), (2, "Instagram", "Social"),
            (3, "Google Ads", "Search"), (4, "Email", "Owned")]
channels_df = spark.createDataFrame(channels, ["channel_id", "channel_name", "channel_type"])

# --- Dimensions: campaigns -------------------------------------------------
campaigns = [
    (1, "Spring Launch", "Awareness", "2024-02-01", "2024-04-30"),
    (2, "Summer Sale", "Conversion", "2024-06-01", "2024-08-31"),
    (3, "Back to Business", "Lead Gen", "2024-09-01", "2024-11-30"),
    (4, "Holiday Deals", "Conversion", "2024-11-15", "2025-01-15"),
    (5, "New Year Promo", "Awareness", "2025-01-15", "2025-03-15"),
    (6, "Spring Refresh", "Conversion", "2025-03-01", "2025-05-31"),
    (7, "Summer Blowout", "Conversion", "2025-06-01", "2025-08-31"),
    (8, "Q4 Growth Push", "Conversion", "2025-09-01", "2026-05-31"),
    (9, "Holiday Mega Sale", "Conversion", "2025-11-15", "2026-01-31"),
    (10, "2026 Kickoff", "Awareness", "2026-01-15", "2026-03-31"),
    (11, "Spring 2026", "Conversion", "2026-03-01", "2026-05-31"),
]
campaigns_df = (spark.createDataFrame(
    campaigns, ["campaign_id", "campaign_name", "objective", "start_date", "end_date"])
    .withColumn("start_date", F.to_date("start_date"))
    .withColumn("end_date", F.to_date("end_date")))

# --- Dimensions: audiences -------------------------------------------------
audiences = [(1, "Gen Z", "18-24", "Trends & Entertainment"),
             (2, "Young Pros", "25-34", "Career & Tech"),
             (3, "Families", "35-49", "Home & Lifestyle"),
             (4, "Established", "50-65", "Finance & Travel")]
audiences_df = spark.createDataFrame(audiences, ["audience_id", "audience_name", "age_band", "interest"])

# --- Dimensions: regions (country, code, lat, lon) -------------------------
regions = [
    (1, "United States", "US", 37.09, -95.71), (2, "United Kingdom", "GB", 55.38, -3.44),
    (3, "Germany", "DE", 51.17, 10.45), (4, "France", "FR", 46.23, 2.21),
    (5, "Spain", "ES", 40.46, -3.75), (6, "Italy", "IT", 41.87, 12.57),
    (7, "Canada", "CA", 56.13, -106.35), (8, "Brazil", "BR", -14.24, -51.93),
    (9, "Mexico", "MX", 23.63, -102.55), (10, "Japan", "JP", 36.20, 138.25),
    (11, "Australia", "AU", -25.27, 133.78), (12, "India", "IN", 20.59, 78.96),
    (13, "Singapore", "SG", 1.35, 103.82), (14, "Netherlands", "NL", 52.13, 5.29),
    (15, "Sweden", "SE", 60.13, 18.64), (16, "Poland", "PL", 51.92, 19.15),
    (17, "UAE", "AE", 23.42, 53.85), (18, "South Korea", "KR", 35.91, 127.77),
    (19, "Argentina", "AR", -38.42, -63.62), (20, "South Africa", "ZA", -30.56, 22.94),
]
regions_df = spark.createDataFrame(regions, ["region_id", "country", "country_code", "latitude", "longitude"])

# --- Dimensions: creatives — the root-cause table. Healthy creatives + one flagged bad one.
# creative_id, creative_name, channel, channel_id, message_theme, format, launch_date, target_market, status
creatives = [
    (1, "Always-On Brand", "TikTok", 1, "Brand Story", "Video", "2024-01-01", "Global", "active"),
    (2, "Summer Vibes", "TikTok", 1, "Lifestyle", "Video", "2024-06-01", "Global", "active"),
    (3, "Carousel Classics", "Instagram", 2, "Product Showcase", "Carousel", "2024-01-01", "Global", "active"),
    (4, "Story Highlights", "Instagram", 2, "Social Proof", "Story", "2024-05-01", "Global", "active"),
    (5, "Search Intent", "Google Ads", 3, "Offer / Discount", "Search Text", "2024-01-01", "Global", "active"),
    (6, "Shopping Feed", "Google Ads", 3, "Product Showcase", "Shopping", "2024-03-01", "Global", "active"),
    (7, "Newsletter Promo", "Email", 4, "Offer / Discount", "HTML Email", "2024-01-01", "Global", "active"),
    (8, "Loyalty Rewards", "Email", 4, "Retention", "HTML Email", "2024-04-01", "Global", "active"),
    # --- the flagged bad new creative: localized TikTok variant launched on the event date ---
    (BAD_CREATIVE_ID, "Fall Sale - v2 (DE/FR)", "TikTok", 1, "Aggressive Discount", "Video",
     str(EVENT_DATE), "Germany & France", "underperforming"),
]
creatives_df = (spark.createDataFrame(
    creatives, ["creative_id", "creative_name", "channel", "channel_id",
                "message_theme", "format", "launch_date", "target_market", "status"])
    .withColumn("launch_date", F.to_date("launch_date")))

# --- FACT: campaign_performance (daily grain across channel x platform x audience x region x creative)
print("== campaign_performance (fact) ==")
TD = (END - START).days
EVENT_OFF = (EVENT_DATE - START).days
NREG = len(regions)
NAUD = len(audiences)
NCAMP = len(campaigns)

perf_struct = StructType([
    StructField("offset_days", IntegerType()), StructField("channel_id", IntegerType()),
    StructField("platform", StringType()), StructField("audience_id", IntegerType()),
    StructField("region_id", IntegerType()), StructField("campaign_id", IntegerType()),
    StructField("creative_id", IntegerType()),
    StructField("impressions", IntegerType()), StructField("clicks", IntegerType()),
    StructField("spend", DoubleType()), StructField("conversions", IntegerType()),
    StructField("revenue", DoubleType())])


@F.pandas_udf(perf_struct)
def gen(ids: pd.Series) -> pd.DataFrame:
    import numpy as np
    rng = np.random.default_rng()
    # TikTok is the biggest channel (the one we lean on for growth)
    chans = np.array([1, 2, 3, 4]); chan_w = np.array([0.42, 0.22, 0.22, 0.14])
    plats = np.array(["Mobile", "Web"])
    good = {1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8]}   # healthy creative ids per channel
    # region weights: Germany(3) & France(4) are top markets, rest spread worldwide
    reg_ids = np.arange(1, NREG + 1)
    reg_w = np.full(NREG, 0.6); reg_w[0] = 2.5          # US big
    reg_w[2] = 4.0; reg_w[3] = 3.5                      # Germany, France = major markets
    reg_w[1] = 2.0; reg_w[4] = 1.5; reg_w[5] = 1.5      # UK, Spain, Italy
    reg_w = reg_w / reg_w.sum()
    out = []
    for _ in ids:
        day = int(rng.integers(0, TD + 1))
        post = day >= EVENT_OFF
        ch = int(rng.choice(chans, p=chan_w))
        pm = 0.85 if ch in (1, 2) else (0.55 if ch == 3 else 0.45)   # social skews mobile
        plat = str(rng.choice(plats, p=[pm, 1 - pm]))
        aud = int(rng.integers(1, NAUD + 1))
        reg = int(rng.choice(reg_ids, p=reg_w))
        camp = int(rng.integers(1, NCAMP + 1))
        # healthy per-channel economics (all 4 land in a comparable ~3-5 revenue/spend band)
        cpc = {1: 0.30, 2: 0.55, 3: 1.20, 4: 0.45}[ch]
        base_cvr = {1: 0.030, 2: 0.028, 3: 0.045, 4: 0.050}[ch]
        aov = rng.normal(80, 15)
        clicks = int(np.clip(rng.lognormal(4.2, 0.7), 5, 4000))
        # creative FK: healthy creative for this channel by default
        creative = int(rng.choice(good[ch]))
        cvr = base_cvr * rng.uniform(0.9, 1.1)
        # --- THE EVENT: bad new creative on TikTok in Germany/France from EVENT_DATE ---
        # spend stays flat; the NEW creative just converts terribly -> revenue & conversions collapse.
        if post and ch == BAD_CHANNEL and reg in BAD_MARKETS:
            creative = BAD_CREATIVE_ID
            camp = BAD_CAMPAIGN_ID     # the bad creative belongs to the "Q4 Growth Push" campaign
            cvr = base_cvr * 0.12      # conv rate craters (~0.35% vs ~3%)
        ctr = rng.uniform(0.008, 0.03)
        impressions = int(clicks / max(ctr, 0.001))
        spend = round(clicks * cpc * rng.uniform(0.9, 1.1), 2)
        conversions = int(rng.binomial(clicks, min(cvr, 0.5)))
        revenue = round(conversions * max(aov, 20), 2)
        out.append((day, ch, plat, aud, reg, camp, creative, impressions, clicks, spend, conversions, revenue))
    return pd.DataFrame(out, columns=[f.name for f in perf_struct])


perf_raw = (spark.range(0, N_PERF, numPartitions=16).select(gen(F.col("id")).alias("p")).select("p.*"))
perf_raw = (perf_raw
    .withColumn("date", F.expr(f"date_add(DATE'{START}', offset_days)"))
    .withColumn("perf_id", F.monotonically_increasing_id())
    .drop("offset_days"))


# ===========================================================================
# PHASE 2 — SILVER (typed tables; write, then add PK/FK RELY constraints)
# ===========================================================================
def save(df, name):
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.{name}")
    print(f"   {name}: {df.count()} rows")


print("== silver ==")
# Dimensions — cast every id to BIGINT so fact FK types match exactly.
save(channels_df.select(
        F.col("channel_id").cast("bigint").alias("channel_id"), "channel_name", "channel_type"),
     "channels")
save(campaigns_df.select(
        F.col("campaign_id").cast("bigint").alias("campaign_id"), "campaign_name", "objective",
        "start_date", "end_date"),
     "campaigns")
save(audiences_df.select(
        F.col("audience_id").cast("bigint").alias("audience_id"), "audience_name", "age_band", "interest"),
     "audiences")
save(regions_df.select(
        F.col("region_id").cast("bigint").alias("region_id"), "country", "country_code",
        "latitude", "longitude"),
     "regions")
save(creatives_df.select(
        F.col("creative_id").cast("bigint").alias("creative_id"), "creative_name", "channel",
        F.col("channel_id").cast("bigint").alias("channel_id"), "message_theme", "format",
        "launch_date", "target_market", "status"),
     "creatives")
# Fact — cast every key/measure column to the silver contract types (BIGINT keys).
save(perf_raw.select(
        F.col("perf_id").cast("bigint").alias("perf_id"),
        "date",
        F.col("campaign_id").cast("bigint").alias("campaign_id"),
        F.col("channel_id").cast("bigint").alias("channel_id"),
        "platform",
        F.col("audience_id").cast("bigint").alias("audience_id"),
        F.col("region_id").cast("bigint").alias("region_id"),
        F.col("creative_id").cast("bigint").alias("creative_id"),
        F.col("impressions").cast("bigint").alias("impressions"),
        F.col("clicks").cast("bigint").alias("clicks"),
        "spend",
        F.col("conversions").cast("bigint").alias("conversions"),
        "revenue"),
     "campaign_performance")

# PK/FK constraints (NOT ENFORCED, RELY) — light up Catalog Explorer + help Genie.
# A PK column must be NOT NULL first, so the statements run in order: set the key
# columns NOT NULL, then add the PRIMARY KEYs, then the FOREIGN KEYs (after all
# referenced PKs exist). Plain list of full SQL so it's easy to read/copy/run.
_constraints = [
    # --- key columns NOT NULL (required before PRIMARY KEY) ---
    f"ALTER TABLE {FQ}.channels             ALTER COLUMN channel_id  SET NOT NULL",
    f"ALTER TABLE {FQ}.campaigns            ALTER COLUMN campaign_id SET NOT NULL",
    f"ALTER TABLE {FQ}.audiences            ALTER COLUMN audience_id SET NOT NULL",
    f"ALTER TABLE {FQ}.regions              ALTER COLUMN region_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.creatives            ALTER COLUMN creative_id SET NOT NULL",
    f"ALTER TABLE {FQ}.campaign_performance ALTER COLUMN perf_id     SET NOT NULL",
    f"ALTER TABLE {FQ}.campaign_performance ALTER COLUMN campaign_id SET NOT NULL",
    f"ALTER TABLE {FQ}.campaign_performance ALTER COLUMN channel_id  SET NOT NULL",
    f"ALTER TABLE {FQ}.campaign_performance ALTER COLUMN audience_id SET NOT NULL",
    f"ALTER TABLE {FQ}.campaign_performance ALTER COLUMN region_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.campaign_performance ALTER COLUMN creative_id SET NOT NULL",
    # --- primary keys ---
    f"ALTER TABLE {FQ}.channels             ADD CONSTRAINT channels_pk   PRIMARY KEY (channel_id) RELY",
    f"ALTER TABLE {FQ}.campaigns            ADD CONSTRAINT campaigns_pk  PRIMARY KEY (campaign_id) RELY",
    f"ALTER TABLE {FQ}.audiences            ADD CONSTRAINT audiences_pk  PRIMARY KEY (audience_id) RELY",
    f"ALTER TABLE {FQ}.regions              ADD CONSTRAINT regions_pk    PRIMARY KEY (region_id) RELY",
    f"ALTER TABLE {FQ}.creatives            ADD CONSTRAINT creatives_pk  PRIMARY KEY (creative_id) RELY",
    f"ALTER TABLE {FQ}.campaign_performance ADD CONSTRAINT campaign_performance_pk PRIMARY KEY (perf_id) RELY",
    # --- foreign keys (campaign_performance → dimensions) ---
    f"ALTER TABLE {FQ}.campaign_performance ADD CONSTRAINT cp_campaign_fk FOREIGN KEY (campaign_id) REFERENCES {FQ}.campaigns(campaign_id) RELY",
    f"ALTER TABLE {FQ}.campaign_performance ADD CONSTRAINT cp_channel_fk  FOREIGN KEY (channel_id)  REFERENCES {FQ}.channels(channel_id) RELY",
    f"ALTER TABLE {FQ}.campaign_performance ADD CONSTRAINT cp_audience_fk FOREIGN KEY (audience_id) REFERENCES {FQ}.audiences(audience_id) RELY",
    f"ALTER TABLE {FQ}.campaign_performance ADD CONSTRAINT cp_region_fk   FOREIGN KEY (region_id)   REFERENCES {FQ}.regions(region_id) RELY",
    f"ALTER TABLE {FQ}.campaign_performance ADD CONSTRAINT cp_creative_fk FOREIGN KEY (creative_id) REFERENCES {FQ}.creatives(creative_id) RELY",
]
for c in _constraints:
    try:
        spark.sql(c)
    except Exception as e:  # noqa: BLE001 — idempotent: NOT NULL / constraint may already be set
        print(f"   (skip) {str(e).splitlines()[0][:90]}")


# ===========================================================================
# PHASE 3 — GOLD (campaign_performance_enriched — one wide analysis-ready join)
# ===========================================================================
print("== gold ==")
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.campaign_performance_enriched
COMMENT 'Analysis-ready daily campaign performance joined with campaign, channel, audience, market and creative. Powers the AI/BI dashboard and Genie. Revenue & conversions drop from 2025-09-01 on TikTok in Germany & France because of the underperforming Fall Sale - v2 (DE/FR) creative; spend stays flat.'
AS SELECT p.perf_id, p.date,
     c.channel_name, c.channel_type, p.platform,
     cp.campaign_name, cp.objective,
     a.audience_name, a.age_band, a.interest,
     r.country, r.country_code, r.latitude, r.longitude,
     cr.creative_name, cr.message_theme, cr.format AS creative_format,
     cr.launch_date AS creative_launch_date, cr.target_market, cr.status AS creative_status,
     p.impressions, p.clicks, p.spend, p.conversions, p.revenue
   FROM {FQ}.campaign_performance p
   JOIN {FQ}.channels  c  ON p.channel_id  = c.channel_id
   JOIN {FQ}.campaigns cp ON p.campaign_id = cp.campaign_id
   JOIN {FQ}.audiences a  ON p.audience_id = a.audience_id
   JOIN {FQ}.regions   r  ON p.region_id   = r.region_id
   JOIN {FQ}.creatives cr ON p.creative_id = cr.creative_id
""")
print("   campaign_performance_enriched: built")


# ===========================================================================
# PHASE 4 — METRICS (governed metric view; measures correct under any grouping)
# ===========================================================================
print("== metric view ==")
spark.sql(f"""
CREATE OR REPLACE VIEW {FQ}.metrics_campaign
WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: {CATALOG}.{SCHEMA}.campaign_performance_enriched
comment: "Governed multi-channel marketing KPIs. Revenue per Dollar = revenue / spend (a.k.a. ROAS). The root cause of the late-2025 drop lives in the creative_name / creative_status fields (the underperforming Fall Sale - v2 (DE/FR) creative)."
dimensions:
  - name: Date
    expr: date
  - name: Channel
    expr: channel_name
  - name: Channel Type
    expr: channel_type
  - name: Platform
    expr: platform
  - name: Campaign
    expr: campaign_name
  - name: Objective
    expr: objective
  - name: Audience
    expr: audience_name
  - name: Age Band
    expr: age_band
  - name: Interest
    expr: interest
  - name: Country
    expr: country
  - name: Country Code
    expr: country_code
  - name: Latitude
    expr: latitude
  - name: Longitude
    expr: longitude
  - name: Creative
    expr: creative_name
  - name: Message Theme
    expr: message_theme
  - name: Creative Format
    expr: creative_format
  - name: Creative Status
    expr: creative_status
  - name: Target Market
    expr: target_market
measures:
  - name: Revenue
    expr: SUM(revenue)
  - name: Total Spend
    expr: SUM(spend)
  - name: Conversions
    expr: SUM(conversions)
  - name: Impressions
    expr: SUM(impressions)
  - name: Clicks
    expr: SUM(clicks)
  - name: Revenue per Dollar
    expr: SUM(revenue) / NULLIF(SUM(spend),0)
  - name: Conversion Rate
    expr: SUM(conversions) / NULLIF(SUM(clicks),0)
  - name: CTR
    expr: SUM(clicks) / NULLIF(SUM(impressions),0)
  - name: Cost per Conversion
    expr: SUM(spend) / NULLIF(SUM(conversions),0)
$$
""")
print("   metrics_campaign: built")

print(f"\nDONE — {CATALOG}.{SCHEMA} built: 6 base tables + campaign_performance_enriched + metrics_campaign")
