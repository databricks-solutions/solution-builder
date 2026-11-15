-- Headline SOC numbers for the home page: identity-incident MTTD, alert volume and true-positive rate.
-- @param catalog STRING = cybersecurity
-- @param schema STRING = threat_hunting_copilot
SELECT
  (SELECT round(avg((unix_timestamp(detected_ts) - unix_timestamp(first_malicious_ts)) / 86400), 1)
     FROM IDENTIFIER(:catalog || '.' || :schema || '.incidents') WHERE category IN ('credential_compromise', 'data_mishandling')) AS mttd_days_identity,
  (SELECT count(*) FROM IDENTIFIER(:catalog || '.' || :schema || '.siem_alerts')) AS alerts_90d,
  (SELECT round(100 * avg(IF(disposition = 'true_positive', 1, 0)), 1)
     FROM IDENTIFIER(:catalog || '.' || :schema || '.siem_alerts') WHERE disposition <> 'open') AS tp_rate_pct
