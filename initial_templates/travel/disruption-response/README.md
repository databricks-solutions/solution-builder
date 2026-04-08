# SkyWest Airlines — Delay Investigation Demo

## The Story

| | |
|---|---|
| **Company** | SkyWest Airlines — Regional carrier with 180 aircraft |
| **Hero** | Rachel Kim, VP of Operations Control (aviation background) |
| **Problem** | On-time performance drops to 62% this week (vs 85% target) |
| **Investigation** | Rachel asks "Why are we delayed?" — traces to 45 aircraft with APU issues |
| **Root cause** | APU software update caused startup failures — engineering bulletin explains the bug |
| **Impact** | 312 delayed flights, 47,000 affected passengers, $3.8M in compensation |

---

## Overview

Rachel opens her Monday dashboard and sees on-time performance at 62% — well below the 85% target. Departure delays are driving the problem.

She asks one question: *"Why are we delayed so much?"*

The platform traces it through structured data (delays → aircraft → systems → maintenance) and finds an engineering bulletin explaining the APU software bug. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Target on-time performance | 85% |
| Current on-time performance | 62% (23 points below target) |
| Primary delay code | 41 (APU/Ground Power) |
| Affected aircraft | 45 aircraft (tail numbers N7xx series) |
| Software version | APU-FW-v3.2.1 |
| Delayed flights | 312 flights |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from flight ops (delays), maintenance (AMOS), crew scheduling |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Rachel built this herself — shows the 62% OTP at a glance |
| **AI/BI Genie** | Answers "Why delays?" by investigating: codes, aircraft, patterns |
| **Knowledge Assistant** | Finds the engineering bulletin explaining the APU software bug |
| **Multi-Agent Supervisor** | Routes Rachel's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from ops to AI |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from flight ops, AMOS maintenance, and crew systems flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Rachel is VP of Ops Control — aviation background. She built this dashboard herself.
- Load factor strong, crew utilization good... but OTP: **62%** (target 85%)
- Delay code 41 (APU) showing 5x normal frequency
- In most airlines: dig through maintenance logs. Rachel just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why are we delayed so much this week?`

- Genie investigates: OTP 23 points below target, delay code 41 dominant
- 45 aircraft affected — all N7xx series, all updated to APU-FW-v3.2.1 last week
- Delays happen on first departure of day (cold start)
- Suggests checking engineering documentation for software update

**Type:** `Were there any issues reported with the APU software update?`

- KA finds it: Engineering bulletin EB-2025-0423 — APU cold start failure
- Software bug in v3.2.1 causes startup timeout in low ambient temperatures
- Workaround: manual override procedure for affected aircraft
- **Root cause found:** Software bug → APU failures → departure delays → OTP drop

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — ops data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Rachel, no IT dependency
- **Genie** — analytics for operations leaders
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Rachel identified the root cause in 2 minutes. The workaround can be communicated to all crews immediately while the software is patched. That's not just fixing delays — that's preventing 47,000 more frustrated passengers.
