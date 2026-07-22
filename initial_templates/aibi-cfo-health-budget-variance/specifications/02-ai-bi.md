# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in `01-lakeflow.md` (Section B — Column Reference).
Goal: a Genie space and a two-page AI/BI Dashboard for Dana's FP&A cockpit.

> **Talking-track-only products mentioned in the README** — do **not** build resources for these:
> - **Databricks One** is a workspace-level surface, not a buildable artifact.
> - **Genie Code** is the AI authoring assist *inside* the Genie/SQL editor — referenced in the narrative, not a separate resource.
> - **Lakeflow Connect** is the ingestion talking point — the data generation in `01-lakeflow.md` already builds the gold tables.

> Unity Catalog **comp controls** (column masking on the compensation table) are built in `01-lakeflow.md` Section E — this file does not rebuild them, but the dashboard/Genie must read only NON-masked gold tables (they never expose raw comp).

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.

## A. Genie Space

**Skill to use**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `Healthcare CFO Budget Variance` Genie Space.

### Tables

`gold_budget_variance` (variance by dept × category), `gold_staffing_summary` (employed vs. agency hours + cost), `gold_vendor_spend` (agency spend by vendor), `gold_opex_forecast` (actuals + AI_FORECAST projection), `gold_revenue` (revenue YoY), `gold_facility_variance` (over-budget $ by hospital, with lat/long).

> Point Genie only at the gold_* tables above — never at bronze_compensation (comp masking lives at the table level, but the Genie story is variance, not salaries).

### Instructions

```
You analyze operating-expense budget variance for the CFO (Dana Reyes) of a regional health system. Non-technical, board-focused. Lead with the answer, then the numbers.

BASELINES:
- Full-year opex budget is ~$820M; the AI_FORECAST projection lands ~$825M → ~$4.8M over and widening. Opex crossed above budget over the summer.
- Recognized revenue is roughly flat YoY (~+1.3%, bumpy month to month) — so this is a COST problem, not a demand problem. Say so.
- A healthy budget variance is within ±1% by department. Nursing is the outlier (+$3.57M).

THE ROOT CAUSE (the punchline — always drive toward this):
- The overrun concentrates in ONE department (Nursing) and ONE line item (Contract Labor, +$3.58M ≈ the whole Nursing miss).
- Employed nursing headcount is flat; agency nurse HOURS ramp from an index of ~100 to ~280 (nearly 3×) at ~2× the hourly cost of an employed RN (~$105/hr agency vs ~$52/hr employed). Agency labor spend is ~$16.4M.
- The agency spend growth traces to ONE vendor: Apex Clinical Staffing (~3.5× YoY).
- Geographically it concentrates at TWO of the four hospitals: Lakeshore Medical Center and Riverside Community Hospital (~$1.8M of Nursing contract-labor overrun each); North Suburban and Westgate are near zero.

INVESTIGATION FLOW for "Why is Nursing over budget?":
1. gold_budget_variance → Nursing is the top variance; within Nursing, Contract Labor is the driver (+$3.58M).
2. gold_staffing_summary (department='Nursing') → employed hours flat, agency hours surging, agency ~2× cost/hr.
3. gold_vendor_spend (department='Nursing') → Apex Clinical Staffing dominates, up ~3.5× YoY.
4. gold_facility_variance → the overrun lands at Lakeshore + Riverside, not system-wide.
5. Conclude: "It's contract labor — RN vacancies backfilled with agency nurses at ~2× cost, mostly through one vendor, concentrated at two hospitals."

Answer in a sentence first, then the supporting numbers. Use $ and % formatting. Never expose individual compensation — you only have aggregated gold tables.
```

### Sample Questions

- "Why is Nursing over budget?"
- "How much of the overrun is agency labor?"
- "Which vendor drove the increase in contract labor?"
- "Which hospitals are driving the overrun?"
- "Is revenue up or down this year?"
- "How does agency nurse cost compare to employed nurses?"
- "What's the full-year opex forecast vs. budget?"
- "What would we save if agency hours returned to last year's level?"

### Validation

- "Why is Nursing over budget?" → names Contract Labor (+$3.58M), the agency-vs-employed cost gap, and Apex Clinical Staffing.
- "Which hospitals are driving the overrun?" → names Lakeshore + Riverside (~$1.8M each); others near zero.
- "Is revenue up or down?" → roughly flat (~+1.3%), framed as "this is a cost problem."
- "What's the forecast vs budget?" → ~$825M vs ~$820M, ~$4.8M over.
- Department filter → variance recomputes for the selected department.

Add `genie_space_id` to `resources.json`.

---

## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns JSON shape, encoding rules, and grid math; this spec is story-level.

Create `Healthcare CFO — Budget Variance` dashboard. Save locally as `PROJECT/dashboard.json`. Link the Genie space from Section A. **Two content pages** (plus a hidden Filters page): page 1 "The headline" is the board narrative, page 2 "The root cause" is the guided drill-down.

**8 datasets:** `ds_kpi` (headline KPIs, one row per fiscal_month), `ds_forecast` (opex forecast vs budget), `ds_cum_var` (cumulative variance to budget), `ds_revenue` (revenue vs prior year), `ds_facility_map` (over-budget by facility), `ds_variance` (budget variance by dept & category), `ds_staffing` (staffing hours, cost & indexed hours), `ds_vendor` (agency spend by vendor).

### Filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets it filters | Default |
|--------|--------|---------------------|---------|
| Department | department | gold_budget_variance, gold_staffing_summary, gold_vendor_spend | All |

Two global filters: **Department** (single-select, cross-applies to page-2 drill-down widgets) and **Fiscal month** (date-range-picker, cross-applies to every time-series dataset). Page 1 reads org-wide by default.

### Page 1 — "The board headline" (12-column grid)

**Story arc:** opex hugs budget through spring, CROSSES ABOVE it over the summer, and AI_FORECAST projects the gap widening to year-end — the trigger to investigate.

**Row 1 — KPIs (4 counters WITH sparklines, 3 cols each; dataset `ds_kpi`):** each dataset carries a CONSTANT full-year aggregate column (the headline) + a per-month column (the sparkline) + the temporal column; the counter value points at the aggregate (`disaggregated:true`), the `period` encoding draws the trend line.
- **Full-year variance vs budget ⚠️** = SUM(forecast − budget) over gold_opex_forecast → ~+$4.8M. Currency, compact. **Red when positive** (conditional style rule).
- **Operating margin (rev − forecast opex)** = full-year revenue − full-year forecast opex → ~$20M. Currency. Framed "squeezed".
- **Revenue YoY** = (SUM cur − SUM prior)/SUM prior → ~+1.3%. Percent. Label "roughly flat".
- **Agency (contract) labor** = full-year agency labor cost → ~$16.4M. Currency. Framed "climbing".

**Row 2 — hero (8 cols, `ds_forecast`) + cumulative (4 cols, `ds_cum_var`):**
- **Hero: native `forecast-line` widget with live `AI_FORECAST`** on monthly opex (actuals + point forecast + upper/lower confidence band from `opex_upper`/`opex_lower`, bridged) plus a flat **budget horizontal line** (~$68.3M/mo). Monthly opex crosses above budget in early summer and the forecast band pulls away to year-end. This is the "one SQL function projects the miss" moment. Viewer-facing title says "year-end projection", not "AI_FORECAST".
- **Cumulative overrun (area):** running cumulative (actual+forecast) minus cumulative budget, colored actual vs forecast — flat through spring, then compounding to ~$4.8M.

**Row 3 — "Net patient revenue — this year vs prior" (full-width GROUPED BAR, `ds_revenue`):**
- x = fiscal_month, series = this year vs prior year (long format via UNION, color by series, bars side-by-side — `mark.stack:"none"`). This year #094074, Prior year #9AA5B1. Bumpy month to month but ~flat for the year — the "not a demand problem" panel. A grouped/clustered bar (not overlapping lines) makes the near-flat-but-bumpy YoY read cleanly.

**Row 4 — "Where the overrun is" (full-width SYMBOL-MAP, `ds_facility_map`):**
- latitude/longitude from gold_facility_variance; dot size + a blue sequential color ramp = total over-budget $. The four hospitals sit in the Chicagoland metro; **Lakeshore Medical Center** and **Riverside Community Hospital** are the two big dots (~$1.8M of Nursing contract-labor overrun each), North Suburban + Westgate near zero — geography confirms the problem is concentrated, not system-wide. This lands the "two hospitals carry it" beat on the board page, before the drill-down.

### Page 2 — "The drill-down" (12-column grid)

The five widgets read as a numbered narrative (①–⑤) from the headline down to the single vendor. All drill-down widgets read `ds_variance` / `ds_staffing` / `ds_vendor` and cross-apply the Department filter.

**① "Variance by department" (full-width 12 cols, horizontal bar, `ds_variance`):**
- y = department, x = variance_usd, color: red if positive (over budget), green if negative.
- gold_budget_variance aggregated to department. Nursing is the lone deep-red bar (+$3.57M); everything else hugs zero.

**② "Within the department — Contract Labor is the driver" (full-width 12 cols, horizontal bar, `ds_variance`):**
- y = expense_category, x = variance_usd. gold_budget_variance filtered to Nursing (set the Department filter to Nursing).
- **Contract Labor** is the tall red bar (~+$3.58M); Salaries/Benefits/Supplies hug zero.

**③ "Hours indexed to January" (full-width 12 cols, line, `ds_staffing`):**
- x = fiscal_month, series = worker_type, y = hours indexed to Jan (=100). Employed roughly stable (~95–105); agency ramps 100 → ~280. Source: gold_staffing_summary (department='Nursing').

**④ "Agency costs ~2× an employed RN" (full-width 12 cols, bar, `ds_staffing`):**
- x = worker_type, y = avg_hourly_cost_usd for Nursing — agency ~$105 vs employed ~$52 (~2×). Source: gold_staffing_summary.

**⑤ "And it's one vendor — Apex Clinical Staffing dominates" (full-width 12 cols, bar, `ds_vendor`):**
- y = vendor_name, x = spend_ytd_usd (yoy_multiple as a label). gold_vendor_spend filtered to Nursing.
- Apex Clinical Staffing is the dominant bar (~3.5× YoY).

> The facilities symbol-map lives on **page 1** (the board headline), not here — the drill-down page is the department → category → employed/agency → vendor narrative.

### Validation

- Page 1 KPIs: ~+$4.8M variance (red), ~$20M operating margin, ~+1.3% revenue YoY, ~$16.4M agency labor — each with a sparkline.
- Page 1 hero forecast-line: monthly opex crosses above budget in early summer; the year-end projection band pulls away to year-end, against a flat ~$68.3M/mo budget line. Cumulative-overrun area flat then compounding to ~$4.8M.
- Page 1 revenue grouped bar: this year vs prior, bumpy but flat for the year.
- Page 1 facilities map: Lakeshore + Riverside the two big dots (~$1.8M each); North Suburban + Westgate near zero.
- Page 2 department bar: Nursing the lone over-budget outlier.
- Page 2 category bar (Nursing): Contract Labor the tall bar (~$3.58M).
- Page 2 indexed-hours line: employed ~100 flat, agency ramping to ~280.
- Page 2 agency-cost bar: agency ~2× employed ($105 vs $52).
- Page 2 vendor bar: Apex Clinical Staffing dominant.
- Department filter (select Nursing) → drill-down widgets narrow to Nursing.

Add `dashboard_id` to `resources.json`.
