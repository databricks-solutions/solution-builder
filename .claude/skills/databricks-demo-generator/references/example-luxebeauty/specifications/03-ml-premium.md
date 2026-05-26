# ML — Hidden Premium Customer Classifier

**Skill**: `databricks-ml-training-serving` (owns the *how* — UC registry URI, experiment parent-folder trap, `@prod` alias, Optuna+autolog, `spark_udf` env_manager rules, serverless-job `--no-wait` + TASK-run_id pattern, gotchas table). This spec is *what*.

Reads `gold_customer_features` from `01-lakeflow.md`. Writes `gold_customer_premium_predictions`.

## The story this model tells

LuxeBeauty's CS team has hand-tagged ~3K customers as `premium` and ~1K as `not_premium`. The other ~46K are untagged — not "non-premium", just *no one got around to reviewing them yet*. Within the 250 affected-lot customers, only ~18 are already tagged premium. The model trains on the labeled subset and **finds the hidden premiums** — untagged customers whose behavioral fingerprint matches the labeled ones (high spend + high tenure + low return rate + loyalty tier). Expected outcome on the 250: ~18 already-labeled premium + ~49 model-found premium → 67 total premium, 183 standard. The agent uses `final_tier` to pick the offer (premium → 20% + personal apology; standard → 5% goodwill).

The model is doing something a query can't: a `WHERE premium_status='premium'` filter misses the 49 hidden ones.

## What to train

Binary classifier predicting `premium_status` — train only on the ~4K rows where the label is non-null; filter `premium_status IS NULL` out at training time. XGBoost, Optuna ~10 trials, MLflow autolog. Register to UC as `{catalog}.{schema}.customer_premium_classifier`, promote `@prod`.

## Features (and why each is in)

| Feature | Role |
|---|---|
| `total_spend_lifetime` | Strongest signal — premium customers spend more. |
| `total_orders_lifetime` | Frequency proxy — engagement, not just one-shot big spenders. |
| `lifetime_return_rate` | Premium customers tend to return less. |
| `tenure_months` | Long-tenured = more chance to behave like a premium. |
| `loyalty_tier` | Strong but not perfect — most premiums are Gold/Silver, but the model needs to find Standard-tier premiums (the ~10% "surprise tags"). |
| `avg_anger_score_last_90d` | Weaker — premium customers do file returns but tend to be measured about it. Useful tie-breaker. |
| `days_since_last_order` | Recency — engaged premiums order regularly. |
| `region`, `country` | Weak signals; included for per-country slicing in the dashboard map. |

The synth rules in `01-lakeflow.md` engineer `premium_status` so the first four features carry the signal — see the tagging rules + behavioral profile table there.

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

- Run as a **serverless job**, never in the chat process. ~10–15 min end-to-end.
- create a notebook under (`PROJECT/ml/premium_train_score.py`): train → register → set `@prod` → batch-score → overwrite gold table → `dbutils.notebook.exit(json.dumps({model_version, auc, labeled_premium, predicted_premium, total_scored}))`. Upload the notebook to the workspace folder & run it as a job
- Note: Nightly retrain is talk-track, not built.
- Critical: never run anything locally

## Who consumes the predictions

1. **Returns Console app** — Delta `gold_customer_premium_predictions` is mirrored into Lakebase as `app.customer_premium` on app boot + on "Reset demo" (see `specifications/app/03_DATA_MODEL.md`). The agent's `find_lot_premium_breakdown` and the per-row JOIN inside `process_return_batch` read from Lakebase so hot-path lookups are sub-ms. Talking-track: production uses Lakebase Synced Tables for continuous replication; the demo does a one-shot manual sync to keep moving parts visible.
2. **Genie** — reads from Delta directly. Answers *"How many of the affected customers are premium (tagged or predicted)?"*, *"Which countries have the most hidden premiums?"*, *"How many premiums did the model find that CS hadn't tagged?"*.
3. **AI/BI dashboard map** (`04-ai-bi.md` Row 5) — reads from Delta, colored by `pct_premium` per country, joined with affected-customer list + `bronze_customers.country`.

## Functional validation

Among the 250 lot-affected customers, `final_tier='premium'` lands on **between 30 and 120 of them** (target ≈67, with a meaningful split between CS-tagged and model-found hidden premiums, and a visible European concentration). Below 30 or above 120, the agent's tiered-offer story breaks — premium becomes either trivially rare or trivially universal. If it does, re-check the `premium_status` distribution in the synth data and the model's classification threshold.

## resources.json

- `ml_model_name`: `{catalog}.{schema}.customer_premium_classifier`
- `mlflow_experiment_path`: `/Workspace/Users/<your-user>/luxebeauty/experiments/premium_classifier`
