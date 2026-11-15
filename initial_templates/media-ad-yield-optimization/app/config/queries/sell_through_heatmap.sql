-- Sell-through by daypart x property (platform), last 28 days: sold impressions / avails.
-- @param catalog STRING = media_advertising
-- @param schema STRING = ad_yield_optimization
SELECT daypart,
       platform,
       CAST(ROUND(SUM(sold_impressions) / NULLIF(SUM(avails), 0), 4) AS DOUBLE) AS sell_through,
       CAST(SUM(avails) AS DOUBLE) AS avails
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_inventory_daily')
WHERE inventory_date >= date_sub(current_date(), 28)
GROUP BY daypart, platform
ORDER BY daypart, platform
