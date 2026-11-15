-- Weekly impressions per title: Harborlight re-tagged in the July pilot vs Harborlight not re-tagged vs the rest of the library.
-- @param catalog STRING = media_advertising
-- @param schema STRING = content_metadata_copilot
SELECT CAST(week_start AS STRING) AS week,
       CAST(ROUND(SUM(CASE WHEN library_group = 'Harborlight - re-tagged in pilot' THEN impressions END)
             / COUNT(DISTINCT CASE WHEN library_group = 'Harborlight - re-tagged in pilot' THEN title_id END)) AS DOUBLE) AS pilot_retagged,
       CAST(ROUND(SUM(CASE WHEN library_group = 'Harborlight - not re-tagged' THEN impressions END)
             / COUNT(DISTINCT CASE WHEN library_group = 'Harborlight - not re-tagged' THEN title_id END)) AS DOUBLE) AS harborlight_not_retagged,
       CAST(ROUND(SUM(CASE WHEN library_group = 'Rest of library' THEN impressions END)
             / COUNT(DISTINCT CASE WHEN library_group = 'Rest of library' THEN title_id END)) AS DOUBLE) AS rest_of_library
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_title_weekly')
WHERE week_start >= DATE'2026-04-13'
GROUP BY week_start
ORDER BY week_start
