# Lakeflow — Data Generation + Medallion Build

## Shared Context

**Demo:** AI/BI Patient Genomics — real-world evidence (RWE) for a new targeted cancer
therapy, **OncoTarget-1**, across a ~10,000-patient TCGA-style oncology cohort. The
drug works overall but **UNEVENLY**; the responders share a **molecular gene-expression
signature, not an organ**. Every downstream consumer (dashboard, Genie) reads the gold
table `patient_cohort` and its survival rollups + the governed metric view
`genomics_metrics`.

**Target:** `{{CATALOG}}.{{SCHEMA}}` (defaults `dbdemos_templates.aibi_patient_genomics`).

**Build shape (no SDP pipeline).** A single self-contained Spark script
(`data_generation/generate_data.py`) generates the raw clinical-genomics data *and*
builds the full medallion in four phases: RAW → SILVER (typed + constrained) → GOLD
(derived analysis tables) → METRICS (metric view). It runs unchanged in a Databricks
notebook (ambient Spark, catalog/schema from CLI args) or locally via Databricks
Connect serverless. No parquet round-trip, no Faker — pure Spark plus one `pandas_udf`
for the per-patient rows, so it runs on serverless.

**The load-bearing signal (do NOT simplify).** The whole demo hinges on the UMAP
gene-expression coordinates. The responder subtype is defined purely by:

```
responder_subtype := (tissue = 'Breast, NOS' AND c1 > 2)
```

The fraction of Breast patients with `c1 > 2` must stay ~0.406 (the responder cohort
size the breast deep-dive story needs). It is reproduced with a two-component Breast
mixture (a tight responder island above `c1=2` at the profiled center, plus the diffuse
other-breast islands). Every other tissue draws from its own profiled UMAP
sub-cluster mixture, and tissue **counts** are preserved, so `lift_by_site`
(`HAVING patients>150`) and `survival_by_arm` (`patients>80`) keep surfacing the same
sites. If you touch the raw generator, keep the `SPIKE CHECK` fraction near 0.406.

---

## A. Data Generation Script

### Phase 1 — RAW (4 TCGA-style clinical-genomics tables)

All four join on `case_id` (1 row per `case_id` per table). Generated deterministically
from a seeded per-row RNG (fixed `SEED`), so re-running is stable.

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `demographics` | patient | `case_id`, `ethnicity`, `gender`, `race`, `year_of_birth`, `year_of_death`, `file_id` | Profiled distributions; ~78.6% no recorded death year; a tiny all-null block mirrors the real data |
| `diagnoses` | patient | `case_id`, `classification_of_tumor`, `diagnosis_id`, `primary_diagnosis`, `tissue_or_organ_of_origin`, `treatments0_*`, `treatments1_*`, `tumor_grade`, `file_id` | Tissue drawn proportional to profiled per-site counts (31 named sites + a long tail of minor sites) |
| `exposures` | patient | `case_id`, `alcohol_history`, `alcohol_intensity`, `cigarettes_per_day`, `years_smoked`, `file_id` | Sparse smoking/alcohol fields |
| `expression_profiles_umap` | patient | `c1`, `c2`, `file_id`, `case_id`, + a copy of the diagnoses descriptive cols | `c1`/`c2` are 2-D UMAP coordinates of the patient's gene-expression profile — the molecular map |

**UMAP-shaping rules (the mechanics that make the story true):**
- **Breast responder island:** ~41% of Breast patients drawn from a tight cluster at
  `c1 ~ N(2.61, ·)`, `c2 ~ N(-0.99, ·)` (above `c1=2`); the rest from the diffuse
  other-breast sub-islands. → P(c1>2) ≈ 0.406.
- **Every named tissue** draws from its profiled k-means **sub-cluster mixture** (2–3
  tight islands) with a per-tissue **c1↔c2 correlation** (elongated diagonal ellipses),
  so the "molecular map" reads as crisp, separated clusters (Prostate far −c1, Liver
  high `c2`, Brain/Tongue high `c1`) like the real UMAP.
- **Tissue counts preserved** so the `>150` / `>80` HAVING thresholds keep the site
  charts clean (long-tail sites stay below them).

### Phase 2 — SILVER (typed + constrained)
Each raw DataFrame is written with `saveAsTable` (overwrite). Then PK/FK
**constraints (NOT ENFORCED, RELY)** are added so Catalog Explorer draws the ER diagram
and Genie understands the joins: `case_id` PK on all four tables; FKs from `diagnoses`,
`exposures`, `expression_profiles_umap` → `demographics(case_id)`. A PK column must be
`NOT NULL` first, so the statements run in order (NOT NULL → PKs → FKs) and each is
wrapped so a re-run is idempotent.

---

## B. Medallion Build — GOLD (folded into the same script)

The derived analysis layer is built by the exact SQL ported from the original the demo library
`bundle_config.py` (retargeted to `{{CATALOG}}.{{SCHEMA}}`). The synthetic
OncoTarget-1 treatment arm + 24-month outcome are derived deterministically from a
stable `hash(case_id)` — no extra outcome generator needed.

| Table | What it is |
|---|---|
| `patient_cohort` | 1 row per `case_id` (row_number dedup) joining the 4 raw tables; derives `treatment_arm` (`OncoTarget-1` / `Standard of care`), `responder_subtype`, `survival_probability`, `survived_24mo`, `months_survived`. **The patient-level table every consumer slices.** |
| `survival_by_arm` | survival % + avg months per `tissue` × `treatment_arm` |
| `arm_summary` | overall survival % per `treatment_arm` |
| `breast_deepdive` | Breast split into `Responder subtype` vs `Other breast` × arm — the "why" |
| `survival_curve` / `survival_curve_responder` | % surviving by month 0–24 per arm (Kaplan-Meier-style), overall and responder-only |
| `lift_by_site` | treated-minus-standard survival gap per cancer site (`HAVING patients>150`) — the where-does-it-help/harm chart |

**Survival model (in `patient_cohort`):** a per-tissue baseline survival probability +
an arm bump when treated. The bump is `+0.22` for the Breast responder subtype (its
headline lift), positive for Cerebrum/Skin/Bladder/Breast/Thyroid/Kidney/Lung,
`0` for lung/liver/endometrium, and **negative (−0.06) for Ovary and Prostate** (the
"not indicated" cancers). `survived_24mo := hash(case_id)-derived r < survival_prob`.

---

## C. Metrics — `genomics_metrics` (see also `04-ai-bi.md`)
A governed metric view (`WITH METRICS LANGUAGE YAML`) over `patient_cohort`. Defined in
this script because it's part of the data layer; its dimensions/measures are the
contract the dashboard filters and Genie consume. Full definition in `04-ai-bi.md`.

---

## D. Validation

After the script runs, confirm:
1. **Row counts** — ~10,346 rows in each of the 4 raw tables and in `patient_cohort`.
2. **The load-bearing spike survives** — Breast `c1>2` fraction ≈ 0.406 (`SPIKE CHECK`
   line), and `breast_deepdive` shows the responder subtype at ~99% treated vs ~89%
   standard of care.
3. **The lift is uneven** — `lift_by_site` shows strong positive lift for Cerebrum /
   Bladder / Breast / Skin / Thyroid / Lung / Kidney and clearly negative lift for
   **Ovary** and **Prostate** (`verdict = 'Not indicated'`).
4. **Constraints present** — Catalog Explorer shows the 4 PKs + 3 FKs.
5. **Metric view queryable** — `SELECT MEASURE(\`Survival Rate\`) ... GROUP BY
   \`Treatment Arm\`` returns two rows with OncoTarget-1 above Standard of care overall.
