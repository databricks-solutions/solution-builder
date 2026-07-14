# Databricks notebook source
# MAGIC %md
# MAGIC # 4️⃣ Governance
# MAGIC
# MAGIC Layer **Unity Catalog governance** on the gold tables — a semantic **metric
# MAGIC view**, **ABAC** access policies, and **data classification** on the sensitive
# MAGIC columns. → *[Back to the introduction]($./00_introduction)*
# MAGIC
# MAGIC > Prereq: **[2. Build the pipeline]($./02_build_pipeline)** finished, so the gold
# MAGIC > tables exist. As before, each step is a prompt for the Assistant (✨).

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1/ Create the metric view
# MAGIC
# MAGIC A metric view gives Genie + the dashboard **governed, named measures** so
# MAGIC "return rate" means the same formula everywhere. Create it, then query it.
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Create a metric view `mv_returns` over `gold_daily_summary`, sliced by date,
# MAGIC > region and category, with the measures everyone argues about — revenue, refunds,
# MAGIC > order + return counts, and return rate + refund rate as proper ratios that stay
# MAGIC > correct under any filter. Then run a query over it to confirm it works."*
# MAGIC
# MAGIC ✅ **Confirm:** *"Query `MEASURE(return_rate)` by week"* — the spike week should be
# MAGIC ~3× the baseline.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2/ Govern PII with ABAC — tag once, one policy covers everything
# MAGIC
# MAGIC **ABAC** (Attribute-Based Access Control) is the modern, tag-driven model: you
# MAGIC **tag** sensitive columns, write **one `CREATE POLICY` on the schema** that
# MAGIC matches those tags, and it auto-applies to every column carrying the tag — today
# MAGIC and every future table. That's the story per-table `SET MASK` can't tell.
# MAGIC
# MAGIC **2a — Tag the sensitive columns.**
# MAGIC > *"Tag the PII on `gold_returns` with a governance tag — the customer id and the
# MAGIC > geo columns (`city`, `customer_lat`, `customer_lng`) — using
# MAGIC > `ALTER TABLE … ALTER COLUMN … SET TAGS ('pii' = 'geo')` (and `'id'` for the id)."*
# MAGIC
# MAGIC **2b — Write the masking function + the ABAC policy** (the load-bearing part —
# MAGIC give Genie Code the exact shape so it uses the policy engine, not per-table masks):
# MAGIC > *"Create a masking function that redacts a string, then create a tag-driven ABAC
# MAGIC > column-mask policy on the schema that applies it to every column tagged `pii`,
# MAGIC > for `account users` except the ops group. Use this grammar:*
# MAGIC > *```sql*
# MAGIC > *CREATE OR REPLACE POLICY mask_pii*
# MAGIC > *  ON SCHEMA {catalog}.{schema}*
# MAGIC > *  COLUMN MASK {catalog}.{schema}.redact*
# MAGIC > *  TO `account users` EXCEPT luxe_ops*
# MAGIC > *  FOR TABLES MATCH COLUMNS has_tag_value('pii','geo') AS m ON COLUMN m;*
# MAGIC > *```*
# MAGIC > *Then add a row-filter policy so regional analysts only see their own `region`
# MAGIC > (a `ROW FILTER` policy using `MATCH COLUMNS has_tag('region') … USING COLUMNS`)."*
# MAGIC
# MAGIC **2c — Verify by persona** (the payoff):
# MAGIC > *"Query `gold_returns` as the ops group vs a regular analyst — confirm ops sees
# MAGIC > raw geo, the analyst sees it masked, and the KPI aggregates are unchanged for
# MAGIC > both. Then prove the ABAC win: add the same `pii` tag to a column on another
# MAGIC > table and show the existing policy already masks it — zero new DDL."*
# MAGIC
# MAGIC > 💡 Gotchas to hand Genie Code: the mask function's return type must match the
# MAGIC > column type exactly; one row filter per table, one mask per column.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3/ Run data classification
# MAGIC
# MAGIC Let Unity Catalog **scan and classify** the schema so PII is found
# MAGIC automatically — not just where you remembered to tag it.
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Run data classification across the schema, then show me what it flagged as
# MAGIC > sensitive — emails, names, locations — and how to review and accept the
# MAGIC > suggestions."*
# MAGIC
# MAGIC ✅ **Confirm:** the classifier's flagged columns line up with the PII you tagged
# MAGIC by hand in step 2.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ Governed
# MAGIC A metric view gives Genie clean measures; ABAC + classification keep PII safe.
# MAGIC
# MAGIC ### ▶️ Next: **[5. ML]($./05_ml)** — the hidden-premium classifier
# MAGIC *(or [back to the introduction]($./00_introduction))*
