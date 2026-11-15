-- =====================================================================
-- AI criteria review of the OPEN prior-auth queue  (AI Functions: ai_query)
-- =====================================================================
-- For every open request, ai_query() reads the submitted clinical notes and
-- evaluates them against EVERY coverage criterion of the request's medical
-- policy, returning structured JSON (strict json_schema responseFormat):
--   per-criterion status (Met / Not Met / Not Documented) + a verbatim evidence
--   quote + the note id it came from, a recommendation (APPROVE / PEND /
--   REFER_MD — automation never denies), confidence, rationale, and the exact
--   missing information to request from the provider.
-- Outputs:
--   ai_case_review        one row per open request (+ the auto-approval rule)
--   ai_criteria_evidence  one row per request x criterion (the citations)
-- Auto-approval rule (MV-UM-000): policy auto_approval_eligible AND every
-- criterion Met AND each Met criterion cites its own distinct, specific quote
-- (>= 25 chars) AND recommendation = APPROVE AND confidence >= 0.85.
-- Runs on a SQL warehouse (src/deploy/run_sql_on_warehouse.py). ~2 min for ~200 cases.
-- =====================================================================
CREATE OR REPLACE TABLE {{CATALOG}}.{{SCHEMA}}.ai_case_review_raw AS
WITH crit AS (
  SELECT policy_id,
         concat_ws('\n', sort_array(collect_list(concat(criterion_id, ' - ', criterion_label, ': ', criterion_text)))) AS criteria_text
  FROM {{CATALOG}}.{{SCHEMA}}.policy_criteria GROUP BY policy_id),
docs AS (
  SELECT request_id,
         concat_ws('\n\n', collect_list(concat('[', note_id, ' | ', note_type, ']\n', note_text))) AS notes_text
  FROM {{CATALOG}}.{{SCHEMA}}.clinical_notes GROUP BY request_id),
q AS (
  SELECT r.request_id, r.policy_id, p.policy_title, c.criteria_text, d.notes_text
  FROM {{CATALOG}}.{{SCHEMA}}.pa_requests r
  JOIN {{CATALOG}}.{{SCHEMA}}.medical_policies p USING (policy_id)
  JOIN crit c USING (policy_id)
  JOIN docs d USING (request_id)
  WHERE r.final_outcome = 'Open')
SELECT request_id, policy_id, 'databricks-gpt-5-4-mini' AS review_model, current_timestamp() AS reviewed_at,
  ai_query('databricks-gpt-5-4-mini',
    concat('You are a utilization-management clinical reviewer at a health plan. Evaluate the clinical documentation against EVERY coverage criterion of medical policy ', policy_id, ' (', policy_title, ').\n\nCRITERIA:\n', criteria_text,
      '\n\nCLINICAL DOCUMENTATION:\n', notes_text,
      '\n\nFor each criterion return status Met (explicit supporting evidence), Not Met (the documentation contradicts it) or Not Documented (no evidence either way). Be strict: every criterion needs its OWN explicit sentence of evidence - never infer one criterion from another criterion, from the diagnosis, or from the document type (an office visit note header is not evidence of a face-to-face evaluation for the test). evidence = a short VERBATIM quote from the documentation, without surrounding quotation marks (empty string if Not Documented); source_note_id = the bracketed note id the quote comes from (empty if Not Documented). recommendation: APPROVE if every criterion is Met, PEND if any criterion is Not Documented and none is Not Met, REFER_MD if any criterion is Not Met (only a physician may deny). confidence between 0 and 1. rationale: 1-2 plain sentences for the nurse. missing_information: the specific item(s) to request from the provider (empty string if none).'),
    responseFormat => '{"type": "json_schema", "json_schema": {"name": "pa_review", "strict": true, "schema": {"type": "object", "additionalProperties": false, "required": ["criteria", "recommendation", "confidence", "rationale", "missing_information"], "properties": {"criteria": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["criterion_id", "status", "evidence", "source_note_id"], "properties": {"criterion_id": {"type": "string"}, "status": {"type": "string", "enum": ["Met", "Not Met", "Not Documented"]}, "evidence": {"type": "string"}, "source_note_id": {"type": "string"}}}}, "recommendation": {"type": "string", "enum": ["APPROVE", "PEND", "REFER_MD"]}, "confidence": {"type": "number"}, "rationale": {"type": "string"}, "missing_information": {"type": "string"}}}}}') AS review_json
FROM q;

CREATE OR REPLACE TABLE {{CATALOG}}.{{SCHEMA}}.ai_criteria_evidence
COMMENT 'AI Functions (ai_query) evidence extraction: one row per open PA request x policy criterion, with the verbatim quote and source note.'
AS
WITH x AS (
  SELECT r.request_id,
         explode(from_json(r.review_json, 'STRUCT<criteria: ARRAY<STRUCT<criterion_id: STRING, status: STRING, evidence: STRING, source_note_id: STRING>>>').criteria) AS c
  FROM {{CATALOG}}.{{SCHEMA}}.ai_case_review_raw r)
SELECT x.request_id, x.c.criterion_id, pc.criterion_number, pc.criterion_label, x.c.status,
       regexp_replace(x.c.evidence, '^["\u201c]+|["\u201d]+$', '') AS evidence_quote,
       nullif(x.c.source_note_id, '') AS source_note_id
FROM x LEFT JOIN {{CATALOG}}.{{SCHEMA}}.policy_criteria pc ON pc.criterion_id = x.c.criterion_id;

CREATE OR REPLACE TABLE {{CATALOG}}.{{SCHEMA}}.ai_case_review
COMMENT 'AI pre-review of every open PA request (ai_query over clinical notes vs. policy criteria). auto_approve_candidate = the MV-UM-000 auto-approval rule.'
AS
WITH j AS (
  SELECT r.request_id, r.policy_id, r.review_model, r.reviewed_at,
         from_json(r.review_json, 'STRUCT<recommendation: STRING, confidence: DOUBLE, rationale: STRING, missing_information: STRING>') AS v
  FROM {{CATALOG}}.{{SCHEMA}}.ai_case_review_raw r),
e AS (
  SELECT request_id,
         count_if(status = 'Met') AS n_met, count_if(status = 'Not Met') AS n_not_met,
         count_if(status = 'Not Documented') AS n_not_documented, count(*) AS n_criteria,
         -- evidence guard: every Met criterion must cite its OWN specific sentence
         (count(DISTINCT CASE WHEN status = 'Met' THEN lower(evidence_quote) END) = count_if(status = 'Met')
          AND coalesce(min(CASE WHEN status = 'Met' THEN length(evidence_quote) END), 0) >= 25
          -- boilerplate (the note header / the request line itself) is not clinical evidence
          AND count_if(status = 'Met' AND (lower(evidence_quote) LIKE 'prior authorization%'
                                           OR lower(evidence_quote) LIKE 'request prior authorization%')) = 0) AS evidence_specific
  FROM {{CATALOG}}.{{SCHEMA}}.ai_criteria_evidence GROUP BY request_id)
SELECT j.request_id, j.policy_id, v.recommendation AS ai_recommendation, round(v.confidence, 2) AS ai_confidence,
       v.rationale AS ai_rationale, nullif(v.missing_information, '') AS missing_information,
       e.n_met, e.n_not_met, e.n_not_documented, e.n_criteria,
       (e.n_met = e.n_criteria) AS all_criteria_met,
       p.auto_approval_eligible,
       e.evidence_specific,
       (p.auto_approval_eligible AND e.n_met = e.n_criteria AND e.evidence_specific AND v.recommendation = 'APPROVE' AND v.confidence >= 0.85) AS auto_approve_candidate,
       CASE WHEN p.auto_approval_eligible AND e.n_met = e.n_criteria AND e.evidence_specific AND v.recommendation = 'APPROVE' AND v.confidence >= 0.85 THEN 'Auto-approval lane'
            WHEN e.n_met = e.n_criteria AND v.recommendation = 'APPROVE' THEN 'Nurse fast-track'
            WHEN v.recommendation = 'PEND' THEN 'Request information'
            ELSE 'Physician review' END AS ai_lane,
       j.review_model, j.reviewed_at
FROM j JOIN e USING (request_id)
JOIN {{CATALOG}}.{{SCHEMA}}.medical_policies p ON p.policy_id = j.policy_id;

ALTER TABLE {{CATALOG}}.{{SCHEMA}}.ai_case_review ALTER COLUMN ai_lane COMMENT 'Auto-approval lane (automation may approve), Nurse fast-track (all met, policy needs nurse sign-off), Request information (pend), Physician review (possible denial)';
