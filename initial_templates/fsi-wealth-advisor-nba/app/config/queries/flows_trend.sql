-- @param catalog STRING = financial_services
-- @param schema STRING = wealth_advisor_nba
SELECT date_format(month, 'yyyy-MM') AS month, round(sum(sweep_cash) / 1e6, 1) AS sweep_cash_m,
       round(sum(external_outflows) / 1e6, 1) AS outflows_m
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_flows_monthly')
GROUP BY 1 ORDER BY 1
