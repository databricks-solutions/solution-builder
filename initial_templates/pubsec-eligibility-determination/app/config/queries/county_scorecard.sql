-- County scorecard: last-3-month SNAP timeliness, procedural denials, approval, and today's backlog per worker.
-- @param catalog STRING = public_sector
-- @param schema STRING = eligibility_copilot
WITH recent AS (
  SELECT county_name,
         ROUND(100 * AVG(CASE WHEN program = 'SNAP' THEN CAST(met_timeliness AS INT) END), 1) AS snap_on_time_pct,
         ROUND(100 * COUNT_IF(is_procedural_denial) / COUNT(*), 1) AS procedural_denial_pct,
         ROUND(100 * COUNT_IF(determination = 'APPROVED') / NULLIF(COUNT_IF(determination IN ('APPROVED','DENIED')), 0), 1) AS approval_pct,
         PERCENTILE(processing_days, 0.5) AS median_days
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_applications')
  WHERE is_determined AND determination_date >= add_months(current_date(), -3)
  GROUP BY county_name
)
SELECT b.county_name AS county, b.region_type,
       CAST(r.snap_on_time_pct AS DOUBLE) AS snap_on_time_pct,
       CAST(r.median_days AS DOUBLE) AS median_days,
       CAST(r.procedural_denial_pct AS DOUBLE) AS procedural_denial_pct,
       CAST(r.approval_pct AS DOUBLE) AS approval_pct,
       CAST(b.open_cases AS BIGINT) AS open_cases,
       CAST(b.overdue_cases AS BIGINT) AS overdue_cases,
       CAST(b.caseworker_fte AS BIGINT) AS caseworkers,
       CAST(b.open_cases_per_worker AS DOUBLE) AS open_per_worker
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_county_backlog') b
JOIN recent r ON r.county_name = b.county_name
ORDER BY snap_on_time_pct
