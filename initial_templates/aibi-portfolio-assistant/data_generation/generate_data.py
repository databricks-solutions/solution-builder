#!/usr/bin/env python
"""
AI/BI Portfolio Assistant — self-contained data generation + medallion build.

Self-contained synthetic demo. The
original ships a raw-parquet generator (REAL prices via yfinance) plus install-time
bronze->silver->gold SQL in `bundle_config.py`; here BOTH are folded into ONE script so
a fork rebuilds the whole demo from scratch with no external dataset dependency:

  Phase 1  RAW      — dimensions (securities, sectors, portfolios), the time-versioned
                      holdings fact + the rebalances event log, REAL daily prices +
                      benchmark (QQQ) pulled once from Yahoo Finance, and synthetic
                      news / sentiment — generated with pure Spark. No parquet stage.
  Phase 2  SILVER   — write the base tables, then PK/FK RELY constraints for Catalog
                      Explorer + Genie join understanding.
  Phase 3  GOLD     — the analysis tables the dashboard + Genie read: holdings_asof
                      (view), portfolio_performance, concentration_timeseries,
                      sector_exposure, holdings_enriched, news_enriched, sharpe_analysis,
                      var_metrics, returns_distribution, risk_metrics.
  Phase 4  METRICS  — portfolio_metrics governed metric view (WITH METRICS YAML).

STORY — "Concentrated in the AI trade":
A wealth manager's flagship AI Growth Fund (portfolio_id = 1) is BEATING its benchmark
(the Nasdaq-100 / QQQ) by riding the REAL AI rally. Three portfolio reorganizations
progressively bought AI and sold defensives, capped by a MAJOR AI PIVOT on 2025-08-04
that concentrated the book in core-AI names (~30% -> ~46% -> ~77% core-AI). Returns are
strong, but the fund is now a large, undiversified bet on AI: post-pivot Value at Risk
and volatility rose. There is no crash in the data — the point is RISK, not a bubble.

Runs two ways (same plain .py — NOT a notebook):
  • On Databricks (DAB spark_python_task) — ambient SparkSession; catalog/schema
    from CLI args: `generate_data.py --catalog <c> --schema <s>`.
  • Locally / from the app — Databricks Connect serverless; catalog/schema from
    the same --catalog/--schema args, or env (CATALOG / SCHEMA), or the defaults.

Local run (use a Python 3.12 venv — Spark Connect UDFs need the client's minor
Python version to match serverless; a 3.11 client fails the pandas_udf step):
  uv venv --python 3.12 .venv && . .venv/bin/activate
  uv pip install "databricks-connect>=16.4,<17.4" numpy pandas yfinance
  DATABRICKS_CONFIG_PROFILE=field-eng \
      python generate_data.py --catalog dbdemos_templates --schema aibi_portfolio_assistant
"""
import argparse
import datetime as dt
import os

import numpy as np
import pandas as pd
import yfinance as yf
from pyspark.sql import functions as F

# ---------------------------------------------------------------------------
# Spark session + catalog/schema resolution — runs in two modes:
#   • On Databricks (DAB spark_python_task): an ambient SparkSession already
#     exists; catalog/schema come from CLI args (--catalog / --schema).
#   • Locally / from the app: no active session, so start Databricks Connect
#     serverless; catalog/schema come from CLI args or env (CATALOG / SCHEMA).
# ---------------------------------------------------------------------------
_p = argparse.ArgumentParser(add_help=False)
_p.add_argument("--catalog")
_p.add_argument("--schema")
_cli, _ = _p.parse_known_args()

from pyspark.sql import SparkSession
spark = SparkSession.getActiveSession()
if spark is None:
    # Local run — connect to serverless.
    from databricks.connect import DatabricksSession
    _profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
    spark = DatabricksSession.builder.profile(_profile).serverless(True).getOrCreate()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "dbdemos_templates")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "aibi_portfolio_assistant")

FQ = f"`{CATALOG}`.`{SCHEMA}`"          # fully-qualified, back-ticked
PIVOT = dt.date(2025, 8, 4)            # the MAJOR AI pivot — the story's step-change
START = "2024-06-01"                   # price-history start
END = "2026-06-10"                     # price-history end (clean, all in the past)
BENCHMARK = "QQQ"                      # Nasdaq-100 ETF as the benchmark

print(f"== target: {CATALOG}.{SCHEMA} ==")
spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG}`")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")


# ===========================================================================
# PHASE 1 — RAW (generated with pure Spark + one yfinance price pull)
# ===========================================================================
# --- SECURITIES (curated universe; ai_exposure drives the concentration story) ----
# ticker, company, sector, industry, ai_exposure, market_cap_b, country
securities = [
    # --- Core AI ---
    ("NVDA", "NVIDIA", "Technology", "Semiconductors", "Core AI", 3200, "USA"),
    ("AVGO", "Broadcom", "Technology", "Semiconductors", "Core AI", 1100, "USA"),
    ("AMD", "Advanced Micro Devices", "Technology", "Semiconductors", "Core AI", 260, "USA"),
    ("PLTR", "Palantir", "Technology", "Software", "Core AI", 330, "USA"),
    ("SMCI", "Super Micro Computer", "Technology", "Hardware", "Core AI", 30, "USA"),
    ("MU", "Micron Technology", "Technology", "Semiconductors", "Core AI", 130, "USA"),
    ("ANET", "Arista Networks", "Technology", "Networking", "Core AI", 140, "USA"),
    ("TSM", "Taiwan Semiconductor", "Technology", "Semiconductors", "Core AI", 900, "Taiwan"),
    ("ORCL", "Oracle", "Technology", "Software", "Core AI", 450, "USA"),
    ("MRVL", "Marvell Technology", "Technology", "Semiconductors", "Core AI", 90, "USA"),
    ("DELL", "Dell Technologies", "Technology", "Hardware", "Core AI", 95, "USA"),
    ("SNOW", "Snowflake", "Technology", "Software", "Core AI", 60, "USA"),
    ("CRWD", "CrowdStrike", "Technology", "Software", "Core AI", 90, "USA"),
    ("VRT", "Vertiv Holdings", "Industrials", "Electrical Equipment", "Core AI", 45, "USA"),
    ("ASML", "ASML Holding", "Technology", "Semiconductors", "Core AI", 380, "Netherlands"),
    # --- AI-adjacent ---
    ("MSFT", "Microsoft", "Technology", "Software", "AI-adjacent", 3300, "USA"),
    ("GOOGL", "Alphabet", "Communication Services", "Internet", "AI-adjacent", 2300, "USA"),
    ("META", "Meta Platforms", "Communication Services", "Internet", "AI-adjacent", 1500, "USA"),
    ("AMZN", "Amazon", "Consumer Discretionary", "Internet Retail", "AI-adjacent", 2100, "USA"),
    ("CRM", "Salesforce", "Technology", "Software", "AI-adjacent", 260, "USA"),
    ("AAPL", "Apple", "Technology", "Consumer Electronics", "AI-adjacent", 3400, "USA"),
    ("NOW", "ServiceNow", "Technology", "Software", "AI-adjacent", 190, "USA"),
    ("ADBE", "Adobe", "Technology", "Software", "AI-adjacent", 230, "USA"),
    ("TSLA", "Tesla", "Consumer Discretionary", "Autos", "AI-adjacent", 800, "USA"),
    ("QCOM", "Qualcomm", "Technology", "Semiconductors", "AI-adjacent", 190, "USA"),
    ("INTC", "Intel", "Technology", "Semiconductors", "AI-adjacent", 95, "USA"),
    # --- Non-AI ---
    ("JNJ", "Johnson & Johnson", "Healthcare", "Pharmaceuticals", "Non-AI", 380, "USA"),
    ("PG", "Procter & Gamble", "Consumer Staples", "Household Products", "Non-AI", 390, "USA"),
    ("KO", "Coca-Cola", "Consumer Staples", "Beverages", "Non-AI", 290, "USA"),
    ("XOM", "Exxon Mobil", "Energy", "Oil & Gas", "Non-AI", 470, "USA"),
    ("JPM", "JPMorgan Chase", "Financials", "Banks", "Non-AI", 640, "USA"),
    ("UNH", "UnitedHealth Group", "Healthcare", "Managed Care", "Non-AI", 520, "USA"),
    ("V", "Visa", "Financials", "Payments", "Non-AI", 560, "USA"),
    ("WMT", "Walmart", "Consumer Staples", "Retail", "Non-AI", 560, "USA"),
    ("CVX", "Chevron", "Energy", "Oil & Gas", "Non-AI", 280, "USA"),
    ("HD", "Home Depot", "Consumer Discretionary", "Home Improvement", "Non-AI", 380, "USA"),
    ("MCD", "McDonald's", "Consumer Discretionary", "Restaurants", "Non-AI", 210, "USA"),
    ("PEP", "PepsiCo", "Consumer Staples", "Beverages", "Non-AI", 230, "USA"),
    ("ABBV", "AbbVie", "Healthcare", "Pharmaceuticals", "Non-AI", 330, "USA"),
    ("BAC", "Bank of America", "Financials", "Banks", "Non-AI", 320, "USA"),
]
securities_df = spark.createDataFrame(
    securities, ["ticker", "company", "sector", "industry", "ai_exposure", "market_cap_b", "country"])
ALL_TICKERS = [s[0] for s in securities]

# --- SECTORS (benchmark allocation, for the concentration comparison) ----
sectors = [
    ("Technology", 0.34), ("Communication Services", 0.16), ("Consumer Discretionary", 0.14),
    ("Healthcare", 0.10), ("Consumer Staples", 0.08), ("Financials", 0.10), ("Energy", 0.08),
]
sectors_df = spark.createDataFrame(sectors, ["sector", "benchmark_weight"])

# --- PORTFOLIOS ----
portfolios = [
    (1, "AI Growth Fund", "Aggressive growth, AI/tech-led", "A. Chen"),
    (2, "Balanced Fund", "Diversified core holdings", "M. Rossi"),
    (3, "Income Fund", "Dividend & low volatility", "S. Patel"),
]
portfolios_df = spark.createDataFrame(portfolios, ["portfolio_id", "portfolio_name", "strategy", "manager"])

# --- HOLDINGS (TIME-VERSIONED) + REBALANCES ----
# The AI Growth Fund went through 3 reorgs. The MAJOR one (2025-08-04) sold defensives and
# piled into AI: core-AI exposure jumps from ~30% to ~77%. That reorg drives the outperformance
# AND the concentration risk. Balanced & Income stay static.
# Each "era" is the target weights effective from a date until the next reorg.
START_DATE = "2024-06-03"
ai_eras = [
    # effective_date, weights (sum ~100)
    ("2024-06-03", {  # Era 1: diversified, ~28% core AI
        "NVDA": 5, "AVGO": 4, "AMD": 3, "PLTR": 2, "SMCI": 2, "MU": 2, "ANET": 2, "ORCL": 2, "MRVL": 2, "DELL": 2, "CRWD": 2,  # core AI = 28
        "MSFT": 5, "GOOGL": 4, "META": 3, "AMZN": 3, "AAPL": 4, "CRM": 2, "QCOM": 2,                                            # AI-adjacent = 23
        "JNJ": 4, "PG": 4, "KO": 3, "XOM": 4, "JPM": 4, "UNH": 4, "V": 4, "WMT": 3, "CVX": 2, "HD": 3, "MCD": 2, "PEP": 2, "ABBV": 2, "BAC": 2}),  # non-AI = 49
    ("2025-02-03", {  # Era 2: minor tilt toward AI, ~43% core AI
        "NVDA": 7, "AVGO": 6, "AMD": 4, "PLTR": 4, "SMCI": 2, "MU": 4, "ANET": 4, "ORCL": 3, "MRVL": 3, "DELL": 3, "CRWD": 3,   # core AI = 43
        "MSFT": 6, "GOOGL": 5, "META": 4, "AMZN": 3, "AAPL": 4, "CRM": 2,                                                       # adjacent = 24
        "JNJ": 3, "PG": 3, "KO": 2, "XOM": 2, "JPM": 3, "UNH": 3, "V": 3, "WMT": 2, "HD": 2, "MCD": 2, "ABBV": 1, "BAC": 1}),   # non-AI = 33
    ("2025-08-04", {  # Era 3: MAJOR AI pivot — sold defensives, bought AI => ~73% core AI
        "NVDA": 11, "AVGO": 9, "AMD": 7, "PLTR": 7, "SMCI": 3, "MU": 6, "ANET": 6, "TSM": 5, "ORCL": 4, "MRVL": 4, "DELL": 3, "SNOW": 2, "CRWD": 2, "VRT": 2, "ASML": 2,  # core AI = 73
        "MSFT": 6, "GOOGL": 5, "META": 4, "AMZN": 3, "NOW": 2, "QCOM": 2}),                                                     # adjacent = 22, non-AI = 0
]
static_w = {
    2: {"NVDA": 4, "AVGO": 3, "AMD": 2, "ANET": 2, "MU": 2, "MSFT": 6, "GOOGL": 5, "META": 4, "AMZN": 5, "AAPL": 6, "CRM": 3, "TSLA": 2,
        "JNJ": 7, "PG": 6, "KO": 5, "XOM": 4, "JPM": 7, "UNH": 5, "V": 5, "HD": 3, "PEP": 3, "ABBV": 3},
    3: {"JNJ": 10, "PG": 10, "KO": 9, "XOM": 8, "JPM": 8, "UNH": 7, "V": 6, "WMT": 5, "CVX": 4, "HD": 4, "MCD": 4, "PEP": 4, "ABBV": 4, "BAC": 4, "MSFT": 5, "GOOGL": 2, "AMZN": 2},
}
hold_rows = []
# AI Growth Fund: one row per (ticker, era) with effective_date.
# Carry a weight-0 row for any ticker dropped in a later era, so the as-of
# weight in force always reflects the FULL current era (sold names => 0),
# instead of the dropped ticker's last non-zero era persisting forever.
ever_held = set()
for eff, w in ai_eras:
    ever_held |= set(w)
for eff, w in ai_eras:
    for t in sorted(ever_held):
        wt = w.get(t, 0)
        hold_rows.append((1, t, eff, float(wt), int(wt * 1000)))
# Balanced & Income: single era from START
for pid, w in static_w.items():
    for t, wt in w.items():
        hold_rows.append((pid, t, START_DATE, float(wt), int(wt * 1000)))
holdings_df = (spark.createDataFrame(hold_rows, ["portfolio_id", "ticker", "effective_date", "weight_pct", "shares"])
               .withColumn("effective_date", F.to_date("effective_date")))


# --- REBALANCES (the events) — what changed at each AI Growth Fund reorg ----
def diff_era(prev, cur, eff, label):
    rows = []
    keys = set(prev) | set(cur)
    for t in keys:
        o = prev.get(t, 0)
        n = cur.get(t, 0)
        if o == n:
            continue
        action = "Buy" if o == 0 else ("Sell" if n == 0 else ("Add" if n > o else "Trim"))
        rows.append((eff, t, action, float(o), float(n), float(n - o), label))
    return rows


reb_rows = []
reb_rows += diff_era({}, ai_eras[0][1], ai_eras[0][0], "Initial allocation")
reb_rows += diff_era(ai_eras[0][1], ai_eras[1][1], ai_eras[1][0], "Minor AI tilt")
reb_rows += diff_era(ai_eras[1][1], ai_eras[2][1], ai_eras[2][0], "Major AI pivot — sold defensives, bought AI")
rebalances_df = (spark.createDataFrame(reb_rows, ["rebalance_date", "ticker", "action", "old_weight", "new_weight", "weight_change", "rationale"])
                 .withColumn("rebalance_date", F.to_date("rebalance_date")))

# --- PRICES (REAL via yfinance) ----
print("== fetching REAL prices from Yahoo Finance ==")
dl = yf.download(ALL_TICKERS + [BENCHMARK], start=START, end=END, progress=False, auto_adjust=True)
close = dl["Close"]
# tidy long form: ticker, date, close, daily_return
price_rows = []
for t in ALL_TICKERS:
    s = close[t].dropna()
    ret = s.pct_change().fillna(0.0)
    for d, c in s.items():
        price_rows.append((t, d.date().isoformat(), float(round(c, 4)), float(round(ret.loc[d], 6))))
prices_pd = pd.DataFrame(price_rows, columns=["ticker", "date", "close", "daily_return"])
prices_df = spark.createDataFrame(prices_pd).withColumn("date", F.to_date("date"))

# benchmark series
b = close[BENCHMARK].dropna()
bret = b.pct_change().fillna(0.0)
bench_rows = [(d.date().isoformat(), float(round(c, 4)), float(round(bret.loc[d], 6))) for d, c in b.items()]
bench_pd = pd.DataFrame(bench_rows, columns=["date", "close", "daily_return"])
benchmark_df = spark.createDataFrame(bench_pd).withColumn("date", F.to_date("date"))

# --- NEWS + sentiment (synthetic, AI names skew positive given the rally) ----
print("== news + sentiment ==")
rng = np.random.default_rng(42)
ai_core = [s[0] for s in securities if s[4] == "Core AI"]
headlines_pos = ["{c} beats earnings on AI demand", "{c} raises guidance as data-center orders surge",
                 "Analysts lift {c} price target on AI momentum", "{c} unveils next-gen AI chips", "{c} signs major AI cloud deal"]
headlines_neu = ["{c} in line with expectations", "{c} holds steady amid market rotation", "{c} announces buyback"]
headlines_neg = ["{c} slips on valuation concerns", "Profit-taking hits {c} after AI run-up", "{c} faces export-rule scrutiny"]
sources = ["Bloomberg", "Reuters", "WSJ", "CNBC", "FT", "MarketWatch"]
comp = {s[0]: s[1] for s in securities}
ai_names = [s[0] for s in securities if s[4] in ("Core AI", "AI-adjacent")]
news_rows = []
link_rows = []
aid = 1
start_d = dt.date(2024, 6, 1)
ndays = (dt.date(2026, 6, 9) - start_d).days
for _ in range(1800):
    t = str(rng.choice(ALL_TICKERS))
    # AI names skew positive (the rally); others mixed
    if t in ai_names:
        bucket = rng.choice(["pos", "neu", "neg"], p=[0.6, 0.28, 0.12])
    else:
        bucket = rng.choice(["pos", "neu", "neg"], p=[0.34, 0.4, 0.26])
    tmpl = {"pos": headlines_pos, "neu": headlines_neu, "neg": headlines_neg}[bucket]
    title = str(rng.choice(tmpl)).format(c=comp[t])
    sent = {"pos": round(float(rng.uniform(0.3, 0.9)), 3), "neu": round(float(rng.uniform(-0.15, 0.15)), 3), "neg": round(float(rng.uniform(-0.9, -0.3)), 3)}[bucket]
    label = {"pos": "Positive", "neu": "Neutral", "neg": "Negative"}[bucket]
    d = (start_d + dt.timedelta(days=int(rng.integers(0, ndays)))).isoformat()
    news_rows.append((aid, d, str(rng.choice(sources)), title, sent, label))
    link_rows.append((aid, t))
    aid += 1
news_df = (spark.createDataFrame(news_rows, ["article_id", "published_date", "source", "title", "sentiment", "sentiment_label"])
           .withColumn("published_date", F.to_date("published_date")))
news_ticker_df = spark.createDataFrame(link_rows, ["article_id", "ticker"])


# ===========================================================================
# PHASE 2 — SILVER (typed base tables; write, then add PK/FK RELY constraints)
# ===========================================================================
def save(df, name):
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.{name}")
    print(f"   {name}: {df.count()} rows")


print("== base tables ==")
save(securities_df, "securities")
save(sectors_df, "sectors")
save(portfolios_df, "portfolios")
save(holdings_df, "holdings")
save(rebalances_df, "rebalances")
save(prices_df, "prices")
save(benchmark_df, "benchmark")
save(news_df, "news")
save(news_ticker_df, "news_ticker")

# PK/FK constraints (NOT ENFORCED, RELY) — light up Catalog Explorer + help Genie.
# A PK column must be NOT NULL first, so the statements run in order: set the key
# columns NOT NULL, then add the PRIMARY KEYs, then the FOREIGN KEYs (after all
# referenced PKs exist). Plain list of full SQL so it's easy to read/copy/run.
_constraints = [
    # --- key columns NOT NULL (required before PRIMARY KEY) ---
    f"ALTER TABLE {FQ}.securities   ALTER COLUMN ticker         SET NOT NULL",
    f"ALTER TABLE {FQ}.sectors      ALTER COLUMN sector         SET NOT NULL",
    f"ALTER TABLE {FQ}.portfolios   ALTER COLUMN portfolio_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.news         ALTER COLUMN article_id     SET NOT NULL",
    f"ALTER TABLE {FQ}.holdings     ALTER COLUMN portfolio_id   SET NOT NULL",
    f"ALTER TABLE {FQ}.holdings     ALTER COLUMN ticker         SET NOT NULL",
    f"ALTER TABLE {FQ}.rebalances   ALTER COLUMN ticker         SET NOT NULL",
    f"ALTER TABLE {FQ}.prices       ALTER COLUMN ticker         SET NOT NULL",
    f"ALTER TABLE {FQ}.news_ticker  ALTER COLUMN article_id     SET NOT NULL",
    f"ALTER TABLE {FQ}.news_ticker  ALTER COLUMN ticker         SET NOT NULL",
    # --- primary keys ---
    f"ALTER TABLE {FQ}.securities ADD CONSTRAINT securities_pk PRIMARY KEY (ticker) RELY",
    f"ALTER TABLE {FQ}.sectors    ADD CONSTRAINT sectors_pk    PRIMARY KEY (sector) RELY",
    f"ALTER TABLE {FQ}.portfolios ADD CONSTRAINT portfolios_pk PRIMARY KEY (portfolio_id) RELY",
    f"ALTER TABLE {FQ}.news       ADD CONSTRAINT news_pk       PRIMARY KEY (article_id) RELY",
    # --- foreign keys (facts/links → dimensions) ---
    f"ALTER TABLE {FQ}.holdings    ADD CONSTRAINT holdings_portfolio_fk FOREIGN KEY (portfolio_id) REFERENCES {FQ}.portfolios(portfolio_id) RELY",
    f"ALTER TABLE {FQ}.holdings    ADD CONSTRAINT holdings_ticker_fk    FOREIGN KEY (ticker)       REFERENCES {FQ}.securities(ticker) RELY",
    f"ALTER TABLE {FQ}.rebalances  ADD CONSTRAINT rebalances_ticker_fk  FOREIGN KEY (ticker)       REFERENCES {FQ}.securities(ticker) RELY",
    f"ALTER TABLE {FQ}.prices      ADD CONSTRAINT prices_ticker_fk      FOREIGN KEY (ticker)       REFERENCES {FQ}.securities(ticker) RELY",
    f"ALTER TABLE {FQ}.news_ticker ADD CONSTRAINT news_ticker_news_fk   FOREIGN KEY (article_id)   REFERENCES {FQ}.news(article_id) RELY",
    f"ALTER TABLE {FQ}.news_ticker ADD CONSTRAINT news_ticker_sec_fk    FOREIGN KEY (ticker)       REFERENCES {FQ}.securities(ticker) RELY",
]
for c in _constraints:
    try:
        spark.sql(c)
    except Exception as e:  # noqa: BLE001 — idempotent: NOT NULL / constraint may already be set
        print(f"   (skip) {str(e).splitlines()[0][:90]}")


# ===========================================================================
# PHASE 3 — GOLD (the analysis tables the dashboard + Genie read)
# ===========================================================================
print("== gold ==")
_gold = [
    ("holdings_asof", f"""CREATE OR REPLACE VIEW {FQ}.holdings_asof AS WITH base AS (SELECT h.portfolio_id,h.ticker,h.effective_date,h.weight_pct,h.shares,s.ai_exposure,s.sector,s.company FROM {FQ}.holdings h JOIN {FQ}.securities s ON h.ticker=s.ticker) SELECT *, lead(effective_date) OVER (PARTITION BY portfolio_id,ticker ORDER BY effective_date) AS next_eff FROM base"""),
    ("portfolio_performance", f"""CREATE OR REPLACE TABLE {FQ}.portfolio_performance AS WITH px AS (SELECT ticker,date,close,close/lag(close) OVER (PARTITION BY ticker ORDER BY date)-1 AS daily_ret FROM {FQ}.prices), asof AS (SELECT portfolio_id,ticker,weight_pct,effective_date,next_eff FROM {FQ}.holdings_asof), pd AS (SELECT a.portfolio_id,px.date,SUM(px.daily_ret*a.weight_pct/100.0) port_ret FROM px JOIN asof a ON px.ticker=a.ticker AND px.date>=a.effective_date AND (a.next_eff IS NULL OR px.date<a.next_eff) WHERE px.daily_ret IS NOT NULL GROUP BY a.portfolio_id,px.date), bench AS (SELECT date,close/lag(close) OVER (ORDER BY date)-1 AS bench_ret FROM {FQ}.benchmark), j AS (SELECT p.portfolio_id,p.date,p.port_ret,b.bench_ret FROM pd p JOIN bench b ON p.date=b.date WHERE b.bench_ret IS NOT NULL) SELECT portfolio_id,date,port_ret,bench_ret, exp(sum(ln(1+port_ret)) OVER (PARTITION BY portfolio_id ORDER BY date))-1 cum_port_ret, exp(sum(ln(1+bench_ret)) OVER (PARTITION BY portfolio_id ORDER BY date))-1 cum_bench_ret FROM j"""),
    ("concentration_timeseries", f"""CREATE OR REPLACE TABLE {FQ}.concentration_timeseries AS WITH d AS (SELECT distinct date FROM {FQ}.prices), asof AS (SELECT d.date,e.portfolio_id,e.weight_pct,e.ai_exposure FROM d JOIN {FQ}.holdings_asof e ON d.date>=e.effective_date AND (e.next_eff IS NULL OR d.date<e.next_eff)) SELECT portfolio_id,date, round(sum(CASE WHEN ai_exposure='Core AI' THEN weight_pct ELSE 0 END)/sum(weight_pct)*100,1) core_ai_pct, round(sum(CASE WHEN ai_exposure='AI-adjacent' THEN weight_pct ELSE 0 END)/sum(weight_pct)*100,1) ai_adjacent_pct, round(sum(CASE WHEN ai_exposure='Non-AI' THEN weight_pct ELSE 0 END)/sum(weight_pct)*100,1) non_ai_pct, count(CASE WHEN weight_pct>0 THEN 1 END) num_holdings FROM asof GROUP BY portfolio_id,date"""),
    ("sector_exposure", f"""CREATE OR REPLACE TABLE {FQ}.sector_exposure AS WITH cur AS (SELECT e.sector,sum(e.weight_pct) fund_w FROM {FQ}.holdings_asof e WHERE e.portfolio_id=1 AND e.next_eff IS NULL AND e.weight_pct>0 GROUP BY e.sector) SELECT coalesce(cur.sector,s.sector) sector, coalesce(cur.fund_w,0)/100.0 fund_weight, s.benchmark_weight, coalesce(cur.fund_w,0)/100.0-s.benchmark_weight overweight FROM {FQ}.sectors s FULL OUTER JOIN cur ON s.sector=cur.sector"""),
    ("holdings_enriched", f"""CREATE OR REPLACE TABLE {FQ}.holdings_enriched AS SELECT p.portfolio_name,e.portfolio_id,e.ticker,e.company,e.sector,e.ai_exposure,e.weight_pct,sec.market_cap_b,sec.country,sec.industry FROM {FQ}.holdings_asof e JOIN {FQ}.portfolios p ON p.portfolio_id=e.portfolio_id JOIN {FQ}.securities sec ON sec.ticker=e.ticker WHERE e.next_eff IS NULL AND e.weight_pct>0"""),
    ("news_enriched", f"""CREATE OR REPLACE TABLE {FQ}.news_enriched AS SELECT n.*,nt.ticker,s.company,s.ai_exposure,s.sector FROM {FQ}.news n JOIN {FQ}.news_ticker nt ON n.article_id=nt.article_id JOIN {FQ}.securities s ON s.ticker=nt.ticker"""),
    ("sharpe_analysis", f"""CREATE OR REPLACE TABLE {FQ}.sharpe_analysis AS WITH ret AS (SELECT ticker,date,close/lag(close) OVER (PARTITION BY ticker ORDER BY date)-1 r FROM {FQ}.prices), stats AS (SELECT ticker,avg(r)*252 ar,stddev(r)*sqrt(252) arisk,avg(r)/nullif(stddev(r),0)*sqrt(252) sr FROM ret WHERE r IS NOT NULL GROUP BY ticker) SELECT s.ticker,sec.company,sec.sector,sec.ai_exposure,sec.market_cap_b,he.weight_pct fund_weight,round(s.ar*100,1) annualized_return,round(s.arisk*100,1) annualized_risk,round(s.sr,2) sharpe_ratio FROM stats s JOIN {FQ}.securities sec ON sec.ticker=s.ticker LEFT JOIN {FQ}.holdings_enriched he ON he.ticker=s.ticker AND he.portfolio_id=1"""),
    ("var_metrics", f"""CREATE OR REPLACE TABLE {FQ}.var_metrics AS WITH r_all AS (SELECT port_ret FROM {FQ}.portfolio_performance WHERE portfolio_id=1), r_post AS (SELECT port_ret FROM {FQ}.portfolio_performance WHERE portfolio_id=1 AND date>=date'2025-08-04') SELECT 'Post-pivot (current risk)' regime,1 srt,0.95 confidence,round(percentile(port_ret,0.05)*-100,2) var_pct,round(percentile(port_ret,0.05)*-100000000) var_dollar FROM r_post UNION ALL SELECT 'Post-pivot (current risk)',1,0.99,round(percentile(port_ret,0.01)*-100,2),round(percentile(port_ret,0.01)*-100000000) FROM r_post UNION ALL SELECT 'Full history',2,0.95,round(percentile(port_ret,0.05)*-100,2),round(percentile(port_ret,0.05)*-100000000) FROM r_all UNION ALL SELECT 'Full history',2,0.99,round(percentile(port_ret,0.01)*-100,2),round(percentile(port_ret,0.01)*-100000000) FROM r_all"""),
    ("returns_distribution", f"""CREATE OR REPLACE TABLE {FQ}.returns_distribution AS SELECT round(port_ret*200)/2.0 return_bucket_pct,count(*) days FROM {FQ}.portfolio_performance WHERE portfolio_id=1 AND date>=date'2025-08-04' GROUP BY 1 ORDER BY 1"""),
    ("risk_metrics", f"""CREATE OR REPLACE TABLE {FQ}.risk_metrics AS WITH p AS (SELECT date,port_ret,bench_ret FROM {FQ}.portfolio_performance WHERE portfolio_id=1), agg AS (SELECT 'Overall' period,1 sort_order,port_ret,bench_ret FROM p UNION ALL SELECT CASE WHEN date<date'2025-08-04' THEN 'Before pivot' ELSE 'After pivot' END, CASE WHEN date<date'2025-08-04' THEN 2 ELSE 3 END, port_ret,bench_ret FROM p) SELECT period,sort_order, round(avg(port_ret)*252*100,1) fund_return, round(stddev(port_ret)*sqrt(252)*100,1) fund_volatility, round(avg(port_ret)/stddev(port_ret)*sqrt(252),2) fund_sharpe, round(avg(bench_ret)*252*100,1) bench_return, round(stddev(bench_ret)*sqrt(252)*100,1) bench_volatility, round(avg(bench_ret)/stddev(bench_ret)*sqrt(252),2) bench_sharpe FROM agg GROUP BY period,sort_order ORDER BY sort_order"""),
]
for name, sql in _gold:
    spark.sql(sql)
    print(f"   {name}: built")


# ===========================================================================
# PHASE 4 — METRICS (governed metric view; measures correct under any grouping)
# ===========================================================================
print("== metric view ==")
spark.sql(f"""CREATE OR REPLACE VIEW {FQ}.portfolio_metrics
WITH METRICS LANGUAGE YAML AS $$
version: 1.1
source: {CATALOG}.{SCHEMA}.holdings_enriched
comment: "AI Growth Fund holdings metrics — current allocation by ticker / sector / AI exposure. Measures stay correct under any dimension grouping."
dimensions:
  - name: Portfolio
    expr: portfolio_name
  - name: Ticker
    expr: ticker
  - name: Company
    expr: company
  - name: Sector
    expr: sector
  - name: AI Exposure
    expr: ai_exposure
  - name: Country
    expr: country
measures:
  - name: Total Weight
    expr: SUM(weight_pct)
  - name: Core AI Weight
    expr: SUM(CASE WHEN ai_exposure='Core AI' THEN weight_pct ELSE 0 END)
  - name: Number of Holdings
    expr: COUNT(DISTINCT ticker)
  - name: Avg Market Cap
    expr: AVG(market_cap_b)
  - name: Top Position Weight
    expr: MAX(weight_pct)
$$
""")
print("   portfolio_metrics: built")

print(f"\nDONE — {CATALOG}.{SCHEMA} built: 9 base tables + 9 gold tables/views + portfolio_metrics")
