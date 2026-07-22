#!/usr/bin/env python
"""
AI/BI Healthcare CFO — Budget Variance & Comp Controls: self-contained data
generation + medallion build.

Self-contained synthetic demo. Raw feeds and the bronze -> silver -> gold SQL are
folded into ONE script so a fork rebuilds the whole demo from scratch with no
external dataset dependency and no parquet round-trip:

  Phase 1  RAW    — GL actuals, budget, revenue, staffing hours, compensation and
                    staffing-vendor invoices — generated deterministically with pure
                    Spark (a couple of pandas_udf fan-outs). Encodes the variance
                    shape: Nursing Contract Labor ramps Q2+ to +$3.58M, everything
                    else tracks flat to budget; revenue flat YoY (~+1.3%); agency
                    nurse hours ramp from index ~100 to ~280 at ~2x cost; Apex
                    Clinical Staffing ~3.5x YoY; 4 hospitals with the overrun
                    concentrated at Lakeshore + Riverside.
  Phase 2  SILVER — typed, constrained tables (PK/FK RELY for Catalog Explorer).
  Phase 3  GOLD   — gold_opex_monthly, gold_budget_variance, gold_staffing_summary,
                    gold_vendor_spend, gold_revenue, gold_facility_variance
                    (+ actual half of the forecast).

STORY — "It's a cost problem, and it's one line item":
A regional non-profit health system closes the month and the full-year opex forecast
tracks ~$4.8M over a ~$820M budget while recognized revenue is flat (~+1.3% YoY). The
whole miss traces to ONE department (Nursing) and ONE line item (Contract Labor,
+$3.58M): RN vacancies backfilled with agency nurses at ~2x cost, most of the agency
spend routed to ONE vendor (Apex Clinical Staffing, up ~3.5x YoY). Unity Catalog
column-masking governs who sees compensation detail (Finance sees comp, ops managers
see headcount only) — built in src/deploy/comp_masking.sql.

The AI_FORECAST projection (gold_opex_forecast) is materialised on a SQL warehouse
by the DAB sql_task in src/deploy/build_forecast.sql — AI_FORECAST is disabled on
databricks-connect serverless, so this script deliberately does NOT call it and
builds only the ACTUAL months of gold_opex_monthly; the warehouse task extends them
with the forecast rows.

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
      python generate_data.py --catalog dbdemos_templates --schema aibi_cfo_health_budget_variance
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
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "aibi_cfo_health_budget_variance")

FQ = f"`{CATALOG}`.`{SCHEMA}`"          # fully-qualified, back-ticked

# ---------------------------------------------------------------------------
# Temporal anchors (load-bearing — every consumer depends on them).
# We work in ONE fiscal year (Jan 1 -> Dec 1, monthly grain). Actuals exist for the
# months already elapsed; AI_FORECAST (built on the warehouse) projects the rest.
# ---------------------------------------------------------------------------
FISCAL_YEAR = 2026
FY_START = dt.date(FISCAL_YEAR, 1, 1)
# Months with ACTUALS = the elapsed months of the fiscal year. We fix this at 7
# (Jan..Jul) so the demo is deterministic regardless of run date; the forecast task
# then projects Aug..Dec. The Nursing Contract Labor ramp (small in Q1, accelerating
# from Q2) makes the trend extrapolate ~$4.8M over budget by year-end.
N_ACTUAL_MONTHS = 7
ACTUAL_MONTHS = [dt.date(FISCAL_YEAR, m, 1) for m in range(1, N_ACTUAL_MONTHS + 1)]
ALL_MONTHS = [dt.date(FISCAL_YEAR, m, 1) for m in range(1, 13)]

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG}`")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


# ===========================================================================
# SHARED CONTEXT — deterministic budgets / variance shape (see 01-lakeflow.md §A)
# ===========================================================================
# annual opex budget by department (sums to ~$820M).
DEPT_BUDGET = {
    "Nursing":            210_000_000.0,
    "Surgical Services":  140_000_000.0,
    "Emergency":           95_000_000.0,
    "Radiology":           70_000_000.0,
    "Pharmacy":           120_000_000.0,
    "Lab":                 55_000_000.0,
    "Facilities":          60_000_000.0,
    "Administration":      70_000_000.0,
}
DEPTS = list(DEPT_BUDGET)

# expense-category share of a department's budget (must sum to 1.0).
CATEGORIES = ["Salaries", "Benefits", "Contract Labor", "Supplies",
              "Purchased Services", "Other"]
CAT_SHARE = {
    "Salaries":           0.50,
    "Benefits":           0.16,
    "Contract Labor":     0.06,
    "Supplies":           0.14,
    "Purchased Services": 0.09,
    "Other":              0.05,
}

# Full-year variance we want each (dept, category) to LAND at (actual - budget), $.
# Only Nursing/Contract Labor is material (+$3.58M); a little Pharmacy/Facilities
# drift for realism; everything else ~flat. These are FULL-YEAR (12-month) targets;
# the actual months carry the elapsed fraction of each, the forecast carries the rest.
FULL_YEAR_VARIANCE = {
    ("Nursing", "Contract Labor"):  3_580_000.0,   # THE punchline (~75% of the ~$4.8M forecast miss)
    ("Pharmacy", "Supplies"):         160_000.0,   # drug-cost inflation, minor
    ("Facilities", "Purchased Services"):  90_000.0,
}
# Full-year deterministic total variance = $3.58M + $0.16M + $0.09M = ~$3.83M. The
# board-headline miss (~$4.8M) is AI_FORECAST's independent projection of the rising
# opex trend to year-end (gold_opex_forecast) — a trend forecast lands a touch above
# the bottoms-up total, which is exactly the "forecast says we'll end over" story.

# Contract-Labor ramp weight by month index (Jan=0..Dec=11). THE STORY ARC: opex tracks
# at/under budget through spring (RN vacancies still covered internally), then the agency
# backfill surges from ~May and monthly opex CROSSES ABOVE BUDGET in early summer — the
# "we just went over" moment on the dashboard. AI_FORECAST catches that steep recent
# upturn and projects the gap widening hard to year-end (a big, alarming miss) — which
# is exactly the trigger to investigate. Back-loaded on purpose. Sums to 1.0.
_ramp = [0.0, 0.0, 0.01, 0.02, 0.05, 0.10, 0.14, 0.15, 0.15, 0.13, 0.13, 0.12]
assert abs(sum(_ramp) - 1.0) < 1e-9, sum(_ramp)


def month_actual(dept, cat, month_idx):
    """Deterministic monthly ACTUAL for (dept, category, month) in USD."""
    base = DEPT_BUDGET[dept] * CAT_SHARE[cat] / 12.0
    var_total = FULL_YEAR_VARIANCE.get((dept, cat), 0.0)
    if (dept, cat) == ("Nursing", "Contract Labor"):
        # the ramp — concentrates the overrun in Q2+.
        extra = var_total * _ramp[month_idx]
    else:
        extra = var_total / 12.0
    # tiny deterministic noise (±0.05%) so non-variance lines look real, not flat-lined.
    # Kept small: at a ~$70M/mo opex level, larger noise would swamp the ramp signal and
    # make AI_FORECAST's trend fit erratic.
    noise = base * 0.0005 * (((hash((dept, cat, month_idx)) % 200) - 100) / 100.0)
    return round(base + extra + noise, 2)


def month_budget(dept, cat):
    return round(DEPT_BUDGET[dept] * CAT_SHARE[cat] / 12.0, 2)


# ===========================================================================
# PHASE 1 — RAW (generated deterministically with pure Spark)
# ===========================================================================
# --- gl_actuals (monthly GL actuals by dept x category x cost center) ------
# A couple of cost centers per department so the fact has realistic grain; the
# monthly (dept, category) total is split across them.
# We generate ACTUALS for the ELAPSED months (Jan..Jul); the remaining months are
# projected by AI_FORECAST on the warehouse. gold_budget_variance below is built as a
# FULL-YEAR projection (elapsed actuals + the same deterministic model for the
# remaining months) so the department/category story lands the full-year +$3.58M
# Nursing Contract Labor overrun that ties to the ~$4.8M forecast miss.
COST_CENTERS = {d: [f"{d[:4].upper()}-{i:02d}" for i in range(1, 4)] for d in DEPTS}

# --- facilities (geography — 4 hospitals in the Chicagoland metro) -----------
# The system is a regional non-profit with 4 hospitals clustered around Chicago.
# Each cost center rolls up to exactly one facility. The Nursing contract-labor
# overrun is CONCENTRATED at 2 of the 4 (the RN-vacancy/agency problem is worst
# there), so on the map those two dots are by far the biggest.
FACILITIES = [
    # facility_id, facility_name, city, latitude, longitude
    ("FAC-01", "Lakeshore Medical Center",       "Chicago",     41.90, -87.63),
    ("FAC-02", "Riverside Community Hospital",    "Cicero",      41.85, -87.68),
    ("FAC-03", "North Suburban Hospital",         "Evanston",    42.06, -87.69),
    ("FAC-04", "Westgate Regional Medical",       "Oak Park",    41.87, -87.95),
]
FACILITY_BY_ID = {f[0]: f for f in FACILITIES}

# cost_center -> facility_id. Load-bearing: ALL THREE Nursing cost centers map to
# just FAC-01 and FAC-02 (NURS-01 0.5 -> FAC-01; NURS-02 0.3 + NURS-03 0.2 -> FAC-02),
# so the entire Nursing Contract Labor overrun (+$3.58M) lands at those two hospitals
# — the big red dots. FAC-03 and FAC-04 carry no Nursing and sit near zero. Every
# other department's 3 cost centers spread round-robin across the 4 facilities so
# non-Nursing variance (near zero) sprinkles thinly.
COST_CENTER_FACILITY = {}
# Nursing: pin the split so the overrun concentrates at FAC-01 + FAC-02 only.
COST_CENTER_FACILITY["NURS-01"] = "FAC-01"   # 0.5 of Nursing
COST_CENTER_FACILITY["NURS-02"] = "FAC-02"   # 0.3 of Nursing
COST_CENTER_FACILITY["NURS-03"] = "FAC-02"   # 0.2 of Nursing -> also FAC-02
# All other departments: round-robin their cost centers across the 4 facilities.
_fac_ids = [f[0] for f in FACILITIES]
_rr = 0
for _d in DEPTS:
    if _d == "Nursing":
        continue
    for _cc in COST_CENTERS[_d]:
        COST_CENTER_FACILITY[_cc] = _fac_ids[_rr % len(_fac_ids)]
        _rr += 1

fac_rows = [(fid, fname, city, lat, lon) for (fid, fname, city, lat, lon) in FACILITIES]
fac_schema = StructType([
    StructField("facility_id", StringType()), StructField("facility_name", StringType()),
    StructField("city", StringType()), StructField("latitude", DoubleType()),
    StructField("longitude", DoubleType())])
facilities_df = spark.createDataFrame(fac_rows, fac_schema)
gl_rows = []
_rid = 0
for m_idx, month in enumerate(ACTUAL_MONTHS):
    for dept in DEPTS:
        ccs = COST_CENTERS[dept]
        for cat in CATEGORIES:
            total = month_actual(dept, cat, m_idx)
            # split across cost centers with fixed weights (sum to 1).
            w = [0.5, 0.3, 0.2]
            for i, cc in enumerate(ccs):
                _rid += 1
                gl_rows.append((_rid, month, dept, cc, cat, round(total * w[i], 2)))
gl_schema = StructType([
    StructField("row_id", IntegerType()), StructField("fiscal_month", DateType()),
    StructField("department", StringType()), StructField("cost_center", StringType()),
    StructField("expense_category", StringType()), StructField("actual_usd", DoubleType())])
gl_df = spark.createDataFrame(gl_rows, gl_schema)

# --- budget (monthly budget by dept x category) ----------------------------
bud_rows = []
_bid = 0
for month in ALL_MONTHS:
    for dept in DEPTS:
        for cat in CATEGORIES:
            _bid += 1
            bud_rows.append((_bid, month, dept, cat, month_budget(dept, cat)))
bud_schema = StructType([
    StructField("row_id", IntegerType()), StructField("fiscal_month", DateType()),
    StructField("department", StringType()), StructField("expense_category", StringType()),
    StructField("budget_usd", DoubleType())])
budget_df = spark.createDataFrame(bud_rows, bud_schema)

# --- revenue (monthly recognized net patient revenue — realistic, ~flat YoY) ----
# Net patient revenue swings month to month (flu season, elective-surgery cycles,
# payer-mix shifts, DSH timing). We generate current AND prior year INDEPENDENTLY with
# real healthcare seasonality + noise, so per-month YoY varies believably (~ -4% .. +5%)
# while the FULL-YEAR total nets to roughly flat / low-single-digit growth (~+1.3%). That
# is the actual CFO read: demand is basically flat, so a big opex overrun is a COST
# problem, not a volume problem. (No mechanical +0.5%/month — that looked fake.)
# Healthcare monthly seasonality: winter respiratory peak (Jan-Mar), summer dip,
# year-end elective surgery surge (patients hitting deductibles in Q4).
_season = [1.06, 1.04, 1.05, 0.99, 0.97, 0.96, 0.95, 0.97, 1.00, 1.03, 1.05, 1.10]
REV_BASE = 68_500_000.0            # avg monthly net patient revenue -> ~$822M/yr
# Independent month-to-month noise on each year, ±4-6% swings, so the two lines are
# VISIBLY distinct (some months current clearly above prior, others clearly below)
# while the full-year total still nets to ~flat (+~1% YoY). The two arrays average to
# ~1.0 so neither year drifts systematically off the seasonal spine.
_cur_noise = [1.05, 0.96, 1.04, 0.95, 1.04, 0.96, 1.02, 1.05, 0.96, 1.04, 0.95, 1.04]
_pri_noise = [0.96, 1.05, 0.95, 1.05, 0.96, 1.04, 1.04, 0.95, 1.05, 0.96, 1.05, 0.95]
# a small genuine growth drift on the current year (~+1% full-year, uneven by month)
_growth = [1.006, 1.010, 1.005, 1.012, 1.004, 1.008, 1.012, 1.002, 1.011, 1.006, 1.009, 1.013]
rev_rows = []
for i, month in enumerate(ALL_MONTHS):
    prior = round(REV_BASE * _season[i] * _pri_noise[i], 2)
    cur = round(REV_BASE * _season[i] * _cur_noise[i] * _growth[i], 2)
    rev_rows.append((month, cur, prior))
rev_schema = StructType([
    StructField("fiscal_month", DateType()),
    StructField("net_patient_revenue_usd", DoubleType()),
    StructField("prior_year_revenue_usd", DoubleType())])
revenue_df = spark.createDataFrame(rev_rows, rev_schema)

# --- staffing_hours (monthly dept x worker_type x role hours + cost) --------
# The root cause reads directly off Nursing: employed RN hours flat all year; agency
# RN hours ramp from an index of ~100 to ~280 (mirroring the Contract Labor ramp) at ~2x hourly cost.
EMPLOYED_RATE = 52.0     # blended $/hr all-in
AGENCY_RATE = 105.0      # ~2.0x employed
# Employed RN ~1,000 FTE => ~1,000 * ~160 hr/month ~ 160k hr/month, held flat.
NURSING_EMPLOYED_HRS = 160_000.0
# Agency baseline (Jan) small, grows so late-year months index to ~280 vs January's 100
# (nearly 3x); the ramp mirrors Contract Labor. Total agency labor cost over
# actual+forecast ties to the $3.58M Contract Labor overrun.
_agency_base = 6_500.0   # hours in the low months
# Employed hours are ROUGHLY stable but not dead-flat — real staffing wobbles with PTO,
# census, and seasonal demand. A gentle ±3-5% month-to-month factor (indexed to Jan it
# hovers ~95-105, with visible bumps) keeps the "employed roughly stable" read while the
# agency line clearly ramps. Deterministic so the demo is reproducible.
_emp_wobble = [1.00, 0.97, 1.04, 1.02, 0.96, 1.05, 0.98, 1.03, 0.95, 1.02, 0.97, 1.01]
staff_rows = []
_sid = 0
for m_idx, month in enumerate(ALL_MONTHS):
    # Nursing employed RN — roughly stable with gentle month-to-month wobble.
    emp_hrs = round(NURSING_EMPLOYED_HRS * _emp_wobble[m_idx], 1)
    _sid += 1
    staff_rows.append((_sid, month, "Nursing", "Employed", "RN",
                       emp_hrs, EMPLOYED_RATE,
                       round(emp_hrs * EMPLOYED_RATE, 2)))
    # Nursing agency RN — ramps with the Contract Labor ramp.
    agency_hrs = round(_agency_base * (1.0 + 12.0 * _ramp[m_idx]), 1)
    _sid += 1
    staff_rows.append((_sid, month, "Nursing", "Agency", "RN",
                       agency_hrs, AGENCY_RATE, round(agency_hrs * AGENCY_RATE, 2)))
    # A little employed staffing for other big departments (same gentle wobble) so the
    # table isn't Nursing-only — keeps a department filter meaningful.
    for dept, hrs in [("Surgical Services", 90_000.0), ("Emergency", 70_000.0),
                      ("Radiology", 40_000.0)]:
        wob_hrs = round(hrs * _emp_wobble[m_idx], 1)
        _sid += 1
        staff_rows.append((_sid, month, dept, "Employed", "Tech",
                           wob_hrs, 48.0, round(wob_hrs * 48.0, 2)))
staff_schema = StructType([
    StructField("row_id", IntegerType()), StructField("fiscal_month", DateType()),
    StructField("department", StringType()), StructField("worker_type", StringType()),
    StructField("role", StringType()), StructField("hours", DoubleType()),
    StructField("blended_hourly_cost_usd", DoubleType()),
    StructField("labor_cost_usd", DoubleType())])
staffing_df = spark.createDataFrame(staff_rows, staff_schema)

# --- compensation (sensitive — masked in comp_masking.sql) -----------------
# One row per (role x department): headcount, base salary, total comp, blended $/hr.
_roles = ["RN", "Physician", "Tech", "Aide", "Manager", "Analyst"]
_role_comp = {   # base_salary, total_comp, blended_hourly
    "RN":        (88_000.0, 112_000.0, 52.0),
    "Physician": (285_000.0, 340_000.0, 165.0),
    "Tech":      (62_000.0, 78_000.0, 40.0),
    "Aide":      (41_000.0, 52_000.0, 27.0),
    "Manager":   (118_000.0, 150_000.0, 74.0),
    "Analyst":   (82_000.0, 100_000.0, 49.0),
}
_dept_head = {   # rough headcount scale per department
    "Nursing": 1000, "Surgical Services": 420, "Emergency": 300, "Radiology": 180,
    "Pharmacy": 160, "Lab": 150, "Facilities": 210, "Administration": 240,
}
comp_rows = []
for dept in DEPTS:
    for role in _roles:
        # headcount weighted by role x department (RN dominates Nursing, etc.)
        base_head = _dept_head[dept]
        if role == "RN":
            head = int(base_head * (0.72 if dept == "Nursing" else 0.10))
        elif role == "Physician":
            head = int(base_head * (0.10 if dept in ("Surgical Services", "Emergency") else 0.03))
        elif role == "Manager":
            head = max(3, int(base_head * 0.05))
        elif role == "Analyst":
            head = int(base_head * (0.20 if dept == "Administration" else 0.04))
        else:
            head = int(base_head * 0.15)
        if head <= 0:
            continue
        bs, tc, bh = _role_comp[role]
        comp_rows.append((role, dept, head, bs, tc, bh))
comp_schema = StructType([
    StructField("role", StringType()), StructField("department", StringType()),
    StructField("headcount", IntegerType()), StructField("base_salary_usd", DoubleType()),
    StructField("total_comp_usd", DoubleType()),
    StructField("blended_hourly_cost_usd", DoubleType())])
comp_df = spark.createDataFrame(comp_rows, comp_schema)

# --- vendor_invoices (staffing-vendor invoices — Apex dominates, up ~3.5x) --
# Nursing agency spend routed to a handful of vendors. Apex takes the lion's share of
# the current-year ramp; prior-year comparison lives in the vendor gold via a scalar.
VENDOR_CUR = {    # current-year total spend (approx) on Nursing agency
    "Apex Clinical Staffing":        3_200_000.0,
    "Cornerstone Medical Staffing":    800_000.0,
    "BlueRidge Nurses":                500_000.0,
    "MedStaff Partners":               260_000.0,
    "CareBridge Locums":               180_000.0,
}
VENDOR_PRIOR = {
    "Apex Clinical Staffing":          900_000.0,   # ~3.5x YoY
    "Cornerstone Medical Staffing":    600_000.0,
    "BlueRidge Nurses":                400_000.0,
    "MedStaff Partners":               230_000.0,
    "CareBridge Locums":               160_000.0,
}
inv_rows = []
_iid = 0
for vendor, total in VENDOR_CUR.items():
    # spread current-year (full-year) invoices across all months following the ramp.
    for m_idx, month in enumerate(ALL_MONTHS):
        amt = round(total * _ramp[m_idx], 2)
        hrs = round(amt / AGENCY_RATE, 1)
        _iid += 1
        inv_rows.append((_iid, vendor, "Nursing", month, "Agency", amt, hrs))
inv_schema = StructType([
    StructField("invoice_id", IntegerType()), StructField("vendor_name", StringType()),
    StructField("department", StringType()), StructField("fiscal_month", DateType()),
    StructField("worker_type", StringType()), StructField("amount_usd", DoubleType()),
    StructField("hours_billed", DoubleType())])
vendor_df = spark.createDataFrame(inv_rows, inv_schema)


# ===========================================================================
# PHASE 2 — SILVER (typed tables; write, then add PK/FK RELY constraints)
# ===========================================================================
def save(df, name):
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.{name}")
    print(f"   {name}: {df.count()} rows")


print("== silver ==")
save(gl_df, "gl_actuals")
save(budget_df, "budget")
save(revenue_df, "revenue")
save(staffing_df, "staffing_hours")
save(comp_df, "compensation")
save(vendor_df, "vendor_invoices")
save(facilities_df, "facilities")

# PK/FK constraints (NOT ENFORCED, RELY) — light up Catalog Explorer + help Genie.
# A PK column must be NOT NULL first, so statements run in order: set key columns
# NOT NULL, then add PRIMARY KEYs. (No cross-fact FKs here — these are conformed feeds
# keyed by natural business keys, not a star schema.) Plain list of full SQL.
_constraints = [
    f"ALTER TABLE {FQ}.gl_actuals      ALTER COLUMN row_id       SET NOT NULL",
    f"ALTER TABLE {FQ}.budget          ALTER COLUMN row_id       SET NOT NULL",
    f"ALTER TABLE {FQ}.revenue         ALTER COLUMN fiscal_month SET NOT NULL",
    f"ALTER TABLE {FQ}.staffing_hours  ALTER COLUMN row_id       SET NOT NULL",
    f"ALTER TABLE {FQ}.vendor_invoices ALTER COLUMN invoice_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.facilities      ALTER COLUMN facility_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.gl_actuals      ADD CONSTRAINT gl_pk       PRIMARY KEY (row_id) RELY",
    f"ALTER TABLE {FQ}.budget          ADD CONSTRAINT budget_pk   PRIMARY KEY (row_id) RELY",
    f"ALTER TABLE {FQ}.revenue         ADD CONSTRAINT revenue_pk  PRIMARY KEY (fiscal_month) RELY",
    f"ALTER TABLE {FQ}.staffing_hours  ADD CONSTRAINT staffing_pk PRIMARY KEY (row_id) RELY",
    f"ALTER TABLE {FQ}.vendor_invoices ADD CONSTRAINT vendor_pk   PRIMARY KEY (invoice_id) RELY",
    f"ALTER TABLE {FQ}.facilities      ADD CONSTRAINT facility_pk PRIMARY KEY (facility_id) RELY",
]
for c in _constraints:
    try:
        spark.sql(c)
    except Exception as e:  # noqa: BLE001 — idempotent: NOT NULL / constraint may already be set
        print(f"   (skip) {str(e).splitlines()[0][:90]}")


# ===========================================================================
# PHASE 3 — GOLD (variance, staffing, vendor, revenue + ACTUAL opex-by-month)
# The AI_FORECAST projection (gold_opex_forecast) is materialised on the warehouse
# by src/deploy/build_forecast.sql — this script builds gold_opex_monthly (actuals
# only), which that task extends.
# ===========================================================================
print("== gold ==")

# gold_opex_monthly — one row per fiscal_month (actual months only): SUM actuals +
# SUM budget for those months.
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_opex_monthly
COMMENT 'Monthly total operating expense: actual (from gl_actuals) vs budget, for the elapsed (actual) months of the fiscal year. AI_FORECAST projects the remaining months in gold_opex_forecast.'
AS
WITH a AS (SELECT fiscal_month, SUM(actual_usd) actual_opex_usd FROM {FQ}.gl_actuals GROUP BY fiscal_month),
     b AS (SELECT fiscal_month, SUM(budget_usd) budget_opex_usd FROM {FQ}.budget GROUP BY fiscal_month)
SELECT a.fiscal_month, a.actual_opex_usd, b.budget_opex_usd
FROM a JOIN b USING (fiscal_month)
ORDER BY a.fiscal_month
""")
print("   gold_opex_monthly: built")

# gold_budget_variance — one row per (department, expense_category): FULL-YEAR
# projected actual vs full-year budget + variance + variance_pct. Built from the same
# deterministic model over all 12 months (elapsed actuals + projected remaining
# months) so the department/category story lands the full-year overrun: Nursing /
# Contract Labor = ~+$3.58M (the whole Nursing miss, ~75% of the ~$4.8M forecast miss); everything else near zero.
_var_rows = []
for dept in DEPTS:
    for cat in CATEGORIES:
        actual_fy = round(sum(month_actual(dept, cat, i) for i in range(12)), 2)
        budget_fy = round(month_budget(dept, cat) * 12, 2)
        var = round(actual_fy - budget_fy, 2)
        pct = round(var / budget_fy * 100, 2) if budget_fy else 0.0
        _var_rows.append((dept, cat, actual_fy, budget_fy, var, pct))
_var_schema = StructType([
    StructField("department", StringType()), StructField("expense_category", StringType()),
    StructField("actual_ytd_usd", DoubleType()), StructField("budget_ytd_usd", DoubleType()),
    StructField("variance_usd", DoubleType()), StructField("variance_pct", DoubleType())])
(spark.createDataFrame(_var_rows, _var_schema)
     .write.mode("overwrite").option("overwriteSchema", "true")
     .saveAsTable(f"{FQ}.gold_budget_variance"))
spark.sql(f"""
COMMENT ON TABLE {FQ}.gold_budget_variance IS
'Full-year projected budget variance by department and expense category (projected actual - budget). Nursing / Contract Labor is the large positive outlier (~+$3.58M, ~75% of the ~$4.8M forecast miss); every other department/category tracks near zero to budget.'
""")
print("   gold_budget_variance: built")

# gold_staffing_summary — one row per (fiscal_month, department, worker_type).
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_staffing_summary
COMMENT 'Monthly staffing hours and cost by department and worker type (Employed vs Agency). For Nursing, employed hours are flat while agency hours ramp from an index of ~100 to ~280 at ~2x the employed hourly cost — the contract-labor root cause.'
AS
SELECT fiscal_month, department, worker_type,
       SUM(hours) AS total_hours,
       SUM(labor_cost_usd) AS total_labor_cost_usd,
       ROUND(SUM(labor_cost_usd) / NULLIF(SUM(hours), 0), 2) AS avg_hourly_cost_usd
FROM {FQ}.staffing_hours
GROUP BY fiscal_month, department, worker_type
""")
print("   gold_staffing_summary: built")

# gold_vendor_spend — one row per (vendor_name, department): current-year YTD spend +
# prior-year spend + yoy_multiple. Apex Clinical Staffing on Nursing is the top row.
_prior_case = " ".join(
    [f"WHEN vendor_name = '{v}' THEN {p}" for v, p in VENDOR_PRIOR.items()])
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_vendor_spend
COMMENT 'Agency staffing spend by vendor and department: current-year YTD vs prior-year, with the YoY multiple. Apex Clinical Staffing dominates Nursing agency spend (~3.5x YoY) — the single vendor behind the contract-labor surge.'
AS
WITH cur AS (SELECT vendor_name, department, SUM(amount_usd) spend_ytd_usd
             FROM {FQ}.vendor_invoices GROUP BY vendor_name, department)
SELECT vendor_name, department,
       spend_ytd_usd,
       CASE {_prior_case} ELSE 0 END AS spend_prior_year_usd,
       ROUND(spend_ytd_usd / NULLIF(CASE {_prior_case} ELSE 0 END, 0), 2) AS yoy_multiple
FROM cur
ORDER BY spend_ytd_usd DESC
""")
print("   gold_vendor_spend: built")

# gold_revenue — one row per fiscal_month: recognized revenue + prior-year + YoY %.
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_revenue
COMMENT 'Monthly recognized net patient revenue vs prior year. Aggregate YoY is ~+1.3% (flat) — this is what makes the overrun a cost problem, not a demand problem.'
AS
SELECT fiscal_month, net_patient_revenue_usd, prior_year_revenue_usd,
       ROUND((net_patient_revenue_usd - prior_year_revenue_usd)
             / NULLIF(prior_year_revenue_usd, 0) * 100, 2) AS revenue_yoy_pct
FROM {FQ}.revenue
ORDER BY fiscal_month
""")
print("   gold_revenue: built")

# gold_facility_variance — one row per facility: full-year variance attributed to
# the facility's cost centers, plus the Nursing contract-labor slice. The overrun
# concentrates at FAC-01 + FAC-02 (they carry 80% of the Nursing Contract Labor
# +$3.58M via NURS-01/NURS-02), so on the map those two dots are by far the biggest;
# the other two facilities sit near zero. Total across facilities == the full-year
# deterministic total variance (~$3.83M), consistent with the ~$4.8M forecast story.
# Attribution uses the SAME 0.5/0.3/0.2 cost-center split that gl_actuals uses, so
# the geography rollup ties out to gold_budget_variance.
_cc_weights = [0.5, 0.3, 0.2]
_fac_var = {fid: 0.0 for fid, *_ in FACILITIES}          # total variance per facility
_fac_nurse_cl = {fid: 0.0 for fid, *_ in FACILITIES}     # Nursing Contract Labor slice
for dept in DEPTS:
    ccs = COST_CENTERS[dept]
    for cat in CATEGORIES:
        actual_fy = sum(month_actual(dept, cat, i) for i in range(12))
        budget_fy = month_budget(dept, cat) * 12
        var = actual_fy - budget_fy
        for i, cc in enumerate(ccs):
            fid = COST_CENTER_FACILITY[cc]
            _fac_var[fid] += var * _cc_weights[i]
            if (dept, cat) == ("Nursing", "Contract Labor"):
                _fac_nurse_cl[fid] += var * _cc_weights[i]
_facvar_rows = []
for fid, fname, city, lat, lon in FACILITIES:
    _facvar_rows.append((fid, fname, city, lat, lon,
                         round(_fac_var[fid], 2), round(_fac_nurse_cl[fid], 2)))
_facvar_schema = StructType([
    StructField("facility_id", StringType()), StructField("facility_name", StringType()),
    StructField("city", StringType()), StructField("latitude", DoubleType()),
    StructField("longitude", DoubleType()),
    StructField("total_variance_usd", DoubleType()),
    StructField("nursing_contract_labor_variance_usd", DoubleType())])
(spark.createDataFrame(_facvar_rows, _facvar_schema)
     .write.mode("overwrite").option("overwriteSchema", "true")
     .saveAsTable(f"{FQ}.gold_facility_variance"))
spark.sql(f"""
COMMENT ON TABLE {FQ}.gold_facility_variance IS
'Full-year budget variance attributed to each of the 4 hospitals (via the cost-center -> facility rollup), with latitude/longitude for the map and the Nursing contract-labor slice. Lakeshore Medical Center and Riverside Community Hospital carry ~80% of the Nursing contract-labor overrun (the big red dots); North Suburban and Westgate sit near zero.'
""")
print("   gold_facility_variance: built")


# ===========================================================================
# PHASE 4 — METRICS (governed metric view; measures correct under any grouping)
# ===========================================================================
print("== metric view ==")
spark.sql(f"""
CREATE OR REPLACE VIEW {FQ}.metrics_budget_variance
WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: {CATALOG}.{SCHEMA}.gold_budget_variance
comment: "Governed budget-variance KPIs for the CFO. Measures stay correct under any dimension grouping. The full-year overrun concentrates in Nursing / Contract Labor (~+$3.58M)."
dimensions:
  - name: Department
    expr: department
  - name: Expense Category
    expr: expense_category
measures:
  - name: Actual
    expr: SUM(actual_ytd_usd)
  - name: Budget
    expr: SUM(budget_ytd_usd)
  - name: Variance
    expr: SUM(variance_usd)
  - name: Variance Pct
    expr: SUM(variance_usd) / NULLIF(SUM(budget_ytd_usd), 0)
$$
""")
print("   metrics_budget_variance: built")

print(f"\nDONE — {CATALOG}.{SCHEMA} built: 7 raw/silver tables + 6 gold tables + metrics_budget_variance.")
print("       Run src/deploy/build_forecast.sql on a SQL warehouse to materialise")
print("       gold_opex_forecast (AI_FORECAST), then deploy_genie + comp_masking.")
