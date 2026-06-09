# ML — Hidden Premium Customer Classifier

**Skill**: `databricks-ml-training-serving` (owns the *how* — UC registry URI, experiment parent-folder trap, `@prod` alias, Optuna+autolog, `spark_udf` env_manager rules, serverless-job `--no-wait` + TASK-run_id pattern, gotchas table). This spec is *what*.

Reads `gold_customer_features` from `01-lakeflow.md`. Writes `gold_customer_premium_predictions`.

## The story this model tells

LuxeBeauty's CS team has hand-tagged ~3K customers as `premium` and ~1K as `not_premium`. The other ~46K are untagged — not "non-premium", just *no one got around to reviewing them yet*. Within the 250 affected-lot customers, only ~18 are already tagged premium. The model trains on the labeled subset and **finds the hidden premiums** — untagged customers whose behavioral fingerprint matches the labeled ones (high spend + high tenure + low return rate + loyalty tier). Expected outcome on the 250: ~18 already-labeled premium + ~49 model-found premium → 67 total premium, 183 standard. The agent uses `final_tier` to pick the offer (premium → 20% + personal apology; standard → 5% goodwill).

The model is doing something a query can't: a `WHERE premium_status='premium'` filter misses the 49 hidden ones.

## What to train

Binary classifier predicting `premium_status` — train only on the ~4K rows where the label is non-null; filter `premium_status IS NULL` out at training time. XGBoost, Optuna ~10 trials, MLflow autolog. Register to UC as `{catalog}.{schema}.customer_premium_classifier`, promote `@prod`.

## Features

All from `gold_customer_features`: `total_spend_lifetime` + `total_orders_lifetime` + `lifetime_return_rate` + `tenure_months` carry the signal (per the synth's `premium_status` tagging in `01-lakeflow.md`). `loyalty_tier` helps but isn't enough alone — the surprise-tags rule (Standard-tier premiums) forces the model to combine features. `avg_anger_score_last_90d` is a tie-breaker. `days_since_last_order` is recency. `region` / `country` are weak; included for per-country slicing in the dashboard map.

## Inference shape

Same notebook trains AND scores. Immediately after training, batch-score every customer with `spark_udf(models:/...@prod)` and overwrite `gold_customer_premium_predictions`:

| Column | |
|---|---|
| `customer_id` | PK |
| `premium_prob` | model output, 0–1 |
| `is_premium_predicted` | bool — `premium_prob > 0.5` |
| `premium_status_labeled` | pass-through from `bronze_customers.premium_status` (NULL for untagged) — kept for transparency / lineage in the UI |
| `final_tier` | `'premium'` if `premium_status_labeled = 'premium'` OR `is_premium_predicted = true`, else `'standard'`. Single column the agent's `process_return_batch` JOINs on. |
| `predicted_at` | now() |

**Batch only — no serving endpoint.** Every downstream consumer reads from a table; serving would add cost + quota for zero narrative gain.

## Execution

One Databricks notebook at `PROJECT/ml/premium_train_score.py` doing train → register → set `@prod` → batch-score → overwrite gold table → `dbutils.notebook.exit(json.dumps({model_version, auc, labeled_premium, predicted_premium, total_scored}))`. Uploaded to the workspace folder, run as a **serverless job** (~10-15 min). Never run locally. Nightly retrain is talk-track only.

**Notebook-source format is required** (without these headers the file uploads as a plain `.py`, not a notebook — cells don't render, `# MAGIC %md` shows as a comment):

```python
# Databricks notebook source
# MAGIC %md
# MAGIC # Notebook title
# MAGIC <Business description of what we're doing in this notebook>

# COMMAND ----------

<code cell>

# COMMAND ----------
...
```

## Who consumes the predictions

1. **Returns Console app** — Delta `gold_customer_premium_predictions` is mirrored into Lakebase as `app.customer_premium` on app boot + on "Reset demo" (see `specifications/app/03_DATA_MODEL.md`). The agent's `find_lot_premium_breakdown` and the per-row JOIN inside `process_return_batch` read from Lakebase so hot-path lookups are sub-ms. Talking-track: production uses Lakebase Synced Tables for continuous replication; the demo does a one-shot manual sync to keep moving parts visible.
2. **Genie** — reads from Delta directly. Answers *"How many of the affected customers are premium (tagged or predicted)?"*, *"Which countries have the most hidden premiums?"*, *"How many premiums did the model find that CS hadn't tagged?"*.
3. **AI/BI dashboard map** (`04-ai-bi.md` Row 5) — reads from Delta, colored by `pct_premium` per country, joined with affected-customer list + `bronze_customers.country`.

## Functional validation

Among the 250 lot-affected customers, `final_tier='premium'` lands on **between 30 and 120 of them** (target ≈67, with a meaningful split between CS-tagged and model-found hidden premiums, and a visible European concentration). Below 30 or above 120, the agent's tiered-offer story breaks — premium becomes either trivially rare or trivially universal. If it does, re-check the `premium_status` distribution in the synth data and the model's classification threshold.

## resources.json

- `ml_model_name`: `{catalog}.{schema}.customer_premium_classifier`
- `mlflow_experiment_path`: `/Workspace/Users/<your-user>/luxebeauty/experiments/premium_classifier`
