# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in `01-lakeflow.md` (Section B — Column Reference).
Goal: a Genie space and a two-page AI/BI Dashboard for Dana's FP&A cockpit.

> **Talking-track-only products mentioned in the README** — do **not** build resources for these:
> - **Databricks One** is a workspace-level surface, not a buildable artifact.
> - **Genie Code** is the AI authoring assist *inside* the Genie/SQL editor — referenced in the narrative, not a separate resource.
> - **Lakeflow Connect** is the ingestion talking point — the pipeline in `01-lakeflow.md` already lands the data.

> Unity Catalog **comp controls** (column masking on the compensation table) are built in `01-lakeflow.md` Section E — this file does not rebuild them, but the dashboard/Genie must read only NON-masked gold tables (they never expose raw comp).

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.

## A. Genie Space

**Skill to use**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `Healthcare CFO Budget Variance` Genie Space.

### Tables

`gold_budget_variance` (variance by dept × category), `gold_staffing_summary` (employed vs. agency hours + cost), `gold_vendor_spend` (agency spend by vendor), `gold_opex_forecast` (actuals + AI_FORECAST projection), `gold_revenue` (revenue YoY).

> Point Genie only at the gold_* tables above — never at bronze_compensation (comp masking lives at the table level, but the Genie story is variance, not salaries).

### Instructions

```
You analyze operating-expense budget variance for the CFO (Dana Reyes) of a regional health system. Non-technical, board-focused. Lead with the answer, then the numbers.

BASELINES:
- Full-year opex budget is ~$820M; the AI_FORECAST projection lands ~$824.1M → ~$4.1M over.
- Recognized revenue is flat YoY (+0.5%) — so this is a COST problem, not a demand problem. Say so.
- A healthy budget variance is within ±1% by department. Nursing is the outlier.

THE ROOT CAUSE (the punchline — always drive toward this):
- The overrun concentrates in ONE department (Nursing) and ONE line item (Contract Labor, +$3.58M ≈ 87% of the total miss).
- Employed nursing headcount is flat; agency nurse HOURS are up ~140% at ~2× the hourly cost of an employed RN.
- The agency spend growth traces to ONE vendor: Apex Clinical Staffing (~3.5× YoY).

INVESTIGATION FLOW for "Why is Nursing over budget?":
1. gold_budget_variance → Nursing is the top variance; within Nursing, Contract Labor is the driver (+$3.58M).
2. gold_staffing_summary (department='Nursing') → employed hours flat, agency hours +140%, agency ~2× cost/hr.
3. gold_vendor_spend (department='Nursing') → Apex Clinical Staffing dominates, up ~3.5× YoY.
4. Conclude: "It's contract labor — RN vacancies backfilled with agency nurses at ~2× cost, mostly through one vendor."

Answer in a sentence first, then the supporting numbers. Use $ and % formatting. Never expose individual compensation — you only have aggregated gold tables.
```

### Sample Questions

- "Why is Nursing over budget?"
- "How much of the overrun is agency labor?"
- "Which vendor drove the increase in contract labor?"
- "Is revenue up or down this year?"
- "How does agency nurse cost compare to employed nurses?"
- "What's the full-year opex forecast vs. budget?"
- "What would we save if agency hours returned to last year's level?"

### Validation

- "Why is Nursing over budget?" → names Contract Labor (+$3.58M), the agency-vs-employed cost gap, and Apex Clinical Staffing.
- "Is revenue up or down?" → flat (+0.5%), framed as "this is a cost problem."
- "What's the forecast vs budget?" → ~$824.1M vs ~$820M, ~$4.1M over.
- Department filter → variance recomputes for the selected department.

Add `genie_space_id` to `resources.json`.

---

## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns JSON shape, encoding rules, and grid math; this spec is story-level.

Create `Healthcare CFO — Budget Variance` dashboard. Save locally as `PROJECT/dashboard.json`. Link the Genie space from Section A. **Two pages**: page 1 is the board narrative, page 2 is the guided drill-down.

### Filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets it filters | Default |
|--------|--------|---------------------|---------|
| Department | department | gold_budget_variance, gold_staffing_summary, gold_vendor_spend | All |

The department filter cross-applies to page 2's drill-down widgets. Page 1 (KPIs + forecast + revenue) is org-wide and does not need the filter. There is no date filter — the story is the full-year forecast, not an arbitrary window.

### Page 1 — "The board headline" (12-column grid)

**Row 1 — KPIs (4 counters, 3 cols each):**
- **Opex Budget** = SUM(budget_opex_usd) from gold_opex_forecast → ~$820M. Format: currency, compact.
- **Opex Forecast (AI_FORECAST)** = SUM(forecast_opex_usd) → ~$824.1M. Format: currency, compact.
- **Full-Year Variance ⚠️** = SUM(forecast_opex_usd) - SUM(budget_opex_usd) → ~+$4.1M. Format: currency, compact. **The attention-grabber — color red.**
- **Revenue YoY** = AVG(revenue_yoy_pct) from gold_revenue → +0.5%. Format: percent. Label it "flat" so the "cost not demand" point reads.

**Row 2 — "Opex: actual → forecast vs. budget" (full-width 12 cols, line/combo):**
- x = fiscal_month. Series: actual_opex_usd (solid), forecast_opex_usd (dashed continuation), budget_opex_usd (reference line).
- Source: gold_opex_forecast. The forecast line pulls above budget after Q2 — the visual of the $4.1M miss opening up.

**Row 3 — "Revenue is flat" (full-width 12 cols, line):**
- x = fiscal_month, y = net_patient_revenue_usd, with prior_year_revenue_usd as a second series.
- Source: gold_revenue. The two lines sit on top of each other — flat YoY. This is the "not a demand problem" panel.

### Page 2 — "The drill-down" (12-column grid)

**Row 1 — "Variance by department" (full-width 12 cols, horizontal bar):**
- y = department, x = variance_usd, color: red if positive (over budget), green if negative.
- Source: gold_budget_variance (aggregated to department). Nursing is the lone deep-red bar; everything else hugs zero.

**Row 2 — "Nursing: variance by expense category" (full-width 12 cols, horizontal bar):**
- y = expense_category, x = variance_usd. Source: gold_budget_variance filtered to Nursing (or use the department filter set to Nursing).
- **Contract Labor** is the tall red bar (~+$3.58M); Salaries/Benefits/Supplies hug zero.

**Row 3 — "Employed vs. agency: hours & cost over time" (two widgets, 6 cols each):**
- Left (grouped bar/line, x = fiscal_month): total_hours by worker_type for Nursing — employed flat, agency climbing.
- Right (bar, x = worker_type): avg_hourly_cost_usd for Nursing — agency ~2× employed. Source: gold_staffing_summary.

**Row 4 — "Agency spend by vendor" (full-width 12 cols, bar):**
- y = vendor_name, x = spend_ytd_usd (optionally show yoy_multiple as a label). Source: gold_vendor_spend filtered to Nursing.
- Apex Clinical Staffing is the dominant bar (~3.5× YoY).

### Validation

- Page 1 KPIs: ~$820M budget, ~$824.1M forecast, ~+$4.1M variance (red), +0.5% revenue YoY.
- Page 1 forecast chart: forecast line diverges above budget after Q2; revenue lines flat and overlapping.
- Page 2 department bar: Nursing the lone over-budget outlier.
- Page 2 category bar (Nursing): Contract Labor the tall bar (~$3.58M).
- Page 2 employed-vs-agency: agency hours climb, agency cost/hr ~2× employed.
- Page 2 vendor bar: Apex Clinical Staffing dominant.
- Department filter (select Nursing) → drill-down widgets narrow to Nursing.

Add `dashboard_id` to `resources.json`.
