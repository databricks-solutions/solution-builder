-- Monthly SNAP 30-day timeliness (% of determinations on time), Tamarack vs the rest of the state.
-- @param catalog STRING = public_sector
-- @param schema STRING = eligibility_copilot
SELECT determination_month AS month,
       CAST(ROUND(100 * AVG(CASE WHEN county_name = 'Tamarack' THEN CAST(met_timeliness AS INT) END), 1) AS DOUBLE) AS tamarack_on_time_pct,
       CAST(ROUND(100 * AVG(CASE WHEN county_name <> 'Tamarack' THEN CAST(met_timeliness AS INT) END), 1) AS DOUBLE) AS rest_of_state_on_time_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_applications')
WHERE is_determined AND program = 'SNAP'
  AND determination_month >= add_months(date_trunc('MONTH', current_date()), -9)
  AND determination_month < date_trunc('MONTH', current_date())
GROUP BY determination_month
ORDER BY month
