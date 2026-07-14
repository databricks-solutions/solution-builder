-- ============================================================================
-- Silver Layer — the ANSWER KEY for the workshop.
-- ============================================================================
-- This is the target the SA converges on while building the pipeline live with
-- Genie Code (notebooks/01_build_pipeline.py). It is NOT run directly — it's
-- the "here's what good looks like" reference the workshop CONTEXT.md points at.
--
-- Design for the workshop:
--   * NO bronze pass-through. Silver reads the RAW FILES straight from the UC
--     Volume (`/Volumes/{cat}/{schema}/raw_data/<dataset>/`) via read_files().
--     The data-gen script (data_generation/generate_data.py) lands one parquet
--     dataset per raw_* table there — that Volume is the bronze landing zone.
--   * Two consumed silver tables (silver_returns, silver_order_items) + one
--     helper MV (comment_anger_scores) so ai_classify runs once per distinct
--     comment instead of once per row.
--
-- Placeholders: ${catalog} / ${schema} are SDP pipeline configuration values.
-- The Volume path resolves to /Volumes/${catalog}/${schema}/raw_data/... .
-- ============================================================================

-- ai_classify dedup: raw_returns has ~13K+ rows but the synth draws comments
-- from a small canned pool. Score each DISTINCT comment ONCE, join it back —
-- drops the LLM call count from O(rows) to O(distinct comments).
CREATE OR REFRESH MATERIALIZED VIEW comment_anger_scores
COMMENT 'Distinct customer comments → ai_classify anger score. Read by silver_returns to avoid per-row LLM calls.'
AS
WITH distinct_comments AS (
  SELECT DISTINCT customer_comment
  FROM read_files('/Volumes/${catalog}/${schema}/raw_data/returns', format => 'parquet')
  WHERE customer_comment IS NOT NULL
)
SELECT
  customer_comment,
  CASE ai_classify(customer_comment,
        ARRAY('very_angry', 'angry', 'neutral', 'satisfied'))
    WHEN 'very_angry' THEN 1.0
    WHEN 'angry'      THEN 0.7
    WHEN 'neutral'    THEN 0.3
    ELSE 0.1
  END AS anger_score
FROM distinct_comments;

-- silver_order_items: one row per order line, denormalized with order
-- date/region + product/category + lot/facility/production_date so gold can
-- roll up without re-joining. Reads the raw FILES from the Volume.
CREATE OR REFRESH MATERIALIZED VIEW silver_order_items
COMMENT 'One row per order line, denormalized — order_date/region from raw orders, product_name/category from raw products, facility/production_date from raw production lots.'
CLUSTER BY (order_date)
AS
SELECT
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
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/order_items', format => 'parquet') i
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/orders', format => 'parquet') o
  ON o.order_id = i.order_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/products', format => 'parquet') p
  ON p.product_id = i.product_id
LEFT JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/production_lots', format => 'parquet') l
  ON l.lot_id = i.lot_id AND l.product_id = i.product_id;

-- silver_returns: each return carries customer city/lat/lng + region/country
-- in-row so the bubble map query doesn't re-join, plus the ai_classify anger
-- score. Reads the raw FILES from the Volume.
CREATE OR REFRESH MATERIALIZED VIEW silver_returns
COMMENT 'Cleaned returns enriched with ai_classify anger score + customer geo (city/lat/lng denormalized). is_bad_lot is the split key for the affected-lot story.'
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
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/returns', format => 'parquet') r
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/products', format => 'parquet') p
  ON r.product_id  = p.product_id
LEFT JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/customers', format => 'parquet') c
  ON r.customer_id = c.customer_id
LEFT JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/orders', format => 'parquet') o
  ON r.order_id    = o.order_id
LEFT JOIN comment_anger_scores s
  ON r.customer_comment = s.customer_comment;
