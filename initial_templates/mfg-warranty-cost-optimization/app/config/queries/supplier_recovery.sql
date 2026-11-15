-- Supplier cost recovery over the last 4 settled quarters: attributable warranty cost vs recovered.
-- @param catalog STRING = manufacturing
-- @param schema STRING = warranty_copilot
SELECT supplier_name, ROUND(SUM(supplier_attributable_cost), 0) AS attributable_cost, ROUND(SUM(submitted_amount), 0) AS submitted,
       ROUND(SUM(recovered_amount), 0) AS recovered,
       ROUND(100 * SUM(recovered_amount) / NULLIF(SUM(supplier_attributable_cost), 0), 1) AS recovery_rate_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_supplier_recovery')
WHERE status = 'settled' AND quarter >= concat(year(add_months(current_date(), -12)), '-Q', quarter(add_months(current_date(), -12)))
GROUP BY supplier_name ORDER BY attributable_cost DESC
