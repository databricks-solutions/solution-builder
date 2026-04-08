# Precision Motors — Equipment Failure Investigation Demo

## The Story

| | |
|---|---|
| **Company** | Precision Motors — Automotive parts manufacturer, 3 plants |
| **Hero** | Tom Bradley, VP of Operations (engineering background) |
| **Problem** | Defect rate spikes to 8.5% this week (3x the 2.8% target) |
| **Investigation** | Tom asks "Why are defects so high?" — traces to parts from CNC machine #7 |
| **Root cause** | Spindle bearing wear detected — maintenance report shows vibration anomaly ignored |
| **Impact** | 12,400 defective parts, $1.8M in scrap and rework, customer delivery at risk |

---

## Overview

Tom opens his Monday dashboard and sees defect rate at 8.5% — three times the 2.8% target. The Detroit plant is driving the spike.

He asks one question: *"Why are defects so high?"*

The platform traces it through structured data (defects → parts → machines → sensors) and finds a maintenance report explaining the ignored vibration warning. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Target defect rate | 2.8% |
| Current defect rate | 8.5% (3x target) |
| Affected machine | CNC-DTR-007 (Detroit Plant) |
| Defect type | Dimensional tolerance failures |
| Defective parts | ~12,400 units |
| Scrap/rework cost | ~$1.8M |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from MES (production), SCADA (sensors), SAP (quality) |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Tom built this himself — shows the 8.5% spike at a glance |
| **AI/BI Genie** | Answers "Why are defects high?" by investigating: rates, machines, sensor data |
| **Knowledge Assistant** | Finds the maintenance report explaining the vibration anomaly |
| **Multi-Agent Supervisor** | Routes Tom's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from sensors to AI |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from MES, SCADA sensors, and SAP flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Tom is VP of Ops — engineering background. He built this dashboard himself with AI/BI.
- Production volume on target, OEE normal... but defects: **8.5%** (target 2.8%)
- Detroit plant showing 12% defect rate — other plants at 2.5%
- In most plants: stop production, investigate, lose days. Tom just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why are defects so high this week?`

- Genie investigates: 3x target, Detroit plant, CNC machine #7
- All defects are dimensional tolerance failures on precision gears
- Vibration sensor data shows anomaly starting 3 days ago
- Suggests checking maintenance logs for CNC-DTR-007

**Type:** `Were there any maintenance alerts for CNC machine 7?`

- KA finds it: Predictive maintenance alert flagged vibration anomaly
- Spindle bearing wear detected but deemed "within acceptable range"
- **Root cause found:** Bearing wear → vibration → tolerance failures → defect spike

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — sensor data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Tom, no IT dependency
- **Genie** — analytics for operations leaders
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Tom identified the root cause in 2 minutes. The machine can be taken offline for bearing replacement immediately. That's not just avoiding $1.8M in scrap — that's preventing a customer delivery failure.
