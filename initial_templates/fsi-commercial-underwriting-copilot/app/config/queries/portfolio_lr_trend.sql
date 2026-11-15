-- Accident-quarter loss ratio by portfolio cell (hail-belt habitational split out), 2024-Q3 .. 2026-Q2.
-- @param catalog STRING = financial_services
-- @param schema STRING = commercial_underwriting_copilot
SELECT quarter, portfolio_cell,
       ROUND(SUM(earned_premium), 0) AS earned_premium,
       ROUND(SUM(incurred), 0) AS incurred,
       ROUND(SUM(incurred) / SUM(earned_premium), 4) AS loss_ratio
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_portfolio_quarterly')
GROUP BY quarter, portfolio_cell
ORDER BY portfolio_cell, quarter
