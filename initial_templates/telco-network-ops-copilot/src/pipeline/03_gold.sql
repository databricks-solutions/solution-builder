-- Gold — the NOC's operational views (dashboard, Genie, the anomaly model and the NOC Copilot app).

CREATE OR REFRESH MATERIALIZED VIEW gold_cell_kpi_daily
COMMENT 'Daily KPIs per cell: availability, call volume, dropped-call rate (dropped / calls), RRC setup success, SINR, max VSWR, uplink interference, PRB utilization. Feeds the KPI anomaly model.'
AS SELECT
  cell_id, site_id, sector, to_date(ts) AS day,
  round(avg(availability_pct), 2) AS availability_pct,
  sum(voice_calls) AS voice_calls,
  sum(dropped_calls) AS dropped_calls,
  round(100 * sum(dropped_calls) / nullif(sum(voice_calls), 0), 3) AS drop_call_rate_pct,
  round(avg(rrc_setup_success_pct), 3) AS rrc_setup_success_pct,
  round(avg(avg_sinr_db), 2) AS avg_sinr_db,
  round(max(vswr), 3) AS max_vswr,
  round(avg(ul_interference_dbm), 1) AS ul_interference_dbm,
  round(avg(prb_utilization_pct), 1) AS prb_utilization_pct,
  round(max(prb_utilization_pct), 1) AS peak_prb_utilization_pct,
  round(sum(data_volume_gb), 1) AS data_volume_gb,
  count(*) AS hours_reported
FROM silver_ran_kpis
GROUP BY cell_id, site_id, sector, to_date(ts);

CREATE OR REFRESH MATERIALIZED VIEW gold_site_status
COMMENT 'Current state of every cell site at the latest reported hour: is_down (availability < 50%), active alarms, subscribers served, aggregation router, backhaul.'
AS WITH latest AS (SELECT max(ts) AS ts FROM silver_ran_kpis),
k AS (
  SELECT site_id, round(avg(availability_pct), 1) AS availability_pct
  FROM silver_ran_kpis WHERE ts = (SELECT ts FROM latest) GROUP BY site_id
),
a AS (
  SELECT site_id, count(*) AS active_alarms, count_if(severity = 'critical') AS active_critical_alarms, min(raised_ts) AS first_active_alarm_ts
  FROM silver_alarms WHERE is_active AND site_id IS NOT NULL GROUP BY site_id
)
SELECT s.site_id, s.site_name, s.market, s.city, s.agg_router_id, s.backhaul_type, s.subscribers_served, s.critical_facility,
       (SELECT ts FROM latest) AS as_of_ts, k.availability_pct, coalesce(k.availability_pct, 100) < 50 AS is_down,
       coalesce(a.active_alarms, 0) AS active_alarms, coalesce(a.active_critical_alarms, 0) AS active_critical_alarms, a.first_active_alarm_ts
FROM ${catalog}.${schema}.cell_sites s
LEFT JOIN k ON k.site_id = s.site_id
LEFT JOIN a ON a.site_id = s.site_id;

CREATE OR REFRESH MATERIALIZED VIEW gold_alarm_windows
COMMENT 'Alarm-storm detector input: major/critical alarms per aggregation router per 15-minute window, with the number of distinct cell sites alarming.'
AS SELECT
  agg_router_id, market, window(raised_ts, '15 minutes').start AS window_start,
  count(*) AS alarms, count(DISTINCT site_id) AS sites_alarming, count_if(severity = 'critical') AS critical_alarms,
  count_if(node_type <> 'cell_site') AS transport_alarms
FROM silver_alarms
WHERE severity IN ('critical', 'major') AND agg_router_id IS NOT NULL
GROUP BY agg_router_id, market, window(raised_ts, '15 minutes').start;

CREATE OR REFRESH MATERIALIZED VIEW gold_network_hourly
COMMENT 'Network health per market per hour: availability, dropped-call rate, traffic, sites down, alarms raised.'
AS WITH k AS (
  SELECT s.market, r.ts, round(avg(r.availability_pct), 3) AS availability_pct,
         round(100 * sum(r.dropped_calls) / nullif(sum(r.voice_calls), 0), 3) AS drop_call_rate_pct,
         sum(r.voice_calls) AS voice_calls, round(sum(r.data_volume_gb), 1) AS data_volume_gb,
         count(DISTINCT CASE WHEN r.availability_pct < 50 THEN r.site_id END) AS sites_down
  FROM silver_ran_kpis r JOIN ${catalog}.${schema}.cell_sites s ON s.site_id = r.site_id
  GROUP BY s.market, r.ts
),
a AS (
  SELECT market, date_trunc('HOUR', raised_ts) AS ts, count(*) AS alarms_raised, count_if(severity IN ('critical', 'major')) AS major_critical_alarms
  FROM silver_alarms WHERE market IS NOT NULL GROUP BY ALL
)
SELECT k.*, coalesce(a.alarms_raised, 0) AS alarms_raised, coalesce(a.major_critical_alarms, 0) AS major_critical_alarms
FROM k LEFT JOIN a ON a.market = k.market AND a.ts = k.ts;
