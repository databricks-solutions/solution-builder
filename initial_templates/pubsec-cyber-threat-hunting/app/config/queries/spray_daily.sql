-- Failed passwords per day: hosting / VPS networks (the spray) vs everything else, with distinct accounts hit.
-- @param catalog STRING = cybersecurity
-- @param schema STRING = threat_hunting_copilot
SELECT CAST(date(event_ts) AS STRING) AS day,
       count_if(asn_org LIKE '%Hosting%') AS hosting_failures,
       count(DISTINCT IF(asn_org LIKE '%Hosting%', user_id, NULL)) AS hosting_accounts,
       count_if(asn_org NOT LIKE '%Hosting%') AS other_failures
FROM IDENTIFIER(:catalog || '.' || :schema || '.auth_logs')
WHERE failure_reason = 'invalid_password'
  AND event_ts >= (SELECT max(event_ts) FROM IDENTIFIER(:catalog || '.' || :schema || '.auth_logs')) - INTERVAL 45 DAYS
GROUP BY 1 ORDER BY 1
