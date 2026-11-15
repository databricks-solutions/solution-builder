-- Headline network numbers for the home page: sites down now, subscribers on them, alarms in the last 24 h, silent degradations.
-- @param catalog STRING = telecommunications
-- @param schema STRING = network_ops_copilot
SELECT
  (SELECT count_if(is_down) FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_site_status')) AS sites_down,
  (SELECT count(*) FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_site_status')) AS sites_total,
  (SELECT sum(IF(is_down, subscribers_served, 0)) FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_site_status')) AS subscribers_down,
  (SELECT count(*) FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_alarms')
     WHERE raised_ts > (SELECT max(raised_ts) FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_alarms')) - INTERVAL 24 HOURS) AS alarms_24h,
  (SELECT CAST(max(as_of_ts) AS STRING) FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_site_status')) AS as_of
