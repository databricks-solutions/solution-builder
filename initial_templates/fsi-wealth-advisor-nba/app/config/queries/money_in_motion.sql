-- @param catalog STRING = financial_services
-- @param schema STRING = wealth_advisor_nba
SELECT signal_type, count(DISTINCT household_id) AS households, round(sum(amount) / 1e6, 1) AS amount_m
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_household_signals')
WHERE signal_type NOT IN ('Death of spouse', 'New grandchild', 'External outflow')
GROUP BY signal_type ORDER BY amount_m DESC
