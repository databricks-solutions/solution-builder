"""
Gold layer for the portfolio dashboard, Genie, the ML model and the app.

  gold_trial_enrollment_monthly   trial × month: screened / randomized / screen-failed, cumulative actual vs plan
  gold_site_performance           trial × site: activation, months active, screened, randomized, rate, screen-fail rate,
                                  competing-trial overlap (randomization rate before vs after the competitor opened), zero-enroller flag
  gold_screen_fail_monthly        trial × month × criterion: screen failures by the REAL criterion (site-coded or AI-read)
                                  vs what the sites coded
  gold_site_features              every network site's features for the CASCADE-CKD enrollment model (catchment under the
                                  current and amended protocol, enrollment history, competition, start-up speed)

Requires screen_fail_reasons (src/ai/classify_screen_fails.py).

    python build_gold.py --catalog healthcare_lifesciences --schema trial_site_selection
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
    ap.add_argument("--schema", default="trial_site_selection")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_trial_enrollment_monthly
      COMMENT 'Trial × calendar month since FPI: patients screened, randomized (by randomization month), screen-failed; cumulative randomized vs the protocol plan. The current month is partial (is_complete_month = false).'
      AS WITH months AS (
        SELECT p.trial_id, p.month_start, p.month_number, p.planned_cum_randomized
        FROM {s}.enrollment_plan p WHERE p.month_start <= current_date()
      ),
      scr AS (
        SELECT trial_id, date_trunc('MONTH', screen_date)::DATE AS m, count(*) AS screened,
               count_if(outcome = 'screen_failed') AS screen_failed, count_if(outcome = 'withdrawn') AS withdrawn
        FROM {s}.screening_log GROUP BY 1, 2
      ),
      rnd AS (
        SELECT trial_id, date_trunc('MONTH', randomization_date)::DATE AS m, count(*) AS randomized
        FROM {s}.screening_log WHERE outcome = 'randomized' GROUP BY 1, 2
      ),
      act AS (
        SELECT m.trial_id, m.month_start, count(ts.site_id) AS active_sites
        FROM months m LEFT JOIN {s}.trial_sites ts
          ON ts.trial_id = m.trial_id AND ts.activation_date <= last_day(m.month_start)
        GROUP BY 1, 2
      )
      SELECT m.trial_id, t.acronym, t.phase, t.therapeutic_area, m.month_start, m.month_number,
             m.month_start = date_trunc('MONTH', current_date())::DATE AS is_current_month,
             m.month_start < date_trunc('MONTH', current_date())::DATE AS is_complete_month,
             coalesce(scr.screened, 0) AS screened, coalesce(scr.screen_failed, 0) AS screen_failed,
             coalesce(scr.withdrawn, 0) AS withdrawn, coalesce(rnd.randomized, 0) AS randomized,
             sum(coalesce(rnd.randomized, 0)) OVER (PARTITION BY m.trial_id ORDER BY m.month_start) AS cum_randomized,
             m.planned_cum_randomized, t.target_enrollment, act.active_sites,
             round(sum(coalesce(rnd.randomized, 0)) OVER (PARTITION BY m.trial_id ORDER BY m.month_start) / nullif(m.planned_cum_randomized, 0), 3) AS pct_of_plan
      FROM months m
      JOIN {s}.trials t ON t.trial_id = m.trial_id
      LEFT JOIN scr ON scr.trial_id = m.trial_id AND scr.m = m.month_start
      LEFT JOIN rnd ON rnd.trial_id = m.trial_id AND rnd.m = m.month_start
      LEFT JOIN act ON act.trial_id = m.trial_id AND act.month_start = m.month_start
    """)

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_site_performance
      COMMENT 'One row per trial site: status, activation, months active, screened, randomized, randomized per active month, screen-fail rate, start-up cycle time, and competing-trial overlap (REDWOOD-CKD for CASCADE-CKD) with the randomization rate before vs after the competitor opened at the site. is_zero_enroller = active ≥ 6 months with 0 randomized.'
      AS WITH scr AS (
        SELECT trial_id, site_id, count(*) AS screened, count_if(outcome = 'randomized') AS randomized,
               count_if(outcome = 'screen_failed') AS screen_failed, max(screen_date) AS last_screen_date
        FROM {s}.screening_log GROUP BY 1, 2
      ),
      comp AS (
        SELECT cts.site_id, ct.acronym, ct.indication, cts.site_activation_date
        FROM {s}.competing_trial_sites cts JOIN {s}.competing_trials ct USING (competing_trial_id)
        WHERE ct.acronym = 'REDWOOD-CKD'
      ),
      prepost AS (
        SELECT l.trial_id, l.site_id,
               count_if(l.outcome = 'randomized' AND l.screen_date < c.site_activation_date AND l.screen_date >= add_months(c.site_activation_date, -6)) AS rand_6m_before,
               count_if(l.outcome = 'randomized' AND l.screen_date >= c.site_activation_date) AS rand_since,
               greatest(months_between(current_date(), c.site_activation_date), 1) AS months_since
        FROM {s}.screening_log l JOIN comp c ON c.site_id = l.site_id
        WHERE l.trial_id = 'CASCADE-CKD' GROUP BY l.trial_id, l.site_id, c.site_activation_date
      )
      SELECT ts.trial_id, t.acronym, ts.site_id, si.site_name, si.principal_investigator, si.city, si.state, si.region,
             si.site_type, si.irb_type, si.coordinator_fte, ts.status, ts.activation_date, a.selected_date, a.cycle_time_days,
             a.days_in_startup,
             CASE WHEN ts.activation_date IS NOT NULL THEN round(months_between(current_date(), ts.activation_date), 1) END AS months_active,
             coalesce(scr.screened, 0) AS screened, coalesce(scr.randomized, 0) AS randomized,
             round(coalesce(scr.screen_failed, 0) / nullif(scr.screened, 0), 3) AS screen_fail_rate,
             round(coalesce(scr.randomized, 0) / nullif(months_between(current_date(), ts.activation_date), 0), 2) AS randomized_per_month,
             ts.target_randomized, scr.last_screen_date,
             (ts.trial_id = 'CASCADE-CKD' AND comp.site_id IS NOT NULL) AS has_competing_trial,
             CASE WHEN ts.trial_id = 'CASCADE-CKD' THEN comp.acronym END AS competing_trial,
             CASE WHEN ts.trial_id = 'CASCADE-CKD' THEN comp.site_activation_date END AS competitor_opened_date,
             round(pp.rand_6m_before / 6.0, 2) AS rand_per_month_before_competitor,
             round(pp.rand_since / pp.months_since, 2) AS rand_per_month_since_competitor,
             ts.status = 'active' AND months_between(current_date(), ts.activation_date) >= 6 AND coalesce(scr.randomized, 0) = 0 AS is_zero_enroller
      FROM {s}.trial_sites ts
      JOIN {s}.trials t ON t.trial_id = ts.trial_id
      JOIN {s}.sites si ON si.site_id = ts.site_id
      LEFT JOIN {s}.site_activation a ON a.trial_id = ts.trial_id AND a.site_id = ts.site_id
      LEFT JOIN scr ON scr.trial_id = ts.trial_id AND scr.site_id = ts.site_id
      LEFT JOIN comp ON comp.site_id = ts.site_id
      LEFT JOIN prepost pp ON pp.trial_id = ts.trial_id AND pp.site_id = ts.site_id
    """)

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_screen_fail_monthly
      COMMENT 'Trial × screening month × criterion: screen failures (and pre-randomization withdrawals) by their REAL criterion — site-coded, or read from the coordinator note by ai_classify when the site coded OTHER — next to the count the sites coded to that criterion themselves.'
      AS SELECT r.trial_id, r.screen_month, r.criterion_id, coalesce(r.criterion_name, r.criterion_id) AS criterion_name,
                r.criterion_type, count(*) AS screen_failures,
                count_if(r.criterion_source = 'site_coded') AS site_coded_failures,
                count_if(r.criterion_source = 'ai_classify') AS ai_recovered_failures,
                count_if(r.sglt2i_stable_12wk) AS stable_sglt2i_failures
         FROM {s}.screen_fail_reasons r GROUP BY ALL
    """)

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_site_features
      COMMENT 'One row per network site: features of the CASCADE-CKD site enrollment model — eligible patients within 30 miles under the current protocol and with the E4 amendment, historical enrollment (all TAs and nephrology/endocrinology), start-up speed, competing trials, CASCADE status (candidate = not selected).'
      AS WITH h AS (
        SELECT site_id, count(*) AS past_trials,
               round(avg(enroll_rate_per_month), 3) AS hist_rate_all,
               round(avg(CASE WHEN therapeutic_area IN ('Nephrology', 'Endocrinology') THEN enroll_rate_per_month END), 3) AS hist_rate_renal_metabolic,
               round(avg(screen_fail_rate), 3) AS hist_screen_fail_rate,
               cast(percentile_approx(activation_days, 0.5) AS INT) AS hist_activation_days_median,
               round(avg(protocol_deviations_per_patient), 2) AS hist_deviations_per_patient
        FROM {s}.site_trial_history GROUP BY 1
      ),
      comp AS (
        SELECT site_id, count(*) AS competing_trials_now,
               max(CASE WHEN ct.indication LIKE '%kidney%' THEN 1 ELSE 0 END) = 1 AS has_dkd_competitor,
               array_join(collect_list(ct.acronym), ', ') AS competing_trial_names
        FROM {s}.competing_trial_sites cts JOIN {s}.competing_trials ct USING (competing_trial_id)
        WHERE ct.indication LIKE '%kidney%' GROUP BY 1
      )
      SELECT si.site_id, si.site_name, si.principal_investigator, si.city, si.state, si.region, si.latitude, si.longitude,
             si.site_type, si.irb_type, si.coordinator_fte, si.therapeutic_focus, si.prior_halcyra_trials,
             coalesce(ts.status, 'candidate') AS cascade_status,
             c.t2d_ckd_patients, c.pct_on_sglt2i, c.eligible_current_protocol, c.eligible_amended_e4,
             round(c.eligible_amended_e4 / nullif(c.eligible_current_protocol, 0), 2) AS amendment_pool_multiplier,
             h.past_trials, h.hist_rate_all, coalesce(h.hist_rate_renal_metabolic, h.hist_rate_all) AS hist_rate_renal_metabolic,
             h.hist_screen_fail_rate, h.hist_activation_days_median, h.hist_deviations_per_patient,
             coalesce(comp.competing_trials_now, 0) AS competing_dkd_trials, coalesce(comp.has_dkd_competitor, false) AS has_dkd_competitor,
             comp.competing_trial_names
      FROM {s}.sites si
      JOIN {s}.site_catchment c ON c.site_id = si.site_id
      LEFT JOIN h ON h.site_id = si.site_id
      LEFT JOIN comp ON comp.site_id = si.site_id
      LEFT JOIN {s}.trial_sites ts ON ts.site_id = si.site_id AND ts.trial_id = 'CASCADE-CKD'
    """)
    for t, pk in [("gold_site_features", "site_id")]:
        spark.sql(f"ALTER TABLE {s}.{t} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {s}.{t} ADD CONSTRAINT {t}_pk PRIMARY KEY ({pk}) RELY")
    print("gold done")


if __name__ == "__main__":
    main()
