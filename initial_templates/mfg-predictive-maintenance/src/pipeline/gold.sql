-- TechRobotics PdM — GOLD layer (views + metric view). Executed by src/pipeline/build_gold.py
-- with ${catalog} / ${schema} substituted. Idempotent (CREATE OR REPLACE).

-- 1) OEE per line per day (Availability x Performance x Quality)
CREATE OR REPLACE VIEW `${catalog}`.`${schema}`.oee_daily
COMMENT 'OEE per production line per day: availability x performance x quality, plus unplanned/planned downtime hours.'
AS SELECT
  production_date,
  line,
  count(DISTINCT asset_id)                                                       AS assets,
  round(sum(run_time_min) / nullif(sum(planned_production_min - planned_downtime_min), 0), 4) AS availability,
  round(sum(total_units * ideal_cycle_time_sec / 60.0) / nullif(sum(run_time_min), 0), 4)    AS performance,
  round(sum(good_units) / nullif(sum(total_units), 0), 4)                                   AS quality,
  round((sum(run_time_min) / nullif(sum(planned_production_min - planned_downtime_min), 0))
      * (sum(total_units * ideal_cycle_time_sec / 60.0) / nullif(sum(run_time_min), 0))
      * (sum(good_units) / nullif(sum(total_units), 0)), 4)                                 AS oee,
  round(sum(unplanned_downtime_min) / 60.0, 1)                                              AS unplanned_downtime_hours,
  round(sum(planned_downtime_min) / 60.0, 1)                                                AS planned_downtime_hours,
  sum(total_units)                                                                          AS total_units,
  sum(good_units)                                                                           AS good_units
FROM `${catalog}`.`${schema}`.production_daily
GROUP BY production_date, line;

-- 2) Reliability per asset over the last 12 months (MTBF / MTTR / cost)
CREATE OR REPLACE VIEW `${catalog}`.`${schema}`.asset_reliability_12m
COMMENT 'Per-asset reliability over the trailing 12 months: failures, MTBF hours (run time / failures), MTTR hours, unplanned downtime cost.'
AS WITH run AS (
  -- operating hours from telemetry (1 reading per hour, RUNNING state) — covers utilities too
  SELECT asset_id, count(*) AS run_hours
  FROM `${catalog}`.`${schema}`.sensor_readings
  WHERE machine_state = 'RUNNING' AND reading_ts >= current_timestamp() - INTERVAL 365 DAYS
  GROUP BY asset_id
), f AS (
  SELECT asset_id, count(*) AS failures, avg(downtime_hours) AS mttr_hours,
         sum(downtime_hours) AS downtime_hours, sum(total_cost_usd) AS failure_cost_usd
  FROM `${catalog}`.`${schema}`.failure_events
  WHERE failure_ts >= current_timestamp() - INTERVAL 365 DAYS
  GROUP BY asset_id
)
SELECT a.asset_id, a.asset_name, a.asset_type, a.line, a.criticality,
       coalesce(f.failures, 0)                                        AS failures_12m,
       round(r.run_hours / greatest(coalesce(f.failures, 0), 1), 0)   AS mtbf_hours,
       round(f.mttr_hours, 1)                                         AS mttr_hours,
       round(coalesce(f.downtime_hours, 0), 1)                        AS unplanned_downtime_hours_12m,
       round(coalesce(f.failure_cost_usd, 0), 0)                      AS failure_cost_usd_12m
FROM `${catalog}`.`${schema}`.assets a
LEFT JOIN run r USING (asset_id)
LEFT JOIN f USING (asset_id);

-- 3) Fleet health right now: registry + ML risk + last PM + last-24h condition
CREATE OR REPLACE VIEW `${catalog}`.`${schema}`.asset_health_current
COMMENT 'One row per asset: ML failure risk (asset_risk_scores), last preventive maintenance (vendor + lubricant), last-24h sensor averages, downtime cost per hour.'
AS WITH last_pm AS (
  SELECT asset_id, scheduled_ts AS last_pm_ts, vendor AS last_pm_vendor, lubricant_used AS last_pm_lubricant,
         work_order_id AS last_pm_work_order
  FROM `${catalog}`.`${schema}`.maintenance_work_orders
  WHERE work_type = 'Preventive'
  QUALIFY row_number() OVER (PARTITION BY asset_id ORDER BY scheduled_ts DESC) = 1
), s24 AS (
  SELECT asset_id,
         round(avg(vibration_rms_mm_s), 2) AS vibration_24h_mm_s,
         round(avg(temperature_c), 1)      AS temperature_24h_c,
         round(avg(pressure_bar), 2)       AS pressure_24h_bar,
         round(avg(motor_current_a), 1)    AS current_24h_a
  FROM `${catalog}`.`${schema}`.sensor_readings
  WHERE machine_state = 'RUNNING'
    AND reading_ts >= (SELECT max(reading_ts) FROM `${catalog}`.`${schema}`.sensor_readings) - INTERVAL 24 HOURS
  GROUP BY asset_id
)
SELECT a.asset_id, a.asset_name, a.asset_type, a.manufacturer, a.model, a.line, a.cell, a.criticality,
       a.is_bottleneck, a.downtime_cost_per_hour,
       r.risk_score, r.risk_tier, r.failure_prob_7d, r.predicted_failure_mode, r.est_days_to_failure,
       r.downtime_cost_at_risk_usd, r.unplanned_failure_cost_usd,
       r.top_driver_1, r.top_driver_2, r.top_driver_3, r.vib_ratio, r.temp_delta_c, r.pressure_ratio,
       p.last_pm_ts, p.last_pm_vendor, p.last_pm_lubricant, p.last_pm_work_order,
       s.vibration_24h_mm_s, s.temperature_24h_c, s.pressure_24h_bar, s.current_24h_a
FROM `${catalog}`.`${schema}`.assets a
LEFT JOIN `${catalog}`.`${schema}`.asset_risk_scores r USING (asset_id)
LEFT JOIN last_pm p USING (asset_id)
LEFT JOIN s24 s USING (asset_id);

-- 4) Governed plant KPIs (UC metric view) — used by Genie + the dashboard
CREATE OR REPLACE VIEW `${catalog}`.`${schema}`.plant_performance_metrics
WITH METRICS
LANGUAGE YAML
COMMENT 'Governed plant KPIs: OEE and its components, unplanned vs planned downtime, output — sliceable by line, asset type, asset, date.'
AS $$
version: 1.1
source: ${catalog}.${schema}.production_daily
joins:
  - name: asset
    source: ${catalog}.${schema}.assets
    on: source.asset_id = asset.asset_id
dimensions:
  - name: production_date
    expr: production_date
  - name: production_week
    expr: date_trunc('WEEK', production_date)
  - name: line
    expr: source.line
  - name: asset_id
    expr: source.asset_id
  - name: asset_type
    expr: asset.asset_type
  - name: criticality
    expr: asset.criticality
measures:
  - name: availability
    expr: sum(run_time_min) / sum(planned_production_min - planned_downtime_min)
  - name: performance
    expr: sum(total_units * ideal_cycle_time_sec / 60.0) / sum(run_time_min)
  - name: quality
    expr: sum(good_units) / sum(total_units)
  - name: oee
    expr: (sum(run_time_min) / sum(planned_production_min - planned_downtime_min)) * (sum(total_units * ideal_cycle_time_sec / 60.0) / sum(run_time_min)) * (sum(good_units) / sum(total_units))
  - name: unplanned_downtime_hours
    expr: sum(unplanned_downtime_min) / 60.0
  - name: planned_downtime_hours
    expr: sum(planned_downtime_min) / 60.0
  - name: good_units
    expr: sum(good_units)
  - name: scrap_units
    expr: sum(total_units - good_units)
$$;
