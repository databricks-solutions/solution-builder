"""
Submission intake with AI Functions: turn every broker PDF in the queue into structured underwriting data.

  ai_parse_document   application / statement-of-values / loss-run PDFs → layout-aware text + tables
                      → submission_documents_parsed
  ai_query            (JSON-schema structured output) per document type:
                        APPLICATION → application_extract   (what the broker SAYS: TIV, construction, roof, sprinklers, losses)
                        SOV         → sov_locations          (what the SCHEDULE says, one row per building)
                        LOSS_RUN    → loss_run_claims + loss_run_summary (what the prior CARRIER says)
  ai_classify         business description → underwriting segment (application_extract.segment_code)

The workbench and the triage compare the three sources — "underwrite the documents, not the application"
(TSI-DOC-04 §3.2). A self-check at the end fails the task if the hero packet (SUB-26-0417) was mis-read.

    python extract_submissions.py --catalog financial_services --schema commercial_underwriting_copilot
"""
import argparse
import json

from pyspark.sql import SparkSession

MODEL = "databricks-gpt-5-4-mini"

NUM, INT, STR, BOOL = {"type": "number"}, {"type": "integer"}, {"type": "string"}, {"type": "boolean"}
NNUM = {"type": ["number", "null"]}


def obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


APP_SCHEMA = obj({
    "insured_name": STR, "business_description": STR, "naics": STR, "years_in_business": INT, "broker_name": STR, "broker_contact": STR,
    "effective_date": STR, "premises_state": STR, "locations_count": INT, "total_tiv": NUM, "construction": STR, "year_built": INT, "roof_year": INT,
    "sprinklered": BOOL, "protection_class": INT, "annual_revenue": NUM, "prior_carrier": STR, "expiring_premium": NNUM,
    "stated_loss_count": INT, "stated_loss_amount": NUM, "target_premium": NNUM, "remarks": STR,
})
SOV_SCHEMA = obj({"locations": {"type": "array", "items": obj({
    "loc_no": INT, "building_name": STR, "address": STR, "city": STR, "state": STR, "construction": STR, "year_built": INT,
    "roof_year": INT, "stories": INT, "units": INT, "sprinklered": BOOL, "protection_class": INT, "tiv": NUM})},
    "total_tiv": NUM})
LR_SCHEMA = obj({"carrier": STR, "valuation_date": STR, "years_covered": INT, "total_incurred": NUM, "claims": {"type": "array", "items": obj({
    "loss_date": STR, "claim_number": STR, "line": STR, "loc_no": INT, "cause": STR, "paid": NUM, "reserve": NUM,
    "total_incurred": NUM, "status": STR})}})

PROMPTS = {
    "APPLICATION": "You read commercial insurance applications (ACORD 125/140 format). Extract the fields exactly as written on the form. "
                   "Dates as YYYY-MM-DD. Money as plain numbers in USD. Use null for a premium shown as '-' or 'not disclosed'.",
    "SOV": "You read commercial property statements of values. Extract EVERY location row exactly as written (do not include the TOTAL row "
           "as a location). units = 0 when shown as '-'. sprinklered = true only when the column says Y.",
    "LOSS_RUN": "You read insurance carrier loss run reports. Extract the carrier, the valuation date (YYYY-MM-DD), how many years are "
                "covered, and EVERY claim row (not the TOTAL row) with dates as YYYY-MM-DD and amounts as plain numbers. "
                "If the report says no losses were reported, return an empty claims array and total_incurred 0.",
}

SEGMENTS = json.dumps({
    "HAB": "apartments, condominiums, residential rental communities",
    "RET": "shopping centers, retail stores, restaurants, grocery",
    "MFG": "manufacturing, fabrication, processing plants",
    "WHS": "warehousing, cold storage, logistics and distribution",
    "OFF": "office buildings, medical or professional offices",
    "HOS": "hotels, motels, lodging",
})


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def fmt(schema: dict, name: str) -> str:
    rf = {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}}
    return json.dumps(rf).replace("'", "\\'")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="financial_services")
    ap.add_argument("--schema", default="commercial_underwriting_copilot")
    a, _ = ap.parse_known_args()
    s = f"{a.catalog}.{a.schema}"
    vol = f"/Volumes/{a.catalog}/{a.schema}/submission_docs"
    spark = get_spark()

    print("ai_parse_document over every submission PDF…")
    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.submission_documents_parsed
    COMMENT 'ai_parse_document output for every submission PDF: layout-aware text (tables as HTML) the extractors read.'
    AS
    WITH files AS (
      SELECT regexp_replace(path, '^dbfs:', '') AS file_path, content
      FROM read_files('{vol}/*/*.pdf', format => 'binaryFile')
    ), parsed AS (
      SELECT d.doc_id, d.submission_id, d.doc_type, d.file_path, ai_parse_document(f.content, map('version', '2.0')) AS parsed
      FROM {s}.submission_documents d JOIN files f ON f.file_path = d.file_path
    )
    SELECT doc_id, submission_id, doc_type, file_path,
           concat_ws('\\n', transform(parsed:document:elements::ARRAY<STRUCT<content:STRING, type:STRING>>, e -> e.content)) AS text,
           CAST(parsed:error_status AS STRING) AS parse_error,
           size(parsed:document:elements::ARRAY<STRUCT<content:STRING>>) AS elements,
           current_timestamp() AS parsed_at
    FROM parsed
    """)
    print(spark.sql(f"SELECT doc_type, COUNT(*) n, SUM(CAST(parse_error IS NOT NULL AS INT)) errors FROM {s}.submission_documents_parsed GROUP BY 1").collect())

    def extract(doc_type: str, schema: dict, table: str):
        prompt = PROMPTS[doc_type].replace("'", "\\'")
        spark.sql(f"""
        CREATE OR REPLACE TABLE {s}.{table} AS
        SELECT submission_id, doc_id,
               ai_query('{MODEL}', concat('{prompt}\\n\\nDOCUMENT:\\n', text), responseFormat => '{fmt(schema, table)}') AS raw
        FROM {s}.submission_documents_parsed WHERE doc_type = '{doc_type}'
        """)

    print("ai_query structured extraction (application / SOV / loss run)…")
    extract("APPLICATION", APP_SCHEMA, "_x_application")
    extract("SOV", SOV_SCHEMA, "_x_sov")
    extract("LOSS_RUN", LR_SCHEMA, "_x_loss_run")

    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.application_extract
    COMMENT 'What the broker SAYS: fields extracted by ai_query from each ACORD-format application PDF (+ ai_classify segment).'
    AS
    WITH j AS (SELECT submission_id, doc_id, from_json(raw, '{spark_schema_app()}') a FROM {s}._x_application)
    SELECT j.submission_id, j.doc_id, a.insured_name, a.business_description, a.naics, a.years_in_business, a.broker_name, a.broker_contact,
           try_cast(a.effective_date AS DATE) AS effective_date, upper(a.premises_state) AS premises_state, a.locations_count, a.total_tiv, a.construction, a.year_built, a.roof_year,
           a.sprinklered, a.protection_class, a.annual_revenue, a.prior_carrier, a.expiring_premium, a.stated_loss_count,
           a.stated_loss_amount, a.target_premium, a.remarks,
           get_json_object(CAST(ai_classify(a.business_description, '{SEGMENTS}') AS STRING), '$.response[0]') AS segment_code
    FROM j
    """)
    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.sov_locations
    COMMENT 'What the SCHEDULE says: one row per building, extracted by ai_query from each statement-of-values PDF.'
    AS
    SELECT x.submission_id, x.doc_id, l.loc_no, l.building_name, l.address, l.city, upper(l.state) AS state, l.construction, l.year_built,
           l.roof_year, 2026 - l.roof_year AS roof_age_years, l.stories, l.units, l.sprinklered, l.protection_class, l.tiv,
           (l.city ILIKE '%beach%' AND upper(l.state) = 'FL') AS coastal_tier1
    FROM (SELECT submission_id, doc_id, from_json(raw, '{spark_schema_sov()}') v FROM {s}._x_sov) x
    LATERAL VIEW explode(x.v.locations) t AS l
    """)
    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.loss_run_summary
    COMMENT 'What the prior CARRIER says: loss-run header extracted by ai_query (carrier, valuation date, years covered, total incurred).'
    AS
    SELECT submission_id, doc_id, v.carrier, try_cast(v.valuation_date AS DATE) AS valuation_date, v.years_covered, v.total_incurred,
           size(v.claims) AS claim_count
    FROM (SELECT submission_id, doc_id, from_json(raw, '{spark_schema_lr()}') v FROM {s}._x_loss_run)
    """)
    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.loss_run_claims
    COMMENT 'Every claim row on the prior-carrier loss runs, extracted by ai_query (loss date, location, cause, paid, reserve, incurred).'
    AS
    SELECT x.submission_id, x.doc_id, c.claim_number, try_cast(c.loss_date AS DATE) AS loss_date, c.line, c.loc_no, c.cause,
           c.paid, c.reserve, c.total_incurred, c.status,
           (lower(c.cause) LIKE '%hail%' OR lower(c.cause) LIKE '%wind%') AS wind_hail
    FROM (SELECT submission_id, doc_id, from_json(raw, '{spark_schema_lr()}') v FROM {s}._x_loss_run) x
    LATERAL VIEW explode(x.v.claims) t AS c
    """)
    for t in ["_x_application", "_x_sov", "_x_loss_run"]:
        spark.sql(f"DROP TABLE IF EXISTS {s}.{t}")

    # ── self-check: the hero packet must be read correctly or the demo story breaks ──
    app = spark.sql(f"SELECT * FROM {s}.application_extract WHERE submission_id = 'SUB-26-0417'").collect()[0]
    cedar = spark.sql(f"SELECT * FROM {s}.sov_locations WHERE submission_id = 'SUB-26-0417' AND loc_no = 3").collect()[0]
    lr = spark.sql(f"SELECT COUNT(*) n, ROUND(SUM(total_incurred)) inc FROM {s}.loss_run_claims WHERE submission_id = 'SUB-26-0417'").collect()[0]
    tiv = spark.sql(f"SELECT ROUND(SUM(tiv)) t FROM {s}.sov_locations WHERE submission_id = 'SUB-26-0417'").collect()[0]["t"]
    checks = {
        "application roof_year 2019": app["roof_year"] == 2019, "application losses 1": app["stated_loss_count"] == 1,
        "application segment HAB": app["segment_code"] == "HAB",
        "Cedar Hollow roof 2004": cedar["roof_year"] == 2004, "Cedar Hollow frame": "frame" in cedar["construction"].lower(),
        "Cedar Hollow unsprinklered": cedar["sprinklered"] is False, "loss run 4 claims": lr["n"] == 4,
        "loss run $369,300": abs((lr["inc"] or 0) - 369300) < 1, "SOV TIV $38.6M": abs((tiv or 0) - 38600000) < 1,
    }
    for k, ok in checks.items():
        print(f"  {'OK ' if ok else 'BAD'} {k}")
    counts = spark.sql(f"""SELECT (SELECT COUNT(*) FROM {s}.application_extract) apps, (SELECT COUNT(*) FROM {s}.sov_locations) locs,
                           (SELECT COUNT(*) FROM {s}.loss_run_claims) claims,
                           (SELECT COUNT(*) FROM {s}.application_extract WHERE segment_code IS NULL) unclassified""").collect()[0]
    print(counts)
    if not all(checks.values()):
        raise RuntimeError(f"Hero packet mis-extracted: {[k for k, v in checks.items() if not v]}")


def spark_schema_app() -> str:
    return ("STRUCT<insured_name:STRING, business_description:STRING, naics:STRING, years_in_business:INT, broker_name:STRING, "
            "broker_contact:STRING, effective_date:STRING, premises_state:STRING, locations_count:INT, total_tiv:DOUBLE, construction:STRING, year_built:INT, "
            "roof_year:INT, sprinklered:BOOLEAN, protection_class:INT, annual_revenue:DOUBLE, prior_carrier:STRING, expiring_premium:DOUBLE, "
            "stated_loss_count:INT, stated_loss_amount:DOUBLE, target_premium:DOUBLE, remarks:STRING>")


def spark_schema_sov() -> str:
    return ("STRUCT<locations:ARRAY<STRUCT<loc_no:INT, building_name:STRING, address:STRING, city:STRING, state:STRING, construction:STRING, "
            "year_built:INT, roof_year:INT, stories:INT, units:INT, sprinklered:BOOLEAN, protection_class:INT, tiv:DOUBLE>>, total_tiv:DOUBLE>")


def spark_schema_lr() -> str:
    return ("STRUCT<carrier:STRING, valuation_date:STRING, years_covered:INT, total_incurred:DOUBLE, claims:ARRAY<STRUCT<loss_date:STRING, "
            "claim_number:STRING, line:STRING, loc_no:INT, cause:STRING, paid:DOUBLE, reserve:DOUBLE, total_incurred:DOUBLE, status:STRING>>>")


if __name__ == "__main__":
    main()
