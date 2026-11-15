"""
AI Functions over the screening log — recover the real screen-failure reason from the coordinators' free text.

Sites code a screen failure to a protocol criterion in the EDC, but ~1 in 3 CASCADE-CKD failures is coded
"OTHER" with a free-text note ("Pt on Jardiance 10 mg since Mar 2025 — PI declined to wash out"). The coded
report therefore UNDER-counts the real driver. This task:

  1. ai_classify  — every OTHER-coded failure → the protocol criterion the note describes
  2. ai_query     — every SGLT2i (E4) failure → how many months the patient has been on the SGLT2 inhibitor,
                    so we know who would be eligible under a "stable background SGLT2i ≥ 12 weeks" amendment

Output: screen_fail_reasons (one row per screen failure / pre-randomization withdrawal, all trials).

    python classify_screen_fails.py --catalog healthcare_lifesciences --schema trial_site_selection
"""
from __future__ import annotations

import argparse

from pyspark.sql import SparkSession

LABELS = {
    "E4_sglt2_inhibitor": "E4", "I3_uacr_albuminuria": "I3", "I2_egfr": "I2", "E7_potassium": "E7", "I4_hba1c": "I4",
    "I5_acei_arb_background": "I5", "E3_recent_cv_event": "E3", "E5_mra_use": "E5", "E1_non_diabetic_ckd": "E1",
    "consent_withdrawn_or_lost": "CONSENT_WITHDRAWN",
}
EXTRACT_MODEL = "databricks-gpt-oss-20b"


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
    labels_sql = ", ".join(f"'{k}'" for k in LABELS)
    mapping = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in LABELS.items())

    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.screen_fail_reasons
      COMMENT 'One row per screen failure / pre-randomization withdrawal. criterion_id = the site-coded criterion, or — when the site coded OTHER — the criterion ai_classify read from the coordinator note (criterion_source). For SGLT2i (E4) failures, sglt2i_months (ai_query over the note) and sglt2i_stable_12wk tell who a stable-background-SGLT2i amendment would bring back.'
      AS
      WITH fails AS (
        SELECT l.screening_id, l.trial_id, l.site_id, l.screen_date, date_trunc('MONTH', l.screen_date)::DATE AS screen_month,
               l.outcome, l.coded_reason, l.coordinator_note
        FROM {s}.screening_log l
        WHERE l.outcome IN ('screen_failed', 'withdrawn')
      ),
      classified AS (
        SELECT *,
          CASE WHEN coded_reason = 'OTHER'
               THEN CASE ai_classify(coordinator_note, array({labels_sql})) {mapping} ELSE 'OTHER' END
               ELSE coded_reason END AS criterion_id,
          CASE WHEN coded_reason = 'OTHER' THEN 'ai_classify' ELSE 'site_coded' END AS criterion_source
        FROM fails
      ),
      extracted AS (
        SELECT c.*,
          CASE WHEN c.criterion_id = 'E4' THEN ai_query('{EXTRACT_MODEL}',
                 concat('Screening date: ', CAST(c.screen_date AS STRING), '. Coordinator note: ', c.coordinator_note,
                        '. How many full months before the screening date did the patient start their current SGLT2 inhibitor? ',
                        'If the note gives a start month, count the months from it; if it says on it N months, use N. ',
                        'Answer with an integer only, or -1 if unknown.'),
                 returnType => 'INT') END AS sglt2i_months
        FROM classified c
      )
      SELECT e.*, CASE WHEN e.criterion_id = 'E4' THEN e.sglt2i_months >= 3 END AS sglt2i_stable_12wk,
             pc.short_name AS criterion_name, pc.criterion_type
      FROM extracted e
      LEFT JOIN {s}.protocol_criteria pc ON pc.trial_id = e.trial_id AND pc.criterion_id = e.criterion_id
    """)
    spark.sql(f"COMMENT ON TABLE {s}.screen_fail_reasons IS 'One row per screen failure / pre-randomization withdrawal (all trials). criterion_id = site-coded criterion, or the criterion ai_classify read from the coordinator note when the site coded OTHER (criterion_source). E4 rows: sglt2i_months via ai_query, sglt2i_stable_12wk = on a stable SGLT2i ≥ 12 weeks (eligible under the proposed amendment).'")
    spark.sql(f"ALTER TABLE {s}.screen_fail_reasons ALTER COLUMN screening_id SET NOT NULL")
    spark.sql(f"ALTER TABLE {s}.screen_fail_reasons ADD CONSTRAINT screen_fail_reasons_pk PRIMARY KEY (screening_id) RELY")
    r = spark.sql(f"""SELECT criterion_source, count(*) n FROM {s}.screen_fail_reasons WHERE trial_id='CASCADE-CKD' GROUP BY 1""").collect()
    print({x["criterion_source"]: x["n"] for x in r})


if __name__ == "__main__":
    main()
