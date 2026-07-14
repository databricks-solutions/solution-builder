# Workshop Context — read this first

> **You (the Databricks Assistant / Genie Code) are helping a Solutions Architect build the LuxeBeauty returns-intelligence demo live, one step at a time.** This file is your ground truth: the story, the data, and the exact shapes to converge on. When a notebook cell asks you to "build the silver returns table" or "create the dashboard," come back here for the contract. Prefer these names and columns verbatim — the dashboard and Genie downstream depend on them.

---

## The story (why we're building this)

LuxeBeauty Co. is a D2C cosmetics e-commerce brand. Claire Dubois, VP of Operations (non-technical), sees weekly refunds spike **3x to ~$180K** about three weeks ago and still elevated. The cause: three Skincare SKUs (`SKU-1001`, `SKU-1002`, `SKU-1003`) all came off **one production lot** at the **Lyon** facility, released despite a QC note flagging a homogenizer pressure problem during emulsification. ~5,000 units shipped, ~30% return rate (vs 8% normal), EU-skewed customers (Paris leads).

The demo proves: **spot the spike on a dashboard → ask Genie "why?" → Genie walks the data to the lot and quotes the incident note inline.** Everything we build must serve that arc.

Key numbers to preserve: normal ~$60K/week returns · peak ~$180K (3 weeks ago) · current ~$80K decaying · affected SKUs 1001/1002/1003 · ~1,500 affected returns · ~30% rate · Lyon facility · Paris the biggest map bubble.

---

## The data layout

Raw data is **already generated as parquet files in a UC Volume** (the data-gen notebook did this in step 0):

```
/Volumes/${catalog}/${schema}/raw_data/
├── customers/          ~50K   customer_id, email, region, country, city, customer_lat, customer_lng, loyalty_tier, registration_date
├── products/           ~30    product_id (SKU-NNNN), product_name, category, subcategory, price_usd, cost_usd, launch_date, is_active
├── production_lots/    ~1.5K  lot_id, product_id, production_date, facility, quantity_produced, status, incident_summary (NULL except the 3 affected-lot rows)
├── orders/             ~200K  order_id, customer_id, order_date, region, total_usd
├── order_items/        ~205K  order_id, product_id, lot_id, facility, quantity, unit_price_usd, line_total_usd
└── returns/            ~25K   return_id, order_id, customer_id, product_id, lot_id, return_date, refund_amount_usd, return_reason, customer_comment, status, is_bad_lot
```

Read a raw dataset with `read_files('/Volumes/${catalog}/${schema}/raw_data/<name>', format => 'parquet')`.

**The medallion we're building (live, via these notebooks):**

```
raw parquet (Volume)  →  SILVER (cleaned + ai_classify anger + denormalized)  →  GOLD (dashboard/Genie feeds)
```

There is **no bronze** — silver reads the raw files directly. Keep it simple.

---

## Target: SILVER (materialized views in the SDP pipeline)

| MV | What it is | Source |
|---|---|---|
| `comment_anger_scores` | DISTINCT `customer_comment` → `ai_classify(...)` anger score (1.0 very_angry … 0.1 satisfied). Dedup so the LLM runs once per distinct comment. | `read_files(.../returns)` |
| `silver_order_items` | one row per order line, denormalized: `order_date`/`region` from orders, `product_name`/`category` from products, `facility`/`production_date` from production_lots | `read_files` of order_items + orders + products + production_lots |
| `silver_returns` | cleaned returns fact, every dimension denormalized in-row (`product_name`, `category`, `facility`, `country`, `city`, `customer_lat`/`lng`, `region`) + `anger_score` (joined from `comment_anger_scores`) + **`is_bad_lot`** | `read_files` of returns + products + customers + orders + the anger MV |

> **`is_bad_lot`** is the load-bearing split column: TRUE iff `lot_id` = the affected lot. Every "affected vs everyday" widget splits on it. It comes straight off the raw returns file (the data-gen sets it).

> Silver reads the raw FILES from the Volume via `read_files('/Volumes/${catalog}/${schema}/raw_data/<dataset>', format => 'parquet')` — **no bronze**. Genie Code writes these MVs during the workshop; the tables above are the contract to converge on.

---

## Target: GOLD (materialized views the dashboard + Genie read)

V1 scope is SDP + Dashboard + Genie — build ONLY these two:

| MV | Grain | Powers |
|---|---|---|
| `gold_returns` | one row per return (projected from `silver_returns`) | map, country/reason splits, sentiment, comments table, Genie drill-down. **Omits `incident_summary`** — the explanation stays on the raw production_lots so Genie has a destination to hop to. |
| `gold_daily_summary` | one row per `(date, region, category)` | KPI counters, trend line, category donut, orders-by-region area |

> `gold_returns` projects `silver_returns` (all joins already done); `gold_daily_summary` is an orders rollup from `silver_order_items` LEFT JOIN a returns rollup from `silver_returns`, returns → 0 where none.
>
> Do NOT build `gold_customer_features` (ML-only) or `gold_customer_returns` (app-only) — no ML or app in this workshop.

---

## Target: DASHBOARD (AI/BI)

Two pages. Read `specifications/04-ai-bi.md` for the widget-by-widget spec. Datasets:
- `ds_daily` ← `gold_daily_summary` (KPIs, donut, orders area)
- `ds_returns` ← `gold_returns` (map, country/reason splits, sentiment, city table, comments)
- `ds_forecast` ← weekly refunds from `gold_returns` + AI_FORECAST band (stays UNFILTERED)
- `ds_sankey_flow` ← `gold_returns` (category → product → lot)

The story shape the widgets must show: peak **in the past** with a decay tail (never pinned at the right edge), Paris the biggest map bubble, Skincare dominating the donut, the sankey collapsing Category → 3 SKUs → 1 lot.

---

## Target: GENIE space

Attach: `gold_daily_summary`, `gold_returns`, `raw_production_lots` (for `incident_summary`), `products`, `customers`.

Give Genie this instruction text (baselines + the investigation flow):
```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).
BASELINES: normal weekly returns ~$60K, normal return rate ~8%, anomaly > 20%.
INVESTIGATION FLOW for "Why so many returns?":
  1. gold_daily_summary → SUM(returns_usd) by week → spot the 3x spike
  2. gold_returns → GROUP BY product_id ORDER BY COUNT(*) DESC → SKU-1001/1002/1003
  3. gold_returns WHERE product_id IN (those) GROUP BY lot_id → one lot dominates
  4. gold_returns → customer_comment WHERE lot_id = affected → texture complaints
  5. raw_production_lots → incident_summary WHERE lot_id = affected → THE PUNCHLINE
CUSTOMER FEEDBACK (affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

Sample questions (chips, in arc order):
1. What's our return rate this month, and how does it compare to baseline?
2. Why do I have so many returns? Trace it to the products and the lot.
3. Which production lot is driving the spike, and what does the QC note say?
4. What are customers saying? Show recent affected-lot comments.
5. Where are the affected customers? Group by country.
6. Are refunds recovering? Show the trend.

The demo lands when question 3 makes Genie one-hop join to `raw_production_lots.incident_summary` and quote the homogenizer / pressure / Lyon / released note inline.

---

## Working style for Genie Code in this workshop

- **One table at a time.** Build + validate each MV before the next. Don't emit the whole pipeline in one shot.
- **Use the exact names above.** Downstream (dashboard, Genie) is wired to `gold_returns`, `gold_daily_summary`, `is_bad_lot`, `anger_score`, `incident_summary`.
- **COMMENT every table and column** so Genie reads them as semantics.
- **Validate as you go** — after each MV, run a quick `SELECT` to confirm rows + the story (e.g. the weekly spike peaks ~3 weeks ago, the affected lot has ~1,500 returns, exactly 3 lot rows carry `incident_summary`).
