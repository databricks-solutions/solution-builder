-- Top screen-failure reasons per trial (real criterion: site-coded, or AI-read from the coordinator note when coded OTHER).
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = trial_site_selection
WITH r AS (
  SELECT trial_id, criterion_id, MAX(criterion_name) AS criterion_name, SUM(screen_failures) AS n,
         SUM(ai_recovered_failures) AS ai_recovered
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_screen_fail_monthly')
  GROUP BY trial_id, criterion_id
)
SELECT trial_id, criterion_id, criterion_name, CAST(n AS BIGINT) AS n, CAST(ai_recovered AS BIGINT) AS ai_recovered,
       CAST(ROUND(100 * n / SUM(n) OVER (PARTITION BY trial_id), 1) AS DOUBLE) AS share_pct
FROM r
QUALIFY ROW_NUMBER() OVER (PARTITION BY trial_id ORDER BY n DESC) <= 3
ORDER BY trial_id, n DESC
