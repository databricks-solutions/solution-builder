# AI/BI — Metric View + Dashboard + Genie

## Shared Context

All three artifacts read the same governed data built in `01-lakeflow.md`: the gold
table `{{CATALOG}}.{{SCHEMA}}.patient_cohort` (+ its survival rollups) and the metric
view `{{CATALOG}}.{{SCHEMA}}.genomics_metrics`. The story they must all make obvious:
**OncoTarget-1 works, but UNEVENLY — and the responders share a molecular signature,
not an organ. Within breast cancer a responder subtype reaches ~99% survival vs ~89%
on standard of care.**

---

## A. Metric View — `genomics_metrics`

Governed metric view (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML`) over
`patient_cohort`. It is the single source of truth the dashboard's global filters bind
to.

**Dimensions:** Treatment Arm, Cancer Site, Primary Diagnosis, Gender, Race,
Responder Subtype (`'Responder subtype'` / `'Other'`).

**Measures:** Patients (`COUNT(1)`), Survival Rate (`AVG(CASE WHEN survived_24mo THEN 1
ELSE 0 END)`), Avg Months Survived, Avg Age.

**Contract:** consumers query measures with `MEASURE(\`Survival Rate\`)` etc. and group
by dimensions. The uneven lift across `Cancer Site` and the responder-subtype gap are
the demo's headlines.

---

## B. Dashboard (`dashboard/dashboard.lvdash.json`)

A Lakeview dashboard, **2 content pages + a Filters page**. Datasets bind to
`{{CATALOG}}.{{SCHEMA}}` (the DAB rewrites `dataset_catalog`/`dataset_schema` per
target; the shipped file targets the default schema).

### Datasets (17)
One metric-view-backed dataset (`ds_metrics`, drives the global filters) plus 16 query
datasets reading `patient_cohort` and the survival rollups: KPI singletons
(`ds_kpi_treated/soc/patients/lift`), `ds_arm`, survival curves (`ds_curve`,
`ds_curve_resp`, sparklines), `ds_site`, `ds_lift`, `ds_umap` (the molecular map),
`ds_breast`, `ds_umap_breast`, `ds_responder_demo`, `ds_patients`.

### Global filters (Filters page → apply across pages)
Treatment Arm, Cancer Site, Gender, Race — all multi-select, bound to the
`genomics_metrics` dimensions. Every filter widget has a `frame.title`.

### Page 1 — "Real-world evidence" (the glance)
- **4 KPI counters:** Patients in cohort, OncoTarget-1 survival (24mo), Standard of
  care survival (24mo), Best-responder survival lift.
- **Bar** — survival lift by cancer site (green Benefits / grey No effect / red Not
  indicated) — the where-does-it-help/harm chart.
- **Scatter** — gene-expression UMAP molecular map (the responders as a distinct
  cluster; filtered to the clearly-separated sites).
- **Line** — overall survival over time, treated vs standard of care (the average that
  *hides* the unevenness).

### Page 2 — "Who benefits most" (the why / deep-dive)
- **Line** — responder-subtype survival over time (OncoTarget-1 holds near 99% while
  standard of care falls).
- **Scatter** — breast gene-expression, responder subtype as a distinct molecular
  cluster.
- **Bar** — breast survival, responder subtype vs other × arm.
- **Bar** — responder-subtype patient mix (demographics).
- **Table** — responder-subtype patients (patient-level detail).

### Theme
Follows the standard demo palette — light canvas, categorical palette with literal-hex
pins so colors are stable across widgets (e.g. the Benefits/No effect/Not indicated
verdict colors, and the responder-subtype highlight on the UMAP). Keep the frame titles
verbatim; they are the reading order of the story.

### Validation
1. Dashboard opens with no query errors against the target schema (all 16 query
   datasets return non-empty).
2. Page 1's lift bar shows Ovary + Prostate red (Not indicated) and Cerebrum/Breast/
   Skin green (Benefits); the UMAP shows separated clusters.
3. Page 2's breast bar shows the responder subtype at ~99% treated vs ~89% standard of
   care.

---

## C. Genie Space (`genie/genie_space.json`)

**Tables:** `arm_summary`, `breast_deepdive`, `lift_by_site`, `patient_cohort`,
`survival_by_arm`, `survival_curve` (serialized-v2 export; tables sorted by identifier
— required by `create_space`).

**Room persona / instructions:** Genie is told the story explicitly — OncoTarget-1
works overall but unevenly; `lift_by_site.survival_lift` is the treated-minus-standard
gap per cancer (positive helps, negative harms); it is **not indicated for Ovary and
Prostate**; the responders are a **molecular subtype** (`patient_cohort.responder_subtype
= TRUE`), and within breast cancer that subtype reaches ~99% vs ~89%. Compute survival
rate as `AVG(CASE WHEN survived_24mo THEN 1 ELSE 0 END)` from `patient_cohort`. Don't
answer questions unrelated to this oncology RWE analysis.

**Sample questions (the story-arc walk):**
- "Does OncoTarget-1 improve survival overall versus standard of care?"
- "Which cancers does OncoTarget-1 help — and which does it not?"
- "Which patient subgroup benefits most from OncoTarget-1?" → the breast responder subtype.
- "Within breast cancer, how does the responder molecular subtype compare to other
  breast patients?"
- "What is the 24-month survival rate by treatment arm for ovarian and prostate cancer?"

### Validation
Ask each sample question; confirm Genie (a) names the **breast responder molecular
subtype** as the top-benefiting subgroup, (b) surfaces the uneven per-site lift, and
(c) flags Ovary + Prostate as not indicated.
