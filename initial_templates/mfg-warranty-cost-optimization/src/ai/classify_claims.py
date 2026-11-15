"""
AI Functions: turn dealer technician notes into a failure-mode signal.

Reads  <catalog>.<schema>.warranty_claims   (free-text technician_notes + customer_complaint)
Writes <catalog>.<schema>.claim_failure_modes — one row per claim:
  * failure_mode      ai_classify (v2, labels WITH descriptions from failure_mode_catalog)
  * fault_code / water_exposure / symptom / observed_damage / controller_label_lot
                      ai_extract (v2.1) typed fields
  * matches_dealer_code  does the AI mode agree with the coarse dealer labor code?

Why it matters: dealers file the new controller failures under ELEC-GEN / MOTOR / OTHER — on
labor codes alone the Hanlin water-ingress problem is invisible noise. Classified notes make it
the #1 emerging failure mode.

    python classify_claims.py --catalog manufacturing --schema warranty_copilot
"""
from __future__ import annotations

import argparse
import json

from pyspark.sql import SparkSession

LABELS = {
    "controller_water_ingress": "Motor controller failed because water / moisture got inside: corrosion, condensation, residue, cut-outs or loss of assist in rain or after washing, fault E21.",
    "controller_electrical_other": "Motor controller electronic failure with NO sign of water: overcurrent E07, burnt component, dead output phase, dry conditions.",
    "hub_motor_bearing": "Rear hub motor mechanical noise: bearing, internal gears, grinding, clicking, axle play.",
    "mid_drive_fault": "Mid-drive unit internal fault or knocking (Trail T5).",
    "torque_sensor_fault": "Torque or cadence sensor fault: late, surging, ghost or weak assist caused by the sensor.",
    "battery_bms_fault": "Battery pack will not charge, BMS lockout, cell imbalance, severe range loss — pack replaced.",
    "battery_connector_wear": "Battery connector / rail pins worn or loose causing shutdowns over bumps.",
    "charger_failure": "External charger not working.",
    "brake_caliper_leak": "Hydraulic brake caliper leaking / seeping fluid, soft lever, oil on rotor.",
    "brake_pad_noise": "Brake pads worn or squealing; normal-wear pad replacement.",
    "display_freeze_firmware": "Handlebar display freezes, locks up or reboots, fixed by firmware reflash / update.",
    "drivetrain_wear": "Chain, cassette or derailleur wear / shifting problems.",
    "frame_paint_cosmetic": "Paint, clear-coat or cosmetic frame defect.",
    "no_fault_found": "Technician could not reproduce the complaint; no part replaced.",
}

EXTRACT_SCHEMA = {
    "fault_code": {"type": "string", "description": "Display fault code mentioned, e.g. E21, E07. Empty if none."},
    "water_exposure": {"type": "boolean", "description": "True if the notes mention rain, wet weather, washing, water, moisture or condensation."},
    "symptom": {"type": "string", "description": "The rider's symptom in <= 8 words."},
    "observed_damage": {"type": "string", "description": "What the technician physically found (corrosion, residue, leak, wear...) in <= 10 words. Empty if nothing."},
    "controller_label_lot": {"type": "string", "description": "Controller lot code written in the notes, e.g. HX-2606. Empty if not mentioned."},
}

INSTRUCTIONS = (
    "These are dealer technician notes from warranty claims on Brightwater electric bicycles (hub-motor and mid-drive "
    "e-bikes). Classify by the physical root cause the technician found, not by the labor code."
)

DEALER_CODE_FOR = {
    "controller_water_ingress": "ELEC-GEN", "controller_electrical_other": "ELEC-GEN", "hub_motor_bearing": "MOTOR",
    "mid_drive_fault": "MOTOR", "torque_sensor_fault": "ELEC-GEN", "battery_bms_fault": "BATT",
    "battery_connector_wear": "BATT", "charger_failure": "CHARGER", "brake_caliper_leak": "BRAKE",
    "brake_pad_noise": "BRAKE", "display_freeze_firmware": "DISPLAY", "drivetrain_wear": "DRIVE",
    "frame_paint_cosmetic": "FRAME", "no_fault_found": "OTHER",
}


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
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    esc = lambda s: s.replace("\\", "\\\\").replace("'", "\\'")
    labels = esc(json.dumps(LABELS))
    schema_json = esc(json.dumps(EXTRACT_SCHEMA))
    instr = esc(INSTRUCTIONS)
    code_map = ", ".join(f"'{k}', '{v}'" for k, v in DEALER_CODE_FOR.items())

    spark.sql(f"""
      CREATE OR REPLACE TABLE {fqs}.claim_failure_modes
      COMMENT 'AI Functions over dealer technician notes: ai_classify failure mode (v2, described labels) + ai_extract fault code / water exposure / symptom / damage / controller lot.'
      AS
      WITH raw AS (
        SELECT claim_id, dealer_labor_code,
               concat('Complaint: ', customer_complaint, '\\nTechnician notes: ', technician_notes) AS txt
        FROM {fqs}.warranty_claims
      ),
      ai AS (
        SELECT claim_id, dealer_labor_code,
               ai_classify(txt, '{labels}', map('version', '2.0', 'instructions', '{instr}')) AS c,
               ai_extract(txt, '{schema_json}', map('version', '2.1', 'instructions', '{instr}')) AS x
        FROM raw
      )
      SELECT claim_id,
             c:response[0]::STRING AS failure_mode,
             nullif(upper(trim(x:response:fault_code:value::STRING)), '') AS fault_code,
             try_cast(x:response:water_exposure:value::STRING AS BOOLEAN) AS water_exposure,
             x:response:symptom:value::STRING AS symptom,
             nullif(x:response:observed_damage:value::STRING, '') AS observed_damage,
             nullif(upper(trim(x:response:controller_label_lot:value::STRING)), '') AS controller_label_lot,
             dealer_labor_code,
             dealer_labor_code = element_at(map({code_map}), c:response[0]::STRING) AS matches_dealer_code,
             coalesce(c:error_message::STRING, x:error_message::STRING) AS error_message,
             'ai_classify v2 + ai_extract v2.1' AS ai_model,
             current_timestamp() AS classified_at
      FROM ai
    """)
    spark.sql(f"ALTER TABLE {fqs}.claim_failure_modes ALTER COLUMN claim_id SET NOT NULL")
    spark.sql(f"ALTER TABLE {fqs}.claim_failure_modes ADD CONSTRAINT claim_failure_modes_pk PRIMARY KEY (claim_id) RELY")
    spark.sql(f"ALTER TABLE {fqs}.claim_failure_modes ADD CONSTRAINT claim_failure_modes_claim_fk FOREIGN KEY (claim_id) REFERENCES {fqs}.warranty_claims RELY")
    r = spark.sql(f"SELECT count(*) n, count_if(error_message IS NOT NULL) errs, count_if(failure_mode='controller_water_ingress') wi FROM {fqs}.claim_failure_modes").collect()[0]
    print(f"claim_failure_modes: {r['n']} rows, {r['errs']} errors, {r['wi']} water-ingress")


if __name__ == "__main__":
    main()
