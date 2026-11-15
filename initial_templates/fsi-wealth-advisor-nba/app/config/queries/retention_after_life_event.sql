-- @param catalog STRING = financial_services
-- @param schema STRING = wealth_advisor_nba
SELECT CASE WHEN advisor_contacted_within_30d THEN 'Advisor called within 30 days' ELSE 'Nobody called' END AS follow_up,
       count(*) AS events, round(100 * avg(assets_retained_pct), 1) AS assets_retained_pct,
       round(sum(outflows_6m) / 1e6, 1) AS outflows_m
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_life_event_retention')
GROUP BY 1 ORDER BY 1
