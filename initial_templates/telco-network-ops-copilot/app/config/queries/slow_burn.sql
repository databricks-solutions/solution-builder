-- Daily dropped-call rate + VSWR for the 3 sectors of the site whose cell drifted the most (KPI anomaly model), 21 days.
-- @param catalog STRING = telecommunications
-- @param schema STRING = network_ops_copilot
WITH top AS (
  SELECT site_id, cell_id FROM IDENTIFIER(:catalog || '.' || :schema || '.cell_health_daily') WHERE is_anomaly
  GROUP BY site_id, cell_id ORDER BY max(drop_call_rate_pct - baseline_drop_call_rate_pct) DESC LIMIT 1
)
SELECT CAST(k.day AS STRING) AS day, k.sector, k.cell_id, k.drop_call_rate_pct, k.max_vswr, (SELECT cell_id FROM top) AS flagged_cell
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_cell_kpi_daily') k
WHERE k.site_id = (SELECT site_id FROM top)
  AND k.day > (SELECT max(day) FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_cell_kpi_daily')) - 21
ORDER BY day, sector
