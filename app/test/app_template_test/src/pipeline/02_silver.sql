-- Silver Layer — clean joined fact + ai_classify anger score.
-- Reads the RAW PARQUET FILES straight from the UC Volume landing zone
-- (`/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/<dataset>/`) via
-- read_files() — no bronze pass-through. The data-gen script lands one parquet
-- dataset per raw_* table there. Emits the three silver tables consumed
-- downstream:
--   - silver_returns: enriched returns fact (used by gold + the app)
--   - silver_order_items: denormalized order lines (used by gold)
--   - silver_orders:  order-level totals (used by the Lakebase sync)
-- Plus comment_anger_scores: a small dedup MV so ai_classify runs once per
-- distinct comment instead of once per row.

-- ai_classify dedup: the synth uses a canned pool of ~20 distinct
-- `customer_comment` strings, but the returns dataset has ~13K rows. Score each
-- DISTINCT comment once and join the result back into silver_returns.
-- Drops the LLM call count from O(rows) to O(distinct).
CREATE OR REFRESH MATERIALIZED VIEW comment_anger_scores
COMMENT 'Distinct customer comments → ai_classify anger score. Read by silver_returns to avoid per-row LLM calls.'
AS
WITH distinct_comments AS (
  SELECT DISTINCT customer_comment
  FROM read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/returns', format => 'parquet')
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

-- silver_production_lots: the lot master exposed as a governed table so Genie
-- (and the app) can query it — most importantly `incident_summary`, the QC note
-- that only the affected lot carries. Raw lots now live as parquet in the
-- Volume, so we surface them here as a silver MV (the drill-down destination:
-- the returns tables show the symptom, this lot table holds the explanation).
CREATE OR REFRESH MATERIALIZED VIEW silver_production_lots
COMMENT 'Production lot master. incident_summary is the QC note — non-null ONLY on the affected lot rows; Genie hops here to quote it.'
AS
SELECT
  lot_id,
  product_id,
  CAST(production_date AS DATE) AS production_date,
  facility,
  units_produced,
  status,
  incident_summary
FROM read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/production_lots', format => 'parquet');

-- silver_order_items: one row per order line, denormalized with order
-- date/region + product/category + lot/facility/production_date so the
-- gold layer + lifetime feature aggregates can read everything without
-- re-joining. Spec lives at references/example-luxebeauty/specifications/
-- 01-lakeflow.md § silver_order_items.
CREATE OR REFRESH MATERIALIZED VIEW silver_order_items
COMMENT 'One row per order line, denormalized — pulls order_date/region from raw_orders, product_name/category from raw_products, facility/production_date from raw_production_lots.'
CLUSTER BY (order_date)
AS
SELECT
  -- Synthetic order_item_id since raw_order_items doesn't carry one
  -- (one order_id can have multiple lines for different SKUs).
  CONCAT(i.order_id, '-', i.product_id) AS order_item_id,
  i.order_id,
  CAST(o.order_date AS DATE) AS order_date,
  o.region,
  i.product_id,
  p.product_name,
  p.category,
  i.lot_id,
  i.facility,
  CAST(l.production_date AS DATE) AS production_date,
  i.quantity,
  i.unit_price_usd,
  i.line_total_usd
FROM read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/order_items', format => 'parquet') i
JOIN read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/orders', format => 'parquet') o
  ON o.order_id = i.order_id
JOIN read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/products', format => 'parquet') p
  ON p.product_id = i.product_id
LEFT JOIN read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/production_lots', format => 'parquet') l
  ON l.lot_id = i.lot_id AND l.product_id = i.product_id;

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
FROM read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/returns', format => 'parquet') r
JOIN read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/products', format => 'parquet') p
  ON r.product_id  = p.product_id
LEFT JOIN read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/customers', format => 'parquet') c
  ON r.customer_id = c.customer_id
LEFT JOIN read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/orders', format => 'parquet') o
  ON r.order_id    = o.order_id
LEFT JOIN comment_anger_scores s
  ON r.customer_comment = s.customer_comment;

-- silver_orders — order-level view with the columns the app's Lakebase sync
-- expects: order_id, customer_id, order_date, region, total_usd, status.
-- raw_orders is already one row per order (line items live in raw_order_items
-- with their own per-line columns), so this is a straight column-projection
-- + a CAST on order_date — no GROUP BY needed.
CREATE OR REFRESH MATERIALIZED VIEW silver_orders
COMMENT 'Order-level view (1 row per order) for the Lakebase mirror. total_usd is the gross order total computed at synth time by summing raw_order_items.line_total_usd per order_id.'
AS
SELECT
  o.order_id,
  o.customer_id,
  CAST(o.order_date AS DATE) AS order_date,
  o.region,
  o.total_usd,
  -- raw_orders has no order-level status in this synth; emit NULL so the
  -- sync's expected column exists. The app's drawer treats it as optional.
  CAST(NULL AS STRING)       AS status
FROM read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/orders', format => 'parquet') o;

-- silver_customers — the customer dimension the app's Lakebase mirror needs
-- (customer_id + identity + geo + tier + premium_status + registration_date).
-- raw_customers is one row per customer in the Volume, so this is a straight
-- column projection, matching silver_orders. gold_customer_returns/features
-- can read this instead of re-reading the raw parquet.
CREATE OR REFRESH MATERIALIZED VIEW silver_customers
COMMENT 'Customer dimension (1 row per customer) for the Lakebase mirror + gold joins.'
AS
SELECT
  c.customer_id,
  c.email,
  c.first_name,
  c.last_name,
  c.region,
  c.country,
  c.city,
  c.customer_lat,
  c.customer_lng,
  c.loyalty_tier,
  c.premium_status,
  CAST(c.registration_date AS DATE) AS registration_date
FROM read_files('/Volumes/retail_consumer_goods/luxebeauty_demo/raw_data/customers', format => 'parquet') c;
