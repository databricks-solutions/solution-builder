-- 12 months of trouble tickets: share with an early warning that was ignored (ai_classify on the resolution notes) and MTTR.
-- @param catalog STRING = telecommunications
-- @param schema STRING = network_ops_copilot
SELECT category, count(*) AS tickets,
       count_if(precursor = 'early warning ignored') AS early_warning_ignored,
       round(100 * count_if(precursor = 'early warning ignored') / count(*), 1) AS pct_warned,
       round(avg(mttr_hours), 1) AS avg_mttr_hours
FROM IDENTIFIER(:catalog || '.' || :schema || '.trouble_ticket_insights')
GROUP BY category ORDER BY pct_warned DESC
