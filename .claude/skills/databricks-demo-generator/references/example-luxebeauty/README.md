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

## Demo Walkthrough

**Frame:** Monday morning. Claire's team pinged her — returns are spiking. She opens the Returns Console to see what's going on.

---

### Act 1 — Open the app (1 min)

**Open the LuxeBeauty Returns Console.**

This is the operational app Claire's team uses every day. KPI cards show returns running at 3x normal, 250+ customers waiting on resolution. Recent activity feed shows yesterday's refunds piling up.

> *"You don't have to leave Databricks to ship a real product to your business users. This is **Databricks Apps** — a full-stack React + FastAPI app, hosted on Databricks, with OAuth and resource bindings built in. No separate hosting, no separate identity provider, no separate audit trail."*
>
> *"The operational state — the returns queue, approvals, the audit timeline — lives in **Lakebase**, a managed serverless Postgres designed for cloud apps. Same governance as your lakehouse, but built for sub-millisecond reads and writes from your app. The Gold tables your **SDP pipeline** produces — fed by **Lakeflow Connect** from Shopify, Zendesk, and your ERP — are synced into Lakebase automatically. Operators read fresh data; analysts query the same source of truth and the Datawarehouse in the same place."*

---

### Act 2 — Ask why, in the app (2 min)

**In the app's chat dock, type:** `Why do I have so many returns?`

The thinking panel streams the investigation live. **Claire never leaves the app.**

> *"The assistant inside the app isn't a hand-rolled prompt — it's a **Multi-Agent Supervisor**. Under the hood it routed to **Genie**, which traced the spike to one production lot across three SKUs and pulled customer comments — 'grainy texture', 'product separated'. Then it routed to **Knowledge Assistant**, which searched the manufacturing reports and found the homogenizer pressure incident on that lot's production date."*
>
> *"Two questions, two specialist agents, one answer — and **MLflow** traces every step of the agent's reasoning so you can replay any decision later. **Unity Catalog** is the spine: the agents only see what Claire is allowed to see. Same permissions on the raw data, the agents, and the app."*

---

### Act 3 — Act on it, in the app (2 min)

**Click the featured action:** `Handle the bad-lot returns`.

Agent drafts the apology email + 20% coupon, identifies all 250 affected customers, and **stops for approval**. Claire reviews → approves → KPI cards tick live as refunds process and emails go out. Audit trail in the drawer shows every action with timestamps and signatures.

> *"This is what makes an app different from a chatbot: it can **act**. The agent's tools write to **Lakebase** — refunds, coupons, audit rows — and the 'wait for approval' is a hard stop in the agent's tool chain, not a UI suggestion. **Humans-in-the-loop, by design.**"*

---

### Act 4 — Zoom out: Databricks One (1 min)

**Switch tabs to Databricks One.**

> *"The team built this app because returns processing is their daily job — they need write actions, approvals, an audit trail. **But you don't always need to build an app.** For everyone else in the company — finance, marketing, the CEO — **Databricks One** is already the answer. Same data, same governance, no code to write."*

Show the same dashboard from the app, ask Genie the same `Why so many returns?` question conversationally, surface the same KA incident report.

> *"Same Lakeflow Connect ingestion. Same SDP Gold tables. Same Genie space. Same Knowledge Assistant. Same Unity Catalog governance. **One platform, two surfaces: the app for the team that operates the business, Databricks One for everyone else who just needs to ask.**"*

---

### Closing

> Every project, every app, every agent that actually moves the business has the same prerequisite: **data from every source you've got, in one place, ready to act on.** No single system held the answer here — it was in the join across all of them. Same for the next project, and the one after that.
>
> That's the bet Databricks lets you make: **ingest from anywhere, then act on it any way you need.** Lakeflow Connect pulls from 200+ sources with no custom plumbing. SDP shapes it into Gold tables. From there, the *acting* layer is wide open: AI/BI dashboards for the read-only audience, Databricks One for the no-code crowd, Genie + KA + MAS for the agentic experiences, Lakebase + Databricks Apps when your team needs a real product to operate the business. Unity Catalog underneath all of it — one permission model, one source of truth.
>
> **Ingest everything. Then build whatever you need on top — BI, apps, agents — without re-stitching the data each time.**

---

## Products Showcased

"Build" = a resource we provision in the workspace. "Talk track" = a platform capability we mention live but don't build per-demo (already there or auto-included).

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Lakeflow Connect** | Talk track | Pulls Shopify orders, Zendesk returns, and ERP production data into the lakehouse — no custom pipelines, so the spike is visible the morning it happens |
| **SDP Pipeline** | Build | Turns those raw feeds into the Gold tables (returns, products, lots) the dashboard, Genie, and the app all read from |
| **Databricks Apps** | Build | Hosts the Returns Console where Claire's team works — full-stack React/FastAPI, OAuth + resource bindings out of the box, no separate hosting |
| **Lakebase** | Build | The serverless Postgres behind the app — holds the live returns queue, refund approvals, and audit timeline that ticks during the demo |
| **AI/BI Dashboard** | Build | The $180K spike at a glance — built in clicks, embedded in both the app and Databricks One |
| **AI/BI Genie** | Build | Cracks the *"why so many returns?"* question by tracing the spike to one production lot across three SKUs |
| **Knowledge Assistant** | Build | Surfaces the homogenizer incident report — connects the data anomaly to the manufacturing root cause |
| **Multi-Agent Supervisor** | Build | The brain inside the app's chat — routes Claire's questions to Genie (the data) or KA (the docs) without her thinking about it |
| **MLflow** | Talk track | Auto-traces every Genie / KA / MAS call — replay any agent decision later, no wiring needed |
| **Unity Catalog** | Talk track | One permission model from Shopify ingestion all the way to the agent's tool calls — Claire only sees what she's allowed to see, everywhere |
| **Databricks One** | Talk track | Where the rest of the company lands — the CEO, finance, marketing get the same dashboard + Genie answers, no app required |
