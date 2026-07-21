# AI/BI Portfolio Assistant — Concentrated in the AI Trade

> **What this is.** A fast, end-to-end AI/BI demo for **wealth / portfolio management**:
> a manager's flagship **AI Growth Fund** is beating its benchmark by riding the *real*
> AI rally — but a series of reorganizations, capped by a major AI pivot, left it
> dangerously concentrated in AI names. You see the outperformance on an AI/BI Dashboard,
> then ask **Genie** *why* — and it traces it to the reorgs, shows concentration stepping
> up, and quantifies the rising risk. No app, no ML training — real prices → governed
> analysis tables + metric view → Dashboard + Genie.

## The Story

| | |
|---|---|
| **Company** | A wealth manager running three books: **AI Growth Fund**, Balanced Fund, Income Fund |
| **Hero** | The **portfolio manager / CIO**, reviewing the flagship AI Growth Fund |
| **Headline** | The AI Growth Fund is **beating its benchmark** (the Nasdaq-100 / QQQ) by a wide margin |
| **Investigation** | *Why* is it winning — and what's the catch? |
| **Root cause** | Three portfolio **reorganizations** progressively bought AI and sold defensives, capped by a **major AI pivot on 2025-08-04**. Core-AI concentration stepped up **~30% → ~46% → ~77%**. |
| **The catch** | The fund is now a large, undiversified bet on AI — **~77% core-AI, ~87% Technology** vs ~34% in the benchmark. Post-pivot Value at Risk and volatility rose. The bet has paid off *so far*; the caution is the structural concentration risk. |

---

## Overview

The flagship AI Growth Fund (portfolio_id = 1) has outperformed the Nasdaq-100 (QQQ) over
the window by riding the **real** AI rally — daily prices are pulled from Yahoo Finance,
so the outperformance is grounded in actual market data. The "why" is fully in the data:
the `rebalances` table logs three reorganizations that bought AI and sold defensives, and
`concentration_timeseries` shows core-AI weight stepping up to ~77% at the **2025-08-04**
pivot. The story is **risk, not a crash**: `risk_metrics` and `var_metrics` show that
after the pivot the fund's volatility and Value at Risk rose, but returns rose faster so
its Sharpe stayed strong (~2.1, above the benchmark). Two comparison books (Balanced,
Income) make the AI Growth Fund's concentration a defensible outlier.

---

## Key Numbers

| Metric | Value |
|---|---|
| Fund cumulative return (window) | ~+118% |
| Benchmark (QQQ) cumulative return | ~+58% |
| Outperformance | ~+60 points |
| Core-AI concentration, era 1 → 2 → 3 | ~30% → ~46% → ~77% |
| Technology weight, fund vs benchmark | ~87% vs ~34% |
| Fund Sharpe, before → after pivot | ~1.2 → ~2.1 (benchmark ~1.76) |
| Fund volatility, before → after pivot | ~23% → ~29% |
| Major AI pivot date | 2025-08-04 |
| Prices | REAL (Yahoo Finance), 40 securities + QQQ |

---

## Demo Walkthrough

**Frame:** *"Our flagship AI Growth Fund is crushing its benchmark. Let's see it on the
dashboard, then ask Genie why — and whether we should be worried."*

### Act 1 — The win (1 min)
Open the **AI/BI Dashboard** → *Performance & risk*. The indexed line shows the fund
well above the benchmark; KPI cards show the return, outperformance and holdings count.
Clearly winning.

### Act 2 — Ask why, in Genie (1–2 min)
Switch to the **Genie space**. Ask *"Why is the AI Growth Fund beating its benchmark?"*
Genie traces it to the reorganizations (`rebalances`) that bought AI and sold defensives.
Follow with *"How concentrated is the fund in AI, and how did that change over time?"* —
Genie shows core-AI stepping up to ~77% at the August pivot.

### Act 3 — The catch: quantify the risk (1 min)
Back on the dashboard → *Concentration risk*: the concentration step-line, the
reorganizations table, the ~87% Technology overweight, the return distribution. Ask Genie
*"What is our Value at Risk, and did the pivot increase it?"* and *"Did Sharpe improve or
worsen after the pivot?"* — post-pivot VaR and volatility are higher, but Sharpe is strong.

### Closing
*"The fund won by concentrating into the AI rally — and because everything runs on one
governed lakehouse, the manager can see the win **and** quantify the concentration risk,
without writing a line of SQL."*

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---|---|---|
| **Synthetic data generation** | Build | Generates the full portfolio dataset from scratch — REAL prices (yfinance) + synthetic holdings / reorgs / news |
| **Unity Catalog Metric View** | Build | `portfolio_metrics` — governed holdings-mix KPIs correct under any grouping |
| **AI/BI Dashboard** | Build | The outperformance + concentration story: performance line, VaR, concentration step-up, reorgs, sector overweight |
| **AI/BI Genie** | Build | Natural-language "why" — traces the win to the reorgs and quantifies the rising concentration risk |
| **Lakeflow Connect** | Talk track | How market / holdings / news data would land in the lakehouse |
| **Unity Catalog** | Talk track | Governance over the securities / holdings / prices tables (PK/FK, lineage) |
| **Agent Bricks** | Talk track | Building a portfolio-analysis agent on top of this governed data |
| **Genie on Databricks One** | Talk track | The same Genie space, reachable by any business user from their phone |
