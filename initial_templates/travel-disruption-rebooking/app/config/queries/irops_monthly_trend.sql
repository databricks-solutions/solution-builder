-- Monthly same-day re-accommodation rate, cost per disrupted passenger and NPS by handling method (all hubs).
-- @param catalog STRING = retail_consumer_goods
-- @param schema STRING = travel_disruption_copilot
SELECT CAST(DATE_TRUNC('MONTH', event_date) AS DATE) AS month, handling_method,
       COUNT(*) AS disrupted_pax,
       CAST(ROUND(100 * AVG(CAST(same_day_reaccommodated AS INT)), 1) AS DOUBLE) AS same_day_pct,
       CAST(ROUND(AVG(total_cost_usd), 0) AS DOUBLE) AS cost_per_pax,
       CAST(ROUND(100 * (AVG(CAST(promoter AS INT)) - AVG(CAST(detractor AS INT))), 1) AS DOUBLE) AS nps
FROM IDENTIFIER(:catalog || '.' || :schema || '.irops_history')
GROUP BY ALL
ORDER BY month, handling_method
