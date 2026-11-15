-- Silver — typed, validated, topology-enriched telemetry. Expectations drop corrupt counters.

CREATE OR REFRESH STREAMING TABLE silver_ran_kpis (
  CONSTRAINT valid_cell EXPECT (cell_id IS NOT NULL AND site_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT valid_availability EXPECT (availability_pct BETWEEN 0 AND 100) ON VIOLATION DROP ROW,
  CONSTRAINT valid_drop_rate EXPECT (drop_call_rate_pct IS NULL OR drop_call_rate_pct BETWEEN 0 AND 100)
)
COMMENT 'Hourly per-cell RAN KPIs (cell_id = <site_id>-<sector>). KPI columns are NULL while the cell is unavailable. ts = start of the hour, Mountain local time.'
AS SELECT
  cell_id, site_id, sector, to_timestamp(ts) AS ts,
  availability_pct, voice_calls, dropped_calls, drop_call_rate_pct, rrc_setup_success_pct,
  avg_sinr_db, avg_rsrp_dbm, vswr, ul_interference_dbm, prb_utilization_pct, data_volume_gb, active_users
FROM STREAM(bronze_ran_kpis);

CREATE OR REFRESH STREAMING TABLE silver_alarms (
  CONSTRAINT valid_alarm EXPECT (alarm_id IS NOT NULL AND raised_ts IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT valid_severity EXPECT (severity IN ('critical', 'major', 'minor', 'warning'))
)
COMMENT 'Alarm history with topology: each cell-site alarm carries its market and aggregation router. is_active = not cleared. raised_ts / cleared_ts are Mountain local time.'
AS SELECT
  a.alarm_id, to_timestamp(a.raised_ts) AS raised_ts, to_timestamp(a.cleared_ts) AS cleared_ts, a.cleared_ts IS NULL AS is_active,
  a.node_type, a.node_id, a.site_id, a.cell_id, a.interface, a.alarm_code, a.alarm_name, a.severity, a.probable_cause,
  a.acknowledged_by, a.additional_text,
  coalesce(s.market, n.market) AS market,
  CASE WHEN a.node_type = 'cell_site' THEN s.agg_router_id WHEN a.node_type = 'aggregation_router' THEN a.node_id END AS agg_router_id
FROM STREAM(bronze_alarms) a
LEFT JOIN ${catalog}.${schema}.cell_sites s ON a.site_id = s.site_id
LEFT JOIN ${catalog}.${schema}.transport_nodes n ON a.node_id = n.node_id;

CREATE OR REFRESH STREAMING TABLE silver_optics (
  CONSTRAINT valid_port EXPECT (node_id IS NOT NULL AND interface IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT '15-minute backhaul port counters. rx_power_dbm: healthy -3 to -12 dBm, warning below -18, receiver sensitivity -24 (-40 = no light / LOS).'
AS SELECT node_id, interface, link_id, to_timestamp(ts) AS ts, rx_power_dbm, tx_power_dbm, utilization_pct, crc_errors, oper_status
FROM STREAM(bronze_optics);
