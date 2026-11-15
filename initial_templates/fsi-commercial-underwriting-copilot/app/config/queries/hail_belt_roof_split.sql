-- Hail-belt habitational loss ratio by roof band vs the rest of the book, per accident quarter.
-- @param catalog STRING = financial_services
-- @param schema STRING = commercial_underwriting_copilot
SELECT quarter,
       CASE WHEN portfolio_cell = 'Habitational · Hail belt' THEN roof_band ELSE 'Rest of book' END AS portfolio_cell,
       ROUND(SUM(earned_premium), 0) AS earned_premium,
       ROUND(SUM(incurred), 0) AS incurred,
       ROUND(SUM(incurred) / SUM(earned_premium), 4) AS loss_ratio
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_portfolio_quarterly')
GROUP BY ALL
ORDER BY portfolio_cell, quarter
