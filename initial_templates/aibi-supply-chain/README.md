# AI/BI Supply Chain Optimization — Forecast a Stockout Before It Happens

> **What this is.** A fast, end-to-end AI/BI demo: an e-bike manufacturer is about to
> run out of the shared **Battery Cell**. You see it on an AI/BI Dashboard — weeks of
> cover, a projected stockout, an AI demand forecast — then ask **Genie** *why*, and it
> traces the crunch to a new EMEA market launch that surged demand, blocked by an
> 8-week supplier lead time. No app, no ML training — synthetic data → governed metric
> view → Dashboard + Genie.

## The Story

| | |
|---|---|
| **Company** | An e-bike / micro-mobility manufacturer (City / Cargo / Folding E-Bike, E-Scooter, E-Moped), built from components via a bill of materials |
| **Hero** | The **supply-chain planner**, watching component cover |
| **Problem** | The shared **Battery Cell** is projected to stock out in ~2 weeks at the Rotterdam plant |
| **Investigation** | Weeks of cover has collapsed to ~2-3 weeks against an **8-week** supplier lead time. Why now? |
| **Root cause** | The **City E-Bike opened a new EMEA market on 2026-04-20**, surging EMEA demand ~2x. Because every product uses the Battery Cell, that surge — rolled through the BOM — drains it faster than it can be replenished. |
| **Impact** | A reorder placed today barely arrives in time (8-week lead) — the planner must act now. Every other component is comfortably covered; the Battery Cell is the single bottleneck. |

---

## Overview

An e-bike manufacturer builds finished products from components (Battery Cell,
Electric Motor, Frame, Brake System, Display Unit, Tire Set) bought from suppliers,
each with a lead time. On **2026-04-20** the City E-Bike opened a major new EMEA
market (`market_launches`), driving a sharp, sustained EMEA demand surge. Because
every product uses the shared Battery Cell (4-12 cells per unit via the `bom`), the
surge drains the Battery Cell at the Rotterdam plant (which serves EMEA+APAC) far
faster than its supplier — PowerCell Industries, **8-week lead time** — can
replenish it. `component_status` shows Battery Cell weeks-of-cover at ~2-3 weeks
(Rotterdam) vs the 8-week lead time, flagged **At risk**; every other component
carries 9-40+ weeks and is Healthy. The "why" is fully grounded in the data: the
`market_launches` row carries the EMEA launch, and Genie traces demand → BOM →
inventory → the supplier lead time.

---

## Key Numbers

| Metric | Value |
|---|---|
| Products (e-bikes) | 5 |
| Components / suppliers / plants / DCs | 6 / 6 / 2 / 8 |
| Weekly demand rows (~2 years) | ~4,200 |
| Battery Cell weeks of cover (Rotterdam) | ~2.3 weeks |
| Battery Cell supplier lead time | 8 weeks |
| EMEA demand, before → after launch | ~8k → ~16k units/wk |
| Market launch date | 2026-04-20 |

---

## Demo Walkthrough

**Frame:** *"We're about to run out of a critical part. Let's see it on the dashboard,
then ask Genie why — in plain English."*

### Act 1 — Spot the risk (1 min)
Open the **AI/BI Dashboard**, page "Component supply risk". The KPI cards show the
Battery Cell weeks of cover (~2) and a projected stockout, against an 8-week supplier
lead time. The on-hand line depletes toward zero; the weeks-of-cover bar and heatmap
single out the Battery Cell (red) while everything else is comfortably green.

### Act 2 — Find the driver (1 min)
Switch to page "Why — demand driver". The AI demand forecast projects demand still
climbing; the region area chart shows **EMEA surging after 2026-04-20** while other
regions stay flat, and the BOM table shows every product consumes the Battery Cell.

### Act 3 — Ask why, in Genie (1-2 min)
Open the **Genie space**. Ask *"Which component is about to run out?"* → Battery Cell.
*"Why is Battery Cell demand surging?"* → the City E-Bike EMEA market launch.
*"Why can't we just reorder more Battery Cells in time?"* → the 8-week supplier lead
time. Genie traces it across demand, BOM, inventory, suppliers and the launch event.

### Closing
*"The dashboard and Genie read the **same governed data** — the `component_status`
and `demand_enriched` gold tables and the `metrics_demand` metric view. One set of
numbers, one definition of every KPI, consumed by both a dashboard and natural
language. A planner sees the risk **and** the reason, without writing a line of SQL."*

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---|---|---|
| **Synthetic data generation** | Build | Generates the full supply-chain dataset from scratch (dimensions + operational tables + demand fact) |
| **Unity Catalog Metric View** | Build | `metrics_demand` — governed demand KPIs correct under any grouping |
| **AI/BI Dashboard** | Build | The supply-risk story at a glance: weeks of cover, projected stockout, AI demand forecast, regional surge |
| **AI/BI Genie** | Build | Natural-language "why" — traces the crunch to the EMEA launch, the BOM, and the 8-week supplier lead time |
| **AI_FORECAST** | Build | Forecasts total weekly demand on the dashboard (runs on a SQL warehouse) |
| **Lakeflow Connect** | Talk track | How the raw demand / inventory / PO data would land in the lakehouse |
| **Unity Catalog** | Talk track | Governs the shared tables + metric view both consumers read |
| **Genie on Databricks One** | Talk track | The same Genie space, reachable by any planner from their phone |
