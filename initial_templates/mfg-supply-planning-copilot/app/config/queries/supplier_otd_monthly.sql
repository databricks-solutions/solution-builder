-- Supplier on-time delivery by month of receipt (last 12 months), strategic suppliers.
-- @param catalog STRING = manufacturing
-- @param schema STRING = supply_planning_copilot
SELECT CAST(month AS STRING) AS month, supplier_name, CAST(on_time_pct AS DOUBLE) AS on_time_pct,
       CAST(avg_days_late AS DOUBLE) AS avg_days_late, pos_received
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_supplier_performance_monthly')
WHERE supplier_name IN ('Nanhai Precision Castings', 'Kessler Sensorik GmbH', 'Brightline Electronics', 'Voltara Motor Components')
  AND month >= add_months(date_trunc('MONTH', current_date()), -11)
ORDER BY month, supplier_name
