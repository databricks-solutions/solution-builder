-- Metadata completeness band vs discovery (impressions per title) and quality (completion rate), last 4 complete weeks.
-- @param catalog STRING = media_advertising
-- @param schema STRING = content_metadata_copilot
SELECT completeness_band,
       COUNT(*) AS titles,
       CAST(ROUND(AVG(impressions_4w)) AS DOUBLE) AS impressions_per_title,
       CAST(ROUND(100 * SUM(completions_4w) / NULLIF(SUM(play_starts_4w), 0), 1) AS DOUBLE) AS completion_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_title_scorecard')
GROUP BY completeness_band
ORDER BY completeness_band
