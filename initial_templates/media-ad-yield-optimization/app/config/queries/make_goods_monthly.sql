-- Make-goods issued per month over the last 18 months (value at the booked CPM).
-- @param catalog STRING = media_advertising
-- @param schema STRING = ad_yield_optimization
SELECT CAST(issued_month AS STRING) AS month, COUNT(*) AS make_goods, CAST(SUM(make_good_value) AS DOUBLE) AS value
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_make_goods')
WHERE issued_date >= add_months(current_date(), -18)
GROUP BY issued_month ORDER BY issued_month
