# Lakeflow — Data Generation + Medallion Build

## Shared Context

**Demo:** AI/BI Portfolio Assistant — a wealth manager's flagship **AI Growth Fund**
(portfolio_id = 1) is beating its benchmark (the Nasdaq-100 / QQQ) by riding the REAL
AI rally, but a series of reorganizations — capped by a **major AI pivot on 2025-08-04**
— left it dangerously concentrated (~77% core-AI). Every downstream consumer (dashboard,
Genie) reads the gold analysis tables and the governed metric view `portfolio_metrics`.

**Target:** `{{CATALOG}}.{{SCHEMA}}` (defaults `dbdemos_templates.aibi_portfolio_assistant`).

**Build shape (no SDP pipeline).** A single self-contained Spark script
(`data_generation/generate_data.py`) generates raw data *and* builds the full medallion
in four phases: RAW → SILVER (typed + constrained) → GOLD (analysis tables) → METRICS
(metric view). It runs unchanged in a Databricks notebook (ambient Spark, catalog/schema
from CLI args) or locally via Databricks Connect serverless (catalog/schema from
args/env). Prices are **REAL** — pulled once from Yahoo Finance (`yfinance`) — so the
story is grounded in the actual AI rally; holdings, portfolios, sectors, rebalances and
news/sentiment are synthesized on top with pure Spark. No parquet round-trip, no Faker.

**Temporal anchors (load-bearing — every consumer depends on them):**
- Price window: **2024-06-01 → 2026-06-10**.
- The AI Growth Fund runs **three reorgs**: 2024-06-03 (initial, ~30% core-AI),
  2025-02-03 (minor AI tilt, ~46%), **2025-08-04 (MAJOR AI pivot, ~77% core-AI)**.
- **2025-08-04** is the single step-change the whole risk story turns on; `var_metrics`,
  `returns_distribution` and `risk_metrics`' "After pivot" all key off it.

---

## A. Data Generation Script

### Raw tables (dimensions + facts)

**Dimensions** (curated, realistic values):

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `securities` | ticker | `ticker`, `company`, `sector`, `industry`, `ai_exposure`, `market_cap_b`, `country` | 40 real names; `ai_exposure` ∈ {Core AI, AI-adjacent, Non-AI} drives the concentration story |
| `sectors` | sector | `sector`, `benchmark_weight` | the index allocation, for the concentration/overweight comparison |
| `portfolios` | portfolio | `portfolio_id`, `portfolio_name`, `strategy`, `manager` | AI Growth (1), Balanced (2), Income (3) |

**Facts:**

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `holdings` | portfolio × ticker × era | `portfolio_id`, `ticker`, `effective_date`, `weight_pct`, `shares` | TIME-VERSIONED. AI Growth Fund carries one row per (ticker, era); a **weight-0 row** is written for any ticker dropped in a later era so the as-of weight reflects the full current era (sold names → 0). Balanced/Income are single-era. |
| `rebalances` | reorg × ticker | `rebalance_date`, `ticker`, `action`, `old_weight`, `new_weight`, `weight_change`, `rationale` | The events. `action` ∈ Buy/Add/Trim/Sell; `rationale` labels each reorg ("Major AI pivot — sold defensives, bought AI"). Derived by diffing consecutive eras. |
| `prices` | ticker × date | `ticker`, `date`, `close`, `daily_return` | **REAL** daily closes from yfinance (auto-adjusted). |
| `benchmark` | date | `date`, `close`, `daily_return` | **REAL** — QQQ (Nasdaq-100 ETF). |
| `news` | article | `article_id`, `published_date`, `source`, `title`, `sentiment`, `sentiment_label` | 1800 synthetic headlines; AI names skew positive (the rally). Seeded RNG (42). |
| `news_ticker` | article × ticker | `article_id`, `ticker` | link table |

**Story mechanics (what makes the narrative true):**
- **Three reorgs progressively buy AI, sell defensives.** Core-AI weight steps
  ~30% → ~46% → ~77%; the 2025-08-04 pivot sells every defensive (JNJ, PG, KO, XOM,
  JPM…) and concentrates the book in core-AI names. This drives BOTH the outperformance
  (AI names rallied) AND the concentration risk.
- **Prices are real**, so the outperformance is defensible — the fund's AI-heavy book
  compounds faster than QQQ over the window.
- **Two comparison books** (Balanced, Income) stay static, so cross-portfolio queries
  show the AI Growth Fund's concentration as a genuine outlier.

### Data-shaping rules (must hold end-to-end)
- **The outperformance + concentration must be visible without a filter** — the AI
  Growth Fund's cumulative return exceeds the benchmark's, and its core-AI % rises.
- **The as-of weight in force always reflects the full current era** (dropped tickers
  carry weight-0 rows), so `holdings_asof` never leaks a stale non-zero weight forward.
- **Every FK resolves** — `holdings`/`rebalances`/`prices`/`news_ticker` all reference
  valid `securities.ticker`; `holdings` references `portfolios.portfolio_id`;
  `news_ticker` references `news.article_id`.

---

## B. Medallion Build (folded into the same script)

### Silver — typed + constrained
Each raw DataFrame is written with `saveAsTable` (overwrite), then PK/FK
**constraints (NOT ENFORCED, RELY)** are added so Catalog Explorer draws the ER
diagram and Genie understands the joins: PKs on `securities`, `sectors`, `portfolios`,
`news`; FKs from `holdings` → portfolios/securities, `rebalances`/`prices` → securities,
`news_ticker` → news/securities. FK child + parent column types match. Constraint
creation is idempotent (each wrapped so a re-run doesn't fail if already present).

### Gold — analysis tables (the layer the dashboard + Genie read)
Built with `CREATE OR REPLACE`:
- `holdings_asof` (view) — holdings joined to securities with `lead(effective_date)` as
  `next_eff`, so any date can resolve the era's weights.
- `portfolio_performance` — per-portfolio daily & cumulative return vs the benchmark
  (`cum_port_ret`, `cum_bench_ret`). The outperformance table.
- `concentration_timeseries` — daily core-AI / AI-adjacent / non-AI % per portfolio.
  The concentration step-up.
- `sector_exposure` — current fund weight vs benchmark weight + overweight, by sector.
- `holdings_enriched` — current (latest-era) holdings joined to portfolio + security
  metadata. Source of the metric view.
- `news_enriched` — headlines joined to tickers + `ai_exposure`/`sector`.
- `sharpe_analysis` — per-security annualized return, risk (volatility), Sharpe;
  `fund_weight` non-null only for current AI Growth Fund holdings.
- `var_metrics` — 1-day historical Value at Risk on a $100M notional, by confidence
  (0.95/0.99) and regime ('Post-pivot (current risk)' vs 'Full history'). Post-pivot VaR
  is materially higher.
- `returns_distribution` — post-pivot daily-return histogram buckets.
- `risk_metrics` — annualized return / volatility / Sharpe for fund & benchmark by
  period ('Overall', 'Before pivot', 'After pivot'). After the pivot volatility rose but
  returns rose faster → Sharpe strong (~2.1 vs benchmark ~1.76).

### Metrics — `portfolio_metrics` (see also `04-ai-bi.md`)
A governed metric view (`WITH METRICS LANGUAGE YAML`) over `holdings_enriched`. Defined
here because it's part of the data layer; its measures/dimensions are the contract the
dashboard's metric-view tile and Genie both consume. Full definition in `04-ai-bi.md`.

---

## C. Validation

After the script runs, confirm:
1. **Row counts** — 40 securities, 3 portfolios, ~150 holdings, ~89 rebalances, ~20k
   prices, ~506 benchmark days, 1800 news; 9 gold tables/views + `portfolio_metrics`.
2. **The fund beats the benchmark** — final `cum_port_ret` >> `cum_bench_ret` for
   portfolio_id=1 (≈ +118% vs +58% on the shipped price window).
3. **Concentration steps up** — avg `core_ai_pct` per era ≈ 30% → 46% → 77%.
4. **Risk rose after the pivot** — `risk_metrics`: 'After pivot' fund_volatility >
   'Before pivot', fund_sharpe ≈ 2.1; `var_metrics`: post-pivot VaR > full-history.
5. **Constraints present** — Catalog Explorer shows the PK/FK relationships (4 PK + 6 FK).
6. **Metric view queryable** — `SELECT MEASURE(\`Total Weight\`) ... GROUP BY \`AI Exposure\``
   returns rows.
