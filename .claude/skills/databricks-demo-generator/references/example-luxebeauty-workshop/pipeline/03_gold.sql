-- ============================================================================
-- Gold Layer — the ANSWER KEY for the workshop.
-- ============================================================================
-- Target for the "build the gold rollups" step (notebooks/01_build_pipeline.py).
-- Reference only — not run directly.
--
-- V1 workshop scope is SDP + Dashboard + Genie (no ML, no app), so we build
-- ONLY the two gold tables the dashboard + Genie actually read:
--   * gold_returns        — the one denormalized per-return fact
--   * gold_daily_summary  — (date, region, category) rollup for KPIs + trend
-- The complete demo also has gold_customer_features (ML) + gold_customer_returns
-- (app queue) — intentionally OUT of scope here so nothing is an orphan table.
--
-- Both read the SILVER materialized views (silver_returns, silver_order_items),
-- NOT the raw files — silver already did the joins + cleaning + ai_classify.
-- ============================================================================

-- gold_returns: the single denormalized fact the dashboard + Genie read.
-- Projected straight from silver_returns (all joins already happened upstream).
-- Deliberately OMITS incident_summary — the symptom lives here, the explanation
-- lives on the raw production_lots (Genie does the one-hop join to quote it).
CREATE OR REFRESH MATERIALIZED VIEW gold_returns
COMMENT 'Denormalized per-return fact for the dashboard + Genie. is_bad_lot splits affected-lot vs everyday returns. anger_score drives the sentiment widgets.'
AS
SELECT
  return_id,
  order_id,
  customer_id,
  product_id,
  product_name,
  category,
  lot_id,
  facility,
  return_date,
  order_date,
  refund_amount_usd,
  return_reason,
  return_reason_text,
  customer_comment,
  anger_score,
  region,
  country,
  city,
  customer_lat,
  customer_lng,
  is_bad_lot
FROM silver_returns;

-- gold_daily_summary: one row per (date, region, category). An orders rollup
-- (from silver_order_items) LEFT JOIN a returns rollup (from silver_returns),
-- returns defaulting to zero where there were none. Powers the KPI counters,
-- the category donut, and the orders-by-region area chart.
CREATE OR REFRESH MATERIALIZED VIEW gold_daily_summary
COMMENT 'Daily orders + revenue + returns by (region, category) — powers the dashboard KPIs, trend, and category/region widgets.'
AS
WITH orders_d AS (
  SELECT
    order_date               AS date,
    region,
    category,
    COUNT(DISTINCT order_id) AS order_count,
    SUM(line_total_usd)      AS revenue_usd,
    SUM(quantity)            AS items_sold
  FROM silver_order_items
  GROUP BY 1, 2, 3
),
returns_d AS (
  SELECT
    CAST(return_date AS DATE) AS date,
    region,
    category,
    COUNT(*)                  AS return_count,
    SUM(refund_amount_usd)    AS returns_usd
  FROM silver_returns
  GROUP BY 1, 2, 3
)
SELECT
  o.date,
  o.region,
  o.category,
  o.order_count,
  o.items_sold,
  o.revenue_usd,
  COALESCE(r.return_count, 0)  AS return_count,
  COALESCE(r.returns_usd, 0.0) AS returns_usd
FROM orders_d o
LEFT JOIN returns_d r
  ON r.date = o.date AND r.region = o.region AND r.category = o.category;
