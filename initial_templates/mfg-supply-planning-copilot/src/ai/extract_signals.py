"""
AI Functions: turn unstructured supplier + freight-forwarder emails into structured supply signals.

Reads  <catalog>.<schema>.supplier_messages   (raw emails: delay advisories, allocation notices, offers)
Writes <catalog>.<schema>.supplier_signals    one row per message: event type, supplier, component,
                                               affected PO numbers, new ETA, added delay days, offered
                                               price/capacity, severity + ai_extract confidence

This is how the Yantian delay reaches the planner: the forwarder's advisory is read by ai_extract
(v2.1, typed schema) and the affected POs / added days surface next to the projection in the app.

    python extract_signals.py --catalog manufacturing --schema supply_planning_copilot --warehouse-id <id>
"""
from __future__ import annotations

import argparse
import json
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

EXTRACT_SCHEMA = {
    "event_type": {"type": "enum", "labels": ["shipment_delay", "supplier_allocation", "capacity_offer", "expedite_offer",
                                                "lead_time_change", "price_change", "confirmation"]},
    "supplier_name": {"type": "string", "description": "The supplier the message is about (the manufacturer, not the freight forwarder)."},
    "component": {"type": "string", "description": "Component part number mentioned, e.g. HX-220, EN-17, PCB-MC. Empty if none."},
    "po_numbers": {"type": "array", "items": {"type": "string", "description": "Purchase order number like PO-12345"}},
    "destination_plant": {"type": "string", "description": "Corvane plant affected: Dayton, Monterrey or Wroclaw. Empty if all or none."},
    "added_delay_days": {"type": "number", "description": "Additional days of delay stated or implied (revised minus original date). 0 if none."},
    "new_eta": {"type": "string", "description": "Latest revised ETA mentioned, yyyy-mm-dd. Empty if none."},
    "offered_quantity": {"type": "number", "description": "Quantity offered (air freight pieces or capacity per month). 0 if none."},
    "offered_unit_cost": {"type": "number", "description": "Price or premium per piece offered in USD. 0 if none."},
    "severity": {"type": "enum", "labels": ["high", "medium", "low", "info"]},
    "summary": {"type": "string", "description": "One sentence for a supply planner: what changed and what it affects."},
}
INSTRUCTIONS = ("You read emails received by the supply planning team of Corvane Motion Systems (an industrial motion-components "
                "manufacturer) from suppliers and freight forwarders. Extract only what the email states. Dates ISO yyyy-mm-dd.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="supply_planning_copilot")
    ap.add_argument("--warehouse-id", "--warehouse_id", dest="warehouse_id", required=True)
    ap.add_argument("--profile", default=None)
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    w = WorkspaceClient(profile=args.profile) if args.profile else WorkspaceClient()

    def run(stmt):
        r = w.statement_execution.execute_statement(statement=stmt, warehouse_id=args.warehouse_id, wait_timeout="50s")
        while r.status.state in (StatementState.PENDING, StatementState.RUNNING):
            time.sleep(2)
            r = w.statement_execution.get_statement(r.statement_id)
        if r.status.state != StatementState.SUCCEEDED:
            raise RuntimeError(r.status.error.message if r.status.error else str(r.status.state))
        return r.result.data_array if r.result and r.result.data_array else []

    schema_json = json.dumps(EXTRACT_SCHEMA).replace("'", "\\'")
    instr = INSTRUCTIONS.replace("'", "\\'")

    def f(name, cast):
        return f"try_cast(x:response:{name}:value::STRING AS {cast}) AS {name}, try_cast(x:response:{name}:confidence_score::STRING AS DOUBLE) AS {name}_conf"

    run(f"""
      CREATE OR REPLACE TABLE {s}.supplier_signals
      COMMENT 'ai_extract (v2.1) over supplier_messages: structured supply signal per email (event type, supplier, component, affected POs, added delay days, new ETA, offers, severity, one-line summary) with confidence.'
      AS WITH raw AS (
        SELECT message_id, received_ts, sender_org, subject,
               ai_extract(concat('Subject: ', subject, '\\n\\n', body), '{schema_json}',
                          map('version', '2.1', 'enableConfidenceScores', 'true', 'instructions', '{instr}')) AS x
        FROM {s}.supplier_messages
      )
      SELECT message_id, received_ts, sender_org, subject,
             {f('event_type', 'STRING')}, {f('supplier_name', 'STRING')}, {f('component', 'STRING')},
             from_json(x:response:po_numbers::STRING, 'ARRAY<STRUCT<value: STRING>>').value AS po_numbers,
             {f('destination_plant', 'STRING')}, {f('added_delay_days', 'DOUBLE')}, {f('new_eta', 'DATE')},
             {f('offered_quantity', 'DOUBLE')}, {f('offered_unit_cost', 'DOUBLE')}, {f('severity', 'STRING')},
             {f('summary', 'STRING')},
             x:error_message::STRING AS error_message, 'ai_extract v2.1' AS extraction_model, current_timestamp() AS extracted_at
      FROM raw
    """)
    for r in run(f"SELECT message_id, event_type, component, po_numbers, added_delay_days, severity FROM {s}.supplier_signals ORDER BY message_id"):
        print("  ", r)


if __name__ == "__main__":
    main()
