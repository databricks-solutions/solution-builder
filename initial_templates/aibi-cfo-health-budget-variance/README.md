# Healthcare CFO — Budget Variance & Comp Controls

```glance
Data Ingestion: Lakeflow Connect
AI: AI Functions (AI_FORECAST), Genie
Data Analysis: Dashboard, Genie
Foundation: Unity Catalog (column masking / comp controls)
```

## The Story

| | |
|---|---|
| **Company** | A regional non-profit health system (4 hospitals, ~1,100 beds) — Office of the CFO / FP&A |
| **Hero** | Dana Reyes, CFO — needs a board-ready answer, not a data project |
| **Problem** | It's the Friday before the board meeting. Opex tracked to budget all spring — but it **crossed above budget over the summer**, and the **year-end projection now lands ~$4.8M over** and still widening. Meanwhile recognized revenue is **roughly flat YoY (~+1.3%)**, so operating margin is compressing to ~$20M. The board will ask: is this a demand problem or a cost problem? |
| **Investigation** | Dana drills from the headline opex miss → **department** → **expense category** → **employed FTE vs. contractor** → **vendor**, then asks Genie *"Why is Nursing over budget?"* in plain language |
| **Root cause** | The entire overrun traces to **one department (Nursing)** and within it **one line item — Contract Labor (+$3.58M)**. RN vacancies are backfilled with agency nurses at **~2× cost per FTE**; headcount is flat while cost climbs, and the growth traces to a single staffing vendor — **Apex Clinical Staffing (up ~3.5× YoY)** |
| **Comp controls** | The compensation table is sensitive. Governance decides who sees what: **Finance sees full comp detail; Operations managers see headcount only** — same table, same query, masked by policy |
| **Outcome** | Dana walks into the board meeting with a one-sentence story ("it's a contract-labor problem in Nursing, not a demand problem") and a specific lever — an RN hiring/float-pool plan to retire the agency premium |

---

## Overview

The health system closes the month. Opex hugged the budget line through the spring, then quietly crossed above it over the summer — and the year-end projection now says the year ends ~$4.8M over and the gap is still opening. Revenue is roughly flat, so this isn't a volume story — it's a cost story, and the CFO has 48 hours to tell the board exactly *which* cost.

Dana opens the FP&A dashboard. Page one is the board narrative: the KPI row (forecast-vs-budget miss, compressing operating margin, ~flat revenue, climbing agency-labor spend — each with a sparkline), a hero forecast line that shows monthly opex crossing above budget and the projection band pulling away to year-end, the cumulative-overrun curve compounding beside it, a grouped bar contrasting net patient revenue this year vs. prior, and a map of the four hospitals — where two, Lakeshore and Riverside, light up as the sites carrying nearly the whole overrun. Revenue is bumpy month to month but flat for the year — not a demand problem. Page two is the drill-down: department variance names Nursing as the lone outlier; expense category names Contract Labor; the employed-vs-agency view shows employed hours flat while agency hours surge at ~2× the cost; the vendor view names Apex Clinical Staffing. Then Dana asks Genie *"Why is Nursing over budget?"* and gets the same answer in a sentence — no SQL.

Underneath, Unity Catalog enforces **comp controls**: the compensation detail that powers the cost-per-FTE math is fully visible to Finance and masked to everyone else, on the same governed table.

**Duration:** 6–8 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Full-year opex budget | ~$820M |
| Full-year opex forecast | ~$825M → **~$4.8M over** (and widening) |
| Operating margin (revenue − forecast opex) | **~$20M** (compressing) |
| When opex crosses above budget | early summer (monthly opex tips over ~May–Jun) |
| Recognized revenue YoY | **~+1.3%** (roughly flat; bumpy month to month) |
| Nursing department variance | **+$3.57M** over budget |
| Nursing Contract Labor variance | **+$3.58M** (≈nearly the entire miss) |
| Employed RN blended cost / hr | ~$52 / hr all-in |
| Agency RN cost / hr | ~$105 / hr (**~2.0×**) |
| Agency labor spend (Nursing) | ~$16.4M (climbing) |
| Nursing employed hours YoY | ~flat |
| Agency nurse hours | surging from ~summer (backfilling RN vacancies) |
| Apex Clinical Staffing spend YoY | **~3.5×** (~$0.9M → ~$3.2M) |
| Where the overrun lands | 2 of 4 hospitals — **Lakeshore** & **Riverside** carry ~all of it (~$1.8M each) |
| Departments tracked | 8 (Nursing, Surgical Services, Emergency, Radiology, Pharmacy, Lab, Facilities, Administration) |

---

## Products Showcased

"Build" = a resource we provision in the workspace. "Talk track" = a platform capability we mention live but don't build per-demo.

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Lakeflow Connect** | Talk track | Pulls the GL (Oracle ERP), HRIS/payroll (comp + headcount), timekeeping (employed vs. agency hours), and staffing-vendor invoices into the lakehouse — no custom plumbing |
| **Synthetic data + medallion** | Build | Generates the GL, budget, staffing, comp, revenue and staffing-vendor feeds and builds the Gold tables (budget variance, staffing summary, vendor spend, revenue) the dashboard and Genie read from |
| **AI Functions — AI_FORECAST** | Build | Projects the monthly opex actuals to year-end (live, on the warehouse — the dashboard's hero forecast-line, actuals + point forecast + confidence band), producing the ~$4.8M miss headline on page one — one SQL function, no model to manage |
| **AI/BI Dashboard** | Build | Dana's two-page FP&A cockpit: board narrative on page one (KPIs + forecast-vs-budget + revenue this-year-vs-prior + a hospital map that pins the overrun to two sites), guided drill-down on page two (department → category → FTE-vs-contractor → vendor) |
| **AI/BI Genie** | Build | Answers *"Why is Nursing over budget?"* conversationally, right where the dashboard leaves off — the CFO or an analyst interrogates the data without SQL |
| **Unity Catalog — Comp Controls** | Build | Column masking on the compensation table: Finance sees full comp detail, Operations managers see headcount only. Same table, same query, governed by policy |
| **Databricks One** | Talk track | Where Dana actually works — same dashboard, same Genie, no separate tool to stand up |

---

## Demo Walkthrough

**Frame:** It's Friday afternoon. The board packet is due Monday. Opex just crossed above budget and the year-end projection says the year ends ~$4.8M over on flat revenue. Dana Reyes has to walk in and say — in one sentence — what happened and what the fix is.

---

### Act 1 — The board headline (1–2 min)

**Open the FP&A dashboard (page 1) in Databricks One.**

KPI row (each with a sparkline): **full-year variance vs budget ⚠️ (~$4.8M over, red)**, **operating margin (~$20M, compressing)**, **revenue YoY (~+1.3%, flat)**, **agency labor spend (~$16.4M, climbing)**. The hero chart is a live forecast line: monthly opex hugs the budget line through spring, crosses above it over the summer, and the projection band pulls away toward year-end. Beside it, the cumulative-overrun curve is flat through spring then compounds to ~$4.8M. Below, a grouped bar puts net patient revenue this year next to prior year — bumpy month to month but flat for the year. And a map of the four hospitals lights up **Lakeshore** and **Riverside** as the big dots — two of the four sites carry nearly the entire overrun.

> *"Here's the board's first question answered before they ask it: revenue is basically flat, so this isn't a demand problem. We were on budget all spring — then we crossed over this summer, and the year-end projection says we finish ~$4.8M over and still widening. And it's not everywhere — two hospitals carry almost all of it. Now the only question is *why*."*

---

### Act 2 — Drill to the department, then the line item (2–3 min)

**Go to page 2 and walk the drill-down.**

- **Department variance** (bar): every department is near zero except **Nursing**, which is deep red. One outlier.
- **Click Nursing → expense category** (bar): Salaries flat, Benefits flat, Supplies flat — **Contract Labor is +$3.58M**. That single line is essentially the whole miss.
- **FTE vs. contractor** (hours indexed to January): employed nursing hours stay roughly flat (~95–105); **agency hours climb from an index of 100 to ~280** (nearly 3×). Cost per agency hour is ~2× an employed RN.
- **Vendor breakdown** (bar): among staffing vendors, **Apex Clinical Staffing** dominates — up ~3.5× YoY.

> *"From a scary board number to a specific, actionable root cause in four clicks. It's not 'Nursing is expensive' — it's 'we're backfilling RN vacancies with agency nurses at twice the cost, and most of it is one vendor.' That's a hiring and float-pool decision, not a mystery. Every one of these tiles is the **AI/BI Dashboard** reading the same governed Gold tables."*

---

### Act 3 — Ask it in English (1–2 min)

**Open Genie (or the dashboard's ask bar). Type:** `Why is Nursing over budget?`

Genie decomposes the variance: Nursing vs. plan, category breakdown surfacing Contract Labor, the employed-vs-agency cost gap, and the vendor concentration on Apex. It answers in a sentence with the numbers behind it.

Follow-ups: `How much of the overrun is agency labor?` · `Which vendor drove the increase?` · `Which hospitals are driving the overrun?` · `What would we save if agency hours returned to last year's level?`

> *"That's **AI/BI Genie** — Dana didn't write SQL, and neither would an analyst at 6pm on a Friday. Same Gold tables the dashboard reads, so the number in the chart and the number in the answer are the same number, governed and reproducible."*

---

### Act 4 — Comp controls: same data, different eyes (1 min)

**Show the governance moment.** The cost-per-FTE math is built on the **compensation** table — genuinely sensitive HR/finance data.

- As a **Finance** user: query the comp table → full **base salary and total comp** per role.
- As an **Operations manager**: run the *same* query → salary columns come back **masked**; only **headcount** is visible.

> *"That's **Unity Catalog** comp controls — a column-masking policy keyed to a governance tag, not a copied-and-scrubbed spreadsheet. Finance sees the money, department managers see the heads. One table, one query, governed by policy — which is the only way self-service on HR and finance data is safe to hand out."*

---

### Closing

> Dana walks into the board meeting with one sentence: *"We're ~$4.8M over on a flat-revenue year, and it's not demand — it's contract labor in Nursing, concentrated at two hospitals. We're backfilling RN vacancies with agency nurses at twice the cost, mostly through one vendor. The fix is a hiring and float-pool plan that retires the agency premium, and here's the number it saves."*
>
> Same data the dashboard reads. Same governance the lakehouse enforces on the comp detail underneath it. From board-level headline to root cause to plain-language Q&A — **one platform, one set of numbers, governed for who's allowed to see what.**
