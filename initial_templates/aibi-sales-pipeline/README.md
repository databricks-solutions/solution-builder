# AI/BI Sales Pipeline Review — Hit the Number with AI/BI

> **What this is.** A fast, end-to-end AI/BI demo: a global beauty brand tracks sales
> against its quarterly revenue target across regions and product lines. You see the
> quarter on an AI/BI Dashboard — the AI forecast projects **beating target** — then
> ask **Genie** *why*, and it traces the surge to a new Fragrance line that launched
> in EMEA on 2026-05-04. No app, no ML training — synthetic data → governed metric
> view → Dashboard (with `AI_FORECAST`) + Genie.

## The Story

| | |
|---|---|
| **Company** | A global beauty / cosmetics brand selling high-volume, small-ticket products to retailers across AMER / EMEA / APAC / LATAM |
| **Hero** | The **VP of Sales**, reviewing where the quarter (Q2 2026) will land |
| **Question** | Are we going to hit the company-wide revenue target this quarter? |
| **Investigation** | Data is scattered — Salesforce (accounts / pipeline / reps), the ERP (actual orders & revenue), Finance (targets), the product catalog (launches). Databricks unifies it. The AI forecast projects quarter-end revenue **~$33M vs a ~$21.5M target (~155%)**. Why the surge? |
| **Root cause** | The brand **launched its new Fragrance line in EMEA on 2026-05-04**. EMEA Fragrance revenue spikes as retailers stock it — the `product_launches` table carries the date, and `orders_enriched` shows the EMEA Fragrance ramp. |
| **Impact** | Beating target, driven by one region + one product line — a defensible, drillable story from a single governed dataset |

---

## Overview

A beauty brand tracks sales against a company-wide quarterly target. The current
fiscal quarter is **Q2 2026 (2026-04-01 → 2026-06-30)**. Revenue tracks along across
four product lines (Skincare, Makeup, Fragrance, Haircare) until the brand launches
its new **Fragrance** line in **EMEA on 2026-05-04**, mid-quarter. EMEA sales spike as
retailers stock it, and the AI forecast of quarter-end revenue now projects **beating
the target**. The "why" is fully grounded in the data: `product_launches` carries the
EMEA launch date, and `orders_enriched` shows EMEA Fragrance revenue ramping from that
date. Regions have distinct volume mixes, so any regional filter shows real,
defensible differences.

---

## Key Numbers

| Metric | Value |
|---|---|
| ERP orders (18 months) | ~180,000 |
| Fiscal quarter | Q2 2026 (2026-04-01 → 2026-06-30) |
| Q2 target (Finance) | ~$21.5M |
| Projected quarter-end (AI forecast) | ~$33M (~155% attainment) |
| EMEA Fragrance launch | 2026-05-04 |
| Regions | AMER, EMEA (the spike), APAC, LATAM |
| Product lines | Skincare, Makeup, Fragrance, Haircare |

---

## Demo Walkthrough

**Frame:** *"Are we going to hit our number this quarter? Let's look at the dashboard,
then ask Genie why — in plain English."*

### Act 1 — Are we hitting the number? (1 min)
Open the **AI/BI Dashboard** (page "Are we hitting the number?"). The KPI cards show
quarter target, quarter-to-date revenue, and the **AI-forecast projected attainment
(~155%)** — we're beating. The weekly revenue line + `AI_FORECAST` band bends up late
in the quarter. Something drove a surge.

### Act 2 — Why are we beating? (1–2 min)
Page "Why are we beating?" shows daily revenue by region (EMEA grows after early May),
EMEA weekly revenue by product line (**Fragrance surges after May 4**), and the
product-launch catalog table with the EMEA Fragrance launch date. Then switch to the
**Genie space** and ask *"What is driving the recent revenue spike?"* Genie ties it to
the **Fragrance line that launched in EMEA on 2026-05-04**, and shows EMEA Fragrance
revenue climbing from that date.

### Act 3 — Zoom out: one governed platform (30s)
The dashboard and Genie both read the **same governed data** — the `orders_enriched`
gold table and the `metrics_sales` metric view. One set of numbers, one definition of
every KPI, consumed by both a dashboard and natural language. That's the AI/BI
promise: governed data + natural language = answers in seconds, no analyst in the loop.

### Closing
*"We can see the quarter and ask why — and because everything runs on one governed
lakehouse that unifies CRM, ERP, Finance and the product catalog, a business user gets
the answer without writing a line of SQL."*

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---|---|---|
| **Synthetic data generation** | Build | Generates the full sales dataset from scratch (CRM + ERP + Finance + PIM) and folds the medallion build in |
| **Unity Catalog Metric View** | Build | `metrics_sales` — governed KPIs (Revenue, Units, Orders, Avg Order Value) correct under any grouping |
| **AI/BI Dashboard** | Build | The quarter at a glance: target vs projected (`AI_FORECAST`), weekly revenue + forecast band, region + product-line breakdowns, launch table |
| **AI/BI Genie** | Build | Natural-language "why" — traces the surge to the EMEA Fragrance launch and rising EMEA revenue |
| **Lakeflow Connect** | Talk track | How the raw CRM / ERP / Finance / PIM data would land in the lakehouse |
| **Unity Catalog** | Talk track | Governance + the PK/FK relationships across the unified sources |
| **Agent Bricks** | Talk track | Building an agent on top of the same governed sales data |
| **Genie on Databricks One** | Talk track | The same Genie space, reachable by any business user from their phone |
