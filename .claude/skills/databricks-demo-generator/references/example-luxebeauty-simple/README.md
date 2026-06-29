# LuxeBeauty Co. — Simple Returns Demo

> **What this is.** A **fast, end-to-end** Databricks demo on the same LuxeBeauty universe as `example-luxebeauty/`, scoped to the Simple-tab capabilities of the home picker: synthetic data → AI/BI Dashboard + Genie (+ optional Databricks App). The full demo lives at `example-luxebeauty/` when you want more depth.

## The Story

| | |
|---|---|
| **Company** | LuxeBeauty Co. — D2C cosmetics e-commerce |
| **Hero** | Claire Dubois, VP of Operations (non-technical) |
| **Problem** | Returns spiked to $180K/week three weeks ago (3x normal), still elevated |
| **Investigation** | Claire asks "Why so many returns?" — Genie traces to 3 skincare products from one production lot, surfaces the manufacturing incident note inline |
| **Root cause** | Homogenizer pressure issue at the Lyon facility caused texture problems in ~5,000 units of that lot |
| **Impact** | $180K peak returns, ~30% return rate vs 8% normal, decaying as the affected inventory clears |

---

## Overview

Claire opens her Monday dashboard and sees returns spiked to $180K three weeks ago — triple the usual $60K — still elevated at ~$80K despite trending down. Three Skincare products are driving it, all with 30% return rates.

She asks one question: *"Why do I have so many returns?"*

Genie walks the data: returns → 3 SKUs → one lot at Lyon. The lot row carries an `incident_summary` text column — homogenizer pressure fluctuation during emulsification, lot released despite the QC note. Two questions, complete answer.

If the app is included, Claire's team works the queue in the Returns Console: KPI cards tick when refunds get processed, an agent answers "why?" inline, and a one-click bulk-approve sends a flat 10% goodwill coupon to every customer in the affected lot.

**Duration:** 4–5 minutes (~6–8 with the app variant).

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Peak returns (3 weeks ago) | ~$180K (3x) |
| Current returns | ~$80K (decaying) |
| Affected lot | (dynamic — `LOT-{YYYY}-{MMDD}` at runtime) |
| Affected SKUs | SKU-1001, SKU-1002, SKU-1003 |
| Return rate for affected products | ~30% vs 8% normal |
| Affected customers | ~1,500 across the lot |

---

## Demo Walkthrough

**Frame:** Monday morning. Claire's team pinged her — returns are spiking. She opens the dashboard.

### Act 1 — Spot the spike (1 min)

**Open the LuxeBeauty Operations dashboard.**

KPI tiles read $180K / 30% return rate / spike vs baseline. The weekly bar chart shows a clear 3x peak three weeks back and a decay curve through the recent weeks — the spike sits in the past with a tail trending back to normal, not pinned at the right edge.

On the Investigation page, the Returns-by-product bar is dominated by SKU-1001 / SKU-1002 / SKU-1003 — three Skincare SKUs sitting an order of magnitude above the rest. The map on the Operations page lights up Europe (FR + IT lead, then GB / DE) — affected customers concentrated in the EU market.

> *"This is **AI/BI Dashboards** — built in clicks, no React code, governed by **Unity Catalog**. The data behind every tile came in through **Lakeflow Connect** from Shopify, Zendesk, and the ERP — no custom plumbing. The Gold tables it reads from were populated directly by a fast SQL load (production demos run **Spark Declarative Pipelines** for this — bronze→silver→gold with data quality expectations, schema enforcement, and incremental refresh. We're showing the simplest, fastest path today to make the dashboard land in minutes)."*

---

### Act 2 — Ask why, in Genie (1–2 min)

**Open the Genie space attached to the dashboard.**

**Claire types:** `Why do I have so many returns?`

Genie walks the data: weekly returns trend → spots the 3x spike → finds the three SKUs dominating return volume → all sharing one lot → reads the lot's `incident_summary` column inline and surfaces it as part of the answer: *"Homogenizer pressure fluctuations during emulsification — calibration drift on Lyon's HMG-03 unit. Lot was released despite the QC note about texture variations."*

> *"This is **AI/BI Genie** — natural language over Unity Catalog. Claire didn't write a JOIN, didn't open a notebook, didn't tag anyone in Slack. She asked. The same **Unity Catalog** that powers the dashboard powers Genie — same data, same permissions, same numbers. No glue to maintain."*
>
> *"The incident note sits as a text column on the lot, and Genie quotes it directly. When you have unstructured incident reports (PDFs, Confluence pages, scanned scans), the same pattern moves into a **Knowledge Assistant** without changing how the operator asks."*

---

### Act 3 — Optional: the Returns Console (2–3 min, only if the app is built)

**Skip this act if Databricks Apps + Lakebase aren't in the build.**

**Open the LuxeBeauty Returns Console.**

The operational app Claire's team uses every day. KPI cards show pending refunds at 3x normal, ~1,500 customers waiting on a decision. The returns queue is sortable + filterable; clicking a row opens a drawer with the customer, the lot, the refund amount, and approve/reject/escalate buttons.

In the assistant dock at the bottom right, **Claire types:** `Why do I have so many returns?` — same question, this time a Genie-backed agent streams the answer into the conversation. Then **Claire clicks the featured action** `Handle the bad-lot refunds`. The agent identifies the ~1,500 affected customers, drafts an apology email template + a 10% goodwill coupon, and stops for approval. Claire approves. KPI cards tick live, the queue rows flip to "approved", the audit timeline records every action.

> *"This is **Databricks Apps + Lakebase** — a full-stack React + Node app, hosted on Databricks, with OAuth and resource bindings built in. The operational state — the queue, approvals, the audit trail — lives in **Lakebase**, a serverless Postgres under the same Unity Catalog governance as the lakehouse. The dashboard tables get synced into Lakebase so the queue reflects fresh data instantly."*
>
> *"The assistant is a single tool-using agent over **AI/BI Genie** — one tool, one offer, one approval. Add a Knowledge Assistant, a Multi-Agent Supervisor, or an ML classifier when the business asks for them."*

---

### Act 4 — Zoom out: Databricks One (30s)

**Switch to Databricks One.**

> *"The team uses the app because they process refunds every day — they need write actions and an audit trail. For everyone else in the company — finance, the CEO, marketing — **Databricks One** is the answer. Same dashboard. Same Genie space. Same governance. No code to write."*

Show the same dashboard from Databricks One; ask Genie the same `Why so many returns?` question conversationally.

> *"Same Lakeflow Connect ingestion. Same Gold tables. Same Genie space. Same Unity Catalog governance. **One platform, two surfaces: the app for the team that operates the business, Databricks One for everyone else who just needs to ask.**"*

---

### Closing

> Even the simplest demo here — one dashboard, one Genie space, one optional app — sits on top of **the same governed data the rest of your platform reads.** When you're ready, you layer in **SDP** for proper bronze→silver→gold transformations, **Knowledge Assistant** for unstructured-doc lookup, **Multi-Agent Supervisor** to orchestrate across them, and **ML models** for behavioral classification — all without re-stitching the data each time. That's what makes Databricks the place to start AND the place to scale.
>
> **Ingest once. Build a dashboard in an hour. Add an app in a day. Add ML and agents when the business demands them. Same governance covers everything.**

---

## Products Showcased

"Build" = a resource we provision in the workspace. "Talk track" = a platform capability we mention live but don't build per-demo (already there or auto-included).

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Synthetic Data Generation** | Build (fast load) | Generates realistic LuxeBeauty data (~50K customers, ~200K orders, ~25K returns, ~1.5K lots) into 5 raw tables, then runs 3 small `spark.sql` transforms to produce the read-optimized `gold_*` tables the dashboard + Genie consume. Visible lineage in Catalog Explorer, no pipeline infra. SDP is the talking track here. |
| **Lakeflow Connect** | Talk track | "In production, this is how Shopify / Zendesk / ERP data arrives — 200+ source connectors, no custom pipelines." |
| **AI/BI Dashboard** | Build | The $180K spike at a glance — built in clicks, embedded in both the app and Databricks One. |
| **AI/BI Genie** | Build | Cracks the *"why so many returns?"* question by walking the gold tables and quoting the lot's `incident_summary` inline. |
| **Databricks Apps** | Build (optional) | Hosts the Returns Console — Node/React full-stack, OAuth + resource bindings out of the box. Skip this build if the demo doesn't include `databricks-apps`. |
| **Lakebase** | Build (optional, paired with Apps) | Serverless Postgres behind the app — holds the live queue, refund approvals, audit timeline. Skip if no app. |
| **Unity Catalog** | Talk track | One permission model from ingestion through Genie's queries to the app's resource bindings. |
| **Databricks One** | Talk track | Where the rest of the company lands for the same dashboard + Genie answers. |
| **Genie Code** | Talk track | The AI authoring assist *inside* the Genie/SQL editor — referenced but not provisioned per-demo. |
