# LuxeBeauty Co. — Returns Intelligence Demo

## The Story

| | |
|---|---|
| **Company** | LuxeBeauty Co. — D2C cosmetics e-commerce |
| **Hero** | Claire Dubois, VP of Operations (non-technical) |
| **Problem** | Returns spiked to $180K/week three weeks ago (3x normal), still elevated |
| **Investigation** | Claire asks "Why so many returns?" — traces to 3 skincare products from one production lot |
| **Root cause** | Homogenizer pressure issue during production caused texture problems in 5,000 units |
| **Impact** | $180K peak returns, ~30% return rate vs 8% normal, slowly decaying as affected inventory clears |

---

## Overview

Claire opens her Monday dashboard and sees returns spiked to $180K three weeks ago — triple the usual $60K — and are still elevated at ~$80K despite trending down. Three Skincare products are driving it, all with 30% return rates.

She asks one question: *"Why do I have so many returns?"*

The platform traces it through structured data (returns → products → lot) and finds an internal incident report explaining the manufacturing issue. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Peak returns (3 weeks ago) | ~$180K (3x) |
| Current returns | ~$80K (decaying) |
| Affected lot | (dynamic — LOT-{YYYY}-{MMDD} at runtime) |
| Affected SKUs | SKU-1001, SKU-1002, SKU-1003 |
| Return rate for affected products | ~30% vs 8% normal |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from Shopify (orders), Zendesk (returns), ERP (production) — no custom pipelines |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | Claire built this herself — shows the $180K spike at a glance |
| **AI/BI Genie** | Answers "Why so many returns?" by investigating data: trend, products, lot, customer comments |
| **Knowledge Assistant** | Finds the incident report explaining the homogenizer issue |
| **Multi-Agent Supervisor** | Routes Claire's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from raw data to AI |
| **Databricks One** | Claire's single place to talk to her data — dashboards, Genie, and apps unified |
| **Genie Code** | AI assistant that helped Claire build her dashboard and refine queries |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from Shopify, Zendesk, and ERP flows in via **Lakeflow Connect** — no custom pipelines. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- Claire is VP of Ops — not technical. She built this dashboard herself with AI/BI.
- Revenue normal, orders steady... but returns spiked to **$180K** three weeks ago (usually $60K), still at ~$80K
- Three Skincare products at 30% return rate — everything else is 8%
- In most companies: email analyst, open ticket, wait 2 weeks. Claire just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why do I have so many returns?`

- Genie investigates: 3x normal, three products, all from **one production lot**
- Customer comments: "grainy texture", "product separated"
- Suggests checking for an incident report

**Type:** `Was there an incident for that lot?`

- KA finds it: homogenizer had pressure fluctuations on the affected lot date
- QC noted "minor texture variations" but released the lot
- **Root cause found:** equipment issue → texture problems → returns spike

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Databricks One** — Claire's single place to talk to her data
- **Lakeflow Connect** — data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by Claire with **Genie Code** assistance, no BI team needed
- **Genie** — analytics for business users
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> Claire did in 2 minutes what used to take a team two weeks. That's not a better BI tool — that's a different way of running your business.
