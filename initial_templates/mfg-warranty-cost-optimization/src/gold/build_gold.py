"""
Gold layer + Unity Catalog metric view for the VP Quality view (dashboard + Genie) and the app.

  gold_claims               one row per claim: AI failure mode, unit genealogy (lots, firmware, build
                            date), dealer/region, the attributable supplier, chargeable flag
  gold_monthly_kpis         month × model: units in service, claims, claims per 1K units in service,
                            warranty cost, cost per unit in service
  gold_supplier_recovery    supplier × quarter: attributable cost, submitted, recovered, recovery rate
  gold_lot_quality          controller lot: units, unit-years in service, water-ingress claims per 1K
                            units / per 1K unit-years, E21 telemetry per 1K connected bikes, PCN / PPAP
  gold_early_warning        early-warning signals: failure mode × supplier, claims last 90 days vs the
                            prior 12-month baseline (rate per 1K unit-years), cost to date, flag
  gold_signal_cohorts       per flagged signal: the genealogy dimension that concentrates it (controller
                            lot, brake lot, battery lot or firmware) — units / claims / rate + suspect flag
  gold_signal_exposure      per signal × region: suspect-cohort bikes in field + in stock, observed annual
                            hazard, remaining warranty years → projected additional claims + cost
  mv_warranty_quality       metric view — governed KPI definitions over gold_claims

    python build_gold.py --catalog manufacturing --schema warranty_copilot
"""
from __future__ import annotations

import argparse

from pyspark.sql import SparkSession

# failure mode × drive → attributable supplier (mirrors data_generation MODES)
MODE_SUPPLIER = [
    ("controller_water_ingress", "hub", "SUP-HAN"), ("controller_water_ingress", "mid", "SUP-KES"),
    ("controller_electrical_other", "hub", "SUP-HAN"), ("controller_electrical_other", "mid", "SUP-KES"),
    ("hub_motor_bearing", "hub", "SUP-KES"), ("mid_drive_fault", "mid", "SUP-KES"),
    ("torque_sensor_fault", "hub", "SUP-KES"), ("torque_sensor_fault", "mid", "SUP-KES"),
    ("battery_bms_fault", "hub", "SUP-VOL"), ("battery_bms_fault", "mid", "SUP-VOL"),
    ("battery_connector_wear", "hub", "SUP-VOL"), ("battery_connector_wear", "mid", "SUP-VOL"),
    ("charger_failure", "hub", "SUP-VOL"), ("charger_failure", "mid", "SUP-VOL"),
    ("brake_caliper_leak", "hub", "SUP-ARD"), ("brake_caliper_leak", "mid", "SUP-ARD"),
    ("display_freeze_firmware", "hub", "SUP-BWC"), ("display_freeze_firmware", "mid", "SUP-BWC"),
    ("frame_paint_cosmetic", "hub", "SUP-TOR"), ("frame_paint_cosmetic", "mid", "SUP-TOR"),
]
# genealogy dimension a failure mode's root-cause cohort is cut on
MODE_DIMENSION = {
    "controller_water_ingress": "controller_lot", "controller_electrical_other": "controller_lot",
    "brake_caliper_leak": "brake_lot", "battery_bms_fault": "battery_lot", "battery_connector_wear": "battery_lot",
    "display_freeze_firmware": "firmware_version",
}
WET_REGIONS = ("Pacific Northwest", "Northeast", "Southeast")
FW_RELEASE = "2026-05-06"  # OTA firmware 3.2.0 — firmware cohorts are exposed from this date


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    try:
        from databricks.connect import DatabricksSession  # type: ignore

        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="warranty_copilot")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    ms_values = ", ".join(f"('{m}', '{d}', '{sup}')" for m, d, sup in MODE_SUPPLIER)
    MS = f"ms AS (SELECT * FROM VALUES {ms_values} AS t(failure_mode, drive_type, supplier_id))"
    wet = ", ".join(f"'{r}'" for r in WET_REGIONS)

    # ── claim-level fact ─────────────────────────────────────────────────────
    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_claims
      COMMENT 'One row per warranty claim, enriched: AI-classified failure mode (ai_classify over technician notes), unit genealogy (controller/brake/battery lot, firmware, build date), dealer + region, attributable supplier and whether it is chargeable back to that supplier.'
      AS
      WITH {MS}
      SELECT c.claim_id, c.serial, c.model_id, m.model_name, m.drive_type, c.dealer_id, d.dealer_name, d.city AS dealer_city,
             d.state AS dealer_state, c.region, d.wet_climate_index, c.region IN ({wet}) AS wet_region,
             c.failure_date, c.claim_date, date_trunc('MONTH', c.claim_date)::DATE AS claim_month,
             c.odometer_km, c.days_in_service, c.customer_complaint, c.dealer_labor_code,
             f.failure_mode, fc.label AS failure_mode_label, fc.component, f.fault_code, f.water_exposure,
             f.symptom, f.observed_damage, f.matches_dealer_code,
             c.part_number_replaced, c.part_cost, c.labor_hours, c.labor_cost, c.total_cost, c.claim_status,
             c.technician_name, c.technician_notes, c.firmware_at_claim,
             u.build_date, date_trunc('MONTH', u.build_date)::DATE AS build_month, u.sale_date,
             u.controller_lot, u.controller_supplier_id, u.brake_lot, u.battery_lot, u.connected,
             ms.supplier_id AS attributable_supplier_id, sp.supplier_name AS attributable_supplier_name,
             coalesce(fc.supplier_attributable AND ms.supplier_id IS NOT NULL AND ms.supplier_id <> 'SUP-BWC'
                      AND c.claim_status <> 'rejected', false) AS chargeable,
             l.pcn_reference AS controller_pcn
      FROM {s}.warranty_claims c
      JOIN {s}.units u ON u.serial = c.serial
      JOIN {s}.bike_models m ON m.model_id = c.model_id
      JOIN {s}.dealers d ON d.dealer_id = c.dealer_id
      LEFT JOIN {s}.claim_failure_modes f ON f.claim_id = c.claim_id
      LEFT JOIN {s}.failure_mode_catalog fc ON fc.failure_mode = f.failure_mode
      LEFT JOIN ms ON ms.failure_mode = f.failure_mode AND ms.drive_type = m.drive_type
      LEFT JOIN {s}.suppliers sp ON sp.supplier_id = ms.supplier_id
      LEFT JOIN {s}.supplier_lots l ON l.lot_id = u.controller_lot
    """)

    # ── monthly KPIs ─────────────────────────────────────────────────────────
    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_monthly_kpis
      COMMENT 'Month × model: bikes in warranty service during the month, claims filed, claims per 1,000 bikes in service, warranty cost and cost per bike in service. The current month is partial (is_partial_month).'
      AS
      WITH months AS (
        SELECT explode(sequence(DATE'2024-11-01', date_trunc('MONTH', current_date())::DATE, INTERVAL 1 MONTH)) AS month
      ),
      svc AS (
        SELECT mo.month, u.model_id, count(*) AS units_in_service
        FROM months mo JOIN {s}.units u
          ON u.sold AND u.sale_date <= last_day(mo.month) AND u.warranty_end >= mo.month
        GROUP BY mo.month, u.model_id
      ),
      cl AS (
        SELECT claim_month AS month, model_id, count(*) AS claims, sum(total_cost) AS warranty_cost,
               count_if(failure_mode = 'controller_water_ingress') AS controller_water_claims
        FROM {s}.gold_claims WHERE claim_status <> 'rejected' GROUP BY 1, 2
      )
      SELECT svc.month, svc.model_id, m.model_name, svc.units_in_service,
             coalesce(cl.claims, 0) AS claims, coalesce(cl.controller_water_claims, 0) AS controller_water_claims,
             round(coalesce(cl.warranty_cost, 0), 2) AS warranty_cost,
             round(1000 * coalesce(cl.claims, 0) / svc.units_in_service, 2) AS claims_per_1k_units,
             round(coalesce(cl.warranty_cost, 0) / svc.units_in_service, 2) AS cost_per_unit_in_service,
             svc.month = date_trunc('MONTH', current_date())::DATE AS is_partial_month
      FROM svc JOIN {s}.bike_models m ON m.model_id = svc.model_id
      LEFT JOIN cl ON cl.month = svc.month AND cl.model_id = svc.model_id
    """)

    # ── supplier recovery ────────────────────────────────────────────────────
    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_supplier_recovery
      COMMENT 'Supplier × quarter cost recovery: warranty cost attributable to the supplier, chargeback submitted, recovered, recovery rate (recovered / attributable). The current quarter (status open) has not been settled yet.'
      AS
      SELECT cb.supplier_id, sp.supplier_name, sp.commodity, cb.quarter, cb.supplier_attributable_claims,
             cb.supplier_attributable_cost, cb.submitted_amount, cb.recovered_amount, cb.status,
             round(cb.recovered_amount / nullif(cb.supplier_attributable_cost, 0), 4) AS recovery_rate,
             round(cb.supplier_attributable_cost - cb.recovered_amount, 2) AS unrecovered_cost
      FROM {s}.supplier_chargebacks cb JOIN {s}.suppliers sp ON sp.supplier_id = cb.supplier_id
    """)

    # ── controller lot quality ───────────────────────────────────────────────
    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_lot_quality
      COMMENT 'Motor-controller lot quality: bikes built with the lot, unit-years in service, water-ingress claims per 1,000 bikes sold and per 1,000 unit-years, bikes reporting E21 moisture faults per 1,000 connected bikes, coating + PCN + PPAP status.'
      AS
      WITH u AS (
        SELECT controller_lot, count(*) AS units_built, count_if(sold) AS units_sold, count_if(NOT sold) AS units_in_stock,
               count_if(connected AND sold) AS connected_sold,
               sum(CASE WHEN sold THEN datediff(current_date(), sale_date) / 365.0 ELSE 0 END) AS unit_years,
               min(build_date) AS first_build, max(build_date) AS last_build
        FROM {s}.units GROUP BY controller_lot
      ),
      c AS (
        SELECT controller_lot, count(*) AS controller_claims,
               count_if(failure_mode = 'controller_water_ingress') AS water_ingress_claims,
               sum(CASE WHEN failure_mode = 'controller_water_ingress' THEN total_cost END) AS water_ingress_cost
        FROM {s}.gold_claims WHERE failure_mode LIKE 'controller%' AND claim_status <> 'rejected' GROUP BY controller_lot
      ),
      e AS (
        SELECT u.controller_lot, count(*) AS e21_events, count(DISTINCT t.serial) AS e21_bikes
        FROM {s}.telemetry_fault_events t JOIN {s}.units u ON u.serial = t.serial
        WHERE t.fault_code = 'E21' GROUP BY u.controller_lot
      )
      SELECT l.lot_id AS controller_lot, l.supplier_id, sp.supplier_name, l.part_number, l.production_start,
             l.conformal_coating, l.pcn_reference, l.ppap_status, u.units_built, u.units_sold, u.units_in_stock,
             round(u.unit_years, 1) AS unit_years, u.first_build, u.last_build,
             coalesce(c.controller_claims, 0) AS controller_claims, coalesce(c.water_ingress_claims, 0) AS water_ingress_claims,
             round(coalesce(c.water_ingress_cost, 0), 2) AS water_ingress_cost,
             round(1000 * coalesce(c.water_ingress_claims, 0) / nullif(u.units_sold, 0), 1) AS water_claims_per_1k_units,
             round(1000 * coalesce(c.water_ingress_claims, 0) / nullif(u.unit_years, 0), 1) AS water_claims_per_1k_unit_years,
             coalesce(e.e21_events, 0) AS e21_events, coalesce(e.e21_bikes, 0) AS e21_bikes,
             round(1000 * coalesce(e.e21_bikes, 0) / nullif(u.connected_sold, 0), 1) AS e21_bikes_per_1k_connected
      FROM {s}.supplier_lots l
      JOIN u ON u.controller_lot = l.lot_id
      JOIN {s}.suppliers sp ON sp.supplier_id = l.supplier_id
      LEFT JOIN c ON c.controller_lot = l.lot_id
      LEFT JOIN e ON e.controller_lot = l.lot_id
      WHERE l.component = 'Motor controller'
    """)

    # ── early-warning signals ────────────────────────────────────────────────
    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_early_warning
      COMMENT 'Early-warning detection: for each AI failure mode × attributable supplier, claims in the last 90 days vs the prior 12-month baseline, normalized per 1,000 unit-years in service of the exposed bikes. is_signal = rate ratio >= 2 and >= 15 claims in 90 days.'
      AS
      WITH {MS},
      expo AS (
        SELECT ms.failure_mode, ms.supplier_id,
          sum(greatest(0, datediff(current_date(), greatest(u.sale_date, date_sub(current_date(), 90))))) / 365.0 AS uy_recent,
          sum(greatest(0, datediff(date_sub(current_date(), 90), greatest(u.sale_date, date_sub(current_date(), 455))))) / 365.0 AS uy_base,
          count(*) AS exposed_units
        FROM {s}.units u JOIN {s}.bike_models m ON m.model_id = u.model_id
        JOIN ms ON ms.drive_type = m.drive_type
        WHERE u.sold GROUP BY 1, 2
      ),
      cl AS (
        SELECT failure_mode, attributable_supplier_id AS supplier_id,
          count_if(claim_date > date_sub(current_date(), 90)) AS claims_90d,
          count_if(claim_date <= date_sub(current_date(), 90) AND claim_date > date_sub(current_date(), 455)) AS claims_base,
          count(*) AS claims_total, round(sum(total_cost), 2) AS cost_to_date,
          round(sum(CASE WHEN claim_date > date_sub(current_date(), 90) THEN total_cost ELSE 0 END), 2) AS cost_90d,
          min(CASE WHEN claim_date > date_sub(current_date(), 120) THEN claim_date END) AS first_recent_claim,
          round(avg(total_cost), 2) AS avg_claim_cost,
          round(avg(CASE WHEN matches_dealer_code THEN 1.0 ELSE 0.0 END), 3) AS dealer_code_agreement
        FROM {s}.gold_claims WHERE claim_status <> 'rejected' AND attributable_supplier_id IS NOT NULL GROUP BY 1, 2
      )
      SELECT concat('SIG-', upper(substr(sha2(concat(cl.failure_mode, cl.supplier_id), 256), 1, 6))) AS signal_id,
             cl.failure_mode, fc.label AS failure_mode_label, fc.component, cl.supplier_id, sp.supplier_name,
             expo.exposed_units, cl.claims_90d, cl.claims_base, cl.claims_total, cl.cost_to_date, cl.cost_90d, cl.avg_claim_cost,
             cl.first_recent_claim, cl.dealer_code_agreement,
             round(1000 * cl.claims_90d / nullif(expo.uy_recent, 0), 1) AS rate_90d_per_1k_unit_years,
             round(1000 * cl.claims_base / nullif(expo.uy_base, 0), 1) AS baseline_rate_per_1k_unit_years,
             round((cl.claims_90d / nullif(expo.uy_recent, 0)) / nullif(cl.claims_base / nullif(expo.uy_base, 0), 0), 1) AS rate_ratio,
             (cl.claims_90d >= 15 AND (cl.claims_90d / nullif(expo.uy_recent, 0)) >= 2 * coalesce(cl.claims_base / nullif(expo.uy_base, 0), 0)) AS is_signal,
             fc.supplier_attributable AND cl.supplier_id <> 'SUP-BWC' AS chargeable
      FROM cl JOIN expo ON expo.failure_mode = cl.failure_mode AND expo.supplier_id = cl.supplier_id
      JOIN {s}.failure_mode_catalog fc ON fc.failure_mode = cl.failure_mode
      JOIN {s}.suppliers sp ON sp.supplier_id = cl.supplier_id
    """)

    # ── exposed population per flagged signal (bikes that carry the signal's supplier part) ──
    parts = [f"""
        SELECT w.signal_id, '{dim}' AS dimension, CAST(u.{dim} AS STRING) AS cohort_value, u.serial, u.sold, u.region,
               u.sale_date, u.warranty_end, u.connected,
               {"greatest(u.sale_date, DATE'" + FW_RELEASE + "')" if dim == "firmware_version" else "u.sale_date"} AS exposure_start
        FROM {s}.gold_early_warning w
        JOIN ms ON ms.failure_mode = w.failure_mode AND ms.supplier_id = w.supplier_id
        JOIN {s}.bike_models m ON m.drive_type = ms.drive_type
        JOIN {s}.units u ON u.model_id = m.model_id
        WHERE w.is_signal AND w.failure_mode = '{mode}'""" for mode, dim in MODE_DIMENSION.items()]
    pop_sql = f"WITH {MS}, pop AS ({' UNION ALL '.join(parts)})"

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_signal_cohorts
      COMMENT 'For each flagged early-warning signal: the genealogy dimension that explains it (controller_lot / brake_lot / battery_lot / firmware_version) with bikes, bikes sold, claims, claims per 1,000 bikes sold and per 1,000 unit-years in service per value. is_suspect = claims per unit-year >= 4x the rate of all other values combined, and >= 5 claims. in_scope = suspect, or a controller lot built under the same supplier PCN as a suspect lot (containment scope).'
      AS
      {pop_sql},
      cl AS (
        SELECT w.signal_id, c.serial, c.claim_date FROM {s}.gold_claims c
        JOIN {s}.gold_early_warning w ON w.failure_mode = c.failure_mode AND w.supplier_id = c.attributable_supplier_id
        WHERE c.claim_status <> 'rejected'
      ),
      x AS (
        SELECT p.signal_id, p.dimension, p.cohort_value, count(*) AS units, count_if(p.sold) AS units_sold,
               sum(CASE WHEN p.sold THEN greatest(0, datediff(current_date(), p.exposure_start)) / 365.0 ELSE 0 END) AS unit_years,
               count(CASE WHEN cl.claim_date >= p.exposure_start THEN cl.serial END) AS claims
        FROM pop p LEFT JOIN cl ON cl.signal_id = p.signal_id AND cl.serial = p.serial
        GROUP BY 1, 2, 3
      ),
      r AS (
        SELECT *, 1000 * claims / nullif(unit_years, 0) AS rate_uy,
               percentile(1000 * claims / nullif(unit_years, 0), 0.5) OVER (PARTITION BY signal_id) AS median_rate_uy,
               1000 * (sum(claims) OVER (PARTITION BY signal_id) - claims)
                 / nullif(sum(unit_years) OVER (PARTITION BY signal_id) - unit_years, 0) AS rest_rate_uy
        FROM x
      ),
      flag AS (
        SELECT *, coalesce(claims >= 5 AND rate_uy >= 4 * greatest(rest_rate_uy, 0.1), false) AS is_suspect FROM r
      ),
      pcn AS (
        SELECT DISTINCT f.signal_id, l.pcn_reference FROM flag f
        JOIN {s}.supplier_lots l ON l.lot_id = f.cohort_value
        WHERE f.is_suspect AND f.dimension = 'controller_lot' AND l.pcn_reference IS NOT NULL
      )
      SELECT f.signal_id, f.dimension, f.cohort_value, f.units, f.units_sold, f.units - f.units_sold AS units_in_stock,
             f.claims, round(f.unit_years, 1) AS unit_years,
             round(1000 * f.claims / nullif(f.units_sold, 0), 1) AS claims_per_1k_units,
             round(f.rate_uy, 1) AS claims_per_1k_unit_years, round(f.rest_rate_uy, 1) AS rest_claims_per_1k_unit_years,
             round(f.median_rate_uy, 1) AS median_claims_per_1k_unit_years,
             f.is_suspect, l.pcn_reference,
             f.is_suspect OR pcn.pcn_reference IS NOT NULL AS in_scope
      FROM flag f
      LEFT JOIN {s}.supplier_lots l ON f.dimension = 'controller_lot' AND l.lot_id = f.cohort_value
      LEFT JOIN pcn ON pcn.signal_id = f.signal_id AND pcn.pcn_reference = l.pcn_reference
    """)

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_signal_exposure
      COMMENT 'Remaining-warranty exposure of each signal''s in-scope cohort (suspect values + same-PCN lots), by region: bikes in the field and in dealer stock, observed annual failure hazard (claims / unit-years in service), remaining warranty years, projected additional claims = bikes without a claim x (1 - exp(-hazard x remaining years)), projected cost at the observed average claim cost.'
      AS
      {pop_sql},
      sus AS (
        SELECT p.* FROM pop p JOIN {s}.gold_signal_cohorts k
          ON k.signal_id = p.signal_id AND k.dimension = p.dimension AND k.cohort_value = p.cohort_value AND k.in_scope
      ),
      cl AS (
        SELECT w.signal_id, c.serial, c.total_cost, c.claim_date FROM {s}.gold_claims c
        JOIN {s}.gold_early_warning w ON w.failure_mode = c.failure_mode AND w.supplier_id = c.attributable_supplier_id
        WHERE c.claim_status <> 'rejected'
      ),
      j AS (
        SELECT p.signal_id, p.region, p.serial, p.sold, p.connected,
               CASE WHEN p.sold THEN greatest(0, datediff(current_date(), p.exposure_start)) / 365.0 ELSE 0 END AS uy,
               CASE WHEN p.sold THEN greatest(0, datediff(p.warranty_end, current_date())) / 365.0 ELSE 2.0 END AS rem_years,
               cl.serial IS NOT NULL AS has_claim, cl.total_cost
        FROM sus p LEFT JOIN cl ON cl.signal_id = p.signal_id AND cl.serial = p.serial AND cl.claim_date >= p.exposure_start
      ),
      g AS (
        SELECT signal_id, region, count(*) AS units, count_if(sold) AS units_in_field, count_if(NOT sold) AS units_in_stock,
               count_if(connected AND sold) AS connected_in_field,
               count_if(has_claim) AS claims_to_date, round(coalesce(sum(total_cost), 0), 2) AS cost_to_date,
               sum(uy) AS unit_years, avg(CASE WHEN NOT has_claim THEN rem_years END) AS avg_rem_years
        FROM j GROUP BY 1, 2
      ),
      avgc AS (SELECT signal_id, avg(total_cost) AS avg_cost FROM j WHERE has_claim GROUP BY 1)
      SELECT g.signal_id, g.region, g.region IN ({wet}) AS wet_region, g.units, g.units_in_field, g.units_in_stock,
             g.connected_in_field, g.claims_to_date, g.cost_to_date, round(g.unit_years, 1) AS unit_years,
             round(g.claims_to_date / nullif(g.unit_years, 0), 4) AS annual_hazard,
             round(g.avg_rem_years, 2) AS avg_remaining_warranty_years,
             round((g.units - g.claims_to_date) * (1 - exp(-coalesce(g.claims_to_date / nullif(g.unit_years, 0), 0) * g.avg_rem_years)), 0) AS projected_claims,
             round((g.units - g.claims_to_date) * (1 - exp(-coalesce(g.claims_to_date / nullif(g.unit_years, 0), 0) * g.avg_rem_years)) * a.avg_cost, 2) AS projected_cost,
             round(a.avg_cost, 2) AS avg_claim_cost
      FROM g JOIN avgc a ON a.signal_id = g.signal_id
    """)

    # ── metric view ──────────────────────────────────────────────────────────
    spark.sql(f"""
      CREATE OR REPLACE VIEW {s}.mv_warranty_quality
      WITH METRICS
      LANGUAGE YAML
      COMMENT 'Governed warranty KPIs over gold_claims: claims, warranty cost, cost per claim, chargeable (supplier-attributable) cost, water-ingress claims, AI-vs-dealer-code agreement.'
      AS $$
      version: 1.1
      source: {s}.gold_claims
      filter: claim_status <> 'rejected'
      dimensions:
        - name: claim_month
          expr: claim_month
        - name: build_month
          expr: build_month
        - name: model_name
          expr: model_name
        - name: region
          expr: region
        - name: failure_mode
          expr: failure_mode_label
        - name: component
          expr: component
        - name: supplier
          expr: attributable_supplier_name
        - name: controller_lot
          expr: controller_lot
        - name: dealer_labor_code
          expr: dealer_labor_code
        - name: firmware_at_claim
          expr: firmware_at_claim
      measures:
        - name: claims
          expr: COUNT(1)
        - name: warranty_cost
          expr: SUM(total_cost)
        - name: avg_cost_per_claim
          expr: AVG(total_cost)
        - name: chargeable_cost
          expr: SUM(CASE WHEN chargeable THEN total_cost ELSE 0 END)
        - name: water_ingress_claims
          expr: COUNT_IF(failure_mode = 'controller_water_ingress')
        - name: ai_dealer_code_agreement
          expr: AVG(CASE WHEN matches_dealer_code THEN 1.0 ELSE 0.0 END)
      $$
    """)
    for t in ["gold_claims", "gold_monthly_kpis", "gold_supplier_recovery", "gold_lot_quality", "gold_early_warning",
              "gold_signal_cohorts", "gold_signal_exposure"]:
        print(t, spark.sql(f"SELECT count(*) n FROM {s}.{t}").collect()[0]["n"])


if __name__ == "__main__":
    main()
