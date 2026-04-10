# Lakeside Health System — Readmission Investigation Demo

## The Story

| | |
|---|---|
| **Company** | Lakeside Health System — Regional hospital network with 450 beds |
| **Hero** | Dr. Maya Patel, Chief Medical Officer (clinical background) |
| **Problem** | 30-day readmissions spike to 18% this month (2x the 9% target) |
| **Investigation** | Maya asks "Why are readmissions so high?" — traces to heart failure patients discharged on a specific protocol |
| **Root cause** | New discharge protocol omitted medication reconciliation step — clinical memo explains the gap |
| **Impact** | 156 preventable readmissions, $3.2M in penalties at risk, patient safety concern |

---

## Overview

Dr. Patel opens her Monday dashboard and sees 30-day readmissions at 18% — double the CMS target of 9%. Heart failure patients are driving the spike.

She asks one question: *"Why are readmissions so high?"*

The platform traces it through structured data (readmissions → diagnoses → discharge dates → protocols) and finds a clinical memo explaining the protocol gap. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Target 30-day readmission rate | 9% |
| Current readmission rate | 18% (2x target) |
| Affected DRG | Heart Failure (DRG 291-293) |
| Protocol ID | DISCH-HF-2025-03 |
| Readmissions above baseline | ~156 cases |
| CMS penalty exposure | ~$3.2M |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from Epic (ADT), claims system (readmissions), clinical registry |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Maya built this herself — shows the 18% spike at a glance |
| **AI/BI Genie** | Answers "Why are readmissions high?" by investigating: DRG, dates, protocols |
| **Knowledge Assistant** | Finds the clinical memo explaining the medication reconciliation gap |
| **Multi-Agent Supervisor** | Routes Maya's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — HIPAA-compliant access controls |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from Epic, claims, and clinical registries flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog** with HIPAA-compliant access.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Maya is CMO — clinical background. She built this dashboard herself with AI/BI.
- Admissions steady, average LOS normal... but readmissions: **18%** (target 9%)
- Heart Failure patients showing 24% readmission rate — everything else is 8%
- In most hospitals: pull reports, convene committee, wait weeks. Maya just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why are readmissions so high this month?`

- Genie investigates: 2x target, heart failure patients, all discharged after March 1
- Common factor: patients on new discharge protocol DISCH-HF-2025-03
- Suggests checking clinical documentation for protocol changes

**Type:** `Was there a protocol change for heart failure discharges?`

- KA finds it: March clinical memo — new protocol streamlined discharge process
- Medication reconciliation step was inadvertently removed
- **Root cause found:** Protocol gap → missed med reconciliation → readmissions spike

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Maya, no IT dependency
- **Genie** — analytics for clinical leaders
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance with HIPAA compliance

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Maya identified the root cause in 2 minutes. The protocol can be corrected immediately, preventing more readmissions. That's not just avoiding $3.2M in penalties — that's better patient outcomes.
