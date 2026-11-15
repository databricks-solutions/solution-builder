-- 30-day readmission rate by HRRP condition, last 26 weeks vs before (closed 30-day windows).
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = readmission_reduction
SELECT condition_label,
       CAST(ROUND(100 * COUNT_IF(readmitted_30d AND NOT last_26_weeks) / COUNT_IF(NOT last_26_weeks), 1) AS DOUBLE) AS before_pct,
       CAST(ROUND(100 * COUNT_IF(readmitted_30d AND last_26_weeks) / COUNT_IF(last_26_weeks), 1) AS DOUBLE) AS last_26w_pct,
       CAST(COUNT(*) AS BIGINT) AS discharges
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_discharges')
WHERE outcome_window_closed AND status = 'discharged'
GROUP BY condition_label
ORDER BY last_26w_pct DESC
