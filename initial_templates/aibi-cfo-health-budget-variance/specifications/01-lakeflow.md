# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Departments** (8, deterministic annual opex budgets — these sum to ~$820M):

| department | annual opex budget | actual vs budget | notes |
|------------|-------------------|------------------|-------|
| **Nursing** | ~$210M | **+$3.57M over** | The outlier. Overrun is ~entirely Contract Labor (+$3.58M). |
| Surgical Services | ~$140M | ~flat (±$0.2M) | |
| Emergency | ~$95M | ~flat | |
| Radiology | ~$70M | ~flat | |
| Pharmacy | ~$120M | slightly over (~+$0.3M) | Drug cost inflation — small, not the story |
| Lab | ~$55M | ~flat | |
| Facilities | ~$60M | slightly over (~+$0.2M) | |
| Administration | ~$70M | ~flat | |

> Total forecast lands **~$4.8M over ~$820M budget** (live: $824.8M forecast vs $820M budget = +$4.78M). Nursing department variance is +$3.57M; within it, Contract Labor (+$3.58M) is ~75% of the total forecast miss; the rest is the AI_FORECAST projection carrying the rising Q2+ opex trend forward plus minor Pharmacy/Facilities drift. **Do not spread the overrun evenly — the whole point is that it concentrates in one department and one line item.**

**Expense categories** (per department): `Salaries` (employed), `Benefits`, `Contract Labor` (agency/temp), `Supplies`, `Purchased Services`, `Other`. For every department except Nursing, all categories track ~flat to budget. For **Nursing**, Salaries/Benefits/Supplies are flat and **Contract Labor is +$3.58M over budget**.

**Staffing (the root cause)** — Nursing RN staffing:

| metric | prior year | current year |
|--------|-----------|--------------|
| Employed RN FTEs | ~1,000 | ~1,000 (**flat, ±1%**) |
| Employed RN blended cost | ~$52/hr all-in | ~$52/hr |
| Employed RN hours (indexed to Jan) | 100 | wobbles ~95–105 (flat) |
| Agency RN hours (indexed to Jan) | 100 | ramps to **~280** (nearly 3×) |
| Agency RN cost | ~$105/hr (**~2.0×** employed) | ~$105/hr |

Headcount is flat but agency HOURS surged (indexed ~100 → ~280 through the year) — vacancies backfilled with agency nurses at ~2× cost. That is the entire Contract Labor overrun. Agency labor spend nets ~$16.4M.

**Staffing vendors** (agency spend concentration):

| vendor | prior-year spend | current-year spend | YoY |
|--------|------------------|--------------------|-----|
| **Apex Clinical Staffing** | ~$0.9M | ~$3.2M | **~3.5×** — the driver |
| Cornerstone Medical Staffing | ~$0.6M | ~$0.8M | modest |
| BlueRidge Nurses | ~$0.4M | ~$0.5M | modest |
| (2–3 smaller vendors) | small | small | flat |

**Revenue**: recognized net patient revenue is **roughly flat YoY (~+1.3%)** — monthly YoY swings believably (~ -4% to +5% with real healthcare seasonality: winter respiratory peak, summer dip, Q4 elective-surgery surge) but nets to low-single-digit growth for the year. This is what makes it a *cost* story, not a demand story. Generate current and prior year INDEPENDENTLY (seasonality + noise) so the per-month YoY varies — a mechanical, identical +0.5% every month looks fake.

**Time references**: STORY_END_DATE = NOW, FISCAL_YEAR_START = start of the current fiscal year (Jan 1 of the current year is fine), monthly grain. Actuals exist for months elapsed so far; AI_FORECAST projects the remaining months to year-end. Nursing Contract Labor ramps through the year (small in Q1, accelerating Q2+) so the forecast miss widens after Q2.

> Numbers above are narrative targets. Generated data should land approximately in these ranges — exact equality is not required. Keep math simple and prefer the story over decimal precision.

---

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.

## A. Synthetic Data Generation

**Skill to use**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` before implementing.

**Python runtime**: use the pre-provisioned databricks-connect venv (its path is in the system prompt under "Pre-provisioned databricks-connect venv"). Do NOT create a new venv or install databricks-connect.

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| gl_actuals.parquet | ~10K | Monthly GL actuals: (department × expense_category × month). ~8 depts × 6 categories × 12 months × a few cost centers. Encodes the variance shape in Shared Context |
| budget.parquet | ~600 | Monthly budget by (department × expense_category × month). Sums to ~$820M annual |
| revenue.parquet | ~12 | Monthly recognized net patient revenue — flat YoY (~+1.3%) |
| staffing_hours.parquet | ~24K | Monthly (department × worker_type × month) hours + cost. worker_type ∈ {Employed, Agency}. Nursing agency hours ramp from index ~100 to ~280 |
| compensation.parquet | ~1.2K | One row per (role × department): headcount, base_salary_usd, total_comp_usd, blended_hourly_cost. **This is the sensitive table masked in Section E** |
| vendor_invoices.parquet | ~2K | Staffing-vendor invoices: (vendor × department × month) amount. Apex Clinical Staffing dominates Nursing agency spend, up ~3.5× YoY |
| facilities.parquet | 4 | The 4 hospitals in the Chicagoland metro (facility_id, facility_name, city, latitude, longitude). Each cost center rolls up to one facility; the Nursing contract-labor overrun concentrates at 2 of them (Lakeshore + Riverside) for the map |

### Data Variation

- Revenue: flat YoY (~+1.3%) with mild monthly seasonality (±5%), NO material growth trend — this is deliberate (cost story, not demand story).
- Non-Nursing departments: actuals within ±1–2% of budget across all categories (a little noise so it looks real, but no material variance).
- Nursing: Salaries/Benefits/Supplies flat to budget; **Contract Labor ramps** — near budget in Q1, accelerating from Q2 so cumulative variance reaches +$3.58M by year-end.
- Agency hours ramp mirrors the Contract Labor ramp; employed RN hours stay flat.

### The Event (the contract-labor surge)

RN vacancies open through the year and are backfilled with agency nurses. Employed RN headcount stays flat (~1,000 FTE) while **agency hours ramp from an index of ~100 to ~280** (nearly 3×) at **~2× the hourly cost** of an employed RN. Most agency spend routes to **Apex Clinical Staffing** (~3.5× YoY). This is the entire Nursing Contract Labor overrun — every downstream table must reproduce it.

### Table Schemas

**gl_actuals**: `row_id` (PK), `fiscal_month` (DATE, first-of-month), `department`, `cost_center`, `expense_category` (Salaries/Benefits/Contract Labor/Supplies/Purchased Services/Other), `actual_usd`

**budget**: `row_id` (PK), `fiscal_month` (DATE), `department`, `expense_category`, `budget_usd`

**revenue**: `fiscal_month` (PK, DATE), `net_patient_revenue_usd`, `prior_year_revenue_usd`

**staffing_hours**: `row_id` (PK), `fiscal_month` (DATE), `department`, `worker_type` (Employed/Agency), `role` (RN/Tech/Aide/…), `hours`, `blended_hourly_cost_usd`, `labor_cost_usd`

**compensation** (⚠️ sensitive — see Section E): `role`, `department`, `headcount` (int), `base_salary_usd`, `total_comp_usd`, `blended_hourly_cost_usd`

**vendor_invoices**: `invoice_id` (PK), `vendor_name`, `department`, `fiscal_month` (DATE), `worker_type` (Agency), `amount_usd`, `hours_billed`

**facilities**: `facility_id` (PK), `facility_name`, `city`, `latitude`, `longitude` — 4 hospitals clustered around Chicago. A fixed cost_center → facility map (`Nursing` cost centers → Lakeshore + Riverside) attributes GL variance to geography.

---

## B. Medallion (built inline in generate_data.py)

Like the other AI/BI templates, there is **no SDP pipeline** — the raw → silver → gold
medallion is folded inline into `data_generation/generate_data.py` (`saveAsTable` +
NOT NULL/PK RELY), with a `spark_python_task` in the DAB. The bronze/silver/gold
definitions below are the authoring contract for those inline transforms.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | budget, forecast, variance, revenue YoY | gold_opex_monthly + gold_budget_variance + gold_revenue |
| Dashboard forecast chart | monthly actuals + AI_FORECAST projection to year-end | gold_opex_forecast |
| Dashboard drill-down | variance by department → category | gold_budget_variance |
| Dashboard FTE-vs-contractor | employed vs. agency hours + cost over time | gold_staffing_summary |
| Dashboard vendor | agency spend by vendor | gold_vendor_spend |
| Genie investigation | variance by dept/category, employed-vs-agency gap, vendor concentration | all gold_* tables |

### Source → Bronze (1:1 ingestion)

gl_actuals/budget/revenue/staffing_hours/compensation/vendor_invoices.parquet → bronze_{table_name}

### Bronze → Silver (joins + conforming)

**silver_actuals_vs_budget**: gl_actuals FULL JOIN budget on (fiscal_month, department, expense_category). Expectations: `department IS NOT NULL`, `expense_category IS NOT NULL`. Columns: fiscal_month, department, expense_category, actual_usd (0 if null), budget_usd (0 if null), variance_usd (actual - budget).

**silver_staffing**: staffing_hours conformed. Columns: fiscal_month, department, worker_type, role, hours, labor_cost_usd, blended_hourly_cost_usd.

**silver_vendor**: vendor_invoices conformed. Columns: vendor_name, department, fiscal_month, amount_usd, hours_billed.

### Silver → Gold (variance, forecast, staffing, vendor)

**⚠️ The variance must concentrate in Nursing → Contract Labor per Shared Context. That single line item (+$3.58M) is the demo's punchline.**

**gold_opex_monthly** — one row per (fiscal_month). Columns: fiscal_month, actual_opex_usd (SUM actuals), budget_opex_usd (SUM budget). Only months with actuals present.

**gold_budget_variance** — one row per (department, expense_category). Columns: department, expense_category, actual_ytd_usd, budget_ytd_usd, variance_usd (actual - budget), variance_pct. Nursing/Contract Labor is the large positive outlier.

**gold_opex_forecast** — the AI_FORECAST output (see Section C). Columns: fiscal_month, actual_opex_usd (null for future months), forecast_opex_usd, opex_upper, opex_lower (the AI_FORECAST confidence band — populated only on forecast rows, NULL on actuals), budget_opex_usd, series_type ('actual'/'forecast').

**gold_staffing_summary** — one row per (fiscal_month, department, worker_type). Columns: fiscal_month, department, worker_type, total_hours, total_labor_cost_usd, avg_hourly_cost_usd. The Employed-vs-Agency contrast for Nursing (flat employed, surging agency at ~2× cost) reads directly off this.

**gold_vendor_spend** — one row per (vendor_name, department). Columns: vendor_name, department, spend_ytd_usd, spend_prior_year_usd, yoy_multiple (spend_ytd / spend_prior_year). Apex Clinical Staffing on Nursing is the top row (~3.5×).

**gold_revenue** — one row per (fiscal_month). Columns: fiscal_month, net_patient_revenue_usd, prior_year_revenue_usd, revenue_yoy_pct. Aggregate YoY ≈ +1.3%.

**gold_facility_variance** — one row per facility (4 hospitals). Columns: facility_id, facility_name, city, latitude, longitude, total_variance_usd (full-year variance attributed to the facility's cost centers), nursing_contract_labor_variance_usd. The Nursing Contract Labor overrun concentrates at Lakeshore + Riverside (~$1.8M each ≈ the whole +$3.58M); the other two hospitals sit near zero. Feeds the dashboard's facilities map. Total across facilities ties out to the full-year deterministic variance (~$3.83M).

### Filter Coherence Matrix

| Filter | gold_budget_variance | gold_staffing_summary | gold_vendor_spend |
|--------|----------------------|-----------------------|-------------------|
| department | ✅ | ✅ | ✅ |

`department` must be present as a dimension on gold_budget_variance, gold_staffing_summary, and gold_vendor_spend so the dashboard's department filter (and the Nursing drill-down) cross-apply.

### Column Reference (contract for 02-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|----------------|----------------|
| gold_opex_monthly | fiscal_month | actual_opex_usd, budget_opex_usd |
| gold_opex_forecast | fiscal_month, series_type | actual_opex_usd, forecast_opex_usd, opex_upper, opex_lower, budget_opex_usd |
| gold_budget_variance | department, expense_category | actual_ytd_usd, budget_ytd_usd, variance_usd, variance_pct |
| gold_staffing_summary | department, worker_type, fiscal_month | total_hours, total_labor_cost_usd, avg_hourly_cost_usd |
| gold_vendor_spend | department, vendor_name | spend_ytd_usd, spend_prior_year_usd, yoy_multiple |
| gold_revenue | fiscal_month | net_patient_revenue_usd, revenue_yoy_pct |
| gold_facility_variance | facility_name, city | latitude, longitude, total_variance_usd, nursing_contract_labor_variance_usd |

---

## C. AI_FORECAST — opex projection to year-end

**Skill to use**: `databricks-ai-functions` — read `SKILLS/databricks-ai-functions/SKILL.md` before implementing (the `ai_forecast` section).

Use the `AI_FORECAST` table-valued function on `gold_opex_monthly` to project `actual_opex_usd` forward to the fiscal year-end. Materialize the result as **gold_opex_forecast**, unioning historical actuals (series_type='actual') with the forecast rows (series_type='forecast'), and carry `budget_opex_usd` on every month so the dashboard can plot actual/forecast against budget on one axis.

- **Horizon**: forecast the remaining months of the fiscal year (however many are not yet actual).
- **Persist the confidence band**: `AI_FORECAST` returns `*_upper` / `*_lower` on the forecast rows — carry them into `gold_opex_forecast` as `opex_upper` / `opex_lower` (NULL on actual months) so the dashboard's forecast-line widget can draw the band.
- **Target headline**: summed actuals + forecast ≈ **$824.8M** against a ~$820M budget → **~$4.8M over** (live: +$4,775,238). The Nursing Contract Labor ramp (Q2+) is what pushes the forecast above budget; if your generated actuals already trend over, AI_FORECAST will extend that trend naturally.
- Do **not** hand-code the projection — the demo point is that one SQL function (`AI_FORECAST`) produces the board-headline number. Call it once at the gold step; downstream reads the materialized table.

---

## D. PDF Generation (optional — staffing invoices as unstructured landing)

Not required for the core story (invoices are ingested as structured `vendor_invoices`). Skip unless the demo needs to show a document landing zone; if built, place a few agency invoice PDFs in `{raw_data_volume}/staffing_invoices/` for a Lakeflow direct-ingest talking point.

---

## E. Comp Controls — Unity Catalog column masking

**Skill to use**: `databricks-unity-catalog` — read `SKILLS/databricks-unity-catalog/SKILL.md` before implementing.

The **compensation** table (bronze_compensation, and any gold view over it) is genuinely sensitive. The demo's governance hook: **Finance sees full comp detail; Operations managers see headcount only** — same table, same query, masked by policy.

### Personas (groups)

Create two groups to demo role-based views:
- `finance` — sees full compensation detail (base_salary_usd, total_comp_usd, blended_hourly_cost_usd).
- `ops_managers` — sees `headcount` and non-sensitive columns; salary/comp columns come back **masked**.

Grant both groups SELECT on the comp table. The difference must come from the MASK policy, not from separate tables or views — "same table, same query, different result."

### Masking

Tag the sensitive columns and apply a column-mask policy (ABAC-style tag policy preferred; a direct column mask function is an acceptable fallback):

```sql
-- Tag the sensitive comp columns
ALTER TABLE compensation ALTER COLUMN base_salary_usd SET TAGS ('sensitivity' = 'comp');
ALTER TABLE compensation ALTER COLUMN total_comp_usd  SET TAGS ('sensitivity' = 'comp');
ALTER TABLE compensation ALTER COLUMN blended_hourly_cost_usd SET TAGS ('sensitivity' = 'comp');

-- Mask returns NULL for anyone who is not in the finance group
CREATE FUNCTION mask_comp(v DOUBLE)
  RETURNS DOUBLE
  RETURN CASE WHEN is_account_group_member('finance') THEN v ELSE NULL END;

-- One catalog-level policy covers every column tagged sensitivity=comp
CREATE POLICY mask_comp_policy ON CATALOG {catalog}
  COLUMN MASK mask_comp
  FOR TABLES MATCH COLUMNS has_tag_value('sensitivity','comp') AS col ON COLUMN col;
```

`headcount` is NOT tagged, so it stays visible to everyone — that's the "managers see the heads, Finance sees the money" line.

### Demo moment

Side-by-side: a `finance` user selects from the comp table and sees real salaries; an `ops_managers` user runs the identical query and sees masked salary columns but real headcount. Same table, same SQL, different result = comp controls in action.

---

## F. Validation

Run before proceeding to 02-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Total budget | `SELECT SUM(budget_ytd_usd) FROM gold_budget_variance` | ~$820M (annualized) |
| Variance concentration | `SELECT department, SUM(variance_usd) v FROM gold_budget_variance GROUP BY department ORDER BY v DESC` | Nursing far on top; others near zero |
| The line item | `SELECT variance_usd FROM gold_budget_variance WHERE department='Nursing' AND expense_category='Contract Labor'` | ~+$3.58M |
| Forecast miss | `SELECT SUM(forecast_opex_usd) - SUM(budget_opex_usd) FROM gold_opex_forecast` | ~+$4.8M (AI_FORECAST; live +$4.78M) |
| Revenue ~flat | `SELECT (SUM(net_patient_revenue_usd)-SUM(prior_year_revenue_usd))/SUM(prior_year_revenue_usd)*100 FROM gold_revenue` | ~+1.3% (low single digit; per-month varies) |
| Employed vs agency | `SELECT worker_type, SUM(total_labor_cost_usd) FROM gold_staffing_summary WHERE department='Nursing' GROUP BY worker_type` | Agency cost materially up (~$16.4M); avg_hourly_cost ~2× employed ($105 vs $52) |
| Vendor concentration | `SELECT vendor_name, yoy_multiple FROM gold_vendor_spend WHERE department='Nursing' ORDER BY spend_ytd_usd DESC` | Apex Clinical Staffing top, ~3.5× |
| Facility concentration | `SELECT facility_name, total_variance_usd FROM gold_facility_variance ORDER BY total_variance_usd DESC` | Lakeshore + Riverside ~$1.8M each; North Suburban + Westgate near zero |
| Comp mask works | Query comp table as `finance` vs `ops_managers` | Finance sees salaries; managers see NULLs + real headcount |

Add `dashboard_id` and `genie_space_id` to `resources.json` (there is no pipeline — the medallion is inline in `generate_data.py`).
