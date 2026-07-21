# Healthcare CFO — Budget Variance & Comp Controls

```glance
Data Ingestion: Lakeflow Connect, Spark Declarative Pipelines
AI: AI Functions (AI_FORECAST), Genie
Data Analysis: Dashboard, Genie
Foundation: Unity Catalog (column masking / comp controls)
```

## The Story

| | |
|---|---|
| **Company** | A regional non-profit health system (4 hospitals, ~1,100 beds) — Office of the CFO / FP&A |
| **Hero** | Dana Reyes, CFO — needs a board-ready answer, not a data project |
| **Problem** | It's the Friday before the board meeting. The full-year operating-expense forecast is tracking **~$4.1M over budget** and Q2 is already running hot — but recognized revenue is **flat (+0.5% YoY)**. The board will ask: is this a demand problem or a cost problem? |
| **Investigation** | Dana drills from the headline opex miss → **department** → **expense category** → **employed FTE vs. contractor** → **vendor**, then asks Genie *"Why is Nursing over budget?"* in plain language |
| **Root cause** | The entire overrun traces to **one department (Nursing)** and within it **one line item — Contract Labor (+$3.58M)**. RN vacancies are backfilled with agency nurses at **~2× cost per FTE**; headcount is flat while cost climbs, and the growth traces to a single staffing vendor — **Apex Clinical Staffing (up ~3.5× YoY)** |
| **Comp controls** | The compensation table is sensitive. Governance decides who sees what: **Finance sees full comp detail; Operations managers see headcount only** — same table, same query, masked by policy |
| **Outcome** | Dana walks into the board meeting with a one-sentence story ("it's a contract-labor problem in Nursing, not a demand problem") and a specific lever — an RN hiring/float-pool plan to retire the agency premium |

---

## Overview

The health system closes the month and the full-year forecast is $4.1M in the red. Revenue is flat, so this is not a volume story — it's a cost story, and the CFO has 48 hours to tell the board exactly *which* cost.

Dana opens the FP&A dashboard. Page one is the board narrative: opex budget vs. actual vs. an **AI_FORECAST** projection to year-end, with recognized revenue flat beside it. Page two is the drill-down: department variance names Nursing as the outlier; expense category names Contract Labor; the FTE-vs-contractor view shows employed headcount flat while agency hours climb; the vendor view names Apex Clinical Staffing. Then Dana asks Genie *"Why is Nursing over budget?"* and gets the same answer in a sentence — no SQL.

Underneath, Unity Catalog enforces **comp controls**: the compensation detail that powers the cost-per-FTE math is fully visible to Finance and masked to everyone else, on the same governed table.

**Duration:** 6–8 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Full-year opex budget | ~$820M |
| Full-year opex forecast (AI_FORECAST) | ~$824.1M → **~$4.1M over** |
| Recognized revenue YoY | **+0.5%** (flat) |
| Nursing Contract Labor variance | **+$3.58M** (≈87% of the total miss) |
| Employed RN blended cost / FTE | ~$52 / hr all-in |
| Agency RN cost / FTE | ~$105 / hr (**~2.0×**) |
| Nursing employed headcount YoY | ~flat (±1%) |
| Agency nurse hours YoY | **+140%** |
| Apex Clinical Staffing spend YoY | **~3.5×** (~$0.9M → ~$3.2M) |
| Departments tracked | 8 (Nursing, Surgical Services, Emergency, Radiology, Pharmacy, Lab, Facilities, Administration) |

---

## Products Showcased

"Build" = a resource we provision in the workspace. "Talk track" = a platform capability we mention live but don't build per-demo.

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Lakeflow Connect** | Talk track | Pulls the GL (Oracle ERP), HRIS/payroll (comp + headcount), timekeeping (employed vs. agency hours), and staffing-vendor invoices into the lakehouse — no custom plumbing |
| **SDP Pipeline** | Build | Turns raw GL, budget, staffing, comp, and revenue feeds into the Gold tables (budget variance, staffing summary, vendor spend, revenue) the dashboard and Genie read from |
| **AI Functions — AI_FORECAST** | Build | Projects the monthly opex actuals to year-end, producing the ~$4.1M miss headline on page one — one SQL function, no model to manage |
| **AI/BI Dashboard** | Build | Dana's two-page FP&A cockpit: board narrative (KPIs + forecast) on page one, guided drill-down (department → category → FTE-vs-contractor → vendor) on page two |
| **AI/BI Genie** | Build | Answers *"Why is Nursing over budget?"* conversationally, right where the dashboard leaves off — the CFO or an analyst interrogates the data without SQL |
| **Unity Catalog — Comp Controls** | Build | Column masking on the compensation table: Finance sees full comp detail, Operations managers see headcount only. Same table, same query, governed by policy |
| **Databricks One** | Talk track | Where Dana actually works — same dashboard, same Genie, no separate tool to stand up |

---

## Demo Walkthrough

**Frame:** It's Friday afternoon. The board packet is due Monday. The forecast says $4.1M over budget and revenue is flat. Dana Reyes has to walk in and say — in one sentence — what happened and what the fix is.

---

### Act 1 — The board headline (1–2 min)

**Open the FP&A dashboard (page 1) in Databricks One.**

KPI row: **~$820M budget**, **~$824.1M forecast**, **~$4.1M variance ⚠️**, **revenue +0.5% YoY**. The hero chart plots monthly opex actuals against budget, with the **AI_FORECAST** projection continuing the actual line to year-end — the gap widens after Q2. Beside it, recognized revenue is a flat line.

> *"This is the board's first question answered before they ask it: revenue is flat, so this isn't a demand problem. The forecast — that's **AI_FORECAST**, one SQL function over the monthly actuals, no model to train — says we land $4.1M over. Now the only question is *where*."*

---

### Act 2 — Drill to the department, then the line item (2–3 min)

**Go to page 2 and walk the drill-down.**

- **Department variance** (bar): every department is near zero except **Nursing**, which is deep red. One outlier.
- **Click Nursing → expense category** (bar): Salaries flat, Benefits flat, Supplies flat — **Contract Labor is +$3.58M**. That single line is essentially the whole miss.
- **FTE vs. contractor** (grouped bar over time): employed nursing headcount is flat all year; **agency nurse hours climb ~140%**. Cost per agency FTE is ~2× an employed RN.
- **Vendor breakdown** (bar): among staffing vendors, **Apex Clinical Staffing** dominates — up ~3.5× YoY.

> *"From a scary board number to a specific, actionable root cause in four clicks. It's not 'Nursing is expensive' — it's 'we're backfilling RN vacancies with agency nurses at twice the cost, and most of it is one vendor.' That's a hiring and float-pool decision, not a mystery. Every one of these tiles is the **AI/BI Dashboard** reading the same governed Gold tables."*

---

### Act 3 — Ask it in English (1–2 min)

**Open Genie (or the dashboard's ask bar). Type:** `Why is Nursing over budget?`

Genie decomposes the variance: Nursing vs. plan, category breakdown surfacing Contract Labor, the employed-vs-agency cost gap, and the vendor concentration on Apex. It answers in a sentence with the numbers behind it.

Follow-ups: `How much of the overrun is agency labor?` · `Which vendor drove the increase?` · `What would we save if agency hours returned to last year's level?`

> *"That's **AI/BI Genie** — Dana didn't write SQL, and neither would an analyst at 6pm on a Friday. Same Gold tables the dashboard reads, so the number in the chart and the number in the answer are the same number, governed and reproducible."*

---

### Act 4 — Comp controls: same data, different eyes (1 min)

**Show the governance moment.** The cost-per-FTE math is built on the **compensation** table — genuinely sensitive HR/finance data.

- As a **Finance** user: query the comp table → full **base salary and total comp** per role.
- As an **Operations manager**: run the *same* query → salary columns come back **masked**; only **headcount** is visible.

> *"That's **Unity Catalog** comp controls — a column-masking policy keyed to a governance tag, not a copied-and-scrubbed spreadsheet. Finance sees the money, department managers see the heads. One table, one query, governed by policy — which is the only way self-service on HR and finance data is safe to hand out."*

---

### Closing

> Dana walks into the board meeting with one sentence: *"We're $4.1M over on a flat-revenue year, and it's not demand — it's contract labor in Nursing. We're backfilling RN vacancies with agency nurses at twice the cost, mostly through one vendor. The fix is a hiring and float-pool plan that retires the agency premium, and here's the number it saves."*
>
> Same data the dashboard reads. Same governance the lakehouse enforces on the comp detail underneath it. From board-level headline to root cause to plain-language Q&A — **one platform, one set of numbers, governed for who's allowed to see what.**
