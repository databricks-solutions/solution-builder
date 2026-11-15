-- Portfolio: cumulative randomized as % of the protocol plan, by trial and month since FPI.
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = trial_site_selection
SELECT trial_id, CAST(month_start AS STRING) AS month_start, month_number,
       CAST(cum_randomized AS BIGINT) AS cum_randomized, CAST(planned_cum_randomized AS BIGINT) AS planned_cum_randomized,
       CAST(ROUND(100 * cum_randomized / NULLIF(planned_cum_randomized, 0), 1) AS DOUBLE) AS pct_of_plan
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_trial_enrollment_monthly')
WHERE month_number >= 2
ORDER BY trial_id, month_start
