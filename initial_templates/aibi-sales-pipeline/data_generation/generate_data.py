#!/usr/bin/env python
"""
AI/BI Sales Pipeline Review — self-contained data generation + medallion build.

Self-contained synthetic demo. The
original ships a raw-parquet generator plus install-time bronze→silver→gold SQL in
`bundle_config.py`; here BOTH are folded into ONE script so a fork rebuilds the whole
demo from scratch with no external dataset dependency and no parquet round-trip:

  Phase 1  RAW      — product catalog + launches (PIM), finance targets, Salesforce
                      reps / accounts / opportunities, and the ERP orders FACT —
                      generated with pure Spark (+ pandas_udf for accounts, orders,
                      opportunities). No parquet stage, no bronze bootstrap.
  Phase 2  SILVER   — typed, constrained tables (PK/FK RELY for Catalog Explorer).
  Phase 3  GOLD     — orders_enriched (one wide analysis-ready join).
  Phase 4  METRICS  — metrics_sales governed metric view (WITH METRICS YAML).

STORY — "Hit the number: a new line launches in EMEA and we beat the quarter":
Revenue tracks along across 4 beauty product lines (Skincare, Makeup, Fragrance,
Haircare). Then the brand LAUNCHES its new FRAGRANCE line in EMEA on 2026-05-04, mid
the current fiscal quarter (Q2 2026 = Apr 1 → Jun 30). EMEA sales SPIKE as retailers
stock it, and the AI forecast of quarter-end revenue now projects BEATING the
company-wide quarterly target (~$21.5M target, ~$33M projected ≈ 155% attainment).
Genie: are we hitting target? → what's driving the spike → EMEA → why EMEA → join
product_launches → Fragrance launched in EMEA on 2026-05-04 → which accounts / reps.

Tables:
  products          (PIM)       : product_line, category
  product_launches  (PIM)       : launch_id, product_line, region, launch_date, launch_name, description
  sales_targets     (Finance)   : quarter_start, target_revenue (company-wide)
  crm_reps          (Salesforce): owner_id, rep_name, region, title
  crm_accounts      (Salesforce): account_id, account_name, segment, region, country, country_code, lat, long, owner_id
  crm_opportunities (Salesforce): opp_id, account_id, product_line, stage, expected_revenue, created_date, close_date
  erp_orders        (ERP, FACT) : order_id, order_date, account_id, product_line, region, units, revenue
  orders_enriched   (GOLD)      : ERP orders unified with account/rep/product context (powers dashboard + Genie)
  metrics_sales     (METRICS)   : governed KPIs (Revenue, Units, Orders, Avg Order Value, ...)

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
      python generate_data.py --catalog dbdemos_templates --schema aibi_sales_pipeline
"""
import argparse
import datetime as dt
import json as _json
import os

import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.types import (DoubleType, IntegerType, StringType, StructField,
                               StructType)

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
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "aibi_sales_pipeline")

FQ = f"`{CATALOG}`.`{SCHEMA}`"          # fully-qualified, back-ticked

# Temporal anchors (load-bearing — every consumer depends on them).
START = dt.date(2024, 12, 1)            # data start
END = dt.date(2026, 6, 8)              # data end (mid Q2 2026 — leaves runway to forecast)
QUARTER_START = dt.date(2026, 4, 1)     # Q2 2026 = Apr 1 → Jun 30 (the quarter we're "in")
QUARTER_END = dt.date(2026, 6, 30)
LAUNCH_DATE = dt.date(2026, 5, 4)       # new Fragrance line goes live in EMEA — the step-change

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG}`")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


# ===========================================================================
# PHASE 1 — RAW (generated with pure Spark; no parquet round-trip)
# ===========================================================================
# --- PRODUCTS (PIM) --------------------------------------------------------
products = [("Skincare", "Face & Body"), ("Makeup", "Color Cosmetics"),
            ("Fragrance", "Perfume & Scent"), ("Haircare", "Hair & Scalp")]
products_df = spark.createDataFrame(products, ["product_line", "category"])

# --- PRODUCT LAUNCHES (PIM) — the root-cause table -------------------------
# Core lines available worldwide from the start; the NEW Fragrance line launches
# region by region, and EMEA (2026-05-04, mid-quarter) is the spike.
launches = [
    (1, "Skincare", "Global", "2024-01-01", "Skincare (core range)", "Core skincare range, available worldwide."),
    (2, "Makeup", "Global", "2024-01-01", "Makeup (core range)", "Core color cosmetics, available worldwide."),
    (3, "Haircare", "Global", "2024-01-01", "Haircare (core range)", "Core haircare range, available worldwide."),
    (4, "Fragrance", "AMER", "2024-06-01", "Fragrance launch - AMER", "New signature Fragrance line launched in the Americas."),
    (5, "Fragrance", "APAC", "2024-09-01", "Fragrance launch - APAC", "New signature Fragrance line launched in APAC."),
    (6, "Fragrance", "EMEA", str(LAUNCH_DATE), "Fragrance launch - EMEA", "New signature Fragrance line launched across EMEA - drives a sharp consumption spike in Europe."),
    (7, "Fragrance", "LATAM", "2026-06-15", "Fragrance launch - LATAM", "New signature Fragrance line launched in LATAM (very recent)."),
]
launches_df = (spark.createDataFrame(
        launches, ["launch_id", "product_line", "region", "launch_date", "launch_name", "description"])
    .withColumn("launch_id", F.col("launch_id").cast("bigint"))
    .withColumn("launch_date", F.to_date("launch_date")))

# --- SALES TARGETS (Finance) — company-wide, per quarter -------------------
# Full quarters run ~$29.5M. The CURRENT quarter (Q2-2026) was set conservatively at
# $21.5M and is being SMASHED (~$33M projected ≈ ~155% attainment) thanks to the EMEA
# Fragrance launch — the headline beat the demo tells.
targets = [
    ("2024-10-01", 28000000.0), ("2025-01-01", 28500000.0), ("2025-04-01", 29000000.0),
    ("2025-07-01", 29000000.0), ("2025-10-01", 29500000.0), ("2026-01-01", 29500000.0),
    ("2026-04-01", 21500000.0),
]
targets_df = (spark.createDataFrame(targets, ["quarter_start", "target_revenue"])
    .withColumn("quarter_start", F.to_date("quarter_start")))

# --- REPS (Salesforce) -----------------------------------------------------
reps = [
    (1, "Sophie Martin", "EMEA", "Account Executive"), (2, "Liam O'Brien", "EMEA", "Account Executive"),
    (3, "Emma Schmidt", "EMEA", "Senior AE"), (4, "James Carter", "AMER", "Account Executive"),
    (5, "Olivia Nguyen", "AMER", "Senior AE"), (6, "Noah Williams", "AMER", "Account Executive"),
    (7, "Yuki Tanaka", "APAC", "Account Executive"), (8, "Mei Lin", "APAC", "Senior AE"),
    (9, "Lucas Silva", "LATAM", "Account Executive"), (10, "Sofia Garcia", "LATAM", "Account Executive"),
]
reps_df = (spark.createDataFrame(reps, ["owner_id", "rep_name", "region", "title"])
    .withColumn("owner_id", F.col("owner_id").cast("bigint")))

# --- REGIONS (for geo) — a handful of countries per region with lat/long ---
# region, country, code, lat, long
geo = [
    ("EMEA", "France", "FR", 46.23, 2.21), ("EMEA", "Germany", "DE", 51.17, 10.45), ("EMEA", "United Kingdom", "GB", 55.38, -3.44),
    ("EMEA", "Italy", "IT", 41.87, 12.57), ("EMEA", "Spain", "ES", 40.46, -3.75), ("EMEA", "UAE", "AE", 23.42, 53.85),
    ("AMER", "United States", "US", 37.09, -95.71), ("AMER", "Canada", "CA", 56.13, -106.35), ("AMER", "Mexico", "MX", 23.63, -102.55),
    ("APAC", "Japan", "JP", 36.20, 138.25), ("APAC", "Australia", "AU", -25.27, 133.78), ("APAC", "Singapore", "SG", 1.35, 103.82),
    ("APAC", "South Korea", "KR", 35.91, 127.77),
    ("LATAM", "Brazil", "BR", -14.24, -51.93), ("LATAM", "Argentina", "AR", -38.42, -63.62), ("LATAM", "Chile", "CL", -35.68, -71.54),
]

# --- CRM ACCOUNTS (Salesforce) ---------------------------------------------
print("== crm_accounts ==")
NACC = 150
SEGMENTS = ["Department Store", "Specialty Retail", "Pharmacy", "E-commerce"]
acc_struct = StructType([
    StructField("account_id", IntegerType()), StructField("account_name", StringType()),
    StructField("segment", StringType()), StructField("region", StringType()),
    StructField("country", StringType()), StructField("country_code", StringType()),
    StructField("latitude", DoubleType()), StructField("longitude", DoubleType()),
    StructField("owner_id", IntegerType())])
GEO = geo
SEG = SEGMENTS

@F.pandas_udf(acc_struct)
def gen_acc(ids: pd.Series) -> pd.DataFrame:
    import numpy as np
    rng = np.random.default_rng()
    geo = GEO
    # region weights: EMEA & AMER bigger
    reg_w = {"EMEA": 0.34, "AMER": 0.34, "APAC": 0.20, "LATAM": 0.12}
    reps_by_reg = {"EMEA": [1, 2, 3], "AMER": [4, 5, 6], "APAC": [7, 8], "LATAM": [9, 10]}
    prefixes = ["Belle", "Lumiere", "Aurora", "Maison", "Glow", "Eclat", "Nova", "Velvet", "Rouge", "Coastal", "Urban", "Bloom", "Luxe", "Pure", "Azure"]
    suffixes = ["Beauty", "Cosmetics", "Retail Group", "Stores", "Pharmacy", "Boutique", "Market", "Distributors", "Beaute", "Collective"]
    out = []
    for i in ids:
        i = int(i)
        reg = str(rng.choice(list(reg_w), p=list(reg_w.values())))
        gopts = [g for g in geo if g[0] == reg]
        g = gopts[rng.integers(0, len(gopts))]
        seg = str(rng.choice(SEG, p=[0.18, 0.32, 0.20, 0.30]))
        owner = int(rng.choice(reps_by_reg[reg]))
        name = f"{prefixes[i % len(prefixes)]} {suffixes[(i // len(prefixes)) % len(suffixes)]} {i}"
        # jitter lat/long a touch so map bubbles spread
        lat = float(g[3] + rng.normal(0, 1.2))
        lon = float(g[4] + rng.normal(0, 1.2))
        out.append((i, name, seg, reg, g[1], g[2], lat, lon, owner))
    return pd.DataFrame(out, columns=[f.name for f in acc_struct])

accounts_df = (spark.range(1, NACC + 1).select(gen_acc(F.col("id")).alias("a")).select("a.*")
    # cast keys to bigint to match the reps dimension & downstream FKs
    .withColumn("account_id", F.col("account_id").cast("bigint"))
    .withColumn("owner_id", F.col("owner_id").cast("bigint")))
accounts_df = accounts_df.cache()
_acc_rows = accounts_df.select("account_id", "region").collect()

# --- ERP ORDERS (the fact) — daily small-ticket orders ---------------------
print("== erp_orders (fact) ==")
TD = (END - START).days
LAUNCH_OFF = (LAUNCH_DATE - START).days
ACC_BY_REG = {}
for r in _acc_rows:
    ACC_BY_REG.setdefault(r["region"], []).append(int(r["account_id"]))
ACC_JSON = _json.dumps(ACC_BY_REG)

ord_struct = StructType([
    StructField("offset_days", IntegerType()), StructField("account_id", IntegerType()),
    StructField("product_line", StringType()), StructField("region", StringType()),
    StructField("units", IntegerType()), StructField("revenue", DoubleType())])
TDc = TD
LO = LAUNCH_OFF

@F.pandas_udf(ord_struct)
def gen_ord(ids: pd.Series) -> pd.DataFrame:
    import numpy as np, json
    rng = np.random.default_rng()
    acc_by_reg = json.loads(ACC_JSON)
    regions = list(acc_by_reg.keys())
    # base daily order volume mix by region (EMEA/AMER bigger)
    reg_w = {"EMEA": 0.32, "AMER": 0.34, "APAC": 0.20, "LATAM": 0.14}
    rw = [reg_w[r] for r in regions]
    lines = ["Skincare", "Makeup", "Fragrance", "Haircare"]
    # baseline product mix (Fragrance smaller pre-launch in EMEA)
    line_w = [0.34, 0.30, 0.12, 0.24]
    # small-ticket average prices per line
    price = {"Skincare": 42.0, "Makeup": 34.0, "Fragrance": 78.0, "Haircare": 28.0}
    out = []
    for _ in ids:
        day = int(rng.integers(0, TDc + 1))
        reg = str(rng.choice(regions, p=rw))
        line = str(rng.choice(lines, p=line_w))
        # --- THE EVENT: Fragrance becomes available in EMEA at LAUNCH_OFF -> EMEA fragrance ramps hard ---
        if reg == "EMEA" and line == "Fragrance":
            if day < LO:
                # before EMEA launch: fragrance barely sold in EMEA -> mostly skip (reassign to skincare)
                if rng.random() < 0.85:
                    line = "Skincare"
        accs = acc_by_reg[reg]
        acc = int(accs[rng.integers(0, len(accs))])
        units = int(np.clip(rng.lognormal(3.0, 0.7), 1, 400))
        # post-launch EMEA fragrance gets a growing boost (adoption ramp)
        boost = 1.0
        if reg == "EMEA" and line == "Fragrance" and day >= LO:
            ramp = min(1.0, (day - LO) / 45.0)
            boost = 1.0 + ramp * 4.0    # up to ~5x order sizes as adoption ramps
        units = int(units * boost)
        rev = round(units * price[line] * rng.uniform(0.9, 1.12), 2)
        out.append((day, acc, line, reg, units, rev))
    return pd.DataFrame(out, columns=[f.name for f in ord_struct])

N = 180000
orders_df = (spark.range(0, N, numPartitions=32).select(gen_ord(F.col("id")).alias("o")).select("o.*")
    .withColumn("order_date", F.expr(f"date_add(DATE'{START}', offset_days)"))
    .withColumn("order_id", F.monotonically_increasing_id())
    .drop("offset_days")
    .select("order_id", "order_date",
            F.col("account_id").cast("bigint").alias("account_id"),
            "product_line", "region",
            F.col("units").cast("bigint").alias("units"), "revenue"))

# --- CRM OPPORTUNITIES (Salesforce) — open pipeline for coverage -----------
print("== crm_opportunities ==")
opp_struct = StructType([
    StructField("opp_id", IntegerType()), StructField("account_id", IntegerType()),
    StructField("product_line", StringType()), StructField("stage", StringType()),
    StructField("expected_revenue", DoubleType()),
    StructField("created_off", IntegerType()), StructField("close_off", IntegerType())])

@F.pandas_udf(opp_struct)
def gen_opp(ids: pd.Series) -> pd.DataFrame:
    import numpy as np, json
    rng = np.random.default_rng()
    acc_by_reg = json.loads(ACC_JSON)
    all_acc = [a for v in acc_by_reg.values() for a in v]
    lines = ["Skincare", "Makeup", "Fragrance", "Haircare"]
    stages = ["Prospecting", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]
    stage_w = [0.18, 0.20, 0.22, 0.18, 0.14, 0.08]
    out = []
    for i in ids:
        i = int(i)
        acc = int(all_acc[rng.integers(0, len(all_acc))])
        line = str(rng.choice(lines, p=[0.3, 0.28, 0.2, 0.22]))
        stage = str(rng.choice(stages, p=stage_w))
        exp = round(float(np.clip(rng.lognormal(10.2, 0.7), 3000, 400000)), 2)
        created = int(rng.integers(TDc - 180, TDc))   # recent
        close = int(created + rng.integers(15, 120))
        out.append((i, acc, line, stage, exp, created, close))
    return pd.DataFrame(out, columns=[f.name for f in opp_struct])

opps_df = (spark.range(1, 1201).select(gen_opp(F.col("id")).alias("o")).select("o.*")
    .withColumn("created_date", F.expr(f"date_add(DATE'{START}', created_off)"))
    .withColumn("close_date", F.expr(f"date_add(DATE'{START}', close_off)"))
    .drop("created_off", "close_off")
    .select(F.col("opp_id").cast("bigint").alias("opp_id"),
            F.col("account_id").cast("bigint").alias("account_id"),
            "product_line", "stage", "expected_revenue", "created_date", "close_date"))


# ===========================================================================
# PHASE 2 — SILVER (typed tables; write, then add PK/FK RELY constraints)
# ===========================================================================
def save(df, name):
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.{name}")
    print(f"   {name}: {df.count()} rows")

print("== silver ==")
save(products_df, "products")
save(launches_df, "product_launches")
save(targets_df, "sales_targets")
save(reps_df, "crm_reps")
save(accounts_df, "crm_accounts")
save(opps_df, "crm_opportunities")
save(orders_df, "erp_orders")

# PK/FK constraints (NOT ENFORCED, RELY) — light up Catalog Explorer + help Genie.
# A PK column must be NOT NULL first, so the statements run in order: set the key
# columns NOT NULL, then add the PRIMARY KEYs, then the FOREIGN KEYs (after all
# referenced PKs exist). Plain list of full SQL so it's easy to read/copy/run.
# FK child/parent column TYPES already match (all keys cast to bigint at build time).
_constraints = [
    # --- key columns NOT NULL (required before PRIMARY KEY) ---
    f"ALTER TABLE {FQ}.products          ALTER COLUMN product_line  SET NOT NULL",
    f"ALTER TABLE {FQ}.product_launches  ALTER COLUMN launch_id     SET NOT NULL",
    f"ALTER TABLE {FQ}.sales_targets     ALTER COLUMN quarter_start SET NOT NULL",
    f"ALTER TABLE {FQ}.crm_reps          ALTER COLUMN owner_id      SET NOT NULL",
    f"ALTER TABLE {FQ}.crm_accounts      ALTER COLUMN account_id    SET NOT NULL",
    f"ALTER TABLE {FQ}.crm_opportunities ALTER COLUMN opp_id        SET NOT NULL",
    f"ALTER TABLE {FQ}.erp_orders        ALTER COLUMN order_id      SET NOT NULL",
    # --- primary keys ---
    f"ALTER TABLE {FQ}.products          ADD CONSTRAINT products_pk        PRIMARY KEY (product_line) RELY",
    f"ALTER TABLE {FQ}.product_launches  ADD CONSTRAINT launches_pk        PRIMARY KEY (launch_id) RELY",
    f"ALTER TABLE {FQ}.sales_targets     ADD CONSTRAINT targets_pk         PRIMARY KEY (quarter_start) RELY",
    f"ALTER TABLE {FQ}.crm_reps          ADD CONSTRAINT reps_pk            PRIMARY KEY (owner_id) RELY",
    f"ALTER TABLE {FQ}.crm_accounts      ADD CONSTRAINT accounts_pk        PRIMARY KEY (account_id) RELY",
    f"ALTER TABLE {FQ}.crm_opportunities ADD CONSTRAINT opportunities_pk   PRIMARY KEY (opp_id) RELY",
    f"ALTER TABLE {FQ}.erp_orders        ADD CONSTRAINT orders_pk          PRIMARY KEY (order_id) RELY",
    # --- foreign keys (after all referenced PKs exist) ---
    f"ALTER TABLE {FQ}.crm_accounts      ADD CONSTRAINT acc_owner_fk   FOREIGN KEY (owner_id)     REFERENCES {FQ}.crm_reps(owner_id) RELY",
    f"ALTER TABLE {FQ}.crm_opportunities ADD CONSTRAINT opp_account_fk FOREIGN KEY (account_id)   REFERENCES {FQ}.crm_accounts(account_id) RELY",
    f"ALTER TABLE {FQ}.erp_orders        ADD CONSTRAINT ord_account_fk FOREIGN KEY (account_id)   REFERENCES {FQ}.crm_accounts(account_id) RELY",
    f"ALTER TABLE {FQ}.erp_orders        ADD CONSTRAINT ord_product_fk FOREIGN KEY (product_line) REFERENCES {FQ}.products(product_line) RELY",
]
for c in _constraints:
    try:
        spark.sql(c)
    except Exception as e:  # noqa: BLE001 — idempotent: NOT NULL / constraint may already be set
        print(f"   (skip) {str(e).splitlines()[0][:90]}")


# ===========================================================================
# PHASE 3 — GOLD (orders_enriched — one wide analysis-ready join)
# ===========================================================================
print("== gold ==")
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.orders_enriched
COMMENT 'Analysis-ready sales fact: ERP orders unified with the Salesforce account (region, segment, owner, geo), the rep, and the product category. Powers the AI/BI dashboard and Genie. EMEA Fragrance revenue spikes after the new line launched there on 2026-05-04.'
AS SELECT o.order_id, o.order_date, o.product_line, p.category,
     o.region, a.account_id, a.account_name, a.segment, a.country, a.country_code, a.latitude, a.longitude,
     r.rep_name, r.title AS rep_title,
     o.units, o.revenue
   FROM {FQ}.erp_orders o
   JOIN {FQ}.crm_accounts a ON o.account_id = a.account_id
   LEFT JOIN {FQ}.crm_reps r ON a.owner_id = r.owner_id
   LEFT JOIN {FQ}.products p ON o.product_line = p.product_line
""")
print("   orders_enriched: built")


# ===========================================================================
# PHASE 4 — METRICS (governed metric view; measures correct under any grouping)
# ===========================================================================
print("== metric view ==")
spark.sql(f"""
CREATE OR REPLACE VIEW {FQ}.metrics_sales
WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: {CATALOG}.{SCHEMA}.orders_enriched
comment: "Governed beauty-brand sales KPIs. Revenue is actual ERP order revenue. The new Fragrance line launched in EMEA on 2026-05-04, driving a sales spike there that pushes the quarter forecast above target."
dimensions:
  - name: Order Date
    expr: order_date
  - name: Product Line
    expr: product_line
  - name: Category
    expr: category
  - name: Region
    expr: region
  - name: Segment
    expr: segment
  - name: Account
    expr: account_name
  - name: Country
    expr: country
  - name: Country Code
    expr: country_code
  - name: Latitude
    expr: latitude
  - name: Longitude
    expr: longitude
  - name: Sales Rep
    expr: rep_name
measures:
  - name: Revenue
    expr: SUM(revenue)
  - name: Units
    expr: SUM(units)
  - name: Orders
    expr: COUNT(1)
  - name: Avg Order Value
    expr: SUM(revenue) / NULLIF(COUNT(1),0)
  - name: Avg Unit Price
    expr: SUM(revenue) / NULLIF(SUM(units),0)
$$
""")
print("   metrics_sales: built")

print(f"\nDONE — {CATALOG}.{SCHEMA} built: 7 base tables + orders_enriched + metrics_sales")
