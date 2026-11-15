-- Share of HRRP-condition discharges leaving with a 7-day follow-up booked, by discharge weekday (last 26 weeks):
-- 4 West heart failure vs every other unit / condition.
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = readmission_reduction
SELECT discharge_dow,
       CAST(ROUND(100 * AVG(CASE WHEN unit_id = 'LRMC-4W' AND hrrp_condition = 'HF' THEN CAST(followup_7d_scheduled AS INT) END), 1) AS DOUBLE) AS four_west_hf_pct,
       CAST(ROUND(100 * AVG(CASE WHEN NOT (unit_id = 'LRMC-4W' AND hrrp_condition = 'HF') THEN CAST(followup_7d_scheduled AS INT) END), 1) AS DOUBLE) AS rest_of_system_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_discharges')
WHERE outcome_window_closed AND status = 'discharged' AND is_hrrp_condition AND last_26_weeks
GROUP BY discharge_dow
ORDER BY CASE discharge_dow WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2 WHEN 'Wed' THEN 3 WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5 WHEN 'Sat' THEN 6 ELSE 7 END
