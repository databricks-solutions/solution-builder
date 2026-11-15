-- @param catalog STRING = financial_services
-- @param schema STRING = wealth_advisor_nba
SELECT CASE WHEN targeted THEN response_speed ELSE 'Generic annual review' END AS approach,
       sum(offers) AS offers, round(100.0 * sum(accepted) / sum(offers), 1) AS conversion_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_nba_conversion')
GROUP BY 1 ORDER BY CASE approach WHEN '< 14 days' THEN 1 WHEN '14-44 days' THEN 2 WHEN '45+ days' THEN 3 ELSE 4 END
