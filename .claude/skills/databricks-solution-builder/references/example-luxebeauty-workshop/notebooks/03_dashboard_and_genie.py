# Databricks notebook source
# MAGIC %md
# MAGIC # 3️⃣ Dashboard & Genie
# MAGIC
# MAGIC Build the two surfaces Claire actually uses: an **AI/BI dashboard** to spot the
# MAGIC spike, and a **Genie space** to ask *"why?"* in plain English. → *[Back to the introduction]($./00_introduction)*
# MAGIC
# MAGIC > You direct, the Assistant (✨) builds. It already knows the story from
# MAGIC > `CONTEXT.md`; `../specifications/04-ai-bi.md` has the widget-level detail if you
# MAGIC > want a pixel-faithful build.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1/ Create the dashboard + the Operations page
# MAGIC
# MAGIC Create the AI/BI dashboard, build the at-a-glance page, then **open it and
# MAGIC confirm the story lands** before adding the deep-dive.
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Create an AI/BI dashboard named `LuxeBeauty Returns` on the gold tables, and
# MAGIC > build an **Operations** page that lands the story fast: KPI tiles for refunds /
# MAGIC > returns / orders / revenue, a weekly refund trend with a forecast band, a map of
# MAGIC > where the affected customers are, and a category breakdown. Let me split
# MAGIC > affected-lot vs everyday returns. Then publish it and open it."*
# MAGIC
# MAGIC **Open it and confirm** — refunds peak ≈ **$180K a few weeks back** and decaying
# MAGIC (not pinned at today), **Paris** the biggest map bubble, **Skincare** leads the
# MAGIC category breakdown. If a tile is off, ask the Assistant to check its query
# MAGIC against the gold tables.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2/ Add the Investigation page
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Add an **Investigation** page to the dashboard: a flow from category → product
# MAGIC > → lot that shows everything funnels into one lot, affected-vs-everyday splits by
# MAGIC > country and reason, a sentiment breakdown from the anger score, and a table of
# MAGIC > the angriest comments. Wire up Date / Region / Category / Source filters across
# MAGIC > both pages, then republish."*
# MAGIC
# MAGIC **Open it and confirm** the sankey collapses to **Skincare → 3 SKUs → 1 lot** and
# MAGIC the comments table surfaces the texture complaints (grainy / separated / watery).

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3/ Create the Genie space
# MAGIC
# MAGIC The payoff: Claire asks *"why so many returns?"* and Genie walks the data to the
# MAGIC lot and quotes the incident note. Create it, seed it, then **test the punchline**.
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Create a Genie space named `LuxeBeauty Operations Analytics`, attach the gold
# MAGIC > tables plus `silver_production_lots` (the lot table with the incident notes), and
# MAGIC > give it the baselines + investigation flow + sample questions from `CONTEXT.md`.
# MAGIC > Add a curated example query for the drill-to-lot question so it reliably joins
# MAGIC > returns → the lot table and quotes the incident note."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4/ Run the demo — verify the punchline
# MAGIC
# MAGIC In the new Genie space, ask — in order:
# MAGIC 1. *"What's our return rate this month, and how does it compare to baseline?"*
# MAGIC 2. **"Why do I have so many returns? Trace it to the products and the lot."**
# MAGIC 3. *"Which production lot is driving the spike, and what does the QC note say?"*
# MAGIC
# MAGIC ✅ **Confirm:** by question 3, Genie hops to `silver_production_lots` and **quotes
# MAGIC the incident note inline** — *homogenizer pressure fluctuation at Lyon, lot released
# MAGIC despite the QC flag.* If it won't make the hop, tell the Assistant to add/adjust the
# MAGIC curated query for that question. That's the core demo. 🎯
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ Dashboard + Genie done — that's the core demo 🎯
# MAGIC You built — live, with the Assistant — a raw→silver→gold SDP, an AI/BI dashboard,
# MAGIC and a Genie space that cracks the case, all on governed Unity Catalog data.
# MAGIC
# MAGIC ### ▶️ Go further *(optional)*: **[4. Governance]($./04_governance)**
# MAGIC A metric view, ABAC access policies, and data classification — then
# MAGIC **[5. ML]($./05_ml)** for the hidden-premium classifier. *(or [back to the introduction]($./00_introduction))*
# MAGIC
# MAGIC **To hand this to a customer:** download the whole project as a zip (the specs, the
# MAGIC data-gen, CONTEXT.md, and this notebook set) and load it into their workspace —
# MAGIC they run the same workshop against their own catalog.
