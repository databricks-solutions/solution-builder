"""
Gold layer for the dashboard, Genie, the readmission model and the app.

  gold_discharges           one row per index discharge, joined with patient / unit / hospital / readmission, plus the
                            flags every question needs: outcome_window_closed, weekend_discharge (Fri-Sun),
                            last_26_weeks, discharge_month, and the note-derived social risks (AI Functions, last ~120 days)
  gold_readmission_monthly  month × hospital × unit × condition: discharges (closed 30-day windows), readmissions, rate,
                            7-day follow-up booked rate
  gold_followup_effect      condition × weekend flag × follow-up booked: 30-day readmission rate (trailing 12 months)
  hrrp_performance          hospital × HRRP condition (Medicare FFS 65+, trailing 12 months of closed windows):
                            observed rate, national rate, estimated excess readmission ratio (ERR), last-6-months ERR,
                            Medicare payments and the condition's penalty contribution
  hrrp_penalty_estimate     hospital: estimated HRRP payment reduction (capped at 3%) in % and $ — on the 12-month ERR,
                            and with heart failure at its last-6-months run rate

Requires discharge_note_insights (src/ai/extract_note_insights.py).

    python build_gold.py --catalog healthcare_lifesciences --schema readmission_reduction
"""
from __future__ import annotations

import argparse

from pyspark.sql import SparkSession


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
    ap.add_argument("--catalog", default="healthcare_lifesciences")
    ap.add_argument("--schema", default="readmission_reduction")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    as_of = f"(SELECT max(data_as_of) FROM {s}.hospitals)"
    K = 150  # credibility weight (pseudo-discharges at the national rate) for the ERR estimate

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_discharges AS
      SELECT d.encounter_id, d.patient_id, concat(p.first_name, ' ', p.last_name) AS patient_name, d.hospital_id, h.hospital_name,
             d.unit_id, u.unit_name, u.service_line, d.admit_date, d.discharge_date, date_trunc('MONTH', d.discharge_date)::DATE AS discharge_month,
             d.discharge_dow, d.discharge_dow IN ('Fri', 'Sat', 'Sun') AS weekend_discharge, d.status, d.los_days, d.admit_type,
             d.hrrp_condition, d.condition_label, d.hrrp_condition <> 'OTHER' AS is_hrrp_condition, d.principal_dx_code, d.principal_dx,
             d.age_at_discharge AS age, p.sex, d.payer, p.dual_eligible, p.primary_language, p.lives_alone, p.has_pcp, d.medicare_ffs_65,
             d.charlson_index, d.ed_visits_6m, d.prior_admits_12m, d.discharge_med_count, d.discharge_disposition,
             d.followup_7d_scheduled, d.followup_date, d.followup_clinic, d.followup_completed, d.attending, d.drg_payment,
             d.discharge_date <= date_sub({as_of}, 30) AS outcome_window_closed,
             d.discharge_date >= date_sub({as_of}, 182) AS last_26_weeks,
             d.discharge_date > date_sub({as_of}, 395) AND d.discharge_date <= date_sub({as_of}, 30) AS in_hrrp_window,
             coalesce(d.readmitted_30d, false) AS readmitted_30d, r.readmit_date, r.days_to_readmit, r.readmit_reason, r.readmit_cost_usd,
             i.transportation_barrier AS note_transportation_barrier, i.medication_affordability AS note_medication_affordability,
             i.high_risk_med_change AS note_high_risk_med_change, i.followup_status AS note_followup_status
      FROM {s}.discharges d
      JOIN {s}.patients p USING (patient_id)
      JOIN {s}.units u USING (unit_id)
      JOIN {s}.hospitals h ON h.hospital_id = d.hospital_id
      LEFT JOIN {s}.readmissions r ON r.index_encounter_id = d.encounter_id
      LEFT JOIN {s}.discharge_note_insights i ON i.encounter_id = d.encounter_id
    """)
    spark.sql(f"COMMENT ON TABLE {s}.gold_discharges IS 'One row per index discharge with patient, unit, hospital and 30-day readmission outcome. Compute readmission RATES only WHERE outcome_window_closed (discharge at least 30 days before data_as_of). weekend_discharge = discharged Fri, Sat or Sun. last_26_weeks = discharged in the last 26 weeks (since 4 West lost its weekend discharge navigator). in_hrrp_window = trailing-12-month HRRP performance window of this demo. note_* columns come from the AI Functions read of the discharge note (last ~120 days only).'")

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_readmission_monthly AS
      SELECT discharge_month, hospital_id, hospital_name, unit_id, unit_name, hrrp_condition, condition_label,
             count(*) AS discharges, count_if(readmitted_30d) AS readmissions,
             round(count_if(readmitted_30d) / count(*), 4) AS readmission_rate,
             round(count_if(followup_7d_scheduled) / count(*), 4) AS followup_7d_rate,
             count_if(weekend_discharge) AS weekend_discharges,
             count_if(weekend_discharge AND NOT followup_7d_scheduled) AS weekend_no_followup
      FROM {s}.gold_discharges WHERE outcome_window_closed AND status = 'discharged'
        AND discharge_month >= add_months(date_trunc('MONTH', {as_of})::DATE, -23)   -- whole months only
      GROUP BY ALL
    """)
    spark.sql(f"COMMENT ON TABLE {s}.gold_readmission_monthly IS 'Month × hospital × unit × condition: index discharges with a closed 30-day window, unplanned 30-day readmissions, readmission_rate, share with a 7-day follow-up booked at discharge, weekend (Fri-Sun) discharges and how many left without a follow-up. Re-aggregate with sum(readmissions)/sum(discharges).'")

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_followup_effect AS
      SELECT hrrp_condition, condition_label, weekend_discharge, followup_7d_scheduled,
             count(*) AS discharges, count_if(readmitted_30d) AS readmissions, round(count_if(readmitted_30d) / count(*), 4) AS readmission_rate
      FROM {s}.gold_discharges
      WHERE outcome_window_closed AND discharge_date > date_sub({as_of}, 395) AND status = 'discharged'
      GROUP BY ALL
    """)
    spark.sql(f"COMMENT ON TABLE {s}.gold_followup_effect IS 'Trailing 12 months (closed windows): 30-day readmission rate by condition, weekend (Fri-Sun) discharge and whether a 7-day follow-up was booked before discharge.'")

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.hrrp_performance AS
      WITH w AS (
        SELECT d.hospital_id, d.hrrp_condition, count(*) AS discharges, count_if(d.readmitted_30d) AS readmissions,
               sum(d.drg_payment) AS medicare_payments,
               count_if(d.discharge_date >= date_sub({as_of}, 212)) AS discharges_6m,
               count_if(d.discharge_date >= date_sub({as_of}, 212) AND d.readmitted_30d) AS readmissions_6m
        FROM {s}.gold_discharges d
        WHERE d.in_hrrp_window AND d.medicare_ffs_65 AND d.is_hrrp_condition AND d.status = 'discharged'
        GROUP BY ALL)
      SELECT w.hospital_id, h.hospital_name, w.hrrp_condition, b.condition_label, w.discharges, w.readmissions,
             round(w.readmissions / w.discharges, 4) AS observed_rate, b.national_readmission_rate,
             round((w.readmissions + {K} * b.national_readmission_rate) / ((w.discharges + {K}) * b.national_readmission_rate), 3) AS err_estimate,
             w.discharges_6m, w.readmissions_6m,
             round((w.readmissions_6m + {K} * b.national_readmission_rate) / ((w.discharges_6m + {K}) * b.national_readmission_rate), 3) AS err_last_6m,
             w.medicare_payments, h.medicare_base_drg_payments,
             round(w.medicare_payments / h.medicare_base_drg_payments, 5) AS payment_share,
             round(w.medicare_payments / h.medicare_base_drg_payments * greatest(0, (w.readmissions + {K} * b.national_readmission_rate) / ((w.discharges + {K}) * b.national_readmission_rate) - 1), 6) AS penalty_contribution,
             round(w.medicare_payments / h.medicare_base_drg_payments * greatest(0, (w.readmissions_6m + {K} * b.national_readmission_rate) / ((w.discharges_6m + {K}) * b.national_readmission_rate) - 1), 6) AS penalty_contribution_6m,
             greatest(0, w.readmissions - round(w.discharges * b.national_readmission_rate)) AS excess_readmissions
      FROM w JOIN {s}.hospitals h USING (hospital_id) JOIN {s}.hrrp_benchmarks b USING (hrrp_condition)
    """)
    spark.sql(f"COMMENT ON TABLE {s}.hrrp_performance IS 'CMS HRRP estimate per hospital × condition. Population: Medicare FFS 65+, trailing 12 months of discharges with a closed 30-day window. err_estimate = the excess readmission ratio estimate: observed vs national rate, credibility-weighted toward 1.0 with 150 pseudo-discharges at the national rate so small volumes do not swing it (CMS uses a hierarchical risk-adjusted model). err_last_6m uses the last ~6 closed months only (run rate). payment_share = the condition Medicare DRG payments / the hospital base-operating DRG payments. penalty_contribution = payment_share × max(0, ERR − 1): summed per hospital and capped at 3% it is the payment reduction (see hrrp_penalty_estimate). excess_readmissions = readmissions above the national rate.'")

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.hrrp_penalty_estimate AS
      SELECT hospital_id, hospital_name, max(medicare_base_drg_payments) AS medicare_base_drg_payments,
             round(least(0.03, sum(penalty_contribution)), 5) AS penalty_pct,
             round(least(0.03, sum(penalty_contribution)) * max(medicare_base_drg_payments)) AS penalty_usd,
             round(least(0.03, sum(CASE WHEN hrrp_condition = 'HF' THEN penalty_contribution_6m ELSE penalty_contribution END)), 5) AS penalty_pct_hf_run_rate,
             round(least(0.03, sum(CASE WHEN hrrp_condition = 'HF' THEN penalty_contribution_6m ELSE penalty_contribution END)) * max(medicare_base_drg_payments)) AS penalty_usd_hf_run_rate,
             max(CASE WHEN hrrp_condition = 'HF' THEN err_estimate END) AS hf_err_estimate,
             max(CASE WHEN hrrp_condition = 'HF' THEN err_last_6m END) AS hf_err_last_6m,
             max_by(hrrp_condition, penalty_contribution) AS top_condition,
             round(max(penalty_contribution) * max(medicare_base_drg_payments)) AS top_condition_usd,
             sum(excess_readmissions) AS excess_readmissions
      FROM {s}.hrrp_performance GROUP BY hospital_id, hospital_name
    """)
    spark.sql(f"COMMENT ON TABLE {s}.hrrp_penalty_estimate IS 'Estimated CMS HRRP payment reduction per hospital = min(3%, Σ condition penalty_contribution) × Medicare base-operating DRG payments. penalty_usd uses the trailing-12-month ERR of every condition; penalty_usd_hf_run_rate = the same but with heart failure at its last-6-months ERR (where the hospital is heading if the HF trend continues). top_condition = the condition contributing most.'")

    for t, pk in [("gold_discharges", "encounter_id"), ("hrrp_performance", "hospital_id, hrrp_condition"), ("hrrp_penalty_estimate", "hospital_id")]:
        for c in pk.split(", "):
            spark.sql(f"ALTER TABLE {s}.{t} ALTER COLUMN {c} SET NOT NULL")
        spark.sql(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {t}_pk PRIMARY KEY ({pk}) RELY")

    for row in spark.sql(f"SELECT * FROM {s}.hrrp_penalty_estimate ORDER BY penalty_usd DESC").collect():
        print(row.asDict())
    for row in spark.sql(f"SELECT hospital_id, hrrp_condition, discharges, observed_rate, err_estimate, err_last_6m, round(penalty_contribution * medicare_base_drg_payments) AS usd FROM {s}.hrrp_performance ORDER BY usd DESC LIMIT 6").collect():
        print(row.asDict())


if __name__ == "__main__":
    main()
