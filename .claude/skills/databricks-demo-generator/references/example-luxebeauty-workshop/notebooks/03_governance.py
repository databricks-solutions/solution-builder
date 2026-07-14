# Databricks notebook source
# MAGIC %md
# MAGIC # 🧴 LuxeBeauty Workshop — 3. Governance (Metric View · ABAC · Classification)
# MAGIC
# MAGIC Now that the gold tables exist, layer on **Unity Catalog governance** — a
# MAGIC semantic **metric view**, **ABAC** row/column access policies, and **data
# MAGIC classification** on the sensitive columns. As before, every step is a prompt
# MAGIC you paste into the Databricks Assistant (✨); it reads `../CONTEXT.md` and
# MAGIC writes the SQL/config, you review + run.
# MAGIC
# MAGIC > Prereq: notebook `01_build_pipeline` finished — `gold_returns` and
# MAGIC > `gold_daily_summary` exist under `{catalog}.{schema}`.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3.1 — A metric view over the gold layer
# MAGIC
# MAGIC A metric view gives Genie + the dashboard **governed, named measures** so
# MAGIC "return rate" always means the same formula everywhere.
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Create a Unity Catalog metric view `mv_returns` over `gold_daily_summary`.
# MAGIC > Dimensions: `date`, `region`, `category`. Measures: `total_revenue` =
# MAGIC > SUM(revenue_usd), `total_refunds` = SUM(returns_usd), `order_count` =
# MAGIC > SUM(order_count), `return_count` = SUM(return_count), `return_rate` =
# MAGIC > SUM(return_count)/NULLIF(SUM(order_count),0), `refund_rate` =
# MAGIC > SUM(returns_usd)/NULLIF(SUM(revenue_usd),0). Use the SUM/NULLIF form for
# MAGIC > the ratios (not MEASURE(x)/MEASURE(y)) so they're correct under any filter."*
# MAGIC
# MAGIC Validate: *"Query `MEASURE(return_rate)` by week — the peak should be ~0.24
# MAGIC and the baseline ~0.08."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3.2 — ABAC: tag then govern
# MAGIC
# MAGIC Attribute-Based Access Control governs by **tags**, not table-by-table
# MAGIC grants. Tag the sensitive columns, then write one policy that applies
# MAGIC everywhere the tag appears.
# MAGIC
# MAGIC **Prompt — tag PII:**
# MAGIC > *"On `gold_returns`, add governance tags: tag `customer_id` and any
# MAGIC > customer geo columns (`city`, `customer_lat`, `customer_lng`) with a
# MAGIC > `pii` tag. Show me the `SET TAGS` statements."*
# MAGIC
# MAGIC **Prompt — a column-mask policy:**
# MAGIC > *"Create an ABAC column mask that redacts columns tagged `pii` for users
# MAGIC > who aren't in the `luxe_ops` group — so analysts see aggregates but not
# MAGIC > individual customer coordinates. Apply it to `gold_returns`."*
# MAGIC
# MAGIC **Prompt — a row filter (optional):**
# MAGIC > *"Add a row-level policy on `gold_returns` so regional analysts only see
# MAGIC > rows for their own `region` (based on a group-to-region mapping)."*
# MAGIC
# MAGIC > 💡 ABAC is the talking-track star here: *one* tag-driven policy governs
# MAGIC > every current and future table that carries the tag — no per-table grants.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3.3 — Data classification
# MAGIC
# MAGIC Let Unity Catalog **scan and classify** the schema so PII is discovered
# MAGIC automatically (not just where you remembered to tag).
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Run Unity Catalog data classification on the `{catalog}.{schema}` schema.
# MAGIC > Show me which columns it flagged as sensitive (emails, names, geo) and how
# MAGIC > to review/accept the suggested tags — then confirm the `pii`-tagged columns
# MAGIC > from step 3.2 line up with what classification found."*
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ Governed
# MAGIC `mv_returns` gives Genie clean measures; ABAC + classification keep PII safe.
# MAGIC Next: **`04_ml`** — build the hidden-premium classifier, or skip to the
# MAGIC dashboard + Genie if you're keeping this workshop lean.
