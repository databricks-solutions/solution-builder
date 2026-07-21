#!/usr/bin/env python
"""
AI/BI Supply Chain Optimization — self-contained data generation + medallion build.

Self-contained synthetic demo. The original
ships a raw-parquet generator (`data_generation.py`) plus install-time
bronze->silver->enriched SQL in `bundle_config.py`; here BOTH are folded into ONE
script so a fork rebuilds the whole demo from scratch with no external dataset
dependency:

  Phase 1  RAW      — dimensions (products, distribution_centers, market_launches,
                      suppliers, components, plants), the operational tables
                      (inventory, bom, purchase_orders) and the product_demand fact —
                      generated with pure Spark (+ one pandas_udf for the weekly
                      demand grid). No parquet round-trip.
  Phase 2  SILVER   — typed, constrained tables (PK/FK RELY for Catalog Explorer).
  Phase 3  GOLD     — demand_enriched (wide demand join) + component_status (the
                      supply-risk table: weeks of cover vs supplier lead time).
  Phase 4  METRICS  — metrics_demand governed metric view (WITH METRICS YAML).

STORY — "A demand surge is about to cause a Battery Cell stockout, and the 8-week
supplier lead time means we must act now":
An e-bike manufacturer builds finished products (City E-Bike, Cargo E-Bike, Folding
E-Bike, E-Scooter, E-Moped) from components via a bill of materials (BOM). On
2026-04-20 the City E-Bike opened a major new EMEA market (`market_launches`), driving
a sharp, sustained EMEA demand surge. Because every product uses the shared Battery
Cell, that surge — rolled through the BOM — drains the Battery Cell faster than its
supplier (PowerCell Industries, 8-week lead time) can replenish it. On-hand cover
falls to ~2 weeks at the Rotterdam plant (which serves EMEA+APAC) vs an 8-week lead
time — so a reorder placed today barely arrives in time. Every other component carries
9-17 weeks of cover; the Battery Cell is the single bottleneck. The "why" is grounded
in `market_launches` (the EMEA launch), which Genie traces through the BOM.

Genie arc: which component is at risk? -> Battery Cell -> when does it stock out? ->
~late July -> why can't we just reorder? -> the 8-week supplier lead time -> what's
driving the consumption? -> the City E-Bike EMEA demand surge (via the BOM).

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
      python generate_data.py --catalog dbdemos_templates --schema aibi_supply_chain
"""
import argparse
import datetime as dt
import os

from pyspark.sql import functions as F
from pyspark.sql.types import IntegerType

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
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "aibi_supply_chain")

FQ = f"`{CATALOG}`.`{SCHEMA}`"          # fully-qualified, back-ticked
START = dt.date(2024, 6, 3)             # weekly data (Mondays), ~2 years
END = dt.date(2026, 6, 1)              # end on a clean week boundary
SURGE_WEEK = dt.date(2026, 4, 20)      # City E-Bike EMEA market launch — the surge start
SURGE_PRODUCT_ID = 1                    # City E-Bike

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG}`")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


# ===========================================================================
# PHASE 1 — RAW (generated with pure Spark; no parquet round-trip)
# ===========================================================================
# --- Dimensions: products (finished e-bikes) -------------------------------
products = [
    (1, "City E-Bike", "E-Bike"), (2, "Cargo E-Bike", "E-Bike"), (3, "Folding E-Bike", "E-Bike"),
    (4, "E-Scooter", "Scooter"), (5, "E-Moped", "Moped"),
]
products_df = spark.createDataFrame(products, ["product_id", "product_name", "category"])

# --- Dimensions: distribution centers (lat/long for the map, region FK) ----
dcs = [
    (1, "Amsterdam DC", "EMEA", "Netherlands", "NL", 52.37, 4.90),
    (2, "Berlin DC", "EMEA", "Germany", "DE", 52.52, 13.40),
    (3, "Paris DC", "EMEA", "France", "FR", 48.86, 2.35),
    (4, "Chicago DC", "AMER", "United States", "US", 41.88, -87.63),
    (5, "Los Angeles DC", "AMER", "United States", "US", 34.05, -118.24),
    (6, "Toronto DC", "AMER", "Canada", "CA", 43.65, -79.38),
    (7, "Tokyo DC", "APAC", "Japan", "JP", 35.68, 139.69),
    (8, "Singapore DC", "APAC", "Singapore", "SG", 1.35, 103.82),
]
dcs_df = spark.createDataFrame(dcs, ["dc_id", "dc_name", "region", "country", "country_code", "latitude", "longitude"])

# --- Dimensions: market launches (the UPSTREAM cause of the demand surge) --
# The City E-Bike opened a major new EMEA market on the surge date -> EMEA demand
# jumps, which (via the BOM) drains the shared Battery Cell at the Rotterdam plant.
# This is the root cause Genie can point to for "why did demand surge?".
market_launches = [
    (1, "City E-Bike", "EMEA", str(SURGE_WEEK), "City E-Bike — EMEA market launch",
     "The City E-Bike launched across a major new EMEA market, driving a sharp, sustained demand increase in the region."),
]
market_launches_df = (spark.createDataFrame(
    market_launches, ["launch_id", "product_name", "region", "launch_date", "launch_name", "description"])
    .withColumn("launch_date", F.to_date("launch_date")))

# --- Dimensions: suppliers (lead times — the battery supplier is the crux) --
suppliers = [
    (1, "PowerCell Industries", "APAC", 8, 96.5),   # Battery Cell supplier: 8-week lead time (the constraint)
    (2, "DriveTech Motors", "EMEA", 4, 98.2),
    (3, "Alu-Frame Works", "EMEA", 3, 99.0),
    (4, "SafeStop Brakes", "AMER", 3, 97.8),
    (5, "ClearView Displays", "APAC", 5, 95.4),
    (6, "RollFast Tires", "AMER", 2, 99.3),
]
suppliers_df = spark.createDataFrame(suppliers, ["supplier_id", "supplier_name", "region", "lead_time_weeks", "reliability_pct"])

# --- Dimensions: components (each sourced from a supplier) ------------------
components = [
    (1, "Battery Cell", "Power", 1, 42.0),
    (2, "Electric Motor", "Drivetrain", 2, 85.0),
    (3, "Frame", "Chassis", 3, 120.0),
    (4, "Brake System", "Safety", 4, 38.0),
    (5, "Display Unit", "Electronics", 5, 29.0),
    (6, "Tire Set", "Chassis", 6, 46.0),
]
components_df = spark.createDataFrame(components, ["component_id", "component_name", "component_type", "supplier_id", "unit_cost"])

# --- Dimensions: plants (assembly factories that hold component inventory) --
# Rotterdam serves EMEA+APAC (bears the surging City E-Bike demand); Detroit serves AMER.
plants = [
    (1, "Rotterdam Plant", "EMEA"),
    (2, "Detroit Plant", "AMER"),
]
plants_df = spark.createDataFrame(plants, ["plant_id", "plant_name", "region"])

# --- Inventory (on-hand + safety stock + steady weekly inbound) per component x plant ----
# "Weeks of cover" = on_hand / weekly demand. Battery Cell is the bottleneck, lowest
# cover and clearly worse at Rotterdam (which bears the EMEA surge):
#   Rotterdam battery: on-hand ~300k / ~128k demand -> ~2-3 weeks (critical, 8-week lead)
#   Detroit   battery: on-hand ~165k / ~55k  demand -> ~3.0 weeks
# Every other component carries 9-17 weeks of cover -> healthy.
# (component_id, plant_id, on_hand, safety_stock, weekly_supply)
inventory = [
    # Rotterdam (EMEA+APAC; bears the surge -> battery critical)
    (1, 1, 300000, 90000, 95000), (2, 1, 180000, 24000, 26000), (3, 1, 200000, 24000, 25000),
    (4, 1, 210000, 26000, 26000), (5, 1, 200000, 24000, 25000), (6, 1, 210000, 26000, 26000),
    # Detroit (AMER)
    (1, 2, 165000, 48000, 48000), (2, 2, 210000, 16000, 16000), (3, 2, 230000, 16000, 15000),
    (4, 2, 240000, 18000, 16000), (5, 2, 230000, 16000, 15000), (6, 2, 240000, 18000, 16000),
]
inventory_df = spark.createDataFrame(inventory, ["component_id", "plant_id", "on_hand_units", "safety_stock_units", "weekly_supply_units"])

# --- BOM: qty of each component per finished product unit (Battery Cell used by all) ----
bom = [
    (1, 1, 8), (1, 2, 1), (1, 3, 1), (1, 4, 1), (1, 5, 1), (1, 6, 1),     # City E-Bike (8 cells)
    (2, 1, 12), (2, 2, 2), (2, 3, 1), (2, 4, 1), (2, 5, 1), (2, 6, 1),    # Cargo E-Bike (12 cells)
    (3, 1, 6), (3, 2, 1), (3, 3, 1), (3, 4, 1), (3, 5, 1), (3, 6, 1),     # Folding E-Bike (6 cells)
    (4, 1, 4), (4, 2, 1), (4, 3, 1), (4, 4, 1), (4, 5, 1), (4, 6, 1),     # E-Scooter (4 cells)
    (5, 1, 10), (5, 2, 1), (5, 3, 1), (5, 4, 1), (5, 5, 1), (5, 6, 1),    # E-Moped (10 cells)
]
bom_df = spark.createDataFrame(bom, ["product_id", "component_id", "qty_per_unit"])

# --- Purchase orders (open + historical inbound supply) --------------------
# Steady weekly POs per component (qty = weekly_supply_units), arriving lead_time_weeks
# after order. Recent battery-cell POs are still In Transit — they arrive but the surge
# outpaces them; the next reorder would take 8 weeks, which is the urgency.
NWEEKS = ((END - START).days // 7) + 1
lead_map = {s[0]: s[3] for s in suppliers}      # supplier_id -> lead_time_weeks
comp_sup = {c[0]: c[3] for c in components}     # component_id -> supplier_id
supply_by_cp = {(r[0], r[1]): r[4] for r in inventory}  # (component,plant) -> weekly inbound qty
po_rows = []
po_id = 1
for (comp, plant), qty in supply_by_cp.items():
    sup = comp_sup[comp]
    lead = lead_map[sup]
    for w in range(NWEEKS):
        order_week = START + dt.timedelta(weeks=w)
        arrival_week = order_week + dt.timedelta(weeks=lead)
        status = "Received" if arrival_week < END else ("In Transit" if order_week < END else "Planned")
        po_rows.append((po_id, comp, plant, sup, str(order_week), str(arrival_week), qty, status))
        po_id += 1
purchase_orders_df = (spark.createDataFrame(
    po_rows, ["po_id", "component_id", "plant_id", "supplier_id", "order_week", "expected_arrival_week", "qty_units", "status"])
    .withColumn("order_week", F.to_date("order_week"))
    .withColumn("expected_arrival_week", F.to_date("expected_arrival_week")))

# --- Fact: product_demand (weekly, per product x DC; the City E-Bike EMEA surge) ----
NDC = len(dcs)
NPROD = len(products)
SO = (SURGE_WEEK - START).days // 7      # surge week offset
grid = [(p, w, d) for p in range(1, NPROD + 1) for w in range(NWEEKS) for d in range(1, NDC + 1)]
grid_df = spark.createDataFrame(grid, ["product_id", "week_off", "dc_id"])


@F.pandas_udf(IntegerType())
def demand_udf(product_id, week_off, dc_id):
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng()
    base = {1: 5200, 2: 1800, 3: 2600, 4: 4200, 5: 2200}    # City E-Bike biggest
    dc_w = [0.18, 0.16, 0.14, 0.12, 0.10, 0.08, 0.12, 0.10]
    out = []
    for p, w, d in zip(product_id, week_off, dc_id):
        p = int(p); w = int(w); d = int(d)
        b = base[p] * dc_w[d - 1]
        trend = 1.0 + 0.0015 * w
        seas = 1.0 + 0.06 * np.sin(2 * np.pi * w / 52.0)
        val = b * trend * seas
        # --- THE SURGE: City E-Bike ramps hard from SO, ONLY in EMEA (DCs 1-3) ---
        # A new EMEA market opened, so only EMEA demand jumps; other regions stay flat.
        if p == 1 and w >= SO and d in (1, 2, 3):
            ramp = min(1.0, (w - SO) / 6.0)
            val = val * (1.0 + ramp * 2.4)
        val = val * rng.uniform(0.92, 1.08)
        out.append(int(max(val, 0)))
    return pd.Series(out)


product_demand_df = (grid_df
    .withColumn("demand_units", demand_udf(F.col("product_id"), F.col("week_off"), F.col("dc_id")))
    .withColumn("week", F.expr(f"date_add(DATE'{START}', CAST(week_off*7 AS INT))"))
    .withColumn("demand_id", F.monotonically_increasing_id())
    .drop("week_off"))


# ===========================================================================
# PHASE 2 — SILVER (typed tables; write, then add PK/FK RELY constraints)
# ===========================================================================
# All id columns are cast to BIGINT (and qty_per_unit / lead_time_weeks to INT) so
# every FK child column matches its referenced parent PK type exactly.
def save(df, name):
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.{name}")
    print(f"   {name}: {df.count()} rows")


print("== silver ==")
save(products_df.select(
        F.col("product_id").cast("bigint").alias("product_id"), "product_name", "category"),
     "products")
save(dcs_df.select(
        F.col("dc_id").cast("bigint").alias("dc_id"), "dc_name", "region", "country", "country_code",
        F.col("latitude").cast("double").alias("latitude"), F.col("longitude").cast("double").alias("longitude")),
     "distribution_centers")
save(market_launches_df.select(
        F.col("launch_id").cast("bigint").alias("launch_id"), "product_name", "region", "launch_date",
        "launch_name", "description"),
     "market_launches")
save(suppliers_df.select(
        F.col("supplier_id").cast("bigint").alias("supplier_id"), "supplier_name", "region",
        F.col("lead_time_weeks").cast("int").alias("lead_time_weeks"),
        F.col("reliability_pct").cast("double").alias("reliability_pct")),
     "suppliers")
save(components_df.select(
        F.col("component_id").cast("bigint").alias("component_id"), "component_name", "component_type",
        F.col("supplier_id").cast("bigint").alias("supplier_id"),
        F.col("unit_cost").cast("double").alias("unit_cost")),
     "components")
save(plants_df.select(
        F.col("plant_id").cast("bigint").alias("plant_id"), "plant_name", "region"),
     "plants")
save(inventory_df.select(
        F.col("component_id").cast("bigint").alias("component_id"),
        F.col("plant_id").cast("bigint").alias("plant_id"),
        F.col("on_hand_units").cast("bigint").alias("on_hand_units"),
        F.col("safety_stock_units").cast("bigint").alias("safety_stock_units"),
        F.col("weekly_supply_units").cast("bigint").alias("weekly_supply_units")),
     "inventory")
save(bom_df.select(
        F.col("product_id").cast("bigint").alias("product_id"),
        F.col("component_id").cast("bigint").alias("component_id"),
        F.col("qty_per_unit").cast("int").alias("qty_per_unit")),
     "bom")
save(purchase_orders_df.select(
        F.col("po_id").cast("bigint").alias("po_id"),
        F.col("component_id").cast("bigint").alias("component_id"),
        F.col("plant_id").cast("bigint").alias("plant_id"),
        F.col("supplier_id").cast("bigint").alias("supplier_id"),
        "order_week", "expected_arrival_week",
        F.col("qty_units").cast("bigint").alias("qty_units"), "status"),
     "purchase_orders")
save(product_demand_df.select(
        F.col("demand_id").cast("bigint").alias("demand_id"), "week",
        F.col("product_id").cast("bigint").alias("product_id"),
        F.col("dc_id").cast("bigint").alias("dc_id"),
        F.col("demand_units").cast("bigint").alias("demand_units")),
     "product_demand")

# PK/FK constraints (NOT ENFORCED, RELY) — light up Catalog Explorer + help Genie.
# A PK column must be NOT NULL first, so the statements run in order: set the key
# columns NOT NULL, then add the PRIMARY KEYs, then the FOREIGN KEYs (after all
# referenced PKs exist). Plain list of full SQL so it's easy to read/copy/run.
_constraints = [
    # --- key columns NOT NULL (required before PRIMARY KEY) ---
    f"ALTER TABLE {FQ}.products              ALTER COLUMN product_id    SET NOT NULL",
    f"ALTER TABLE {FQ}.distribution_centers  ALTER COLUMN dc_id         SET NOT NULL",
    f"ALTER TABLE {FQ}.market_launches       ALTER COLUMN launch_id     SET NOT NULL",
    f"ALTER TABLE {FQ}.suppliers             ALTER COLUMN supplier_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.components            ALTER COLUMN component_id  SET NOT NULL",
    f"ALTER TABLE {FQ}.plants                ALTER COLUMN plant_id      SET NOT NULL",
    f"ALTER TABLE {FQ}.purchase_orders       ALTER COLUMN po_id         SET NOT NULL",
    f"ALTER TABLE {FQ}.product_demand        ALTER COLUMN demand_id     SET NOT NULL",
    f"ALTER TABLE {FQ}.components            ALTER COLUMN supplier_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.inventory             ALTER COLUMN component_id  SET NOT NULL",
    f"ALTER TABLE {FQ}.inventory             ALTER COLUMN plant_id      SET NOT NULL",
    f"ALTER TABLE {FQ}.bom                   ALTER COLUMN product_id    SET NOT NULL",
    f"ALTER TABLE {FQ}.bom                   ALTER COLUMN component_id  SET NOT NULL",
    f"ALTER TABLE {FQ}.purchase_orders       ALTER COLUMN component_id  SET NOT NULL",
    f"ALTER TABLE {FQ}.purchase_orders       ALTER COLUMN plant_id      SET NOT NULL",
    f"ALTER TABLE {FQ}.purchase_orders       ALTER COLUMN supplier_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.product_demand        ALTER COLUMN product_id    SET NOT NULL",
    f"ALTER TABLE {FQ}.product_demand        ALTER COLUMN dc_id         SET NOT NULL",
    # --- primary keys ---
    f"ALTER TABLE {FQ}.products              ADD CONSTRAINT products_pk             PRIMARY KEY (product_id) RELY",
    f"ALTER TABLE {FQ}.distribution_centers  ADD CONSTRAINT distribution_centers_pk PRIMARY KEY (dc_id) RELY",
    f"ALTER TABLE {FQ}.market_launches       ADD CONSTRAINT market_launches_pk      PRIMARY KEY (launch_id) RELY",
    f"ALTER TABLE {FQ}.suppliers             ADD CONSTRAINT suppliers_pk            PRIMARY KEY (supplier_id) RELY",
    f"ALTER TABLE {FQ}.components            ADD CONSTRAINT components_pk           PRIMARY KEY (component_id) RELY",
    f"ALTER TABLE {FQ}.plants                ADD CONSTRAINT plants_pk               PRIMARY KEY (plant_id) RELY",
    f"ALTER TABLE {FQ}.purchase_orders       ADD CONSTRAINT purchase_orders_pk      PRIMARY KEY (po_id) RELY",
    f"ALTER TABLE {FQ}.product_demand        ADD CONSTRAINT product_demand_pk       PRIMARY KEY (demand_id) RELY",
    # --- foreign keys (children -> dimensions) ---
    f"ALTER TABLE {FQ}.components      ADD CONSTRAINT comp_supplier_fk FOREIGN KEY (supplier_id)  REFERENCES {FQ}.suppliers(supplier_id) RELY",
    f"ALTER TABLE {FQ}.inventory       ADD CONSTRAINT inv_component_fk FOREIGN KEY (component_id) REFERENCES {FQ}.components(component_id) RELY",
    f"ALTER TABLE {FQ}.inventory       ADD CONSTRAINT inv_plant_fk     FOREIGN KEY (plant_id)     REFERENCES {FQ}.plants(plant_id) RELY",
    f"ALTER TABLE {FQ}.bom             ADD CONSTRAINT bom_product_fk   FOREIGN KEY (product_id)   REFERENCES {FQ}.products(product_id) RELY",
    f"ALTER TABLE {FQ}.bom             ADD CONSTRAINT bom_component_fk FOREIGN KEY (component_id) REFERENCES {FQ}.components(component_id) RELY",
    f"ALTER TABLE {FQ}.purchase_orders ADD CONSTRAINT po_component_fk  FOREIGN KEY (component_id) REFERENCES {FQ}.components(component_id) RELY",
    f"ALTER TABLE {FQ}.purchase_orders ADD CONSTRAINT po_plant_fk      FOREIGN KEY (plant_id)     REFERENCES {FQ}.plants(plant_id) RELY",
    f"ALTER TABLE {FQ}.purchase_orders ADD CONSTRAINT po_supplier_fk   FOREIGN KEY (supplier_id)  REFERENCES {FQ}.suppliers(supplier_id) RELY",
    f"ALTER TABLE {FQ}.product_demand  ADD CONSTRAINT dem_product_fk   FOREIGN KEY (product_id)   REFERENCES {FQ}.products(product_id) RELY",
    f"ALTER TABLE {FQ}.product_demand  ADD CONSTRAINT dem_dc_fk        FOREIGN KEY (dc_id)        REFERENCES {FQ}.distribution_centers(dc_id) RELY",
]
for c in _constraints:
    try:
        spark.sql(c)
    except Exception as e:  # noqa: BLE001 — idempotent: NOT NULL / constraint may already be set
        print(f"   (skip) {str(e).splitlines()[0][:90]}")


# ===========================================================================
# PHASE 3 — GOLD (demand_enriched + component_status)
# ===========================================================================
print("== gold ==")
# demand_enriched — analysis-ready weekly demand joined with product + DC (region,
# country, geo). Powers the demand metric view, the map and the AI forecast.
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.demand_enriched
COMMENT 'Analysis-ready weekly demand joined with product and distribution center (region, country, geo). Powers the demand metric view, the map and the forecast. City E-Bike demand surges in EMEA from 2026-04-20 (new market).'
AS SELECT d.demand_id, d.week, d.product_id, p.product_name, p.category,
     d.dc_id, dc.dc_name, dc.region, dc.country, dc.country_code, dc.latitude, dc.longitude,
     d.demand_units
   FROM {FQ}.product_demand d
   JOIN {FQ}.products p ON d.product_id = p.product_id
   JOIN {FQ}.distribution_centers dc ON d.dc_id = dc.dc_id
""")
print("   demand_enriched: built")

# component_status — per component x plant supply risk: on-hand, safety stock, supplier
# lead time, recent weekly demand (rolled up from the BOM) and weeks of cover
# (on-hand / weekly demand). A component is At risk when weeks of cover <= lead time.
# Plants serve regions: Rotterdam (plant 1) = EMEA+APAC; Detroit (plant 2) = AMER.
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.component_status
COMMENT 'Per component x plant supply risk: on-hand, safety stock, supplier lead time, recent weekly demand (rolled up from the BOM) and weeks of cover (on-hand / weekly demand). A component is At risk when weeks of cover is below the supplier lead time. Only the Battery Cell is at risk - worst at Rotterdam (~2-3 weeks vs an 8-week lead time).'
AS WITH plant_demand AS (
     SELECT b.component_id,
       CASE WHEN d.region IN ('EMEA','APAC') THEN 1 ELSE 2 END AS plant_id,
       SUM(d.demand_units * b.qty_per_unit) / COUNT(DISTINCT d.week) AS awd
     FROM {FQ}.demand_enriched d
     JOIN {FQ}.bom b ON d.product_id = b.product_id
     WHERE d.week >= (SELECT date_sub(max(week), 28) FROM {FQ}.demand_enriched)
     GROUP BY 1, 2)
   SELECT c.component_id, c.component_name, c.component_type, pl.plant_id, pl.plant_name,
     s.supplier_name, s.lead_time_weeks,
     i.on_hand_units, i.safety_stock_units, i.weekly_supply_units,
     ROUND(pd.awd) AS avg_weekly_demand,
     ROUND(i.on_hand_units / pd.awd, 1) AS weeks_of_cover,
     CASE WHEN i.on_hand_units / pd.awd <= s.lead_time_weeks THEN 'At risk' ELSE 'Healthy' END AS status
   FROM {FQ}.components c
   JOIN {FQ}.suppliers s ON c.supplier_id = s.supplier_id
   JOIN {FQ}.inventory i ON c.component_id = i.component_id
   JOIN {FQ}.plants pl ON i.plant_id = pl.plant_id
   JOIN plant_demand pd ON pd.component_id = c.component_id AND pd.plant_id = pl.plant_id
""")
print("   component_status: built")


# ===========================================================================
# PHASE 4 — METRICS (governed metric view; measures correct under any grouping)
# ===========================================================================
print("== metric view ==")
spark.sql(f"""
CREATE OR REPLACE VIEW {FQ}.metrics_demand
WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: {CATALOG}.{SCHEMA}.demand_enriched
comment: "Governed e-bike demand KPIs. Weekly product demand by DC and region. City E-Bike demand surges in EMEA from 2026-04-20 (new market), which via the BOM drains the shared Battery Cell."
dimensions:
  - name: Week
    expr: week
  - name: Product
    expr: product_name
  - name: Category
    expr: category
  - name: Distribution Center
    expr: dc_name
  - name: Region
    expr: region
  - name: Country
    expr: country
  - name: Country Code
    expr: country_code
  - name: Latitude
    expr: latitude
  - name: Longitude
    expr: longitude
measures:
  - name: Demand Units
    expr: SUM(demand_units)
$$
""")
print("   metrics_demand: built")

print(f"\nDONE — {CATALOG}.{SCHEMA} built: 9 base tables + demand_enriched + component_status + metrics_demand")
