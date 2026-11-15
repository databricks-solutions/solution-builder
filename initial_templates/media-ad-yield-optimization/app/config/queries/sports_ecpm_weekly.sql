-- Crest+ Live Sports: programmatic eCPM vs open-auction clearing price vs rate card, weekly, last 26 full weeks.
-- @param catalog STRING = media_advertising
-- @param schema STRING = ad_yield_optimization
SELECT CAST(week_start AS STRING) AS week,
       CAST(ROUND(1000 * SUM(programmatic_revenue) / NULLIF(SUM(programmatic_impressions), 0), 2) AS DOUBLE) AS programmatic_ecpm,
       CAST(ROUND(1000 * SUM(open_auction_revenue) / NULLIF(SUM(open_auction_impressions), 0), 2) AS DOUBLE) AS open_clearing,
       CAST(MAX(rate_card_cpm) AS DOUBLE) AS rate_card,
       MAX_BY(inventory_group, inventory_date) AS inventory_group
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_inventory_daily')
WHERE product_id = 'STR-SPORTS-LIVE'
  AND week_start >= date_sub(date_trunc('WEEK', current_date()), 7 * 26) AND week_start < date_trunc('WEEK', current_date())
GROUP BY week_start ORDER BY week_start
