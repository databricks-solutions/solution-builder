# LuxeBeauty Co. — Returns Intelligence (Genie Code workshop)

## The Story

| | |
|---|---|
| **Company** | LuxeBeauty Co. — D2C cosmetics e-commerce |
| **Hero** | Claire Dubois, VP of Operations (non-technical) |
| **Problem** | Weekly refunds spiked **~4–5× to ~$140K** about three weeks ago (normal ~$30K), still decaying |
| **Investigation** | Claire asks *"Why so many returns?"* — the data traces it to 3 Skincare SKUs from **one production lot** at Lyon-France |
| **Root cause** | The lot was released despite a QC note: homogenizer pressure fluctuations during emulsification caused texture problems |
| **Impact** | ~4,000 returns from one lot (~80% of its orders) — about 75% of the peak week's refund $ |

---

## Overview

Claire sees refunds jump on her dashboard and asks one question: *"Why do I have so many returns?"* Genie walks the data — returns → products → lot — and quotes the lot's incident note inline. The attendee builds every piece of that live with **Genie Code**: raw files → a Lakeflow pipeline → dashboard + Genie, then a governed metric view, PII governance and a premium-customer model.

---

## Key Numbers

These are what `data_generation/generate_data.py` produces. Dates roll with the run date.

| Metric | Value |
|---|---|
| Normal weekly refunds | ~$30K (median week) |
| Peak weekly refunds | ~$140K, ~3 weeks before the latest return (~4–5×) |
| Everyday return rate | ~8% of orders (~10% for December orders) |
| Affected lot | `LOT-{YYYY}-{MMDD}` at `Lyon-France` (id changes per run), 3 SKU rows × 2,500 units |
| Affected SKUs | `SKU-1001` Hydrating Serum 30ml, `SKU-1002` Vitamin C Cream 50ml, `SKU-1003` HA Moisture Boost 15ml (~40 / 30 / 30) |
| Affected-lot returns | ~4,000 (~80% of its ~5,000 orders); the next-largest lot has ~100 |
| Skincare share of refund $ | ~70% |
| Customers | 5,000; ~650 carry a `premium_status` label (~500 premium, ~130 not), the rest are unlabeled |

---

## Workshop Walkthrough

1. **Setup & explore** — generate the raw files into a Volume; Genie Code spots the spike and the lot.
2. **Build the pipeline** — silver (with an `ai_classify` anger score) → gold, data quality expectations, a Lakeflow Job.
3. **Dashboard & Genie** — the spike in the past with its decay tail, Paris among the biggest map bubbles, the sankey collapsing to one lot; Genie quotes the QC note. Certify the space.
4. **Business semantics** — `mv_returns` metric view; Genie answers from its measures; a Discover domain.
5. **Governance** *(optional)* — ABAC masks PII-tagged columns and filters rows by region; data classification proposals.
6. **ML** *(optional)* — a feature table, a premium classifier with a `prod` alias, batch scores that surface unlabeled premium customers.

---

## Products Showcased

| Product | What it does in this workshop |
|---|---|
| **Genie Code** | Builds everything from plain-English prompts |
| **Unity Catalog** | Governs the Volume, tables, model and Genie space; tags drive ABAC |
| **Synthetic data generation** | `generate_data.py` lands 6 raw parquet datasets into a Volume |
| **Notebooks** | Exploration of the raw files |
| **Lakeflow Spark Declarative Pipelines** | Raw → silver → gold with expectations |
| **AI Functions** | `ai_classify` scores customer-comment anger |
| **Lakeflow Jobs** | Runs the pipeline on a schedule |
| **AI/BI Dashboards** | Spot the spike, drill to the lot |
| **Genie** / **Genie One** | Natural-language root cause, certified for business users |
| **Metric Views** | One governed definition of return rate and refund rate |
| **ABAC** + **Data Classification** | Tag-driven masking and row filters; proposed PII tags |
| **ML Training & Serving** + **Feature Store** | Feature table, UC-registered classifier, batch scoring |
