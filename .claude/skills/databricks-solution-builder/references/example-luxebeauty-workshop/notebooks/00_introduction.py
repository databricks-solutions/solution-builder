# Databricks notebook source
# MAGIC %md-sandbox
# MAGIC # 🧴 LuxeBeauty — build a Databricks demo *live* with Genie Code
# MAGIC
# MAGIC <img src="https://github.com/databricks-demos/dbdemos-resources/blob/main/images/di_platform_clean.png?raw=true" style="float: right; margin: 0px 20px 20px 20px" width="480px" />
# MAGIC
# MAGIC Welcome! This is a **hands-on workshop**, not a pre-built demo. Over the next
# MAGIC few notebooks you'll stand up a complete Databricks solution — raw data →
# MAGIC pipeline → dashboard → Genie → (governance + ML) — **by prompting the
# MAGIC Databricks Assistant (Genie Code ✨)**, one step at a time.
# MAGIC
# MAGIC You direct; Genie Code writes the SQL, the pipeline, the dashboard. By the end
# MAGIC you'll have built the whole stack yourself and know exactly how to prompt it
# MAGIC like a pro.
# MAGIC
# MAGIC **The business story you'll build:** LuxeBeauty Co., a D2C cosmetics brand.
# MAGIC Their VP of Ops sees weekly refunds spike **3× to ~$180K**. The workshop's
# MAGIC payoff: a dashboard spots the spike, and Genie traces it — in plain English —
# MAGIC to three products from **one bad production lot** at the Lyon facility, quoting
# MAGIC the QC incident note inline.

# COMMAND ----------

# MAGIC %md
# MAGIC ## How this workshop works
# MAGIC
# MAGIC Every step lives in its own notebook and reads like a conversation with the
# MAGIC Assistant. For each one you'll:
# MAGIC
# MAGIC 1. Open the ✨ **Assistant** panel (top-right of any notebook).
# MAGIC 2. **Copy the prompt** from the markdown cell and paste it into the Assistant.
# MAGIC 3. **Review** what it writes, run it, and move on.
# MAGIC
# MAGIC First, prime the Assistant so it knows the whole story — paste this once:
# MAGIC
# MAGIC > *"Read `CONTEXT.md` in this project — it has the LuxeBeauty story and the
# MAGIC > target tables. We'll build the demo one step at a time; use the exact table
# MAGIC > and column names from it, and keep your SQL clean and commented. Confirm you've
# MAGIC > read it and summarize the story in three lines."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## The path — five steps
# MAGIC
# MAGIC Work through them in order. Each links back here.
# MAGIC
# MAGIC | | Notebook | What you'll build with Genie Code |
# MAGIC |---|---|---|
# MAGIC | 1️⃣ | **[Setup & explore]($./01_setup_and_explore)** | Generate the raw data into a Volume, then poke at it to find the spike |
# MAGIC | 2️⃣ | **[Build the pipeline]($./02_build_pipeline)** | A raw → silver → gold SDP — with AI functions scoring sentiment inline |
# MAGIC | 3️⃣ | **[Dashboard & Genie]($./03_dashboard_and_genie)** | The AI/BI dashboard that spots the spike + the Genie space that cracks the case |
# MAGIC | 4️⃣ | **[Governance]($./04_governance)** *(optional)* | A metric view + ABAC access policies + data classification |
# MAGIC | 5️⃣ | **[ML]($./05_ml)** *(optional)* | A classifier that finds the "hidden premium" customers a query would miss |
# MAGIC
# MAGIC Steps 1–3 are the core demo. Steps 4–5 layer on governance + ML — same
# MAGIC build-it-live-with-Genie-Code pattern.

# COMMAND ----------

# MAGIC %md
# MAGIC ## What you'll show at the end
# MAGIC
# MAGIC A governed, end-to-end solution on the Databricks Data + AI platform —
# MAGIC all built by prompting, all on the same Unity Catalog data:
# MAGIC
# MAGIC - **Lakeflow / SDP** — a declarative bronze→silver→gold pipeline
# MAGIC - **AI Functions** — `ai_classify` scoring customer sentiment inside SQL
# MAGIC - **AI/BI Dashboard** — the $180K spike at a glance
# MAGIC - **Genie** — natural-language answers that walk the data to the root cause
# MAGIC - **Unity Catalog** — one governance model over all of it
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ▶️ Ready? Start with **[1. Setup & explore]($./01_setup_and_explore)**.
