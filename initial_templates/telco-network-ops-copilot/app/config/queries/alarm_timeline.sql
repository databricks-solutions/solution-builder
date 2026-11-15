-- Alarms raised per 5 minutes over the last 4 hours: the storm router (most active alarms) vs the rest of the network.
-- @param catalog STRING = telecommunications
-- @param schema STRING = network_ops_copilot
WITH top AS (
  SELECT agg_router_id FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_alarms')
  WHERE is_active AND agg_router_id IS NOT NULL GROUP BY agg_router_id ORDER BY count(*) DESC LIMIT 1
), mx AS (SELECT max(raised_ts) AS m FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_alarms'))
SELECT date_format(window(a.raised_ts, '5 minutes').start, 'HH:mm') AS bucket,
       count_if(a.agg_router_id = (SELECT agg_router_id FROM top) OR a.node_type = 'core_router') AS storm_alarms,
       count_if(NOT (coalesce(a.agg_router_id, '') = (SELECT agg_router_id FROM top) OR a.node_type = 'core_router')) AS other_alarms,
       (SELECT agg_router_id FROM top) AS storm_router
FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_alarms') a, mx
WHERE a.raised_ts > mx.m - INTERVAL 4 HOURS
GROUP BY window(a.raised_ts, '5 minutes').start
ORDER BY bucket
