-- Site activation cycle time (selection → activation) by trial and IRB type.
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = trial_site_selection
SELECT trial_id, irb_type, CAST(COUNT(*) AS BIGINT) AS sites,
       CAST(PERCENTILE(cycle_time_days, 0.5) AS DOUBLE) AS median_days,
       CAST(ROUND(AVG(cycle_time_days), 0) AS DOUBLE) AS avg_days
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_site_performance')
WHERE cycle_time_days IS NOT NULL
GROUP BY trial_id, irb_type
ORDER BY trial_id, irb_type
