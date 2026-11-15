-- AutoProtect vs the DEN desk-priority pilot (Dec 2025 - Jan 2026): the case for priority re-accommodation.
-- @param catalog STRING = retail_consumer_goods
-- @param schema STRING = travel_disruption_copilot
SELECT handling_method,
       COUNT(DISTINCT event_id) AS events,
       COUNT(*) AS disrupted_pax,
       CAST(ROUND(100 * AVG(CAST(same_day_reaccommodated AS INT)), 1) AS DOUBLE) AS same_day_pct,
       CAST(ROUND(100 * AVG(CASE WHEN special_assistance OR unaccompanied_minor OR lap_infant THEN CAST(overnight AS INT) END), 1) AS DOUBLE) AS ssr_overnight_pct,
       CAST(ROUND(100 * SUM(CAST(misconnect AS INT)) / NULLIF(SUM(CAST(onward_long_haul AS INT)), 0), 1) AS DOUBLE) AS misconnect_pct,
       CAST(ROUND(100 * AVG(CAST(party_split AS INT)), 1) AS DOUBLE) AS split_pct,
       CAST(ROUND(AVG(total_cost_usd), 0) AS DOUBLE) AS cost_per_pax,
       CAST(ROUND(100 * (AVG(CAST(promoter AS INT)) - AVG(CAST(detractor AS INT))), 1) AS DOUBLE) AS nps
FROM IDENTIFIER(:catalog || '.' || :schema || '.irops_history')
WHERE event_date >= '2025-12-01'
GROUP BY handling_method
ORDER BY handling_method
