-- Estimated HRRP excess readmission ratio per hospital × condition (trailing 12 months vs last 6 months).
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = readmission_reduction
SELECT concat(hospital_id, ' · ', hrrp_condition) AS hospital_condition,
       CAST(err_estimate AS DOUBLE) AS err_12m,
       CAST(err_last_6m AS DOUBLE) AS err_last_6m,
       CAST(discharges AS BIGINT) AS discharges
FROM IDENTIFIER(:catalog || '.' || :schema || '.hrrp_performance')
ORDER BY err_12m DESC
