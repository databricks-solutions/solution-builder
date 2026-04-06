# LuxeBeauty Co. - Returns Intelligence Demo

## Overview

A cosmetics retailer investigates a sudden spike in product returns. An executive sees the anomaly in a dashboard, asks "Why do I have so many returns?", and AI combines structured data with incident documentation to reveal the root cause.

**Duration:** 5-7 minutes | **Key message:** One question, complete answer - from anyone, not just analysts.

---

## Product Stack

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌─────────┐    ┌─────────┐
│ Lakeflow │ →  │   SDP    │ →  │ Dashboard │ →  │  Genie  │ →  │   KA    │
│ Connect  │    │ Pipeline │    │  (AI/BI)  │    │ (AI/BI) │    │         │
└──────────┘    └──────────┘    └───────────┘    └─────────┘    └─────────┘
  Ingestion      Processing       Analytics       NL Query      Documents
                                                      ↑              ↑
                                                      └──────────────┘
                                                  Multi-Agent Supervisor

═══════════════════════════════════════════════════════════════════════════
                         Unity Catalog (governance across all)
```

---

## The Story

| | |
|---|---|
| **Company** | LuxeBeauty Co. - D2C cosmetics e-commerce |
| **Hero** | Claire Dubois, VP of Operations (non-technical) |
| **Problem** | Returns spike to $180K (3x normal) |
| **Root cause** | Equipment issue in lot LOT-2025-0212 |

### Timeline

| Date | Event |
|------|-------|
| Feb 12 | Homogenizer issue during production. Lot released after visual QC passes. |
| Feb 12 - Mar 15 | Affected products ship (~2,400 units) |
| Feb 20 - Mar 25 | Returns accumulate - customers notice texture issues |
| **Mar 24** | Claire sees spike → **DEMO STARTS** |

### Key Numbers

| Metric | Value |
|--------|-------|
| Normal returns | ~$60K/week |
| Spike returns | ~$180K (3x) |
| Affected lot | LOT-2025-0212 |
| Affected SKUs | SKU-1001, SKU-1002, SKU-1003 |
| Return rate | ~30% vs 8% normal |

---

## Databricks Resources

| Type | Name |
|------|------|
| Pipeline (SDP) | `luxebeauty_operations` |
| Dashboard | `LuxeBeauty Operations` |
| Genie Space | `LuxeBeauty Operations Analytics` |
| Knowledge Assistant | `LuxeBeauty Incidents` |
| Multi-Agent Supervisor | `LuxeBeauty Operations Assistant` |

---

## Demo Walkthrough

### Pre-flight

- [ ] Dashboard shows $180K returns (spike obvious at a glance)
- [ ] MAS responds to "Why so many returns?"
- [ ] KA finds incident for LOT-2025-0212

---

### Setup: How We Got Here (30 sec - optional)

> "Before we dive in, let me show you how this works.
>
> LuxeBeauty's data - orders from Shopify, returns from Zendesk, production from their ERP - flows into Databricks through **Lakeflow Connect**. A few clicks per source. No custom pipelines. No waiting weeks for engineering.
>
> That data is transformed by an **SDP pipeline** - built with **Genie Code** by describing what tables we need. No hand-coded Spark jobs that only three people understand.
>
> All governed by **Unity Catalog** - same permissions from raw data to dashboards to AI.
>
> Now let's see what their VP of Operations sees every Monday."

---

### Act 1: The Dashboard (1 min)

**[Open: LuxeBeauty Operations Dashboard]**

> "This is Claire, VP of Ops. Not a data analyst. Not technical.
>
> She built this dashboard herself. No IT ticket. No BI team. No waiting 3 weeks for a new chart. With **AI/BI Dashboard**, there's no per-seat licensing - anyone can build and view.
>
> Revenue: $3.8M - normal. Orders: steady.
>
> But returns: **$180K**. Usually $60K. And three Skincare products at 30% return rates - everything else is 8%.
>
> In most companies, Claire's next step is: email the analyst, open a ticket, wait. Maybe two weeks later she gets a report.
>
> But Claire doesn't have to wait. She thinks: *Why do I have so many returns?*"

---

### Act 2: The Investigation (3-4 min)

**[Open: MAS - Operations Assistant]**

**[Type]** `Why do I have so many returns?`

> "Claire doesn't know SQL. She doesn't need to.
>
> This is **AI/BI Genie**. It puts analytics in the hands of business users - not just the data team. Claire asks a business question in plain English. The kind of question that used to create a ticket, sit in a backlog, take weeks.
>
> Watch what happens."

*Wait for response*

> "In seconds:
> - Returns 3x normal
> - Three Skincare products account for 78%
> - All trace to **lot LOT-2025-0212**, manufactured February 12th
> - Customers saying: 'grainy texture', 'product separated'
>
> Genie didn't just query - it *investigated*. Trend analysis, product breakdown, lot tracing, customer sentiment. All from one question.
>
> And it suggests: *check for an incident report*. Let's do that."

---

**[Type]** `Was there an incident for lot LOT-2025-0212?`

> "Now we're asking the **Knowledge Assistant** - it searches through incident reports, QC documents, anything indexed.
>
> The structured data told us WHAT happened. The documents tell us WHY."

*Wait for response*

> "There it is. February 12th - the homogenizer had pressure fluctuations. QC noted *'minor texture variations due to pressure fluctuations during emulsification.'*
>
> The lot was released because visual inspection passed. They thought it was cosmetic.
>
> Two questions. One platform. Complete answer:
> - Equipment calibration issue
> - → Texture problems in 2,400 units
> - → Customer returns
> - → $180K impact this week"

---

### Act 3: The Platform (1 min)

> "Let's zoom out. What did we just see?
>
> Data from Shopify, Zendesk, ERP - **ingested in clicks** with Lakeflow Connect.
>
> Transformed by **SDP pipelines** - built by describing what we need, not hand-coding fragile jobs.
>
> Visualized in a **dashboard** Claire built herself - no BI team required.
>
> Queried in plain English by **Genie** - analytics for business users, not just analysts.
>
> Connected to documents by **Knowledge Assistant** - data tells you WHAT, docs tell you WHY.
>
> Orchestrated by the **Multi-Agent Supervisor** - Claire doesn't need to know which system to ask.
>
> All governed by **Unity Catalog** - same permissions, same lineage, from raw data to AI.
>
> **One platform. Anyone can ask. Everyone gets answers.**
>
> That's Databricks."

---

### Closing

> "You've invested millions collecting data. How much value are you actually getting from it?
>
> Most companies have data scattered across dozens of systems. AI projects take months just to get the data ready. Business users wait weeks for basic answers. Most questions never even get asked.
>
> What we just showed you is different:
> - Any data source connects in clicks
> - Any question gets answered in seconds
> - Any AI use case - BI, ML, agents, apps - runs on the same governed data
>
> Claire isn't special. She's a VP with no technical skills. But she just did in 2 minutes what used to take a team two weeks.
>
> **That's the real value: not one investigation, but unlocking all the value from all your data - for everyone in your company.**
>
> That's Databricks."
