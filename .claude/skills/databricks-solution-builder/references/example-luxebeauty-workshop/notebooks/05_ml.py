# Databricks notebook source
# MAGIC %md
# MAGIC # 5️⃣ ML — the hidden-premium classifier
# MAGIC
# MAGIC The business twist: CS hand-tagged a few thousand customers `premium` /
# MAGIC `not_premium`, but most are **untagged** — not non-premium, just never reviewed.
# MAGIC A model trained on the labeled ones **finds the hidden premiums** a
# MAGIC `WHERE premium_status='premium'` query can't. → *[Back to the introduction]($./00_introduction)*
# MAGIC
# MAGIC > Prereq: **[2. Build the pipeline]($./02_build_pipeline)** is built. This notebook
# MAGIC > adds one more feature table, then trains + batch-scores — each step a prompt for
# MAGIC > the Assistant (✨).

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1/ Build the feature table
# MAGIC
# MAGIC The classifier trains on per-customer behavior — so first roll the data up to
# MAGIC one row per customer, then run it and check the labels.
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Build a per-customer feature table `gold_customer_features` for a premium
# MAGIC > classifier: tenure, loyalty tier, lifetime orders + spend, return rate, recent
# MAGIC > sentiment, and days since last order — plus the CS `premium` label where it
# MAGIC > exists (most are unlabeled). Create it and show me the row count."*
# MAGIC
# MAGIC ✅ **Confirm:** the label is **NULL for most customers** — that unlabeled majority
# MAGIC is exactly who the model will score.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2/ Train + register the classifier
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Train a classifier predicting premium status on just the labeled customers —
# MAGIC > XGBoost with a little Optuna tuning, tracked in MLflow — using the behavioral
# MAGIC > features (spend, tenure, return rate, tier), since some premiums hide in the
# MAGIC > standard tier. Register it to Unity Catalog as `customer_premium_classifier`
# MAGIC > with a `@prod` alias."*
# MAGIC
# MAGIC ✅ **Confirm:** the model version is registered with the `@prod` alias and the
# MAGIC MLflow run shows a sensible AUC. *(Let the Assistant scaffold the MLflow + Optuna
# MAGIC boilerplate; you steer the features.)*

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3/ Score everyone → find the hidden premiums
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Batch-score every customer with the `@prod` model into a predictions table:
# MAGIC > the probability, the predicted flag, the original CS label, and a final tier
# MAGIC > that's 'premium' if EITHER the model or CS says so. Write it out and run the
# MAGIC > check — among the bad-lot customers, how many come out premium?"*
# MAGIC
# MAGIC ✅ **Confirm:** ~30–120 of the bad-lot customers land `premium` — a mix of
# MAGIC CS-tagged and **model-found hidden premiums** a plain filter would miss.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4/ Let Genie tell the story
# MAGIC
# MAGIC **Ask the Assistant:**
# MAGIC > *"Attach the predictions table to the Genie space, then let me ask it: 'how many
# MAGIC > premium customers did the model find that CS never tagged?'"*
# MAGIC
# MAGIC ✅ **Confirm:** Genie answers with the count of model-found premiums (predicted
# MAGIC premium, no CS label) — the hidden premiums a `WHERE premium_status='premium'`
# MAGIC query would miss.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### 🎉 You built the whole stack
# MAGIC The model found the hidden premiums — the punchline a plain query misses. And
# MAGIC you built it all live with Genie Code: **data → SDP → governance → ML →
# MAGIC dashboard → Genie**, on one governed platform. That's the workshop. 🎯
# MAGIC
# MAGIC → *[Back to the introduction]($./00_introduction)*
