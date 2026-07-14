# Databricks notebook source
# MAGIC %md
# MAGIC # 🧴 LuxeBeauty Workshop — 0. Setup & Explore
# MAGIC
# MAGIC **Welcome!** In this hands-on workshop you'll build a complete returns-intelligence
# MAGIC demo on Databricks — a data pipeline, a dashboard, and a Genie space — **live, one step
# MAGIC at a time, using the Databricks Assistant (Genie Code)**.
# MAGIC
# MAGIC You don't have to write the code yourself. Each step gives you a **prompt to paste into
# MAGIC the Assistant** (the ✨ panel on the right). The Assistant reads the shared context and
# MAGIC writes the SQL/Python for you — you review it, run it, and move on.
# MAGIC
# MAGIC ### 👉 First, prime the Assistant
# MAGIC Open the Assistant panel (✨ top-right) and paste this so it knows what we're building:
# MAGIC
# MAGIC > **Read the workshop context at `../CONTEXT.md` and the data spec at
# MAGIC > `../specifications/01-lakeflow.md`. We're building the LuxeBeauty returns demo: raw
# MAGIC > parquet in a Volume → silver → gold → dashboard → Genie. I'll ask you to build it one
# MAGIC > table at a time. Use the exact table and column names from the context. Confirm you've
# MAGIC > read it and summarize the story in 3 lines.**
# MAGIC
# MAGIC Once the Assistant confirms it understands the story, continue below.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 0.1 — Set your catalog & schema
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
# MAGIC ## Step 0.2 — Generate the raw data into a Volume
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
# MAGIC ## Step 0.3 — Explore the raw data with the Assistant
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
# MAGIC ## Step 0.4 — Peek at the punchline (optional)
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
# MAGIC Raw data is in the Volume and you've seen the story in the data. Next:
# MAGIC **`01_build_pipeline`** — build the silver + gold tables with the Assistant, one at a time.
