"""
Alarm correlation → the NOC incident queue (<catalog>.<schema>.noc_incidents).

Topology-aware, rule-based correlation over the last 24 h of major/critical alarms (silver_alarms, SDP pipeline):
  1. STORM: >= 10 distinct cell sites under ONE aggregation router alarming inside a 15-minute window
     (gold_alarm_windows) → one incident for the router: every alarm on its sites, on the router itself and on
     the far-end core ports of its links. Root cause NOT decided here — only "these sites share a parent".
  2. SITE: remaining major/critical alarms, grouped per cell site (power, backhaul, outage…).
  3. KPI ANOMALY: cells flagged by cell_kpi_anomaly_model (cell_health_daily.is_anomaly) on the last 2 days whose
     site has no alarm incident — degradations that never raised an alarm.
Each incident carries its blast radius: sites, subscribers served, enterprise accounts (SLA) and critical facilities.
The NOC Copilot app mirrors this table into Lakebase and its triage agent works each incident.

Also: AI Functions over 12 months of trouble-ticket resolution notes (ai_classify) → trouble_ticket_insights,
so the dashboard can show how many outages had an ignored early warning.

    python build_incident_queue.py --catalog telecommunications --schema network_ops_copilot
"""
import argparse

from pyspark.sql import SparkSession


def get_spark() -> SparkSession:
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="telecommunications")
    ap.add_argument("--schema", default="network_ops_copilot")
    ap.add_argument("--skip-ai", action="store_true")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()

    spark.sql(f"""
    CREATE OR REPLACE TABLE {fqs}.noc_incidents
    COMMENT 'Open NOC incident queue built by alarm correlation (storms under one aggregation router, per-site alarms) and the KPI anomaly model. One row per incident with its blast radius. Mirrored into the NOC Copilot app (Lakebase).'
    AS
    WITH now_ AS (SELECT greatest((SELECT max(raised_ts) FROM {fqs}.silver_alarms), (SELECT max(ts) FROM {fqs}.silver_optics)) AS t),
    recent AS (
      SELECT a.* FROM {fqs}.silver_alarms a, now_
      WHERE a.raised_ts > now_.t - INTERVAL 24 HOURS AND a.severity IN ('critical', 'major')),
    storm_routers AS (
      SELECT agg_router_id, min(window_start) AS window_start FROM {fqs}.gold_alarm_windows w, now_
      WHERE w.window_start > now_.t - INTERVAL 24 HOURS AND w.sites_alarming >= 10 GROUP BY agg_router_id),
    storm_links AS (SELECT l.a_node AS agg_router_id, l.link_id FROM {fqs}.transport_links l JOIN storm_routers r ON r.agg_router_id = l.a_node),
    storm_alarms AS (
      SELECT r.agg_router_id AS root, a.* FROM recent a JOIN storm_routers r
        ON a.agg_router_id = r.agg_router_id AND a.raised_ts >= r.window_start - INTERVAL 30 MINUTES
      UNION
      SELECT sl.agg_router_id AS root, a.* FROM recent a JOIN storm_links sl
        ON a.node_type = 'core_router'
       AND (a.additional_text LIKE concat('%', sl.link_id, '%') OR a.additional_text LIKE concat('%', sl.agg_router_id, '%'))),
    storm_inc AS (
      SELECT 'alarm_storm' AS incident_type, root AS suspected_node_id, 'aggregation_router' AS suspected_node_type,
             CAST(NULL AS STRING) AS cell_id,
             array_sort(collect_set(site_id)) AS site_ids, collect_list(alarm_id) AS alarm_ids,
             count(*) AS alarm_count, count_if(severity = 'critical') AS critical_alarms, count_if(is_active) AS active_alarms,
             count_if(node_type <> 'cell_site') AS transport_alarms,
             min(raised_ts) AS first_alarm_ts, max(raised_ts) AS last_alarm_ts,
             CAST(NULL AS DOUBLE) AS anomaly_score, CAST(NULL AS ARRAY<STRING>) AS top_factors,
             slice(array_sort(collect_set(alarm_name)), 1, 8) AS alarm_types,
             CAST(NULL AS STRING) AS top_alarm, CAST(NULL AS INT) AS cells_flagged
      FROM storm_alarms GROUP BY root),
    site_inc AS (
      SELECT CASE WHEN max_by(probable_cause, CASE severity WHEN 'critical' THEN 2 ELSE 1 END) = 'Power' THEN 'power_alarm'
                  WHEN max_by(probable_cause, CASE severity WHEN 'critical' THEN 2 ELSE 1 END) = 'Transport' THEN 'backhaul_alarm'
                  ELSE 'site_outage' END AS incident_type,
             site_id AS suspected_node_id, 'cell_site' AS suspected_node_type, CAST(NULL AS STRING) AS cell_id,
             array(site_id) AS site_ids, collect_list(alarm_id) AS alarm_ids,
             count(*) AS alarm_count, count_if(severity = 'critical') AS critical_alarms, count_if(is_active) AS active_alarms,
             count_if(probable_cause = 'Transport') AS transport_alarms,
             min(raised_ts) AS first_alarm_ts, max(raised_ts) AS last_alarm_ts,
             CAST(NULL AS DOUBLE) AS anomaly_score, CAST(NULL AS ARRAY<STRING>) AS top_factors,
             slice(array_sort(collect_set(alarm_name)), 1, 8) AS alarm_types,
             max_by(alarm_name, struct(CASE severity WHEN 'critical' THEN 2 ELSE 1 END, -unix_timestamp(raised_ts))) AS top_alarm, CAST(NULL AS INT) AS cells_flagged
      FROM recent WHERE site_id IS NOT NULL AND alarm_id NOT IN (SELECT alarm_id FROM storm_alarms)
      GROUP BY site_id),
    alarm_sites AS (SELECT explode(site_ids) AS site_id FROM (SELECT site_ids FROM storm_inc UNION ALL SELECT site_ids FROM site_inc)),
    anom AS (
      SELECT h.* FROM {fqs}.cell_health_daily h
      WHERE h.is_anomaly AND h.day >= (SELECT date_sub(max(day), 1) FROM {fqs}.cell_health_daily)
        AND h.site_id NOT IN (SELECT site_id FROM alarm_sites)),
    anom_inc AS (
      SELECT 'kpi_anomaly' AS incident_type, site_id AS suspected_node_id, 'cell' AS suspected_node_type,
             max_by(cell_id, anomaly_score) AS cell_id, array(site_id) AS site_ids, CAST(array() AS ARRAY<STRING>) AS alarm_ids,
             0 AS alarm_count, 0 AS critical_alarms, 0 AS active_alarms, 0 AS transport_alarms,
             CAST(NULL AS TIMESTAMP) AS first_alarm_ts, CAST(NULL AS TIMESTAMP) AS last_alarm_ts,
             max(anomaly_score) AS anomaly_score, max_by(top_factors, anomaly_score) AS top_factors, CAST(array() AS ARRAY<STRING>) AS alarm_types,
             CAST(NULL AS STRING) AS top_alarm, CAST(count(DISTINCT cell_id) AS INT) AS cells_flagged
      FROM anom GROUP BY site_id),
    first_flag AS (
      SELECT cell_id, min(day) AS first_flagged_day FROM {fqs}.cell_health_daily WHERE is_anomaly GROUP BY cell_id),
    allinc AS (SELECT * FROM storm_inc UNION ALL SELECT * FROM site_inc UNION ALL SELECT * FROM anom_inc),
    inc_sites AS (SELECT suspected_node_id, explode(site_ids) AS sid FROM allinc),
    impact AS (
      SELECT i.suspected_node_id, sum(s.subscribers_served) AS subscribers_served, count(*) AS sites_affected,
             array_sort(array_distinct(flatten(collect_list(coalesce(e.accts, CAST(array() AS ARRAY<STRING>)))))) AS enterprise_accounts,
             array_sort(collect_set(s.critical_facility)) AS critical_facilities,
             first(s.market) AS market
      FROM inc_sites i
      JOIN {fqs}.cell_sites s ON s.site_id = i.sid
      LEFT JOIN (SELECT site_id, collect_set(concat(account_name, ' (', sla_tier, ', ', restore_sla_hours, 'h SLA)')) AS accts
                 FROM {fqs}.enterprise_site_coverage GROUP BY site_id) e ON e.site_id = s.site_id
      GROUP BY i.suspected_node_id),
    enriched AS (
      SELECT i.*, cs.site_name AS node_name, im.market, im.sites_affected, im.subscribers_served, im.enterprise_accounts, im.critical_facilities,
             coalesce(i.first_alarm_ts, CAST(ff.first_flagged_day AS TIMESTAMP) + INTERVAL 6 HOURS) AS detected_ts,
             ff.first_flagged_day,
             CASE WHEN i.incident_type = 'alarm_storm' THEN 'P1'
                  WHEN i.active_alarms > 0 AND i.critical_alarms > 0 THEN 'P2'
                  WHEN i.active_alarms > 0 THEN 'P3'
                  WHEN i.incident_type = 'kpi_anomaly' THEN 'P3'
                  ELSE 'P4' END AS suggested_priority
      FROM allinc i JOIN impact im USING (suspected_node_id) LEFT JOIN first_flag ff ON ff.cell_id = i.cell_id
      LEFT JOIN {fqs}.cell_sites cs ON cs.site_id = i.suspected_node_id)
    SELECT concat('INC-', CAST(24410 + row_number() OVER (ORDER BY detected_ts, suspected_node_id) AS STRING)) AS incident_id,
           incident_type,
           CASE incident_type
             WHEN 'alarm_storm' THEN concat('Alarm storm: ', sites_affected, ' cell sites down under ', suspected_node_id)
             WHEN 'kpi_anomaly' THEN concat(IF(cells_flagged > 1, concat(suspected_node_id, ' (', cells_flagged, ' cells)'), cell_id), ' ', node_name, ': KPI anomaly, no alarm')
             ELSE concat(suspected_node_id, ' ', node_name, ': ',
                         top_alarm, IF(active_alarms = 0, ' (cleared)', ''))
           END AS title,
           market, suspected_node_id, suspected_node_type, cell_id, detected_ts, first_alarm_ts, last_alarm_ts, first_flagged_day,
           sites_affected, site_ids, subscribers_served, enterprise_accounts, critical_facilities,
           alarm_count, critical_alarms, active_alarms, transport_alarms, alarm_types, alarm_ids,
           anomaly_score, top_factors, suggested_priority, 'open' AS status
    FROM enriched""")
    for r in spark.sql(f"SELECT incident_id, incident_type, title, suggested_priority, sites_affected, alarm_count, active_alarms, subscribers_served FROM {fqs}.noc_incidents ORDER BY incident_id").collect():
        print(" ", r.incident_id, r.incident_type, r.suggested_priority, r.sites_affected, r.alarm_count, r.active_alarms, r.subscribers_served, "|", r.title)

    if not args.skip_ai:
        spark.sql(f"""
        CREATE OR REPLACE TABLE {fqs}.trouble_ticket_insights
        COMMENT 'AI Functions over trouble-ticket resolution notes: ai_classify → precursor = early warning ignored | sudden failure | planned or external cause.'
        AS SELECT ticket_id, category, priority, market, opened_ts, mttr_hours, sites_affected, subscribers_affected, resolution_notes,
                  ai_classify(resolution_notes, array('early warning ignored', 'sudden failure', 'planned or external cause')) AS precursor
        FROM {fqs}.trouble_tickets""")
        for r in spark.sql(f"SELECT precursor, count(*) n, round(avg(mttr_hours), 1) mttr FROM {fqs}.trouble_ticket_insights GROUP BY 1 ORDER BY 2 DESC").collect():
            print("  precursor:", r.precursor, r.n, r.mttr)


if __name__ == "__main__":
    main()
