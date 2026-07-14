# Databricks notebook source
# MAGIC %md
# MAGIC # 🧴 LuxeBeauty Workshop — 2. Dashboard & Genie
# MAGIC
# MAGIC Your gold tables (`gold_returns`, `gold_daily_summary`) are ready. Now build the two
# MAGIC surfaces Claire actually uses: an **AI/BI dashboard** to spot the spike, and a **Genie
# MAGIC space** to ask *"why?"* in plain English.
# MAGIC
# MAGIC As before — the Assistant (✨) does the building; you paste the prompts. Keep it primed
# MAGIC with `../CONTEXT.md` and add `../specifications/04-ai-bi.md` for the widget-level detail.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2.1 — Build the dashboard
# MAGIC
# MAGIC The dashboard has two pages: **Operations** (spot the spike) and **Investigation**
# MAGIC (deep-dive to the lot). Build the datasets first, then the widgets.
# MAGIC
# MAGIC **Prompt — datasets:**
# MAGIC > *"Create an AI/BI dashboard for `{CATALOG}.{SCHEMA}` with four datasets: `ds_daily` from
# MAGIC > `gold_daily_summary`; `ds_returns` from `gold_returns` (add a `source` column =
# MAGIC > 'Affected lot' when `is_bad_lot` else 'Everyday'); `ds_forecast` = weekly
# MAGIC > `SUM(refund_amount_usd)` from `gold_returns` with an `AI_FORECAST` band (leave it
# MAGIC > UNFILTERED); `ds_sankey_flow` = category→product→lot flow from `gold_returns`. See
# MAGIC > 04-ai-bi.md."*
# MAGIC
# MAGIC **Prompt — Operations page:**
# MAGIC > *"On page 'Operations' add: 4 KPI counters from `ds_daily` (refunds $, return count,
# MAGIC > orders, revenue); a forecast-line trend of weekly refunds from `ds_forecast` (the peak
# MAGIC > should sit ~3 weeks in the PAST with a decay tail, not at the right edge); an
# MAGIC > orders-by-region area chart; a stacked country bar of refunds; a symbol-map on
# MAGIC > `customer_lat`/`customer_lng` sized by customers and colored by refund $ (Paris should
# MAGIC > be the biggest bubble); a category donut of returns $."*
# MAGIC
# MAGIC **Prompt — Investigation page:**
# MAGIC > *"On page 'Investigation' add: a sankey (category → product → lot) that collapses to
# MAGIC > Skincare → 3 SKUs → 1 lot; grouped bars comparing Affected-lot vs Everyday by country
# MAGIC > and by reason; a sentiment bar bucketed from `anger_score`; a city table (city, country,
# MAGIC > returns, refund $); and a comments table sorted by `anger_score` showing the texture
# MAGIC > complaints. Add global Date/Region/Category/Source filters — but do NOT bind the global
# MAGIC > Date filter to `ds_forecast`."*
# MAGIC
# MAGIC > 💡 `../specifications/04-ai-bi.md` has the exact widget positions, sizes, and SQL if you
# MAGIC > want a pixel-faithful build.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2.2 — Sanity-check the dashboard tells the story
# MAGIC
# MAGIC Open the dashboard and confirm:
# MAGIC - KPI refunds ≈ **$180K** at peak; return rate ≈ **30%** for the affected slice
# MAGIC - Trend line: **3x peak ~3 weeks ago**, decaying — *not* pinned at today
# MAGIC - Map: **Paris** the largest bubble, then London / Milan
# MAGIC - Donut: **Skincare** dominates returns
# MAGIC - Sankey: everything funnels into **one lot**
# MAGIC
# MAGIC If any of these don't pop, ask the Assistant to check the underlying query against the
# MAGIC gold tables before moving on — the Genie story depends on the same data.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2.3 — Build the Genie space
# MAGIC
# MAGIC This is the payoff: Claire asks *"why so many returns?"* and Genie walks the data to the
# MAGIC lot and quotes the incident note.
# MAGIC
# MAGIC **Prompt — create + attach:**
# MAGIC > *"Create a Genie space called 'LuxeBeauty Operations Analytics' on `{CATALOG}.{SCHEMA}`.
# MAGIC > Attach `gold_daily_summary`, `gold_returns`, `silver_production_lots` (for
# MAGIC > `incident_summary`), `products`, and `customers`."*
# MAGIC
# MAGIC **Prompt — instructions + sample questions:**
# MAGIC > *"Add the instruction text and the 6 sample questions from CONTEXT.md (the investigation
# MAGIC > flow: spike → 3 SKUs → 1 lot → texture comments → incident_summary). Add curated SQL for
# MAGIC > the headline return-rate question, the drill-to-lot+QC question (the cross-table join to
# MAGIC > `silver_production_lots.incident_summary`), and the recovery-trend question."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2.4 — Run the demo
# MAGIC
# MAGIC In the Genie space, ask — in order:
# MAGIC 1. *"What's our return rate this month, and how does it compare to baseline?"*
# MAGIC 2. **"Why do I have so many returns? Trace it to the products and the lot."**
# MAGIC 3. *"Which production lot is driving the spike, and what does the QC note say?"*
# MAGIC
# MAGIC By question 3, Genie should hop from the returns to `silver_production_lots` and **quote the
# MAGIC incident note inline** — *homogenizer pressure fluctuation at Lyon, lot released despite
# MAGIC the QC flag.* That's the core demo. 🎯
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ Dashboard + Genie done
# MAGIC You built — live, with the Assistant — a raw→silver→gold SDP, an AI/BI dashboard, and a
# MAGIC Genie space that cracks the case, all on governed Unity Catalog data.
# MAGIC
# MAGIC **Go further:** `03_governance` (metric view · ABAC · classification) and `04_ml`
# MAGIC (the hidden-premium classifier) layer governance + ML on top — same build-it-live
# MAGIC with Genie Code pattern.
# MAGIC
# MAGIC **To hand this to a customer:** download the whole project as a zip (the specs, the
# MAGIC data-gen, the answer-key SQL, and this notebook set) and load it into their workspace —
# MAGIC they run the same workshop against their own catalog.
