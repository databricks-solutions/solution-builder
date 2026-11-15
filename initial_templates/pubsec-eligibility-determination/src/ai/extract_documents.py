"""
AI Functions: extract structured verification facts from every document on an open case.

Reads  <catalog>.<schema>.application_documents  (OCR text of paystubs, IDs, leases, …)
Writes <catalog>.<schema>.document_extractions  — one row per document, typed fields +
per-field confidence scores, produced by `ai_extract` (v2.1) running on serverless SQL.

This is what lets the caseworker workbench show "the AI already read the paystub" the
moment a case opens: gross pay, pay frequency, pay date, name, address, ID expiration,
layoff end date — each with a confidence score the UI surfaces.

    python extract_documents.py --catalog public_sector --schema eligibility_copilot
"""
from __future__ import annotations

import argparse
import json

from pyspark.sql import SparkSession

EXTRACT_SCHEMA = {
    "person_name": {"type": "string", "description": "Full name of the person the document is about (employee, tenant, card holder, account holder, signer)."},
    "issuer": {"type": "string", "description": "Organization that issued the document: employer, landlord, bank, utility, DMV or agency."},
    "document_date": {"type": "string", "description": "Primary date of the document in yyyy-mm-dd: pay date for a paystub, statement date for a bill or bank statement, lease start date, letter date, signature date."},
    "expiration_date": {"type": "string", "description": "yyyy-mm-dd expiration date of an ID card, or end date of a lease term. Empty if none."},
    "employment_end_date": {"type": "string", "description": "yyyy-mm-dd date employment ends or ended, for layoff / termination letters only."},
    "gross_pay": {"type": "number", "description": "Gross pay for this pay period (paystubs only)."},
    "pay_frequency": {"type": "enum", "labels": ["weekly", "biweekly", "semimonthly", "monthly", "not_applicable"]},
    "street_address": {"type": "string", "description": "Street address of the residence / service address / premises."},
    "city": {"type": "string"},
    "state": {"type": "string", "description": "Two-letter state code of the address (Westbrook = WB)."},
    "monthly_rent": {"type": "number", "description": "Monthly rent amount (leases only)."},
    "account_balance": {"type": "number", "description": "Ending balance (bank statements only)."},
    "declares_no_income": {"type": "boolean", "description": "True only if the document is a signed statement that the household has no income."},
}

INSTRUCTIONS = (
    "You are reading OCR text of verification documents submitted with a SNAP / Medicaid benefits application "
    "to the Westbrook Department of Human Services. Extract only what is written in the document; leave a field "
    "empty when the document does not state it. Dates must be ISO yyyy-mm-dd."
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
    ap.add_argument("--catalog", default="public_sector")
    ap.add_argument("--schema", default="eligibility_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    schema_json = json.dumps(EXTRACT_SCHEMA).replace("'", "\\'")
    instr = INSTRUCTIONS.replace("'", "\\'")

    def f(name, cast):
        return (f"try_cast(x:response:{name}:value::STRING AS {cast}) AS {name}, "
                f"try_cast(x:response:{name}:confidence_score::STRING AS DOUBLE) AS {name}_conf")

    spark.sql(f"""
      CREATE OR REPLACE TABLE {fqs}.document_extractions
      COMMENT 'ai_extract (v2.1) output for every verification document on an open case: typed fields + per-field confidence.'
      AS
      WITH raw AS (
        SELECT document_id, application_id, doc_type,
               ai_extract(document_text, '{schema_json}',
                          map('version', '2.1', 'enableConfidenceScores', 'true', 'instructions', '{instr}')) AS x
        FROM {fqs}.application_documents
      ),
      flat AS (
        SELECT document_id, application_id, doc_type,
          {f('person_name', 'STRING')}, {f('issuer', 'STRING')},
          {f('document_date', 'DATE')}, {f('expiration_date', 'DATE')}, {f('employment_end_date', 'DATE')},
          {f('gross_pay', 'DOUBLE')}, {f('pay_frequency', 'STRING')},
          {f('street_address', 'STRING')}, {f('city', 'STRING')}, {f('state', 'STRING')},
          {f('monthly_rent', 'DOUBLE')}, {f('account_balance', 'DOUBLE')}, {f('declares_no_income', 'BOOLEAN')},
          x:error_message::STRING AS error_message,
          to_json(x:response) AS extraction_json
        FROM raw
      )
      SELECT document_id, application_id, doc_type, person_name, issuer, document_date, expiration_date,
             employment_end_date, gross_pay, pay_frequency, street_address, city, upper(state) AS state,
             monthly_rent, account_balance, declares_no_income,
             round(least(coalesce(person_name_conf, 1), coalesce(document_date_conf, 1),
                         coalesce(gross_pay_conf, 1), coalesce(street_address_conf, 1),
                         coalesce(expiration_date_conf, 1)), 2) AS extraction_confidence,
             error_message, extraction_json,
             'ai_extract v2.1' AS extraction_model, current_timestamp() AS extracted_at
      FROM flat
    """)
    spark.sql(f"ALTER TABLE {fqs}.document_extractions ALTER COLUMN document_id SET NOT NULL")
    spark.sql(f"ALTER TABLE {fqs}.document_extractions ADD CONSTRAINT document_extractions_pk PRIMARY KEY (document_id) RELY")
    n = spark.sql(f"SELECT count(*) n, count_if(error_message IS NOT NULL) errs FROM {fqs}.document_extractions").collect()[0]
    print(f"document_extractions: {n['n']} rows, {n['errs']} errors")


if __name__ == "__main__":
    main()
