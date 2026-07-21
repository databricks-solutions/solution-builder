# AI/BI Customer Support — Making Support More Efficient with AI

> **What this is.** A fast, end-to-end AI/BI demo: a travel company deploys an AI
> Support Copilot (built on Databricks with Agent Bricks), and the whole support
> org gets dramatically more efficient. You see the impact on an AI/BI Dashboard,
> then ask **Genie** *why* — and it traces the gain to the Copilot's GA launch.
> No app, no ML training — synthetic data → governed metric view → Dashboard + Genie.

## The Story

| | |
|---|---|
| **Company** | A global travel company (agencies + corporate travel), support org across NA / EMEA / APAC / LATAM |
| **Hero** | The **VP of Customer Support**, reviewing 2025 performance |
| **Problem** | Support cost and resolution time had been stubbornly high — until something changed mid-2025 |
| **Investigation** | Average resolution time drops from **~26h → ~11h**, cost per case roughly halves, satisfaction ticks up. Why? |
| **Root cause** | The **AI Support Copilot v1.0 went GA on 2025-06-02**, auto-resolving How-To / Access / Billing cases end-to-end. Daily AI deflections jump from zero at that date and keep climbing. |
| **Impact** | Faster resolution, lower cost per case, higher satisfaction — humans freed to focus on complex Outage / Bug / Performance cases |

---

## Overview

A travel-support company launched an AI Support Copilot that reached general
availability on **June 2, 2025**. It answers customers directly for the three most
common ticket categories — How-To, Access and Billing — looking up booking context
and issuing standard fixes without a human. From that date, the human support load
falls, average resolution time drops sharply, cost per case roughly halves, and
customer satisfaction rises. The "why" is fully grounded in the data: the
`ai_assistant_releases` table carries the GA release notes, and `ai_assistant_usage`
shows daily AI deflections jumping from zero at launch and climbing as adoption grows.
Regions have distinct personalities (APAC is the slow region), so any regional filter
shows real, defensible differences rather than uniform noise.

---

## Key Numbers

| Metric | Value |
|---|---|
| Support cases (3 years) | ~20,000 |
| Avg resolution time, before → after AI | ~26h → ~11h |
| Cost per case | roughly halved after GA |
| AI auto-resolution rate (mature) | up to ~70% of How-To / Access / Billing |
| AI Copilot GA date | 2025-06-02 |
| Regions | NA, EMEA, APAC (slowest), LATAM |

---

## Demo Walkthrough

**Frame:** *"Our support org got a lot more efficient in 2025. Let's see it on the
dashboard, then ask Genie why — in plain English."*

### Act 1 — Spot the shift (1 min)
Open the **AI/BI Dashboard**. The KPI cards show avg resolution time and cost per
case down, satisfaction up. The weekly human-handled-volume line bends down mid-2025
and the AI-usage widgets light up at the same moment. Something clearly happened.

### Act 2 — Ask why, in Genie (1–2 min)
Switch to the **Genie space**. Ask *"Why did our average support resolution time
drop in 2025?"* Genie ties the drop to the **AI Support Copilot v1.0 GA on
2025-06-02**, quotes the release notes, and shows daily AI deflections jumping from
zero at that date. Follow with *"How much did cost per case fall after the AI Copilot
launched?"* and *"Which region has the slowest resolution time?"* (APAC).

### Act 3 — Zoom out: one governed platform (30s)
The dashboard and Genie both read the **same governed data** — the
`support_cases_enriched` gold table and the `support_metrics` metric view. One set
of numbers, one definition of every KPI, consumed by both a dashboard and natural
language. That's the AI/BI promise: governed data + natural language = answers in
seconds, no analyst in the loop.

### Closing
*"The AI Copilot made support measurably more efficient — and because everything runs
on one governed lakehouse, a business user can see the impact **and** ask why, without
writing a line of SQL."*

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---|---|---|
| **Synthetic data generation** | Build | Generates the full travel-support dataset from scratch (dimensions + fact + AI story tables) |
| **Unity Catalog Metric View** | Build | `support_metrics` — governed KPIs (resolution time, cost, satisfaction, AI-resolved rate) correct under any grouping |
| **AI/BI Dashboard** | Build | The efficiency story at a glance: KPIs, before/after, trends, regional + category breakdowns |
| **AI/BI Genie** | Build | Natural-language "why" — traces the gain to the Copilot GA release and rising usage |
| **Lakeflow Connect** | Talk track | How the raw support / usage data would land in the lakehouse |
| **Agent Bricks** | Talk track | What the AI Support Copilot itself is built on |
| **Genie on Databricks One** | Talk track | The same Genie space, reachable by any business user from their phone |
