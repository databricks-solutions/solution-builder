# ML — Hidden-premium classifier (built live via Genie Code, optional)

> **Workshop contract.** The "ML" page builds this live with Genie Code on the gold tables from
> `01-lakeflow.md`, using a Unity Catalog feature table (the `feature-store` capability).

---

## A. Feature table — `gold_customer_features`

A Unity Catalog **feature table** (`FeatureEngineeringClient().create_table`, primary key
`customer_id`), one row per customer (all 5,000): `customer_id`, `country`, `region`,
`loyalty_tier`, `total_spend` (sum of `total_usd`), `total_orders`, `return_rate`
(returns ÷ orders), `recency_days` (days since last order), `tenure_days` (from
`registration_date`). **No label in it.**

## B. Training set + model

- **Training set:** `customer_id` + `premium_status` for the labeled customers only (~650; NULL
  for the rest), features joined with `FeatureLookup` + `fe.create_training_set`.
- **Model:** encoding + classifier in one pyfunc that returns the premium probability, logged
  with `fe.log_model(training_set=...)` and registered as
  `{catalog}.{schema}.luxebeauty_premium_classifier`. Set the `prod` alias explicitly;
  `models:/…@prod` must resolve.

## C. Predictions — `customer_premium_predictions`

`fe.score_batch` on `models:/…@prod` with only `customer_id` passed in
(`result_type="double"`). Per customer: `customer_id`, `probability`, `predicted_premium`
(boolean), `cs_label` (= `premium_status`), `final_tier` (`premium` if the model or CS says so,
else `not_premium` / `unlabeled`).

## D. Checks

- The table appears under **Features**, and the model's lineage points at it.
- Model-found premiums exist (predicted premium with a NULL `cs_label`).
- The model agrees with CS on labeled rows, and does NOT call most unlabeled customers premium.
