-- Silver Layer — clean joined fact + ai_classify anger score.
-- We read raw_* directly (no bronze pass-through) and emit just the two
-- silver tables that are actually consumed downstream:
--   - silver_returns: enriched returns fact (used by gold + the app)
--   - silver_orders:  order-level totals (used by the Lakebase sync)
-- Plus comment_anger_scores: a small dedup MV so ai_classify runs once per
-- distinct comment instead of once per row.

-- ai_classify dedup: the synth uses a canned pool of ~20 distinct
-- `customer_comment` strings, but raw_returns has ~13K rows. Score each
-- DISTINCT comment once and join the result back into silver_returns.
-- Drops the LLM call count from O(rows) to O(distinct).
CREATE OR REFRESH MATERIALIZED VIEW comment_anger_scores
COMMENT 'Distinct customer comments → ai_classify anger score. Read by silver_returns to avoid per-row LLM calls.'
AS
WITH distinct_comments AS (
  SELECT DISTINCT customer_comment
  FROM ai_demo_gen.demo_luxebeauty_test.raw_returns
  WHERE customer_comment IS NOT NULL
)
SELECT
  customer_comment,
  CASE ai_classify(customer_comment,
        ARRAY('very_angry','angry','neutral','satisfied'))
    WHEN 'very_angry' THEN 1.0
    WHEN 'angry'      THEN 0.7
    WHEN 'neutral'    THEN 0.3
    ELSE 0.1
  END AS anger_score
FROM distinct_comments;

-- silver_returns: each return carries customer city/lat/lng + region/country
-- in-row so the bubble map query doesn't need a re-join. Reads raw_* directly.
CREATE OR REFRESH MATERIALIZED VIEW silver_returns
COMMENT 'Cleaned returns enriched with ai_classify anger score + customer geo (city/lat/lng denormalized)'
CLUSTER BY (return_date)
AS
SELECT
  r.return_id,
  r.order_id,
  r.customer_id,
  r.product_id,
  p.product_name,
  p.category,
  r.lot_id,
  r.facility,
  CAST(r.return_date AS TIMESTAMP) AS return_date,
  CAST(o.order_date AS DATE)       AS order_date,
  r.refund_amount_usd,
  r.return_reason,
  r.customer_comment       AS return_reason_text,
  r.customer_comment,
  COALESCE(s.anger_score, 0.1)     AS anger_score,
  r.country,
  c.city,
  c.customer_lat,
  c.customer_lng,
  r.region,
  r.status,
  r.is_bad_lot
FROM ai_demo_gen.demo_luxebeauty_test.raw_returns r
JOIN ai_demo_gen.demo_luxebeauty_test.raw_products p
  ON r.product_id  = p.product_id
LEFT JOIN ai_demo_gen.demo_luxebeauty_test.raw_customers c
  ON r.customer_id = c.customer_id
LEFT JOIN ai_demo_gen.demo_luxebeauty_test.raw_orders o
  ON r.order_id    = o.order_id
LEFT JOIN comment_anger_scores s
  ON r.customer_comment = s.customer_comment;

-- silver_orders — order-level view with the columns the app's Lakebase sync
-- expects: order_id, customer_id, order_date, region, total_usd, status.
-- raw_orders is per-line-item (one row per product), so we aggregate.
CREATE OR REFRESH MATERIALIZED VIEW silver_orders
COMMENT 'Order-level totals (sum of unit_price * quantity across line items) for the Lakebase mirror'
AS
SELECT
  o.order_id,
  MAX(o.customer_id)              AS customer_id,
  MAX(CAST(o.order_date AS DATE)) AS order_date,
  MAX(o.region)                   AS region,
  SUM(o.unit_price_usd * o.quantity) AS total_usd,
  -- raw_orders has no order-level status in this synth; emit NULL so the
  -- sync's expected column exists. The app's drawer treats it as optional.
  CAST(NULL AS STRING)            AS status
FROM ai_demo_gen.demo_luxebeauty_test.raw_orders o
GROUP BY o.order_id;
