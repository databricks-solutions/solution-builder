# AI/BI Patient Genomics — Real-World Evidence for Precision Oncology

> **What this is.** A fast, end-to-end AI/BI demo built on real-world evidence (RWE).
> A new targeted cancer therapy, **OncoTarget-1**, is evaluated against standard of
> care across a ~10,000-patient TCGA-style oncology cohort. The drug works — but
> **unevenly**. You see the uneven lift on an AI/BI Dashboard, then ask **Genie**
> *which subgroup benefits most* — and it points to a **molecular gene-expression
> subtype**, not an organ. No app, no ML training — synthetic genomics data →
> governed metric view → Dashboard + Genie.

## The Story

| | |
|---|---|
| **Domain** | Precision oncology real-world evidence — a TCGA-style genomics cohort (cancer site, gene-expression UMAP coordinates, demographics) |
| **Hero** | A **translational oncology / RWE lead** deciding where a new therapy should be used |
| **Problem** | OncoTarget-1 shows a modest overall benefit — but a flat average hides who it actually helps |
| **Investigation** | Break the lift down by cancer site: big benefit in some (Cerebrum, Bladder, Breast, Skin), none in others, and it is **NOT indicated** for Ovary and Prostate (treated patients do worse) |
| **Root cause** | The responders share a **molecular signature, not an organ**: within breast cancer a distinct gene-expression subtype (a tight UMAP cluster) reaches **~99% 24-month survival vs ~84–89%** on standard of care |
| **Impact** | Target the therapy at the responder subtype; avoid the cancers where it harms — precision oncology grounded in one governed lakehouse |

---

## Overview

Every patient is in one of two treatment arms — `OncoTarget-1` or `Standard of care` —
and has a 24-month survival outcome plus a 2-D **UMAP** representation (`c1`, `c2`) of
their tumor's gene-expression profile. Overall, treated patients survive a little more
often (~75.5% vs ~72.5%), but the benefit varies wildly by cancer. The "why" is fully
grounded in the data: the responder subtype is defined purely by the molecular
coordinates (`tissue = 'Breast, NOS' AND c1 > 2`), and that subtype is exactly where
OncoTarget-1 delivers its headline lift. Cancer-site counts and the responder fraction
are preserved so every chart — the lift-by-site bar, the UMAP molecular map, the breast
deep-dive — tells the same coherent story.

---

## Key Numbers

| Metric | Value |
|---|---|
| Patients in cohort | ~10,346 |
| Overall 24-month survival, OncoTarget-1 vs Standard of care | ~75.5% vs ~72.5% |
| Breast **responder subtype**, treated vs standard of care | **~99% vs ~84%** |
| Responder subtype share of breast patients | ~40% (defined by `c1 > 2`) |
| Cancers where OncoTarget-1 **helps most** | Cerebrum, Bladder, Breast, Skin, Thyroid, Lung, Kidney |
| Cancers where it is **NOT indicated** | Ovary, Prostate (negative survival lift) |

---

## Demo Walkthrough

**Frame:** *"This new therapy looks only mildly better on average. Let's see who it
actually helps on the dashboard, then ask Genie which subgroup benefits — in plain
English."*

### Act 1 — The average hides the truth (1 min)
Open the **AI/BI Dashboard**, page "Real-world evidence". The KPI cards show a small
overall survival edge for OncoTarget-1. Then the **survival-lift-by-site bar** breaks
it apart: green (Benefits) for Cerebrum / Bladder / Breast / Skin, and **red (Not
indicated) for Ovary and Prostate** — treated patients there do *worse*. The overall
survival curve alone would have hidden all of this.

### Act 2 — The responders share a molecular signature (1–2 min)
Look at the **UMAP molecular map**: patients cluster by gene expression, and one tight
cluster is highlighted — the responder subtype. On page "Who benefits most", the
**breast deep-dive** shows that subtype at ~99% survival on OncoTarget-1 vs ~84% on
standard of care, far above other breast patients. The responders aren't an organ —
they're a molecular cluster.

### Act 3 — Ask why, in Genie (1–2 min)
Switch to the **Genie space**. Ask *"Which cancers does OncoTarget-1 help, and which
subgroup benefits most?"* Genie surfaces the uneven per-site lift and names the
**breast-cancer responder molecular subtype** as the top-benefiting group. Follow with
*"For which cancers is OncoTarget-1 not indicated?"* (Ovary, Prostate) and *"How does
the responder subtype compare to other breast patients?"*.

### Closing
*"OncoTarget-1 isn't a breast drug or a skin drug — it's a *molecular-subtype* drug.
Because the genomics, outcomes and the metric view all live on one governed lakehouse, a
translational lead can see exactly who benefits **and** ask why, without writing a line
of SQL."*

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---|---|---|
| **Synthetic data generation** | Build | Generates the full TCGA-style genomics cohort from scratch (4 raw tables with a load-bearing UMAP mixture) + the derived survival layer |
| **Unity Catalog Metric View** | Build | `genomics_metrics` — governed KPIs (survival rate, patients, avg months, avg age) correct under any grouping |
| **AI/BI Dashboard** | Build | The uneven-lift story at a glance: KPIs, lift-by-site, the UMAP molecular map, and the breast responder deep-dive |
| **AI/BI Genie** | Build | Natural-language "which subgroup benefits" — names the responder molecular subtype and flags where the drug shouldn't be used |
| **Lakeflow Connect** | Talk track | How the raw clinical-genomics tables would land in the lakehouse |
| **Unity Catalog** | Talk track | Governance over sensitive patient genomics; the PK/FK constraints light up the Catalog Explorer ER diagram |
| **Genie on Databricks One** | Talk track | The same Genie space, reachable by any clinician or analyst from their phone |
