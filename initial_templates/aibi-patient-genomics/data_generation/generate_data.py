#!/usr/bin/env python
"""
AI/BI Patient Genomics (OncoTarget-1 RWE) — self-contained data generation + medallion build.

Self-contained synthetic demo. The
original ships a raw-parquet Spark generator (`data_generation.py`) plus install-time
derived-table SQL in `bundle_config.py`; here BOTH are folded into ONE script so a fork
rebuilds the whole demo from scratch with no external dataset dependency:

  Phase 1  RAW      — 4 TCGA-style clinical-genomics tables (demographics, diagnoses,
                      exposures, expression_profiles_umap), generated with pure Spark
                      (spark.range + one pandas_udf). No parquet round-trip.
  Phase 2  SILVER   — the raw tables written typed + constrained (PK/FK RELY for the
                      Catalog Explorer ER diagram + Genie join understanding).
  Phase 3  GOLD     — the DERIVED analysis tables (patient_cohort + the survival
                      rollups) built by the exact SQL from the original bundle_config.
  Phase 4  METRICS  — genomics_metrics governed metric view (WITH METRICS YAML).

DOMAIN: Real-world-evidence (RWE) precision oncology. A TCGA-style cohort of ~10,000
cancer patients described by the 4 RAW tables above; c1/c2 are 2-D UMAP coordinates of
each patient's gene-expression profile.

STORY — "OncoTarget-1 works, but UNEVENLY; the responders share a MOLECULAR signature,
not an organ": everything downstream (patient_cohort, survival_by_arm, arm_summary,
breast_deepdive, lift_by_site, survival_curve, survival_curve_responder, the metric
view) is DERIVED DETERMINISTICALLY from the 4 RAW tables. All tables join on case_id;
the cohort SQL keeps 1 row per case_id via row_number(). A stable hash(case_id) assigns
the treatment arm + outcome, so no external outcome generator is needed.

The single load-bearing signal is the UMAP:
    responder_subtype := (tissue = 'Breast, NOS' AND c1 > 2)
That responder subtype earns OncoTarget-1 its headline +0.22 (+22pp) survival lift in
the breast deep-dive (~99% treated vs ~89% standard of care). The fraction of Breast
patients with c1>2 MUST be preserved (~0.406 in the real data), reproduced here with a
two-component Breast mixture. Tissue COUNTS are preserved too, so `lift_by_site`
(HAVING patients>150) and `survival_by_arm` (patients>80) keep surfacing the same sites.
DO NOT SIMPLIFY the raw-gen UMAP mixture — it is the whole demo.

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
      python generate_data.py --catalog dbdemos_templates --schema aibi_patient_genomics
"""
import argparse
import os

import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.types import (DoubleType, StringType, StructField, StructType)

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
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "aibi_patient_genomics")

FQ = f"`{CATALOG}`.`{SCHEMA}`"          # fully-qualified, back-ticked
SEED = 42
N_PATIENTS = 10346          # matches real deduped cohort size (1 row / case_id / table)
RESPONDER_TISSUE = "Breast, NOS"

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG}`")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


# ===========================================================================
# PHASE 1 — RAW  (deterministic Spark generator; verbatim from the original
#                 the demo library data_generation.py — the UMAP mixture is load-bearing)
# ===========================================================================
# --- Per-tissue profile: (tissue, n_cases, c1_mean, c1_std, c2_mean, c2_std, primary_diagnosis) ---
# n_cases sums to 8858 for these 31 sites; the remaining ~1488 patients go to a spread of "other"
# small sites. Centers are the profiled UMAP cluster centers (drives the "UMAP molecular map" chart).
# Breast is special-cased below (mixture), its center row is only used for count + primary_diagnosis.
TISSUES = [
    # centers are the robust MEDIAN and stds are the IQR-derived CORE std (IQR/1.349), so each cluster
    # is a TIGHT DENSE core (like the real UMAP) instead of a fat Gaussian smear; a light outlier tail
    # is added in the draw (see gen()) to recreate the few far stragglers. This is what makes Liver /
    # Prostate / Adrenal / Bone-marrow render as compact dots rather than diffuse clouds.
    ("Breast, NOS",              1085,  1.62, 1.82, -0.61, 1.67, "Infiltrating duct carcinoma, NOS"),
    ("Kidney, NOS",               891, -0.53, 2.46,  4.26, 3.07, "Clear cell adenocarcinoma, NOS"),
    ("Upper lobe, lung",          560, -0.84, 1.94, -2.15, 1.24, "Squamous cell carcinoma, NOS"),
    ("Endometrium",               532,  0.44, 1.92,  1.07, 3.36, "Endometrioid adenocarcinoma, NOS"),
    ("Thyroid gland",             507,  1.54, 5.67,  1.65, 1.68, "Papillary adenocarcinoma, NOS"),
    ("Prostate gland",            497, -4.69, 1.19,  3.14, 0.36, "Adenocarcinoma, NOS"),
    ("Skin, NOS",                 469,  0.14, 1.92, -0.38, 2.67, "Malignant melanoma, NOS"),
    ("Cerebrum",                  439,  1.94, 1.69,  4.76, 0.70, "Mixed glioma"),
    ("Ovary",                     423,  0.84, 1.37,  2.39, 1.49, "Serous cystadenocarcinoma, NOS"),
    ("Liver",                     372,  2.36, 0.34, 12.49, 0.45, "Hepatocellular carcinoma, NOS"),
    ("Lower lobe, lung",          349, -0.65, 1.84, -2.25, 1.42, "Squamous cell carcinoma, NOS"),
    ("Cervix uteri",              304,  2.75, 2.70, -3.69, 2.15, "Squamous cell carcinoma, NOS"),
    ("Bladder, NOS",              234,  0.34, 2.10,  0.51, 3.81, "Transitional cell carcinoma"),
    ("Brain, NOS",                224,  3.41, 1.21,  3.60, 0.59, "Glioblastoma"),
    ("Bone marrow",               151,  1.27, 0.79,  6.64, 0.15, "Acute myeloid leukemia, NOS"),
    ("Gastric antrum",            150, -0.95, 1.20,  3.74, 3.00, "Adenocarcinoma, NOS"),
    ("Adrenal gland, NOS",        146, -4.63, 0.56,  8.00, 0.22, "Pheochromocytoma, NOS"),
    ("Testis, NOS",               135,  0.24, 2.06, -1.39, 1.12, "Seminoma, NOS"),
    ("Head of pancreas",          130, -0.07, 1.16,  0.02, 1.65, "Infiltrating duct carcinoma, NOS"),
    ("Tongue, NOS",               128,  3.70, 1.05, -4.83, 0.91, "Squamous cell carcinoma, NOS"),
    ("Lower third of esophagus",  122,  0.62, 2.23,  1.02, 3.46, "Adenocarcinoma, NOS"),
    ("Larynx, NOS",               116,  2.01, 2.74, -3.54, 1.84, "Squamous cell carcinoma, NOS"),
    ("Retroperitoneum",           114,  1.37, 2.79,  0.03, 3.54, "Dedifferentiated liposarcoma"),
    ("Sigmoid colon",             112, -0.31, 1.08,  0.91, 2.26, "Adenocarcinoma, NOS"),
    ("Colon, NOS",                111, -0.44, 1.11,  0.07, 2.09, "Adenocarcinoma, NOS"),
    ("Cardia, NOS",               102, -0.82, 2.14,  2.07, 3.39, "Adenocarcinoma, NOS"),
    ("Body of stomach",            98, -1.20, 1.68,  1.91, 2.69, "Adenocarcinoma, NOS"),
    ("Ascending colon",            91, -0.56, 1.23,  0.71, 2.52, "Adenocarcinoma, NOS"),
    ("Thymus",                     90,  1.02, 1.40, -2.96, 2.37, "Thymoma, type AB, malignant"),
    ("Rectum, NOS",                88, -0.41, 1.14,  0.94, 2.29, "Adenocarcinoma, NOS"),
    ("Cecum",                      88, -0.23, 1.21,  0.55, 2.16, "Adenocarcinoma, NOS"),
]
# "Other" long-tail: ~1488 patients spread thin across MANY generic minor sites so total ~= N_PATIENTS.
# The real data has 138 distinct tissues; the long tail is spread so each minor site stays WELL BELOW
# the lift_by_site HAVING patients>150 (and survival_by_arm patients>80) thresholds. That keeps
# `lift_by_site` (the "survival lift by cancer site" chart) clean — only the real named sites appear,
# so the green/grey/red benefit signal reads clearly instead of being cluttered by tiny sites.
OTHER_TISSUES = [
    ("Pleura, NOS",              "Epithelioid mesothelioma, malignant", -0.5, 2.2,  0.5, 3.0),
    ("Cortex of adrenal gland",  "Adrenal cortical carcinoma",          -4.0, 1.2,  7.5, 1.4),
    ("Floor of mouth, NOS",      "Squamous cell carcinoma, NOS",         2.5, 2.3, -3.8, 2.0),
    ("Connective tissue, NOS",   "Leiomyosarcoma, NOS",                  1.0, 2.6,  0.2, 3.3),
    ("Choroid",                  "Malignant melanoma, NOS",              0.0, 1.8,  0.3, 2.6),
    ("Overlapping lesion of lip, oral cavity and pharynx",
                                 "Squamous cell carcinoma, NOS",         2.6, 2.2, -3.6, 1.9),
    ("Stomach, NOS",             "Adenocarcinoma, NOS",                 -0.9, 1.6,  2.5, 2.9),
    ("Head of pancreas, NOS",    "Adenocarcinoma, NOS",                  0.1, 1.2,  0.4, 2.0),
    ("Gallbladder",              "Adenocarcinoma, NOS",                 -0.7, 1.5,  2.2, 2.6),
    ("Hypopharynx, NOS",         "Squamous cell carcinoma, NOS",         2.4, 2.2, -3.5, 2.0),
    ("Nasopharynx, NOS",         "Squamous cell carcinoma, NOS",         2.3, 2.1, -3.2, 2.1),
    ("Small intestine, NOS",     "Adenocarcinoma, NOS",                 -0.3, 1.2,  0.7, 2.3),
    ("Peripheral nerves and autonomic nervous system",
                                 "Malignant peripheral nerve sheath tumor", 1.2, 2.5, 0.1, 3.2),
    ("Meninges, NOS",            "Meningioma, malignant",                2.8, 1.4,  3.9, 1.3),
    ("Spinal cord",              "Astrocytoma, NOS",                     2.0, 1.5,  4.2, 1.1),
    ("Uterus, NOS",              "Endometrioid adenocarcinoma, NOS",     0.0, 1.6,  1.3, 2.9),
    ("Vulva, NOS",               "Squamous cell carcinoma, NOS",         1.9, 2.3, -2.1, 2.7),
    ("Penis, NOS",               "Squamous cell carcinoma, NOS",         1.8, 2.2, -2.0, 2.6),
    ("Parotid gland",            "Mucoepidermoid carcinoma",             2.2, 2.1, -3.0, 2.2),
    ("Retroperitoneum and peritoneum",
                                 "Leiomyosarcoma, NOS",                  1.3, 2.7,  0.1, 3.4),
]

# --- Per-tissue c1<->c2 correlation (profiled). Real UMAP clusters are ELONGATED diagonal ellipses,
# not round blobs; drawing c1/c2 with this correlation reproduces that elongation so the "molecular map"
# reads as structured, separated streaks (like the real dataset) instead of a fuzzy round cloud.
# Default correlation for any tissue not listed (incl. "other" long tail) is the overall -0.23. ---
CORR = {
    "Breast, NOS": -0.31, "Kidney, NOS": -0.66, "Upper lobe, lung": -0.13, "Endometrium": -0.61,
    "Thyroid gland": -0.14, "Prostate gland": 0.03, "Skin, NOS": -0.38, "Cerebrum": -0.75,
    "Ovary": -0.09, "Liver": 0.65, "Lower lobe, lung": -0.28, "Cervix uteri": -0.70,
    "Bladder, NOS": -0.81, "Brain, NOS": -0.32, "Bone marrow": 0.08, "Gastric antrum": 0.20,
    "Adrenal gland, NOS": -0.60, "Testis, NOS": -0.28, "Head of pancreas": -0.30, "Tongue, NOS": -0.70,
}
CORR_DEFAULT = -0.23

# --- Per-tissue UMAP SUB-CLUSTERS (profiled by k-means on the real data) ---
# Real tissues are NOT single blobs — most are 2-3 tight, well-separated molecular sub-clusters
# (e.g. Prostate is a dense island at c1≈-4.8, Liver a dense island at c2≈12.6, Thyroid has a far
# arm at c1≈6.5). Drawing from a single per-tissue Gaussian averaged those together into one fuzzy
# cloud, which is why the UMAP looked less "clustered" than the real one. Each entry is a list of
# mixture components (c1_mean, c1_std, c2_mean, c2_std, weight); we pick a component by weight then
# draw a tight correlated point in it -> reproduces the crisp multi-island structure of the real UMAP.
SUBCLUSTERS = {
    "Breast, NOS": [(2.2,0.68,-0.72,1.08,0.626), (-0.33,1.06,3.71,1.76,0.189), (-1.43,1.62,-1.5,0.66,0.185)],
    "Kidney, NOS": [(1.64,0.99,2.41,0.9,0.409), (-1.48,0.67,6.2,1.29,0.52), (-0.61,2.44,-1.8,1.33,0.072)],
    "Upper lobe, lung": [(-2.69,1.22,-1.73,0.51,0.382), (0.12,1.73,2.16,2.1,0.15), (0.54,1.34,-3.3,0.91,0.468)],
    "Endometrium": [(0.7,1.49,-0.59,1.45,0.643), (-1.24,0.79,4.57,1.77,0.357)],
    "Thyroid gland": [(6.53,0.46,1.51,0.47,0.46), (-0.06,1.35,4.55,1.49,0.367), (-2.66,1.49,-0.89,1.08,0.174)],
    # Prostate: pushed apart & stretched for clear visual separation — main dense island far LEFT,
    # a second stretched island down at the BOTTOM, plus a small tail.
    "Prostate gland": [(-6.2,1.3,3.4,0.5,0.62), (-3.6,0.9,-3.2,1.6,0.34), (0.35,1.7,-0.86,1.42,0.04)],
    "Skin, NOS": [(0.37,1.93,-1.25,1.18,0.691), (-0.75,1.16,3.5,1.82,0.309)],
    "Cerebrum": [(0.54,0.91,5.35,0.59,0.483), (3.07,0.78,4.11,0.8,0.517)],
    "Ovary": [(0.73,0.92,2.95,1.35,0.811), (-0.67,2.26,-0.53,1.02,0.189)],
    "Liver": [(2.35,0.24,12.6,0.45,0.898), (-0.34,1.58,2.54,3.94,0.102)],
    "Lower lobe, lung": [(-0.27,1.18,2.11,1.75,0.158), (0.87,1.57,-3.38,0.82,0.479), (-2.37,1.13,-1.65,0.65,0.364)],
    "Cervix uteri": [(3.74,0.78,-4.21,0.52,0.553), (-0.07,1.91,-1.13,1.2,0.362), (-1.09,0.63,4.59,1.72,0.086)],
    "Bladder, NOS": [(1.7,1.86,-1.88,1.91,0.534), (-0.97,0.94,3.97,1.98,0.466)],
    "Brain, NOS": [(3.68,0.61,3.55,0.38,0.75), (0.98,1.08,4.96,0.67,0.228), (1.57,0.73,-3.05,0.62,0.022)],
    "Bone marrow": [(0.96,0.82,6.62,0.23,0.967), (1.64,2.68,2.22,1.48,0.033)],
    "Gastric antrum": [(-0.87,0.79,5.48,1.46,0.54), (-0.99,2.04,0.91,1.48,0.46)],
    "Adrenal gland, NOS": [(-4.29,0.89,7.95,0.29,0.966), (-0.46,1.39,1.64,3.41,0.034)],
    "Testis, NOS": [(0.03,1.73,-1.35,1.09,0.933), (-2.02,0.39,6.57,1.9,0.067)],
    "Head of pancreas": [(-0.37,0.86,3.24,1.41,0.238), (0.2,1.16,-0.48,1.04,0.762)],
    "Tongue, NOS": [(3.9,0.76,-4.84,0.68,0.844), (0.53,1.34,1.81,2.55,0.078), (-2.74,1.28,-2.21,0.29,0.078)],
}

# --- Demographic distributions (profiled, ex-null) ---
GENDER   = (["female", "male"],                                    [0.5185, 0.4815])
RACE     = (["white", "not reported", "black or african american", "asian",
             "american indian or alaska native", "native hawaiian or other pacific islander"],
            [0.7529, 0.0903, 0.0892, 0.0638, 0.0025, 0.0013])
ETHNICITY = (["not hispanic or latino", "not reported", "hispanic or latino"],
             [0.7526, 0.2124, 0.0350])
ALCOHOL  = (["Not Reported", "Yes", "No"],                          [0.918, 0.055, 0.027])

# ---- single seeded generator: produces ALL 4 tables' per-case attributes, then we project columns ----
schema = StructType([
    StructField("case_id", StringType()), StructField("file_id", StringType()),
    StructField("diagnosis_id", StringType()),
    # demographics
    StructField("gender", StringType()), StructField("race", StringType()),
    StructField("ethnicity", StringType()),
    StructField("year_of_birth", DoubleType()), StructField("year_of_death", DoubleType()),
    # diagnoses
    StructField("tissue_or_organ_of_origin", StringType()),
    StructField("primary_diagnosis", StringType()),
    StructField("classification_of_tumor", StringType()), StructField("tumor_grade", StringType()),
    # umap
    StructField("c1", DoubleType()), StructField("c2", DoubleType()),
    # exposures
    StructField("alcohol_history", StringType()),
    StructField("cigarettes_per_day", DoubleType()), StructField("years_smoked", DoubleType()),
])

TISSUES_B = TISSUES; OTHER_B = OTHER_TISSUES; NTOT = N_PATIENTS; SEED_B = SEED
G_B, R_B, E_B, A_B = GENDER, RACE, ETHNICITY, ALCOHOL
CORR_B, CORR_DEF_B = CORR, CORR_DEFAULT
SUBC_B = SUBCLUSTERS

@F.pandas_udf(schema)
def gen(ids):
    import numpy as np, pandas as pd, uuid
    def norm(p):  # defensive: rng.choice requires probabilities to sum to exactly 1.0
        a = np.asarray(p, dtype=float); return a / a.sum()
    def bivar(rng, m1, s1, m2, s2, rho):
        # draw correlated (c1,c2) so the cluster is an elongated diagonal ellipse (real UMAP shape)
        z1 = rng.normal(); z2 = rng.normal()
        return (m1 + s1 * z1,
                m2 + s2 * (rho * z1 + (1.0 - rho * rho) ** 0.5 * z2))
    out = []
    for gid in ids:
        gid = int(gid)
        rng = np.random.default_rng(SEED_B * 1_000_003 + gid)   # per-row deterministic stream
        # stable uuid strings from the seeded rng (so ids are reproducible).
        # build a 128-bit int from 4 x 32-bit draws (numpy ints are int64-bounded).
        def uid():
            v = 0
            for _ in range(4):
                v = (v << 32) | int(rng.integers(0, 2**32))
            return str(uuid.UUID(int=v))
        case_id, file_id, diagnosis_id = uid(), uid(), uid()

        # --- tissue assignment: draw proportional to profiled counts (incl. long tail) ---
        weights = np.array([t[1] for t in TISSUES_B], dtype=float)
        p_named = weights.sum() / NTOT                    # ~0.856 fall in the 31 named sites
        if rng.random() < p_named:
            idx = rng.choice(len(TISSUES_B), p=norm(weights))
            tissue, _, c1m, c1s, c2m, c2s, pdx = TISSUES_B[idx]
        else:
            ot = OTHER_B[rng.integers(0, len(OTHER_B))]
            tissue, pdx, c1m, c1s, c2m, c2s = ot[0], ot[1], ot[2], ot[3], ot[4], ot[5]

        # --- UMAP coords: draw from the tissue's SUB-CLUSTER MIXTURE (crisp multi-island structure) ---
        # Breast is special-cased: its responder sub-cluster is DEFINED by c1>2 (the SQL keys on it), so
        # we force one tight component above the c1=2 line at the profiled responder center, and put the
        # rest of Breast in its (profiled) other sub-clusters. rho elongates; a small tail widens a few.
        rho = CORR_B.get(tissue, CORR_DEF_B)
        # SPREAD (<1) tightens every island so the sub-clusters read as crisp, well-separated dots on
        # the UMAP scatter (the profiled k-means stds still let neighbours bleed in the crowded center).
        # k re-inflates a ~6% far-outlier halo so the picture keeps a natural sparse fringe.
        SPREAD = 0.72
        k = (3.0 if rng.random() < 0.06 else 1.0) * SPREAD
        if tissue == "Breast, NOS":
            # weight 0.41 -> P(c1>2)=0.406 (responder cohort size the breast_deepdive story needs;
            # a bit of the responder blob's lower tail and the other-breast islands cross c1=2).
            if rng.random() < 0.41:                       # RESPONDER island: tight, above c1=2
                c1, c2 = bivar(rng, 2.61, 0.39 * k, -0.99, 0.89 * k, -0.26)
            else:                                         # other-breast: its two profiled sub-islands
                comp = SUBC_B["Breast, NOS"][1] if rng.random() < 0.5 else SUBC_B["Breast, NOS"][2]
                c1, c2 = bivar(rng, comp[0], comp[1] * k, comp[2], comp[3] * k, rho)
        elif tissue in SUBC_B:                            # named tissue -> pick a sub-cluster by weight
            comps = SUBC_B[tissue]
            probs = norm([c[4] for c in comps])
            comp = comps[rng.choice(len(comps), p=probs)]
            c1, c2 = bivar(rng, comp[0], comp[1] * k, comp[2], comp[3] * k, rho)
        else:                                             # "other" long-tail -> single small cluster
            c1, c2 = bivar(rng, c1m, c1s * k, c2m, c2s * k, rho)
        c1, c2 = float(c1), float(c2)

        # --- demographics ---
        gender = str(rng.choice(G_B[0], p=norm(G_B[1])))
        # Breast & gyn sites skew female; prostate/testis male (keeps cohort demographics realistic)
        if tissue in ("Breast, NOS", "Ovary", "Endometrium", "Cervix uteri"):
            gender = "female" if rng.random() < 0.99 else "male"
        elif tissue in ("Prostate gland", "Testis, NOS"):
            gender = "male"
        race = str(rng.choice(R_B[0], p=norm(R_B[1])))
        ethnicity = str(rng.choice(E_B[0], p=norm(E_B[1])))
        year_of_birth = float(round(np.clip(rng.normal(1949, 15), 1902, 1997)))
        # ~78.6% of patients have no recorded death year; deaths ~ N(2006.6, 4.3)
        year_of_death = None if rng.random() < 0.786 else \
            float(round(np.clip(rng.normal(2006.6, 4.3), 1992, 2014)))
        # small null block to mirror the ~40 all-null rows in the real data
        if rng.random() < 0.0035:
            gender = race = ethnicity = None
            year_of_birth = None

        # --- exposures ---
        alcohol_history = str(rng.choice(A_B[0], p=norm(A_B[1])))
        cigarettes_per_day = float(round(rng.uniform(0.5, 40.0), 3)) if rng.random() < 0.159 else None
        years_smoked = float(rng.integers(2, 66)) if rng.random() < 0.063 else None

        out.append((case_id, file_id, diagnosis_id, gender, race, ethnicity,
                    year_of_birth, year_of_death, tissue, pdx,
                    "not reported", "not reported", c1, c2,
                    alcohol_history, cigarettes_per_day, years_smoked))
    return pd.DataFrame(out, columns=[f.name for f in schema])

print("== generating patient base (deterministic) ==")
base = (spark.range(0, N_PATIENTS, numPartitions=16)
        .select(gen(F.col("id")).alias("p")).select("p.*")).cache()
print(f"   patients: {base.count()}")


# ===========================================================================
# PHASE 2 — SILVER (the 4 RAW tables, saved as Delta + PK/FK RELY constraints)
# ===========================================================================
def save(df, name):
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.{name}")
    print(f"   {name}: {df.count()} rows")

print("== silver (4 raw tables) ==")
# demographics
demographics = base.select("case_id", "ethnicity", "gender", "race",
                           "year_of_birth", "year_of_death", "file_id")
save(demographics, "demographics")

# diagnoses
diagnoses = base.select(
    "case_id", "classification_of_tumor", "diagnosis_id", "primary_diagnosis",
    "tissue_or_organ_of_origin",
    F.lit(None).cast("string").alias("treatments0_therapeutic_agents"),
    F.lit(None).cast("string").alias("treatments0_treatment_id"),
    F.lit(None).cast("string").alias("treatments1_therapeutic_agents"),
    F.lit(None).cast("string").alias("treatments1_treatment_id"),
    F.lit(None).cast("timestamp").alias("treatments1_updated_datetime"),
    "tumor_grade", "file_id")
save(diagnoses, "diagnoses")

# exposures
exposures = base.select("case_id", "alcohol_history",
                        F.lit(None).cast("string").alias("alcohol_intensity"),
                        "cigarettes_per_day", "years_smoked", "file_id")
save(exposures, "exposures")

# expression_profiles_umap
expression_profiles_umap = base.select(
    F.col("c1").cast("float").alias("c1"), F.col("c2").cast("float").alias("c2"),
    "file_id", "case_id", "classification_of_tumor", "diagnosis_id", "primary_diagnosis",
    "tissue_or_organ_of_origin",
    F.lit(None).cast("string").alias("treatments0_therapeutic_agents"),
    F.lit(None).cast("string").alias("treatments0_treatment_id"),
    F.lit(None).cast("string").alias("treatments1_therapeutic_agents"),
    F.lit(None).cast("string").alias("treatments1_treatment_id"),
    F.lit(None).cast("timestamp").alias("treatments1_updated_datetime"),
    "tumor_grade")
save(expression_profiles_umap, "expression_profiles_umap")

# --- sanity check: the load-bearing SPIKE must survive (Breast c1>2 fraction ~0.406) ----
_br = base.filter(F.col("tissue_or_organ_of_origin") == RESPONDER_TISSUE)
_n_br = _br.count()
_n_resp = _br.filter(F.col("c1") > 2).count()
print(f"   SPIKE CHECK: Breast patients={_n_br}, responders (c1>2)={_n_resp}, "
      f"fraction={_n_resp / max(_n_br, 1):.3f} (target ~0.406)")

# PK/FK constraints (NOT ENFORCED, RELY) — light up Catalog Explorer + help Genie.
# case_id is the natural key shared by all 4 raw tables (1 row per case_id per table);
# a PK column must be NOT NULL first, so the statements run in order: set the key
# columns NOT NULL, then add the PRIMARY KEYs, then the FOREIGN KEYs (after the
# referenced PK exists). Plain list of full SQL so it's easy to read/copy/run.
_constraints = [
    # --- key columns NOT NULL (required before PRIMARY KEY) ---
    f"ALTER TABLE {FQ}.demographics             ALTER COLUMN case_id SET NOT NULL",
    f"ALTER TABLE {FQ}.diagnoses                ALTER COLUMN case_id SET NOT NULL",
    f"ALTER TABLE {FQ}.exposures                ALTER COLUMN case_id SET NOT NULL",
    f"ALTER TABLE {FQ}.expression_profiles_umap ALTER COLUMN case_id SET NOT NULL",
    # --- primary keys (demographics is the parent case dimension) ---
    f"ALTER TABLE {FQ}.demographics             ADD CONSTRAINT demographics_pk PRIMARY KEY (case_id) RELY",
    f"ALTER TABLE {FQ}.diagnoses                ADD CONSTRAINT diagnoses_pk    PRIMARY KEY (case_id) RELY",
    f"ALTER TABLE {FQ}.exposures                ADD CONSTRAINT exposures_pk    PRIMARY KEY (case_id) RELY",
    f"ALTER TABLE {FQ}.expression_profiles_umap ADD CONSTRAINT umap_pk         PRIMARY KEY (case_id) RELY",
    # --- foreign keys (each satellite table → demographics case dimension) ---
    f"ALTER TABLE {FQ}.diagnoses                ADD CONSTRAINT dx_case_fk   FOREIGN KEY (case_id) REFERENCES {FQ}.demographics(case_id) RELY",
    f"ALTER TABLE {FQ}.exposures                ADD CONSTRAINT exp_case_fk  FOREIGN KEY (case_id) REFERENCES {FQ}.demographics(case_id) RELY",
    f"ALTER TABLE {FQ}.expression_profiles_umap ADD CONSTRAINT umap_case_fk FOREIGN KEY (case_id) REFERENCES {FQ}.demographics(case_id) RELY",
]
for c in _constraints:
    try:
        spark.sql(c)
    except Exception as e:  # noqa: BLE001 — idempotent: NOT NULL / constraint may already be set
        print(f"   (skip) {str(e).splitlines()[0][:90]}")


# ===========================================================================
# PHASE 3 — GOLD (DERIVED analysis tables — SQL verbatim from the original
#                 the demo library bundle_config.py `sql_queries`, retargeted to {FQ})
# ===========================================================================
# patient_cohort: 1 row per case_id (row_number dedup), joins the 4 raw tables, then
# derives the synthetic OncoTarget-1 treatment arm + 24-month outcome from a stable
# hash(case_id) — so the arm/outcome layer is deterministic with no extra generator.
# responder_subtype := (tissue='Breast, NOS' AND c1>2) is the load-bearing signal.
print("== gold (derived analysis tables) ==")
spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.patient_cohort AS
WITH dx AS (SELECT * FROM (SELECT d.*, row_number() OVER (PARTITION BY d.case_id ORDER BY d.diagnosis_id) rn FROM {FQ}.diagnoses d) WHERE rn=1),
dem AS (SELECT * FROM (SELECT m.*, row_number() OVER (PARTITION BY m.case_id ORDER BY m.year_of_birth) rn FROM {FQ}.demographics m) WHERE rn=1),
umap AS (SELECT * FROM (SELECT u.*, row_number() OVER (PARTITION BY u.case_id ORDER BY u.c1) rn FROM {FQ}.expression_profiles_umap u) WHERE rn=1),
base AS (SELECT dx.case_id, dx.primary_diagnosis, dx.tissue_or_organ_of_origin AS tissue, dem.gender, dem.race, dem.ethnicity, dem.year_of_birth, dem.year_of_death, (2024-dem.year_of_birth) AS age, umap.c1, umap.c2, abs(hash(dx.case_id))%1000/1000.0 AS r, abs(hash(dx.case_id,'arm'))%2 AS arm_bit, abs(hash(dx.case_id,'death'))%1000/1000.0 AS dr FROM dx JOIN dem ON dx.case_id=dem.case_id LEFT JOIN umap ON dx.case_id=umap.case_id),
arms AS (SELECT *, CASE WHEN arm_bit=0 THEN 'OncoTarget-1' ELSE 'Standard of care' END AS treatment_arm, (tissue='Breast, NOS' AND c1>2) AS responder_subtype FROM base),
surv AS (SELECT *, CASE WHEN tissue='Breast, NOS' THEN 0.85 WHEN tissue='Endometrium' THEN 0.90 WHEN tissue='Thyroid gland' THEN 0.93 WHEN tissue='Brain, NOS' THEN 0.43 WHEN tissue='Cerebrum' THEN 0.62 WHEN tissue='Ovary' THEN 0.50 WHEN tissue='Liver' THEN 0.64 WHEN tissue LIKE '%lung%' THEN 0.55 WHEN tissue='Prostate gland' THEN 0.88 WHEN tissue='Kidney, NOS' THEN 0.74 WHEN tissue='Bladder, NOS' THEN 0.66 WHEN tissue='Skin, NOS' THEN 0.70 ELSE 0.72 END + CASE WHEN treatment_arm='OncoTarget-1' THEN CASE WHEN tissue='Breast, NOS' AND responder_subtype THEN 0.22 WHEN tissue='Breast, NOS' THEN 0.10 WHEN tissue IN ('Cerebrum','Skin, NOS') THEN 0.13 WHEN tissue IN ('Kidney, NOS','Bladder, NOS','Thyroid gland') THEN 0.06 WHEN tissue IN ('Liver','Endometrium') OR tissue LIKE '%lung%' THEN 0.00 WHEN tissue IN ('Ovary','Prostate gland') THEN -0.06 ELSE 0.03 END ELSE 0 END AS sp FROM arms),
clip AS (SELECT *, greatest(least(sp,0.99),0.05) AS surv_prob FROM surv)
SELECT case_id, primary_diagnosis, tissue, gender, race, ethnicity, age, c1, c2, treatment_arm, responder_subtype, surv_prob AS survival_probability, (r<surv_prob) AS survived_24mo, CASE WHEN r<surv_prob THEN 24 ELSE CAST(round(2+dr*20+CASE WHEN treatment_arm='OncoTarget-1' THEN 3 ELSE 0 END) AS INT) END AS months_survived FROM clip""")
print("   patient_cohort: built")

spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.survival_by_arm AS SELECT tissue, treatment_arm, count(*) patients, round(avg(CASE WHEN survived_24mo THEN 1.0 ELSE 0 END)*100,1) survival_pct, round(avg(months_survived),1) avg_months FROM {FQ}.patient_cohort GROUP BY 1,2""")
print("   survival_by_arm: built")

spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.arm_summary AS SELECT treatment_arm, count(*) patients, round(avg(CASE WHEN survived_24mo THEN 1.0 ELSE 0 END)*100,1) survival_pct, round(avg(months_survived),1) avg_months FROM {FQ}.patient_cohort GROUP BY 1""")
print("   arm_summary: built")

spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.breast_deepdive AS SELECT CASE WHEN responder_subtype THEN 'Responder subtype' ELSE 'Other breast' END subgroup, treatment_arm, count(*) patients, round(avg(CASE WHEN survived_24mo THEN 1.0 ELSE 0 END)*100,1) survival_pct FROM {FQ}.patient_cohort WHERE tissue='Breast, NOS' GROUP BY 1,2""")
print("   breast_deepdive: built")

spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.survival_curve AS WITH months AS (SELECT explode(sequence(0,24,1)) month), cohort AS (SELECT treatment_arm, greatest(least(months_survived,24),0) ms FROM {FQ}.patient_cohort) SELECT c.treatment_arm, m.month, round(avg(CASE WHEN c.ms>=m.month THEN 1.0 ELSE 0 END)*100,1) pct_surviving FROM months m CROSS JOIN cohort c GROUP BY 1,2""")
print("   survival_curve: built")

spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.survival_curve_responder AS WITH months AS (SELECT explode(sequence(0,24,1)) month), cohort AS (SELECT treatment_arm, greatest(least(months_survived,24),0) ms FROM {FQ}.patient_cohort WHERE responder_subtype) SELECT c.treatment_arm, m.month, round(avg(CASE WHEN c.ms>=m.month THEN 1.0 ELSE 0 END)*100,1) pct_surviving FROM months m CROSS JOIN cohort c GROUP BY 1,2""")
print("   survival_curve_responder: built")

spark.sql(f"""CREATE OR REPLACE TABLE {FQ}.lift_by_site AS SELECT tissue, sum(patients) patients, round(max(CASE WHEN treatment_arm='OncoTarget-1' THEN survival_pct END)-max(CASE WHEN treatment_arm='Standard of care' THEN survival_pct END),1) survival_lift FROM {FQ}.survival_by_arm GROUP BY 1 HAVING sum(patients)>150""")
print("   lift_by_site: built")


# ===========================================================================
# PHASE 4 — METRICS (governed metric view over patient_cohort; SQL from bundle_config)
# ===========================================================================
print("== metric view ==")
spark.sql(f"""CREATE OR REPLACE VIEW {FQ}.genomics_metrics WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: {CATALOG}.{SCHEMA}.patient_cohort
comment: "Patient genomics + OncoTarget-1 RWE metrics"
dimensions:
  - name: Treatment Arm
    expr: treatment_arm
  - name: Cancer Site
    expr: tissue
  - name: Primary Diagnosis
    expr: primary_diagnosis
  - name: Gender
    expr: gender
  - name: Race
    expr: race
  - name: Responder Subtype
    expr: CASE WHEN responder_subtype THEN 'Responder subtype' ELSE 'Other' END
measures:
  - name: Patients
    expr: COUNT(1)
  - name: Survival Rate
    expr: AVG(CASE WHEN survived_24mo THEN 1.0 ELSE 0 END)
  - name: Avg Months Survived
    expr: AVG(months_survived)
  - name: Avg Age
    expr: AVG(age)
$$""")
print("   genomics_metrics: built")

print(f"\nDONE — {CATALOG}.{SCHEMA} built: 4 raw tables + 7 derived tables + genomics_metrics")
