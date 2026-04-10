# FreshMart Grocery — Stockout Investigation Demo

## The Story

| | |
|---|---|
| **Company** | FreshMart Grocery — Regional grocery chain with 85 stores |
| **Hero** | Michael Torres, VP of Supply Chain (operations background) |
| **Problem** | Stockouts spike to $4.2M in lost sales this week (5x normal) |
| **Investigation** | Michael asks "Why are stockouts so high?" — traces to dairy products at 23 stores |
| **Root cause** | Demand forecast model not updated for local event — stadium concert drove 4x dairy demand |
| **Impact** | $4.2M lost sales, 23 stores affected, customer satisfaction drop |

---

## Overview

Michael opens his Monday dashboard and sees stockout losses at $4.2M — five times the usual $800K. Dairy products are driving the spike.

He asks one question: *"Why are stockouts so high?"*

The platform traces it through structured data (stockouts → products → stores → demand patterns) and finds an event intelligence report explaining the demand surge from a stadium concert. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly stockout losses | ~$800K |
| This week's stockout losses | ~$4.2M (5x) |
| Affected category | Dairy products |
| Affected stores | 23 stores (Metro East region) |
| Event | Stadium concert (75,000 attendees) |
| Demand multiplier | 4x normal for affected stores |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from POS (sales), WMS (inventory), demand planning system |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Michael built this himself — shows the $4.2M spike at a glance |
| **AI/BI Genie** | Answers "Why stockouts?" by investigating: products, stores, demand patterns |
| **Knowledge Assistant** | Finds the event intelligence report explaining the concert impact |
| **Multi-Agent Supervisor** | Routes Michael's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from POS to AI |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from POS, WMS, and demand planning flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Michael is VP of Supply Chain — operations background. He built this dashboard himself.
- Sales strong, inventory turns normal... but stockouts: **$4.2M** (usually $800K)
- Dairy showing 15% stockout rate — everything else at 2%
- In most chains: investigate store by store. Michael just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why are stockouts so high this week?`

- Genie investigates: 5x normal, dairy products, 23 stores in Metro East region
- Sales velocity 4x normal for these stores on Thursday-Saturday
- Suggests checking for demand events in the region

**Type:** `Were there any events that could have driven demand in Metro East?`

- KA finds it: Event intelligence flagged Taylor Swift concert at Metro East Stadium
- 75,000 attendees over 3 nights — tailgating drove dairy demand
- **Root cause found:** Event not in forecast → under-stocked → stockouts → lost sales

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — POS data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Michael, no BI team
- **Genie** — analytics for supply chain leaders
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Michael identified the root cause in 2 minutes. The forecast model can now incorporate event data automatically. For the next stadium event, FreshMart will be ready with 4x inventory. That's not just avoiding lost sales — that's winning customer loyalty.
