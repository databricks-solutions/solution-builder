# Databricks notebook source
# MAGIC %md
# MAGIC # 🧴 LuxeBeauty Workshop — 4. ML: the hidden-premium classifier
# MAGIC
# MAGIC The business twist: CS hand-tagged a few thousand customers `premium` /
# MAGIC `not_premium`, but most are **untagged** — not non-premium, just never
# MAGIC reviewed. A model trained on the labeled ones **finds the hidden premiums**
# MAGIC (a `WHERE premium_status='premium'` query can't). You'll build it live with
# MAGIC Genie Code. Each step is a prompt for the Assistant (✨); it reads
# MAGIC `../CONTEXT.md`, you review + run.
# MAGIC
# MAGIC > Prereq: the pipeline (notebook 01) is built. This notebook adds one more
# MAGIC > gold feature table, then trains + batch-scores.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4.1 — Build the feature table
# MAGIC
# MAGIC The classifier trains on per-customer behavior. Build `gold_customer_features`
# MAGIC (one row per customer) from the silver layer.
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Create a gold materialized view `gold_customer_features`, one row per
# MAGIC > customer, joining the customers parquet + silver_returns + the orders. Columns:
# MAGIC > `customer_id`, `region`, `country`, `loyalty_tier`, `tenure_months`,
# MAGIC > `premium_status` (the CS label, NULL for untagged), `total_orders_lifetime`,
# MAGIC > `total_spend_lifetime`, `returns_lifetime`, `lifetime_return_rate`,
# MAGIC > `avg_anger_score_last_90d`, `days_since_last_order`. This is the training +
# MAGIC > scoring input for the premium classifier."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4.2 — Train the classifier
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Write a training cell: binary classifier on `gold_customer_features`
# MAGIC > predicting `premium_status`, training ONLY on rows where the label is
# MAGIC > non-null (filter out `premium_status IS NULL`). Use XGBoost with Optuna
# MAGIC > (~10 trials) and MLflow autolog. Features: total_spend_lifetime,
# MAGIC > total_orders_lifetime, lifetime_return_rate, tenure_months, loyalty_tier,
# MAGIC > avg_anger_score_last_90d, days_since_last_order. Register the model to
# MAGIC > Unity Catalog as `{catalog}.{schema}.customer_premium_classifier` and set
# MAGIC > the `@prod` alias."*
# MAGIC
# MAGIC > 💡 This is a great Genie Code moment — let it scaffold the MLflow +
# MAGIC > Optuna boilerplate; you focus on the features + the story.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4.3 — Batch-score → the predictions table
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"In the same notebook, batch-score every customer with
# MAGIC > `spark_udf(models:/{catalog}.{schema}.customer_premium_classifier@prod)`
# MAGIC > and overwrite `gold_customer_premium_predictions` with: `customer_id`,
# MAGIC > `premium_prob`, `is_premium_predicted` (prob > 0.5), `premium_status_labeled`
# MAGIC > (pass-through), `final_tier` ('premium' if labeled premium OR predicted,
# MAGIC > else 'standard'), `predicted_at`. Then show me: among the affected-lot
# MAGIC > customers, how many land `final_tier = 'premium'` (target ~30–120)."*

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4.4 — Let Genie see the hidden premiums
# MAGIC
# MAGIC **Paste to the Assistant:**
# MAGIC > *"Attach `gold_customer_premium_predictions` to the Genie space and add a
# MAGIC > sample question: 'How many premiums did the model find that CS hadn't
# MAGIC > tagged?' — it should compare `is_premium_predicted` against
# MAGIC > `premium_status_labeled`."*
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### ✅ ML in the loop
# MAGIC The model found the hidden premiums — the punchline a plain query misses.
# MAGIC You've now built, live with Genie Code, a full governed stack: data → SDP →
# MAGIC governance → ML → dashboard → Genie. That's the workshop. 🎯
