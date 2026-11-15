-- Hanlin MC-48 controller lots: water-ingress claims per 1,000 bike-years, E21 telemetry per 1,000 connected bikes, PCN.
-- @param catalog STRING = manufacturing
-- @param schema STRING = warranty_copilot
SELECT controller_lot, units_built, units_sold, water_ingress_claims,
       CAST(water_claims_per_1k_unit_years AS DOUBLE) AS water_claims_per_1k_unit_years,
       CAST(e21_bikes_per_1k_connected AS DOUBLE) AS e21_bikes_per_1k_connected,
       coalesce(pcn_reference, '') AS pcn_reference, ppap_status
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_lot_quality')
WHERE supplier_id = 'SUP-HAN' AND production_start >= add_months(current_date(), -14)
ORDER BY controller_lot
