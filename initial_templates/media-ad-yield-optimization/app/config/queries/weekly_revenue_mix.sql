-- Weekly ad revenue by sales channel (guaranteed IOs / PMP deals / open auction), last 26 full weeks.
-- @param catalog STRING = media_advertising
-- @param schema STRING = ad_yield_optimization
SELECT CAST(week_start AS STRING) AS week,
       CAST(SUM(guaranteed_revenue) AS DOUBLE) AS guaranteed, CAST(SUM(pmp_revenue) AS DOUBLE) AS pmp,
       CAST(SUM(open_auction_revenue) AS DOUBLE) AS open_auction,
       CAST(ROUND(SUM(sold_impressions) / SUM(avails), 4) AS DOUBLE) AS sell_through
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_inventory_daily')
WHERE week_start >= date_sub(date_trunc('WEEK', current_date()), 7 * 26) AND week_start < date_trunc('WEEK', current_date())
GROUP BY week_start ORDER BY week_start
