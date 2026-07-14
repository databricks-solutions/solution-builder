# Databricks notebook source
# MAGIC %md
# MAGIC # 2️⃣ Build the pipeline
# MAGIC
# MAGIC Turn the raw parquet in the Volume into a clean **medallion** — silver, then the
# MAGIC gold tables your dashboard + Genie read — as a real **Spark Declarative Pipeline
# MAGIC (SDP)**. You'll create the pipeline, add one layer at a time (each as its own SQL
# MAGIC source file), and run + verify after every layer. → *[Back to the introduction]($./00_introduction)*
# MAGIC
# MAGIC > Each step is a prompt you paste into the Assistant (✨) and iterate on, just like
# MAGIC > building a real pipeline. It already read `CONTEXT.md`, so talk at a high level
# MAGIC > and it fills in the SQL + the SDP wiring.
# MAGIC >
# MAGIC > **No bronze** — silver reads the raw files straight from the Volume via
# MAGIC > `read_files()`. If the Assistant reaches for a bronze layer, tell it to read the
# MAGIC > parquet directly.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1/ Create the pipeline + the first silver layer
# MAGIC
# MAGIC Start the SDP and build its first transform — the AI sentiment scoring — as a
# MAGIC source file, then run it so you know the pipeline works before you add more.
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Let's build a Spark Declarative Pipeline for this catalog + schema. Start it,
# MAGIC > and create the first silver step as a source file at `ingestion/01_silver_sentiment.sql`:
# MAGIC > read the returns parquet from the Volume and score each DISTINCT `customer_comment`
# MAGIC > with `ai_classify` into a 0–1 `anger_score` (score once per distinct comment, not
# MAGIC > per row). Then run the pipeline and confirm this table refreshes green."*
# MAGIC
# MAGIC Check it: *"Show me a few scored comments — do the texture complaints score high?"*
# MAGIC
# MAGIC > 💡 **AI Functions** — `ai_classify` is an LLM call inside plain SQL, no model to
# MAGIC > deploy. Try `ai_summarize` / `ai_extract` too.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2/ Add the order-lines silver table
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Add the next silver step to the pipeline as `ingestion/02_silver_order_items.sql`:
# MAGIC > one row per order line with everything denormalized in — order date + region,
# MAGIC > product name + category, and the lot + facility — reading the raw files from the
# MAGIC > Volume. Add it to the pipeline, run it, and confirm it's green."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3/ Add the returns fact (the heart of the demo)
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Add `ingestion/03_silver_returns.sql`: the main returns fact, one row per
# MAGIC > return, with the customer geo, product + category, lot + facility, and the anger
# MAGIC > score from step 1 — all denormalized so nothing downstream re-joins. Flag whether
# MAGIC > each return is from the affected bad lot. Add to the pipeline, run, and verify."*
# MAGIC
# MAGIC Check the story is in the data: *"How many returns are from the bad lot, and are
# MAGIC they angrier on average than everything else?"* — expect a concentrated, angry cluster.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4/ Add the gold layer the dashboard reads
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Now the gold layer, as `ingestion/04_gold.sql`: a per-return fact for the detail
# MAGIC > views — but keep the lot's incident note OUT of it, so Genie has to dig it out of
# MAGIC > the lot table — plus a daily summary rolled up by date, region and category
# MAGIC > (orders + revenue + returns together) for the KPIs and trend. Add to the pipeline
# MAGIC > and run the whole thing end to end."*
# MAGIC
# MAGIC Confirm the spike is real: *"Plot weekly refund $ for the last few months — the
# MAGIC peak should sit a few weeks back and be decaying, not pinned to this week."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5/ Final run — the whole medallion, green
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Trigger a full pipeline run and walk me through the DAG — every silver + gold
# MAGIC > table should refresh green, in dependency order. Then show me the pipeline's
# MAGIC > lineage so I can see raw files → silver → gold."*
# MAGIC
# MAGIC > 💡 That's the workshop: you directed it, the Assistant wrote every SDP source
# MAGIC > file + wired the pipeline — no SQL typed by hand.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ Pipeline built
# MAGIC A working raw→silver→gold SDP, built layer by layer by prompting. The dashboard
# MAGIC Claire opens and the Genie space that cracks the case come next.
# MAGIC
# MAGIC ### ▶️ Next: **[3. Dashboard & Genie]($./03_dashboard_and_genie)**
# MAGIC *(or [back to the introduction]($./00_introduction))*
