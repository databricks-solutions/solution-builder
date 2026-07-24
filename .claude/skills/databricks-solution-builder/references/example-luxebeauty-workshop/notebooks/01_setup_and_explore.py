# Databricks notebook source
# MAGIC %md
# MAGIC # 1️⃣ Setup & Explore
# MAGIC
# MAGIC Generate the raw data into a Volume, then explore it with the Assistant to
# MAGIC find the story hiding in it. → *[Back to the introduction]($./00_introduction)*
# MAGIC
# MAGIC > If you haven't yet, prime the Assistant (✨) with the context prompt from the
# MAGIC > [introduction]($./00_introduction) so it knows the LuxeBeauty story.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1/ Set your catalog & schema
# MAGIC
# MAGIC Everything lands under `{catalog}.{schema}`. Change these to your workshop target.

# COMMAND ----------

CATALOG = "luxebeauty"
SCHEMA  = "workshop"

spark.sql(f"CREATE CATALOG IF NOT EXISTS {CATALOG}")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"USE {CATALOG}.{SCHEMA}")
print(f"✓ using {CATALOG}.{SCHEMA}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2/ Generate the raw data into a Volume
# MAGIC
# MAGIC The generator lands **6 raw parquet datasets** into a UC Volume — this is our "bronze"
# MAGIC landing zone (raw files as they'd arrive from Lakeflow Connect in production). We'll
# MAGIC build silver + gold **from these files** in the next notebook.
# MAGIC
# MAGIC ```
# MAGIC /Volumes/{catalog}/{schema}/raw_data/
# MAGIC   customers/  products/  production_lots/  orders/  order_items/  returns/
# MAGIC ```
# MAGIC
# MAGIC Run the generator (it takes ~1–2 min on serverless):

# COMMAND ----------

# MAGIC %run ../data_generation/generate_data

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3/ Explore the raw data with the Assistant
# MAGIC
# MAGIC Now let's poke at what landed. Rather than writing SQL by hand, **ask the Assistant.**
# MAGIC Paste each prompt into the ✨ panel, run the SQL it generates, and read the result.
# MAGIC
# MAGIC **Prompt 1 — see what's in the landing zone:**
# MAGIC > *"List the parquet datasets under `/Volumes/{CATALOG}/{SCHEMA}/raw_data/` and, for each,
# MAGIC > read the first few rows with `read_files(..., format => 'parquet')` so I can see the columns."*
# MAGIC
# MAGIC **Prompt 2 — spot the returns spike:**
# MAGIC > *"Read the `returns` dataset from the Volume, roll refunds up by week
# MAGIC > (`SUM(refund_amount_usd)`), and show me the last 12 weeks. I'm looking for a spike —
# MAGIC > when does it peak and how big is it vs the baseline?"*
# MAGIC
# MAGIC You should see a **~3x peak about three weeks ago (~$180K)** against a **~$60K** baseline,
# MAGIC decaying since. That's the anomaly the whole demo explains.
# MAGIC
# MAGIC **Prompt 3 — find the common thread:**
# MAGIC > *"For the returns, which `product_id`s have the most returns? And do the top ones share
# MAGIC > a common `lot_id`? Group by product then by lot."*
# MAGIC
# MAGIC You should see **SKU-1001 / SKU-1002 / SKU-1003** dominating, all on **one lot**.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4/ Peek at the punchline (optional)
# MAGIC
# MAGIC The explanation is hiding in the production lots. Ask the Assistant:
# MAGIC > *"In the `production_lots` dataset, which rows have a non-null `incident_summary`?
# MAGIC > Show me the `lot_id`, `facility`, and the incident text."*
# MAGIC
# MAGIC Exactly **3 rows** (one per affected SKU, same lot) carry the note — a homogenizer
# MAGIC pressure issue at **Lyon**, lot **released** despite the QC flag. This is what Genie will
# MAGIC surface at the end of the demo. **Don't build anything on it yet** — the whole point is
# MAGIC that Genie *discovers* it live.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ You're set up
# MAGIC Raw data is in the Volume and you've seen the story in it.
# MAGIC
# MAGIC ### ▶️ Next: **[2. Build the pipeline]($./02_build_pipeline)**
# MAGIC *(or [back to the introduction]($./00_introduction))*
