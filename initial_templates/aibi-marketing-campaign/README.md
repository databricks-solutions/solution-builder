# AI/BI Marketing Campaign — Why Did Revenue Drop? Ask Genie

> **What this is.** A fast, end-to-end AI/BI demo: a multi-channel marketing team
> (TikTok, Instagram, Google Ads, Email) watches revenue and conversions collapse in
> late 2025 — even though spend never dropped. You spot it on an AI/BI Dashboard, then
> ask **Genie** *why* — and it traces the drop to one underperforming ad creative
> hiding inside a single campaign, in just two markets. No app, no ML training —
> synthetic data → governed metric view → Dashboard + Genie.

## The Story

| | |
|---|---|
| **Company** | A brand running paid + owned marketing across TikTok, Instagram, Google Ads and Email, targeting 20 markets worldwide |
| **Hero** | The **Head of Marketing / Growth**, reviewing late-2025 performance |
| **Problem** | Revenue and conversions fell sharply from September 2025 — but spend stayed flat, so ROAS (revenue per dollar) cratered |
| **Investigation** | Revenue per dollar drops on the trend line late 2025; the map shows **Germany & France going red** while the rest of the world stays green. Why? |
| **Root cause** | On **2025-09-01** the team swapped in a new localized creative — **"Fall Sale - v2 (DE/FR)"** — on TikTok for Germany & France, inside the **Q4 Growth Push** campaign. Its conversion rate is **~0.35% vs ~3%** for healthy creatives. Spend kept flowing; conversions and revenue collapsed. |
| **Impact** | The dashboard quantifies the damage (**~$62k spend wasted, ~$440k lost revenue**) and Genie names the exact campaign, creative and markets — a fix a business user can act on the same day |

---

## Overview

A marketing team runs campaigns across four channels and two platforms (Mobile / Web),
targeting audiences in 20 countries. Daily performance is tracked: impressions, clicks,
spend, conversions and revenue. Through mid-2025 every channel is healthy — revenue
grows, conversions are steady. On **September 1, 2025** a new localized TikTok creative,
"Fall Sale - v2 (DE/FR)", launches for the German and French markets as part of the
**Q4 Growth Push** campaign. It flops: the conversion rate craters while spend keeps
flowing, so revenue and conversions collapse — concentrated in TikTok × {Germany,
France}. The "why" is fully grounded in the data: the `campaign_performance` fact only
carries a `creative_id`, but the `creatives` dimension flags the bad creative
(`status = 'underperforming'`), so answering *why* requires the join — which the gold
table `campaign_performance_enriched` pre-computes for both the dashboard and Genie.

---

## Key Numbers

| Metric | Value |
|---|---|
| Performance rows (~2.4 years) | ~60,000 |
| Channels / markets | 4 channels, 20 countries |
| Data window | 2024-01-01 → 2026-05-31 |
| Bad-creative launch | 2025-09-01 |
| Failing campaign | Q4 Growth Push (rev/$ **3.08** since Sept vs ~4.6+ for peers) |
| TikTok DE/FR conversion rate, before → after | **~3.0% → ~0.35%** |
| TikTok DE/FR revenue per dollar, before → after | **~8.0 → ~0.95** |
| Damage from the bad creative | **~$62k spend wasted, ~$440k lost revenue** |

---

## Demo Walkthrough

**Frame:** *"Our marketing revenue dropped late last year even though we didn't cut
spend. Let's see it on the dashboard, then ask Genie why — in plain English."*

### Act 1 — Spot the shift (1 min)
Open the **AI/BI Dashboard** → *Marketing Performance*. The KPI cards show revenue and
revenue-per-dollar down. The monthly revenue-per-dollar line bends down in late 2025,
and the **symbol map** lights up Germany and France in red while the rest of the world
stays green. Spend, meanwhile, is flat. Something clearly broke — but only in two markets.

### Act 2 — Ask why, in Genie (1–2 min)
Switch to the **Genie space**. Ask *"Why did our marketing revenue and conversions drop
in late 2025?"* Genie traces it in three steps: the failing **Q4 Growth Push** campaign
(lowest revenue per dollar since Sept), the underperforming **Fall Sale - v2 (DE/FR)**
creative inside it (conversion rate ~0.35% vs ~3%), and the affected markets **Germany
& France** — all while spend stayed flat. Follow with *"Inside the Q4 Growth Push
campaign, which creative is dragging performance down?"* and *"Which markets have the
lowest revenue per dollar?"*

### Act 3 — Zoom out: one governed platform (30s)
The dashboard and Genie both read the **same governed data** — the
`campaign_performance_enriched` gold table and the `metrics_campaign` metric view. One
set of numbers, one definition of every KPI (Revenue per Dollar, Conversion Rate, CTR),
consumed by both a dashboard and natural language. That's the AI/BI promise: governed
data + natural language = answers in seconds, no analyst in the loop.

### Closing
*"A single bad creative in two markets cost us hundreds of thousands in revenue — and
because everything runs on one governed lakehouse, a marketer can see the damage **and**
ask why it happened, without writing a line of SQL."*

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---|---|---|
| **Synthetic data generation** | Build | Generates the full multi-channel marketing dataset from scratch (dimensions + fact with the embedded creative-failure story) |
| **Unity Catalog Metric View** | Build | `metrics_campaign` — governed KPIs (Revenue per Dollar, Conversion Rate, CTR, Cost per Conversion) correct under any grouping |
| **AI/BI Dashboard** | Build | The story at a glance: revenue KPIs, revenue-per-dollar trend + forecast, market map, and the root-cause campaign/creative breakdowns |
| **AI/BI Genie** | Build | Natural-language "why" — traces the drop to the failing campaign, the underperforming creative and the affected markets |
| **Lakeflow Connect** | Talk track | How the raw ad-platform performance data would land in the lakehouse |
| **Unity Catalog** | Talk track | Governance + PK/FK relationships that light up Catalog Explorer and ground Genie |
| **Agent Bricks** | Talk track | Building an agent that could monitor creative performance and flag failures automatically |
| **Genie on Databricks One** | Talk track | The same Genie space, reachable by any marketer from their phone |
