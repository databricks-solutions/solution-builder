-- Bronze — raw network telemetry, ingested incrementally with Auto Loader (read_files in STREAM mode)
-- from the UC volume landing zone /Volumes/${catalog}/${schema}/raw_telemetry/<feed>/ (gzipped JSON).
-- In production the same tables are fed by Zerobus / Kafka from the OSS/NMS; the rest of the pipeline is unchanged.

CREATE OR REFRESH STREAMING TABLE bronze_ran_kpis
COMMENT 'Raw hourly per-cell RAN performance counters (as received from the OSS PM export)'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/${catalog}/${schema}/raw_telemetry/ran_kpis/', format => 'json',
  schemaHints => 'cell_id STRING, site_id STRING, sector STRING, ts STRING, availability_pct DOUBLE, voice_calls BIGINT, dropped_calls BIGINT, drop_call_rate_pct DOUBLE, rrc_setup_success_pct DOUBLE, avg_sinr_db DOUBLE, avg_rsrp_dbm DOUBLE, vswr DOUBLE, ul_interference_dbm DOUBLE, prb_utilization_pct DOUBLE, data_volume_gb DOUBLE, active_users BIGINT');

CREATE OR REFRESH STREAMING TABLE bronze_alarms
COMMENT 'Raw alarm events from the RAN and transport NMS (one record per alarm, cleared_ts null while active)'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/${catalog}/${schema}/raw_telemetry/alarms/', format => 'json',
  schemaHints => 'alarm_id STRING, raised_ts STRING, cleared_ts STRING, node_type STRING, node_id STRING, site_id STRING, cell_id STRING, interface STRING, alarm_code STRING, alarm_name STRING, severity STRING, probable_cause STRING, acknowledged_by STRING, additional_text STRING');

CREATE OR REFRESH STREAMING TABLE bronze_optics
COMMENT 'Raw 15-minute optical / interface counters of every backhaul port (rx/tx power, utilization, CRC errors)'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/${catalog}/${schema}/raw_telemetry/optics/', format => 'json',
  schemaHints => 'node_id STRING, interface STRING, link_id STRING, ts STRING, rx_power_dbm DOUBLE, tx_power_dbm DOUBLE, utilization_pct DOUBLE, crc_errors BIGINT, oper_status STRING');
