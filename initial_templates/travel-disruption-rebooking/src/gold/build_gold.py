"""
Gold layer + metric view for the Aeralis IROPS demo.

  gold_harlan_flight_status  one row per Harlan-cancelled flight: who is on it (SSR, UMNR, lap infants, onward long-haul,
                             top tiers, EU261/UK261), the seats Ops protected, and what AutoProtect did to them
  gold_irops_monthly         monthly IROPS outcomes by hub x handling method (re-accommodation rate, misconnects,
                             cost per disrupted passenger, NPS) — AutoProtect vs the DEN desk-priority pilot
  v_harlan_pax_status        VIEW: every Harlan passenger with AutoProtect's hold, the AI message insight, the ML
                             detractor risk and — live — the rebooking the IROPS desk committed (rebooking_decisions)
  v_harlan_recovery          VIEW: event-level recovery — AutoProtect baseline vs the desk's committed plans so far
  mv_irops_outcomes          UC metric view over irops_history (governed KPI definitions for dashboard + Genie)

    python build_gold.py --catalog retail_consumer_goods --schema travel_disruption_copilot
"""
import argparse

from pyspark.sql import SparkSession

SSR_ANY = "(p.ssr_codes RLIKE 'UMNR|WCHR|WCHS|WCHC|BLND|DEAF|MEDA|INFT')"


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="retail_consumer_goods")
    ap.add_argument("--schema", default="travel_disruption_copilot")
    a, _ = ap.parse_known_args()
    s = f"{a.catalog}.{a.schema}"
    spark = get_spark()

    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.gold_harlan_flight_status
    COMMENT 'Winter Storm Harlan: one row per cancelled flight — passengers by need, protected seats, and what AutoProtect did (same day / overnight / day+2, special-assistance passengers left overnight, long-haul misconnects, split parties).'
    AS
    WITH opt AS (
      SELECT disrupted_flight_id,
             SUM(CASE WHEN same_day AND NOT is_partner THEN seats_protected ELSE 0 END) AS own_same_day_seats,
             SUM(CASE WHEN same_day AND is_partner AND NOT nearby_airport THEN seats_protected ELSE 0 END) AS partner_same_day_seats,
             SUM(CASE WHEN nearby_airport THEN seats_protected ELSE 0 END) AS nearby_airport_seats,
             SUM(CASE WHEN option_type = 'OWN_NEXT_DAY' THEN seats_protected ELSE 0 END) AS next_day_seats
      FROM {s}.alternate_options GROUP BY disrupted_flight_id
    ), msg AS (
      SELECT disrupted_flight_id, COUNT(*) AS messages, SUM(CAST(escalate AS INT)) AS escalated_messages
      FROM {s}.message_insights GROUP BY disrupted_flight_id
    )
    SELECT f.flight_id, f.flight_number, f.origin, f.destination, f.sched_dep_local, f.aircraft_type, f.cancel_reason,
           f.eu_uk_261,
           COUNT(*) AS pax,
           COUNT(DISTINCT p.pnr) AS bookings,
           SUM(CAST({SSR_ANY} AS INT)) AS special_assistance_pax,
           SUM(CAST(p.ssr_codes LIKE '%UMNR%' AS INT)) AS umnr_pax,
           SUM(CAST(p.ssr_codes RLIKE 'WCHR|WCHS|WCHC' AS INT)) AS wheelchair_pax,
           SUM(CAST(p.ssr_codes LIKE '%INFT%' AS INT)) AS lap_infant_pax,
           SUM(CAST(p.onward_long_haul AS INT)) AS onward_long_haul_pax,
           SUM(CAST(p.loyalty_tier IN ('Platinum', 'Diamond') AS INT)) AS platinum_diamond_pax,
           SUM(CAST(p.away_from_home AS INT)) AS away_from_home_pax,
           FIRST(o.own_same_day_seats) AS own_same_day_seats,
           FIRST(o.partner_same_day_seats) AS partner_same_day_seats,
           FIRST(o.nearby_airport_seats) AS nearby_airport_seats,
           FIRST(o.next_day_seats) AS next_day_seats,
           SUM(CAST(r.same_day AS INT)) AS ap_same_day,
           SUM(CAST(r.overnight AS INT)) AS ap_overnight,
           SUM(CAST(r.nights = 2 AS INT)) AS ap_day_plus_2,
           SUM(CAST(r.overnight AND {SSR_ANY} AS INT)) AS ap_special_assistance_overnight,
           SUM(CAST(r.overnight AND p.ssr_codes LIKE '%UMNR%' AS INT)) AS ap_umnr_overnight,
           SUM(CAST(r.misconnect AS INT)) AS ap_misconnects,
           SUM(CAST(r.party_split AS INT)) AS ap_split_party_pax,
           COALESCE(FIRST(m.messages), 0) AS messages,
           COALESCE(FIRST(m.escalated_messages), 0) AS escalated_messages
    FROM {s}.flights f
    JOIN {s}.passengers p ON p.disrupted_flight_id = f.flight_id
    JOIN {s}.autoprotect_rebookings r ON r.pax_id = p.pax_id
    LEFT JOIN opt o ON o.disrupted_flight_id = f.flight_id
    LEFT JOIN msg m ON m.disrupted_flight_id = f.flight_id
    WHERE f.status = 'CANCELLED'
    GROUP BY ALL
    """)

    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.gold_irops_monthly
    COMMENT 'Monthly IROPS outcomes by hub and handling method (AUTOPROTECT vs DESK_PRIORITY_PILOT): disrupted passengers, same-day re-accommodation rate, misconnect rate among onward long-haul passengers, overnight rate, cost per disrupted passenger and post-trip NPS.'
    AS
    SELECT DATE_TRUNC('MONTH', event_date) AS month, hub, handling_method,
           COUNT(DISTINCT event_id) AS events,
           COUNT(*) AS disrupted_pax,
           ROUND(AVG(CAST(same_day_reaccommodated AS INT)), 4) AS same_day_rate,
           ROUND(AVG(CAST(overnight AS INT)), 4) AS overnight_rate,
           SUM(CAST(misconnect AS INT)) AS misconnects,
           ROUND(SUM(CAST(misconnect AS INT)) / NULLIF(SUM(CAST(onward_long_haul AS INT)), 0), 4) AS misconnect_rate,
           ROUND(AVG(total_cost_usd), 2) AS cost_per_pax_usd,
           ROUND(SUM(total_cost_usd), 0) AS total_cost_usd,
           COUNT(nps_score) AS survey_responses,
           ROUND(100 * (AVG(CAST(promoter AS INT)) - AVG(CAST(detractor AS INT))), 1) AS nps
    FROM {s}.irops_history
    GROUP BY ALL
    """)

    spark.sql(f"""
    CREATE OR REPLACE VIEW {s}.v_harlan_pax_status
    COMMENT 'Every Winter Storm Harlan passenger: needs (SSR, tier, onward connection), what AutoProtect held, AI message insight, ML detractor risk, and the IROPS desk''s committed rebooking (null until committed). current_* = desk decision if committed, else AutoProtect.'
    AS
    SELECT p.pax_id, p.pnr, p.disrupted_flight_id, f.flight_number, f.destination, p.first_name, p.last_name, p.age,
           p.loyalty_tier, p.cabin, p.fare_brand, p.ssr_codes, {SSR_ANY} AS special_assistance,
           p.ssr_codes LIKE '%UMNR%' AS unaccompanied_minor, p.origin_type, p.away_from_home, p.onward_flight,
           p.onward_long_haul, p.party_size, p.preferred_language, p.eu_uk_261,
           r.new_flight_label AS autoprotect_flight, r.arrive_local AS autoprotect_arrival, r.same_day AS autoprotect_same_day,
           r.overnight AS autoprotect_overnight, r.nights AS autoprotect_nights, r.misconnect AS autoprotect_misconnect,
           r.party_split AS autoprotect_party_split,
           mi.intent AS message_intent, mi.urgency AS message_urgency, mi.sentiment AS message_sentiment,
           mi.summary AS message_summary, COALESCE(mi.escalate, FALSE) AS escalated,
           k.p_autoprotect AS detractor_risk_autoprotect, k.p_same_day AS detractor_risk_same_day,
           k.p_next_day AS detractor_risk_next_day,
           d.new_flight_label AS desk_flight, d.arrive_local AS desk_arrival, d.same_day AS desk_same_day,
           d.overnight AS desk_overnight, d.hotel_id AS desk_hotel_id, d.priority_tier AS desk_priority_tier,
           d.cost_usd AS desk_cost_usd, d.committed_at AS desk_committed_at,
           d.pax_id IS NOT NULL AS desk_committed,
           COALESCE(d.same_day, r.same_day) AS current_same_day,
           COALESCE(d.new_flight_label, r.new_flight_label) AS current_flight
    FROM {s}.passengers p
    JOIN {s}.flights f ON f.flight_id = p.disrupted_flight_id
    JOIN {s}.autoprotect_rebookings r ON r.pax_id = p.pax_id
    LEFT JOIN {s}.pax_detractor_risk k ON k.pax_id = p.pax_id
    LEFT JOIN (SELECT * FROM {s}.message_insights QUALIFY ROW_NUMBER() OVER (PARTITION BY pax_id ORDER BY escalate DESC, received_ts DESC) = 1) mi
           ON mi.pax_id = p.pax_id
    LEFT JOIN (SELECT * FROM {s}.rebooking_decisions QUALIFY ROW_NUMBER() OVER (PARTITION BY pax_id ORDER BY committed_at DESC) = 1) d
           ON d.pax_id = p.pax_id
    """)

    spark.sql(f"""
    CREATE OR REPLACE VIEW {s}.v_harlan_recovery
    COMMENT 'Winter Storm Harlan recovery by cancelled flight: AutoProtect baseline vs the IROPS desk plans committed so far (rebooking_plans write-back).'
    AS
    SELECT g.flight_id, g.flight_number, g.destination, g.pax, g.special_assistance_pax, g.onward_long_haul_pax,
           g.ap_same_day, g.ap_overnight, g.ap_special_assistance_overnight, g.ap_misconnects,
           pl.plan_id IS NOT NULL AS desk_plan_committed, pl.same_day_count AS desk_same_day, pl.overnight_count AS desk_overnight,
           pl.misconnects AS desk_misconnects, pl.partner_spend_usd AS desk_partner_spend_usd, pl.total_cost_usd AS desk_total_cost_usd,
           pl.autoprotect_total_cost_usd, pl.cost_per_pax_usd AS desk_cost_per_pax_usd, pl.predicted_detractor_rate AS desk_predicted_detractor_rate,
           pl.approved_by, pl.committed_at
    FROM {s}.gold_harlan_flight_status g
    LEFT JOIN (SELECT * FROM {s}.rebooking_plans QUALIFY ROW_NUMBER() OVER (PARTITION BY disrupted_flight_id ORDER BY committed_at DESC) = 1) pl
           ON pl.disrupted_flight_id = g.flight_id
    """)

    spark.sql(f"""
    CREATE OR REPLACE VIEW {s}.mv_irops_outcomes
    WITH METRICS LANGUAGE YAML
    COMMENT 'Governed IROPS KPIs over irops_history: re-accommodation rate, misconnect rate, cost per disrupted passenger, NPS.'
    AS $$
    version: 0.1
    source: {s}.irops_history
    dimensions:
      - name: Month
        expr: DATE_TRUNC('MONTH', event_date)
      - name: Hub
        expr: hub
      - name: Handling method
        expr: handling_method
      - name: Cause
        expr: cause_category
      - name: Controllable
        expr: controllable
      - name: Loyalty tier
        expr: loyalty_tier
      - name: Special assistance
        expr: special_assistance OR unaccompanied_minor OR lap_infant
    measures:
      - name: Disrupted passengers
        expr: COUNT(1)
      - name: Same-day re-accommodation rate
        expr: AVG(CAST(same_day_reaccommodated AS INT))
      - name: Overnight rate
        expr: AVG(CAST(overnight AS INT))
      - name: Misconnects
        expr: SUM(CAST(misconnect AS INT))
      - name: Misconnect rate
        expr: SUM(CAST(misconnect AS INT)) / NULLIF(SUM(CAST(onward_long_haul AS INT)), 0)
      - name: Cost per disrupted passenger
        expr: AVG(total_cost_usd)
      - name: Total IROPS cost
        expr: SUM(total_cost_usd)
      - name: NPS
        expr: 100 * (AVG(CAST(promoter AS INT)) - AVG(CAST(detractor AS INT)))
      - name: Survey responses
        expr: COUNT(nps_score)
    $$
    """)
    for t in ["gold_harlan_flight_status", "gold_irops_monthly", "v_harlan_pax_status", "v_harlan_recovery"]:
        print(t, spark.sql(f"SELECT COUNT(*) FROM {s}.{t}").collect()[0][0])


if __name__ == "__main__":
    main()
