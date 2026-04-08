# Pacific Grid Utilities — Transformer Failure Investigation Demo

## The Story

| | |
|---|---|
| **Company** | Pacific Grid Utilities — Regional power utility serving 1.2M customers |
| **Hero** | Jennifer Walsh, VP of Grid Operations (engineering background) |
| **Problem** | Unplanned outages spike to 47 this month (3x the 15 average) |
| **Investigation** | Jennifer asks "Why are we having so many outages?" — traces to transformers from a specific batch |
| **Root cause** | Manufacturing defect in cooling system — supplier quality report confirms the issue |
| **Impact** | 47 outages, 180K customer-hours affected, $2.1M in restoration costs |

---

## Overview

Jennifer opens her Monday dashboard and sees unplanned outages at 47 — three times the typical 15 per month. Distribution transformers are the common failure point.

She asks one question: *"Why are we having so many outages?"*

The platform traces it through structured data (outages → equipment → manufacturers → batches) and finds a supplier quality report explaining the cooling system defect. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal monthly outages | ~15 |
| This month's outages | 47 (3x normal) |
| Affected equipment | Distribution transformers |
| Batch ID | TRF-2024-Q3-887 |
| Units in batch | 234 transformers |
| Customer-hours affected | ~180,000 |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from SCADA (grid), GIS (assets), SAP (maintenance) |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Jennifer built this herself — shows the 47 outages at a glance |
| **AI/BI Genie** | Answers "Why so many outages?" by investigating: equipment, location, age, batch |
| **Knowledge Assistant** | Finds the supplier quality report explaining the cooling defect |
| **Multi-Agent Supervisor** | Routes Jennifer's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from SCADA to AI |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from SCADA, GIS, and SAP flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Jennifer is VP of Grid Ops — engineering background. She built this dashboard herself.
- Load balanced, voltage stable... but outages: **47** (usually 15)
- Distribution transformers showing 89% of failures — substations normal
- In most utilities: dispatch crews, investigate individually. Jennifer just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why are we having so many outages?`

- Genie investigates: 3x normal, distribution transformers, batch TRF-2024-Q3-887
- All failed units installed Q4 2024, same manufacturer
- Thermal sensors showed elevated temperatures before failure
- Suggests checking supplier quality documentation

**Type:** `Were there any quality issues reported for transformer batch TRF-2024-Q3-887?`

- KA finds it: Supplier quality audit flagged cooling system irregularity
- Defective thermal compound in cooling assembly — reduced heat dissipation
- **Root cause found:** Manufacturing defect → overheating → transformer failures → outages

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — SCADA data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Jennifer, no IT dependency
- **Genie** — analytics for operations leaders
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Jennifer identified the root cause in 2 minutes. The remaining 187 transformers from the batch can be proactively replaced before they fail. That's not just avoiding outages — that's preventing 500K+ customer-hours of service disruption.
