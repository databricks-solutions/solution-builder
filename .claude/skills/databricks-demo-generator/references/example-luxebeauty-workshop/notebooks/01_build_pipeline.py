# Databricks notebook source
# MAGIC %md
# MAGIC # 🧴 LuxeBeauty Workshop — 1. Build the pipeline
# MAGIC
# MAGIC You've got raw parquet in the Volume. Now build the **medallion** — silver, then gold —
# MAGIC as a **Spark Declarative Pipeline (SDP)**, one table at a time, with the Assistant writing
# MAGIC each transform for you.
# MAGIC
# MAGIC ### How this works
# MAGIC An SDP is a set of `CREATE OR REFRESH MATERIALIZED VIEW` statements. You'll build them up
# MAGIC one cell at a time here, and when they're all working you'll wire them into a pipeline.
# MAGIC Each step below has a **prompt to paste into the Assistant (✨)** — it reads `../CONTEXT.md`
# MAGIC for the exact target shape, so keep the panel primed (re-paste the priming prompt from
# MAGIC notebook 0 if you started a fresh session).
# MAGIC
# MAGIC > **Reminder — no bronze.** Silver reads the raw *files* straight from the Volume with
# MAGIC > `read_files('/Volumes/…/raw_data/<dataset>', format => 'parquet')`. Keep it simple.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1.1 — `comment_anger_scores` (silver helper)
# MAGIC
# MAGIC First an AI step: score customer sentiment with `ai_classify`, deduplicated so the LLM
# MAGIC runs once per distinct comment (not once per row).
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Create a materialized view `comment_anger_scores`: read DISTINCT `customer_comment`
# MAGIC > from the returns parquet in the Volume, and use `ai_classify(comment, ARRAY('very_angry',
# MAGIC > 'angry','neutral','satisfied'))` mapped to a numeric `anger_score` (very_angry=1.0,
# MAGIC > angry=0.7, neutral=0.3, satisfied=0.1). This dedups the LLM call. See CONTEXT.md."*
# MAGIC
# MAGIC Then validate: *"Show me 10 rows of `comment_anger_scores` — do the texture complaints
# MAGIC ('grainy', 'separated', 'watery') score high?"*
# MAGIC
# MAGIC > 💡 **AI Functions** — `ai_classify` is a built-in SQL AI function: an LLM
# MAGIC > call *inside* your pipeline, no model to deploy. Try more of them:
# MAGIC > *"Add a column to `comment_anger_scores` using `ai_summarize` to give a
# MAGIC > one-line summary of each distinct comment"* — or `ai_extract` to pull the
# MAGIC > complaint theme. Great to show how AI slots straight into SQL.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1.2 — `silver_order_items`
# MAGIC
# MAGIC One row per order line, denormalized so gold can roll up without re-joining.
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Create MV `silver_order_items`: one row per order line. Read `order_items`, `orders`,
# MAGIC > `products`, `production_lots` from the Volume. Carry `order_date` + `region` from orders,
# MAGIC > `product_name` + `category` from products, `facility` + `production_date` from
# MAGIC > production_lots. Cluster by `order_date`. Match the columns in CONTEXT.md / 02_silver.sql."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1.3 — `silver_returns` (the load-bearing fact)
# MAGIC
# MAGIC The cleaned returns fact — every dimension denormalized in-row, plus the anger score and
# MAGIC the **`is_bad_lot`** split flag.
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Create MV `silver_returns`: read `returns` from the Volume, join `products` (for
# MAGIC > `product_name`/`category`), `customers` (for `city`/`customer_lat`/`customer_lng`),
# MAGIC > `orders` (for `order_date`), and `comment_anger_scores` (for `anger_score`). Keep
# MAGIC > `is_bad_lot`, `region`, `country`, `facility`, `refund_amount_usd`, `return_reason`,
# MAGIC > `customer_comment`. Cluster by `return_date`. COMMENT every column. Match 02_silver.sql."*
# MAGIC
# MAGIC Validate: *"In `silver_returns`, how many rows have `is_bad_lot = true`, and what's their
# MAGIC average `anger_score` vs everyone else?"* → ~1,500 bad-lot rows, clearly angrier.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1.4 — `gold_returns` + `gold_daily_summary`
# MAGIC
# MAGIC The two tables the dashboard + Genie read. Build both:
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Create two gold MVs from the silver tables. `gold_returns`: project `silver_returns`
# MAGIC > (the denormalized per-return fact) — but OMIT `incident_summary` so Genie has to hop to
# MAGIC > the raw lot to find it. `gold_daily_summary`: one row per (date, region, category) —
# MAGIC > orders rollup from `silver_order_items` LEFT JOIN a returns rollup from `silver_returns`,
# MAGIC > returns defaulting to 0. Match 03_gold.sql. Don't build customer_features or
# MAGIC > customer_returns — no ML or app in this workshop."*
# MAGIC
# MAGIC Validate the story end-to-end: *"From `gold_daily_summary`, show weekly `SUM(returns_usd)`
# MAGIC for the last 10 weeks — confirm the peak is ~3 weeks ago (~$180K), not the current week."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1.5 — Wire it into an SDP pipeline
# MAGIC
# MAGIC The MVs work interactively — now make them a governed, scheduled pipeline.
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Help me create a Spark Declarative Pipeline from these MV definitions. Put the silver
# MAGIC > MVs and gold MVs into pipeline source files, and create the pipeline pointing at
# MAGIC > catalog `{CATALOG}` / schema `{SCHEMA}`. Then trigger a run and confirm all five MVs
# MAGIC > refresh green."*
# MAGIC
# MAGIC > 💡 The Assistant can scaffold the pipeline and the `databricks pipelines` CLI call. If
# MAGIC > you get stuck, `../pipeline/02_silver.sql` and `../pipeline/03_gold.sql` are the exact
# MAGIC > source files — you can point the pipeline at copies of those.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ Pipeline built
# MAGIC You have a working raw→silver→gold SDP. Next: **`02_dashboard_and_genie`** — turn these
# MAGIC gold tables into the dashboard Claire opens and the Genie space that cracks the case.
