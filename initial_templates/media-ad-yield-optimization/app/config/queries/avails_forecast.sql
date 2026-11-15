-- Weekly avails, actual (last 10 weeks) and ai_forecast (next 6 weeks), for the two products in the story.
-- @param catalog STRING = media_advertising
-- @param schema STRING = ad_yield_optimization
SELECT product_id, CAST(week_start AS STRING) AS week, CAST(SUM(avails) AS DOUBLE) AS avails, 'actual' AS kind
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_inventory_daily')
WHERE product_id IN ('STR-SPORTS-LIVE', 'LIN-PRIME-DRAMA')
  AND week_start >= date_sub(date_trunc('WEEK', current_date()), 7 * 10) AND week_start < date_trunc('WEEK', current_date())
GROUP BY product_id, week_start
UNION ALL
SELECT product_id, CAST(date_trunc('WEEK', forecast_date) AS STRING) AS week, CAST(SUM(avails_forecast) AS DOUBLE) AS avails, 'forecast' AS kind
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_avails_forecast')
WHERE product_id IN ('STR-SPORTS-LIVE', 'LIN-PRIME-DRAMA')
  AND forecast_date >= date_trunc('WEEK', current_date()) AND forecast_date < date_add(date_trunc('WEEK', current_date()), 42)
GROUP BY product_id, date_trunc('WEEK', forecast_date)
ORDER BY product_id, week
