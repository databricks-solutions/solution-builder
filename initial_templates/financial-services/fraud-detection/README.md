# Meridian Bank — Card Fraud Investigation Demo

## The Story

| | |
|---|---|
| **Company** | Meridian Bank — Regional retail bank with 2M cardholders |
| **Hero** | Sarah Chen, VP of Fraud Operations (non-technical) |
| **Problem** | Card fraud losses spike to $2.4M this week (4x normal) |
| **Investigation** | Sarah asks "Why is fraud so high?" — traces to 847 cards all used at 3 compromised merchant terminals |
| **Root cause** | POS terminal skimming attack at "QuickMart" convenience stores — merchant security audit flagged the issue |
| **Impact** | $2.4M in fraud losses, 847 compromised cards, ~15% fraud rate vs 0.3% normal |

---

## Overview

Sarah opens her Monday dashboard and sees fraud losses at $2.4M — four times the usual $600K. The spike is concentrated in a specific geographic cluster and merchant category.

She asks one question: *"Why is fraud so high this week?"*

The platform traces it through structured data (fraud → cards → merchants → terminals) and finds a merchant security audit report explaining the POS skimming attack. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly fraud losses | ~$600K |
| This week's fraud losses | ~$2.4M (4x) |
| Affected merchant | QuickMart (MCC: 5411) |
| Affected terminals | TRM-QM-0847, TRM-QM-0848, TRM-QM-0849 |
| Compromised cards | 847 cards |
| Fraud rate on affected cards | ~15% vs 0.3% normal |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from core banking (transactions), Salesforce (merchant info), card processor (auth data) |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Sarah built this herself — shows the $2.4M spike at a glance |
| **AI/BI Genie** | Answers "Why is fraud so high?" by investigating: trend, geography, merchants, terminals |
| **Knowledge Assistant** | Finds the merchant security audit report explaining the POS skimming |
| **Multi-Agent Supervisor** | Routes Sarah's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from raw data to AI |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from core banking, card processor, and merchant systems flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Sarah is VP of Fraud Ops — not technical. She built this dashboard herself with AI/BI.
- Transaction volume normal, auth rates steady... but fraud losses: **$2.4M** (usually $600K)
- One geographic cluster shows 15% fraud rate — everything else is 0.3%
- In most banks: escalate to analytics, wait for investigation. Sarah just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why is fraud so high this week?`

- Genie investigates: 4x normal, 847 cards, all used at 3 terminals at "QuickMart" locations
- Transaction patterns: unusual late-night activity, multiple cards per terminal
- Suggests checking merchant security reports

**Type:** `Was there a security issue reported for QuickMart terminals?`

- KA finds it: Security audit flagged POS tampering at 3 QuickMart locations
- Physical inspection found skimming devices installed on terminals
- **Root cause found:** POS skimming attack → card data harvested → fraud spike

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Sarah, no BI team
- **Genie** — analytics for business users
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Sarah identified the fraud source in 2 minutes. The compromised cards can be blocked immediately, and the merchant terminals flagged for inspection. That's not just faster fraud detection — that's $2M in prevented losses.
