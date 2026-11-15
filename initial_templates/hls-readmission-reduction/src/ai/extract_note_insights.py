"""
AI Functions over the discharge summaries — read what the structured EHR fields don't carry.

The discharge record says whether a 7-day follow-up was booked and whether the patient lives alone (registration
screen). It does NOT say that the patient "does not drive and has no reliable ride", that the diuretic was doubled
with no lab check ordered, or that the follow-up was left as "patient to call the clinic Monday". Those live in the
free text. This task runs ONE ai_query per note with a typed responseFormat (a STRUCT) so every field lands as a
real column:

  lives_alone, transportation_barrier, medication_affordability, caregiver_support, language_barrier,
  high_risk_med_change (anticoagulant / diuretic / RAAS / insulin / opioid start or dose change), med_changes (array),
  followup_status (booked | patient_to_call | not_arranged), pending_labs, sdoh_summary (one line for the coordinator)

Output: discharge_note_insights (one row per discharge note). Accuracy vs the generator ground truth is printed
(note_truth — never used by the app).

    python extract_note_insights.py --catalog healthcare_lifesciences --schema readmission_reduction
"""
from __future__ import annotations

import argparse
import json

from pyspark.sql import SparkSession

MODEL = "databricks-gpt-5-4-mini"
FIELDS = {"lives_alone": "boolean", "transportation_barrier": "boolean", "medication_affordability": "boolean",
          "caregiver_support": "boolean", "language_barrier": "boolean", "high_risk_med_change": "boolean",
          "med_changes": "array", "followup_status": "string", "pending_labs": "string", "sdoh_summary": "string"}
# OpenAI-style strict JSON schema for ai_query's responseFormat, and the matching Spark DDL to parse it.
RESPONSE_FORMAT = json.dumps({"type": "json_schema", "json_schema": {"name": "insights", "strict": True, "schema": {
    "type": "object", "additionalProperties": False, "required": list(FIELDS),
    "properties": {k: ({"type": "array", "items": {"type": "string"}} if t == "array" else
                       {"type": "string", "enum": ["booked", "patient_to_call", "not_arranged"]} if k == "followup_status" else {"type": t})
                   for k, t in FIELDS.items()}}}})
DDL = "STRUCT<" + ", ".join(f"{k}: {'ARRAY<STRING>' if t == 'array' else t.upper()}" for k, t in FIELDS.items()) + ">"
PROMPT = (
    "You read hospital discharge notes for a care-transitions team. Extract, from the note only:\\n"
    "- lives_alone: the patient lives alone.\\n"
    "- transportation_barrier: the note says the patient cannot reliably get to appointments (does not drive, no car, no ride, bus route cut).\\n"
    "- medication_affordability: the note mentions cost / copay problems with medications.\\n"
    "- caregiver_support: someone at home will help (spouse, son, daughter living with the patient).\\n"
    "- language_barrier: preferred language is not English or an interpreter was used.\\n"
    "- high_risk_med_change: a new start or dose change of a diuretic, anticoagulant, antiplatelet, RAAS agent (ARNI/ACEi/ARB/MRA), antiarrhythmic, insulin, opioid, or new home oxygen.\\n"
    "- med_changes: each medication change as a short phrase (e.g. \"furosemide 40 -> 80 mg daily\").\\n"
    "- followup_status: \"booked\" if a follow-up appointment date is scheduled; \"patient_to_call\" if the patient was told to call or arrange it; \"not_arranged\" otherwise.\\n"
    "- pending_labs: labs the note says are needed after discharge, or an empty string.\\n"
    "- sdoh_summary: one short sentence on social risks for the coordinator (empty string if none).\\n"
    "NOTE:\\n"
)


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
    spark.sql(f"""
      CREATE OR REPLACE TABLE {s}.discharge_note_insights AS
      WITH x AS (
        SELECT n.encounter_id, n.note_date,
               ai_query('{MODEL}', concat('{PROMPT}', n.note_text), responseFormat => '{RESPONSE_FORMAT}') AS j
        FROM {s}.discharge_notes n
      ),
      p AS (SELECT encounter_id, note_date, from_json(j, '{DDL}') AS i FROM x)
      SELECT encounter_id, note_date,
             coalesce(i.lives_alone, false) AS lives_alone,
             coalesce(i.transportation_barrier, false) AS transportation_barrier,
             coalesce(i.medication_affordability, false) AS medication_affordability,
             coalesce(i.caregiver_support, false) AS caregiver_support,
             coalesce(i.language_barrier, false) AS language_barrier,
             coalesce(i.high_risk_med_change, false) AS high_risk_med_change,
             coalesce(i.med_changes, array()) AS med_changes,
             CASE WHEN i.followup_status IN ('booked', 'patient_to_call', 'not_arranged') THEN i.followup_status ELSE 'not_arranged' END AS followup_status,
             nullif(i.pending_labs, '') AS pending_labs,
             nullif(i.sdoh_summary, '') AS sdoh_summary,
             '{MODEL}' AS extracted_by
      FROM p
    """)
    spark.sql(f"COMMENT ON TABLE {s}.discharge_note_insights IS 'AI Functions (ai_query with a strict JSON-schema responseFormat, {MODEL}) over every discharge note: social risks the structured record does not carry (transportation_barrier, medication_affordability, caregiver_support, language_barrier), high-risk medication changes, the follow-up status as written in the note (booked / patient_to_call / not_arranged), pending labs and a one-line SDOH summary. One row per discharge note (last ~120 days + planned discharges).'")
    spark.sql(f"ALTER TABLE {s}.discharge_note_insights ALTER COLUMN encounter_id SET NOT NULL")
    spark.sql(f"ALTER TABLE {s}.discharge_note_insights ADD CONSTRAINT discharge_note_insights_pk PRIMARY KEY (encounter_id) RELY")
    r = spark.sql(f"""
      SELECT count(*) AS n,
             round(avg(CAST(i.transportation_barrier = t.transportation_barrier AS INT)), 3) AS acc_transport,
             round(avg(CAST(i.lives_alone = t.lives_alone AS INT)), 3) AS acc_lives_alone,
             round(avg(CAST(i.medication_affordability = t.medication_affordability AS INT)), 3) AS acc_afford,
             round(avg(CAST(i.high_risk_med_change = t.high_risk_med_change AS INT)), 3) AS acc_med,
             round(avg(CAST(i.followup_status = t.followup_status AS INT)), 3) AS acc_followup,
             count_if(i.transportation_barrier) AS transport_found
      FROM {s}.discharge_note_insights i JOIN {s}.note_truth t USING (encounter_id)""").collect()[0]
    print(r.asDict())


if __name__ == "__main__":
    main()
