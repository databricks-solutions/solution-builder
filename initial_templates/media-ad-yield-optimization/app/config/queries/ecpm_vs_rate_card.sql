-- Programmatic products, last 28 days: programmatic eCPM as a share of rate card, with the floor group in force.
-- @param catalog STRING = media_advertising
-- @param schema STRING = ad_yield_optimization
SELECT product_name, tier, CAST(rate_card_cpm AS DOUBLE) AS rate_card_cpm, CAST(programmatic_ecpm_28d AS DOUBLE) AS programmatic_ecpm,
       CAST(open_clearing_cpm_28d AS DOUBLE) AS open_clearing, current_inventory_group, group_mismatch,
       CAST(ROUND(programmatic_ecpm_28d / rate_card_cpm, 3) AS DOUBLE) AS pct_of_rate_card
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_yield_opportunities')
ORDER BY pct_of_rate_card
