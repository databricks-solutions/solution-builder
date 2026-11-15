-- Weekly PA volume, SLA compliance, median turnaround and auto-approval rate.
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = prior_auth_automation
SELECT
  date_format(date_trunc('WEEK', received_ts), 'yyyy-MM-dd') AS week,
  count(*) AS requests,
  round(100 * avg(CASE WHEN sla_met THEN 1 WHEN sla_met = false THEN 0 END), 1) AS sla_pct,
  round(percentile(turnaround_hours, 0.5), 1) AS median_tat_h,
  round(100 * count_if(decided_by_role = 'Automation') / nullif(count_if(final_outcome IN ('Approved', 'Denied')), 0), 1) AS auto_approval_pct,
  round(100 * avg(CASE WHEN criteria_met_on_first_review THEN 1 WHEN criteria_met_on_first_review = false THEN 0 END), 1) AS first_pass_clean_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.pa_requests')
WHERE final_outcome <> 'Open' AND received_ts < (SELECT max(as_of_ts) - INTERVAL 7 DAYS FROM IDENTIFIER(:catalog || '.' || :schema || '.snapshot_info'))
GROUP BY ALL
HAVING count(*) >= 100  -- drop the partial first week
ORDER BY week
