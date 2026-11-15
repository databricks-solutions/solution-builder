"""
Gold layer + Unity Catalog metric view for the program-director view (dashboard + Genie).

  gold_applications          one row per application, enriched with household, county and
                             caseworker attributes + timeliness flags (30-day / 7-day expedited)
  gold_county_monthly        county × determination month: volume, on-time %, median days,
                             approval %, procedural-denial %
  gold_county_backlog        today's open caseload per county, overdue cases, caseload per worker
  mv_eligibility_processing  metric view — governed KPI definitions (timeliness, backlog, approval,
                             procedural denials) shared by the dashboard and Genie

    python build_gold.py --catalog public_sector --schema eligibility_copilot
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
    ap.add_argument("--catalog", default="public_sector")
    ap.add_argument("--schema", default="eligibility_copilot")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_applications
      COMMENT 'One row per SNAP/Medicaid application with household, county and caseworker context and timeliness flags. timeliness_standard_days = 7 for expedited SNAP, 30 for SNAP (7 CFR 273.2(g)), 45 for Medicaid (42 CFR 435.912).'
      AS SELECT
        a.application_id, a.program, a.county_name, c.region_type, a.channel, a.submitted_date,
        date_trunc('MONTH', a.submitted_date)::DATE AS submitted_month,
        a.determination_date, date_trunc('MONTH', a.determination_date)::DATE AS determination_month,
        a.status, a.determination, a.denial_reason, a.processing_days, a.days_open, a.rfi_count,
        a.expedited_screening, a.reported_monthly_income, a.monthly_benefit_amount,
        CASE WHEN a.expedited_screening THEN 7 WHEN a.program = 'Medicaid' THEN 45 ELSE 30 END AS timeliness_standard_days,
        a.determination IS NOT NULL AS is_determined,
        a.status IN ('pending_review', 'awaiting_verification') AS is_open,
        CASE WHEN a.determination IS NOT NULL
             THEN a.processing_days <= CASE WHEN a.expedited_screening THEN 7 WHEN a.program = 'Medicaid' THEN 45 ELSE 30 END END AS met_timeliness,
        a.status IN ('pending_review', 'awaiting_verification')
          AND a.days_open > CASE WHEN a.expedited_screening THEN 7 WHEN a.program = 'Medicaid' THEN 45 ELSE 30 END AS is_overdue,
        coalesce(a.denial_reason = 'failure_to_provide_verification', false) AS is_procedural_denial,
        datediff(a.first_touch_date, a.submitted_date) AS days_to_first_touch,
        h.household_size, h.children_under_18, h.elderly_or_disabled_member, h.preferred_language, h.race_ethnicity,
        a.caseworker_id, w.unit AS caseworker_unit
      FROM {s}.applications a
      JOIN {s}.households h USING (household_id)
      JOIN {s}.counties c ON c.county_name = a.county_name
      LEFT JOIN {s}.caseworkers w ON w.caseworker_id = a.caseworker_id
    """)

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_county_monthly
      COMMENT 'County x determination month: determinations, 30-day timeliness %, median processing days, approval %, procedural-denial %.'
      AS SELECT county_name, region_type, determination_month AS month,
        count(*) AS determinations,
        round(100 * avg(CAST(met_timeliness AS INT)), 1) AS on_time_pct,
        percentile(processing_days, 0.5) AS median_processing_days,
        round(100 * count_if(determination = 'APPROVED') / nullif(count_if(determination IN ('APPROVED', 'DENIED')), 0), 1) AS approval_rate_pct,
        round(100 * count_if(is_procedural_denial) / count(*), 1) AS procedural_denial_pct
      FROM {s}.gold_applications WHERE is_determined
      GROUP BY ALL
    """)

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.gold_county_backlog
      COMMENT 'Current open caseload per county: open, overdue (past the 7 / 30 / 45-day standard), average days open, open cases per eligibility worker.'
      AS SELECT c.county_name, c.region_type, c.caseworker_fte, c.caseworker_fte_prior_year,
        count_if(g.is_open) AS open_cases,
        count_if(g.is_overdue) AS overdue_cases,
        count_if(g.is_open AND g.status = 'awaiting_verification') AS awaiting_verification,
        round(avg(CASE WHEN g.is_open THEN g.days_open END), 1) AS avg_days_open,
        round(count_if(g.is_open) / c.caseworker_fte, 1) AS open_cases_per_worker
      FROM {s}.counties c LEFT JOIN {s}.gold_applications g ON g.county_name = c.county_name
      GROUP BY ALL
    """)

    spark.sql(f"""
      CREATE OR REPLACE VIEW {s}.mv_eligibility_processing
      WITH METRICS LANGUAGE YAML
      COMMENT 'Governed eligibility-processing KPIs: timeliness vs the federal standard, backlog, approval and procedural-denial rates.'
      AS $$
      version: 1.1
      source: {s}.gold_applications
      dimensions:
        - name: county
          expr: county_name
        - name: region_type
          expr: region_type
        - name: program
          expr: program
        - name: channel
          expr: channel
        - name: submitted_month
          expr: submitted_month
        - name: determination_month
          expr: determination_month
        - name: status
          expr: status
        - name: race_ethnicity
          expr: race_ethnicity
        - name: preferred_language
          expr: preferred_language
        - name: caseworker_unit
          expr: caseworker_unit
      measures:
        - name: applications
          expr: COUNT(1)
        - name: determinations
          expr: COUNT_IF(is_determined)
        - name: on_time_rate
          expr: AVG(CASE WHEN is_determined THEN CAST(met_timeliness AS INT) END)
        - name: median_processing_days
          expr: PERCENTILE(processing_days, 0.5)
        - name: approval_rate
          expr: COUNT_IF(determination = 'APPROVED') / NULLIF(COUNT_IF(determination IN ('APPROVED', 'DENIED')), 0)
        - name: procedural_denial_rate
          expr: COUNT_IF(is_procedural_denial) / NULLIF(COUNT_IF(is_determined), 0)
        - name: open_backlog
          expr: COUNT_IF(is_open)
        - name: overdue_backlog
          expr: COUNT_IF(is_overdue)
        - name: avg_days_to_first_touch
          expr: AVG(days_to_first_touch)
      $$
    """)
    for t in ["gold_applications", "gold_county_monthly", "gold_county_backlog"]:
        print(t, spark.sql(f"SELECT count(*) n FROM {s}.{t}").collect()[0]["n"])


if __name__ == "__main__":
    main()
