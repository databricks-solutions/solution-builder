# AI/BI — Metric View + Dashboard + Genie

## Shared Context

All three artifacts read the same governed data built in `01-lakeflow.md`: the gold
analysis tables (`portfolio_performance`, `concentration_timeseries`, `sector_exposure`,
`sharpe_analysis`, `var_metrics`, `risk_metrics`, `rebalances`, `news_enriched`,
`holdings_enriched`) and the metric view `{{CATALOG}}.{{SCHEMA}}.portfolio_metrics`. The
story they must all make obvious: **the AI Growth Fund is beating its benchmark by riding
the AI rally, but is now dangerously concentrated (~77% core-AI) after the 2025-08-04
pivot — strong returns, rising structural risk.**

---

## A. Metric View — `portfolio_metrics`

Governed metric view (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML`) over
`holdings_enriched` (current-era holdings). It is the governed source for holdings-mix
KPIs so consumers report identical numbers under any grouping.

**Dimensions:** Portfolio, Ticker, Company, Sector, AI Exposure, Country.

**Measures:** Total Weight, Core AI Weight, Number of Holdings, Avg Market Cap,
Top Position Weight.

**Contract:** consumers query measures with `MEASURE(\`Total Weight\`)` etc. and group by
dimensions (e.g. `AI Exposure`, `Sector`). Core-AI weight vs total weight is the
concentration headline.

---

## B. Dashboard (`dashboard/dashboard.lvdash.json`)

A Lakeview dashboard, **3 pages** (2 content + Filters). Datasets bind to
`{{CATALOG}}.{{SCHEMA}}` (the DAB rewrites `dataset_catalog`/`dataset_schema` per target;
the shipped file targets `dbdemos_templates.aibi_portfolio_assistant`).

### Datasets (15)
- `ds_metrics` — the `portfolio_metrics` metric view (via `asset_name`).
- KPI trend datasets: `ds_kpi_return`, `ds_kpi_outperf`, `ds_kpi_conc`, `ds_kpi_holdings`.
- `ds_var95` / `ds_var99` — post-pivot Value at Risk counters.
- `ds_perf` — AI Growth Fund vs benchmark, indexed to 100 (the outperformance line).
- `ds_sharpe_scatter` — risk vs return by holding.
- `ds_conc` — core-AI concentration over time (the step-up).
- `ds_rebal` — the portfolio reorganizations (the "why").
- `ds_risk` — risk-adjusted return, fund vs benchmark, by period.
- `ds_alloc` — allocation fund vs benchmark by sector.
- `ds_dist` — daily return distribution (post-pivot).
- `ds_news` — news sentiment on core-AI holdings.

### Page 1 — "Performance & risk" (the headline)
Outperformance KPIs (return, outperformance pts, concentration, holdings count) +
post-pivot VaR counters; the indexed fund-vs-benchmark line; the risk-vs-return scatter;
the risk-adjusted-return table (fund vs benchmark by period).

### Page 2 — "Concentration risk" (the why + the exposure)
The core-AI concentration step-line; the reorganizations table (`rebalances` — what was
sold/bought at each reorg, capped by the Aug 2025 pivot); allocation fund vs benchmark by
sector (the ~87% Technology overweight); daily return distribution; news sentiment on AI
holdings.

### Theme
Follows the standard demo palette — light canvas, navy→orange categorical palette. Keep
the frame titles verbatim; they are the reading order of the story.

### Validation
1. Dashboard opens with no query errors against the target schema.
2. Page 1's indexed line shows the fund well above the benchmark; VaR counters populate.
3. Page 2's concentration line steps up and jumps at 2025-08-04; the reorganizations
   table shows the "Major AI pivot" rows.
4. Every dataset returns rows (none empty).

---

## C. Genie Space (`genie/genie_space.json`)

**Tables (sorted by identifier):** `concentration_timeseries`, `holdings_enriched`,
`news_enriched`, `portfolio_performance`, `rebalances`, `risk_metrics`, `sector_exposure`,
`sharpe_analysis`, `var_metrics`.

**Room persona / instructions:** Genie is told the story explicitly — this is the
flagship AI Growth Fund (portfolio_id = 1), beating the Nasdaq-100 (QQQ) by riding the
real AI rally but now dangerously concentrated. It must walk the multi-step arc:
(1) PERFORMANCE (`portfolio_performance`, index cum returns to 100), (2) WHY — the three
reorgs that bought AI and sold defensives, capped by the 2025-08-04 pivot (`rebalances`),
(3) CONCENTRATION step-up ~30% → ~46% → ~77% (`concentration_timeseries`) + the ~87%
Technology overweight (`sector_exposure`), (4) RISK — higher post-pivot VaR (`var_metrics`)
and volatility, but strong Sharpe ~2.1 (`risk_metrics`), (5) PER-HOLDING risk
(`sharpe_analysis`; SMCI is the cautionary case), (6) NEWS sentiment (`news_enriched`).
It must always filter `portfolio_id = 1` for the AI Growth Fund and decline questions
unrelated to portfolio/investment analysis.

**Curated (load-bearing) SQL instructions:** the 7 `example_question_sqls` cover
performance vs benchmark, the reorgs, concentration over time, the Aug-4 pivot detail,
Value at Risk, Sharpe before/after, and per-holding risk-vs-return.

**Sample questions (the story-arc walk):** performance vs benchmark → why beating →
concentration over time → the pivot → Value at Risk → Sharpe after pivot → riskiest
holdings.

### Validation
Ask the sample questions; confirm Genie (a) shows the fund beating the benchmark, (b)
attributes it to the reorgs/AI pivot using `rebalances`, (c) shows core-AI concentration
stepping up to ~77%, and (d) quantifies the higher post-pivot risk (VaR / volatility)
while noting the strong Sharpe. **Gotchas:** `data_sources.tables` must be sorted by
identifier; the space title uses a hyphen ("AI-BI"), never "/".
