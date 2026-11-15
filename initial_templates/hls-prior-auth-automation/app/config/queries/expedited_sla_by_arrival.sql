-- Expedited (72h) SLA compliance by arrival window x intake channel — the
-- weekend-fax backlog signal. Tables via IDENTIFIER(:catalog.:schema).
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = prior_auth_automation
SELECT
  CASE WHEN dayofweek(received_ts) IN (1, 7) OR (dayofweek(received_ts) = 6 AND hour(received_ts) >= 15)
       THEN 'Fri 3pm - Sun' ELSE 'Weekday' END AS arrival_window,
  channel,
  concat(CASE WHEN dayofweek(received_ts) IN (1, 7) OR (dayofweek(received_ts) = 6 AND hour(received_ts) >= 15)
       THEN 'Weekend' ELSE 'Weekday' END, ' · ', channel) AS segment,
  count(*) AS requests,
  round(100 * avg(CASE WHEN sla_met THEN 1 ELSE 0 END), 1) AS sla_pct,
  round(percentile(turnaround_hours, 0.5), 1) AS median_tat_h
FROM IDENTIFIER(:catalog || '.' || :schema || '.pa_requests')
WHERE urgency = 'Expedited' AND final_outcome IN ('Approved', 'Denied')
GROUP BY ALL
ORDER BY arrival_window DESC, channel
