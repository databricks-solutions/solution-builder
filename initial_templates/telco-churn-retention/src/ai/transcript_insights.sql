-- Voice of the customer: AI Functions over every call-center transcript (last ~90 days).
-- Runs on a SQL warehouse (DAB task src/deploy/run_sql_on_warehouse.py). {{CATALOG}}/{{SCHEMA}}
-- are substituted at run time.
--   ai_analyze_sentiment -> positive / negative / neutral / mixed
--   ai_classify          -> primary intent (7 labels) and an explicit cancel-threat flag
--   ai_extract           -> competitor named + the remedy the customer asked for
--   ai_summarize         -> one-line summary the Retention Desk shows next to the call
CREATE OR REPLACE TABLE `{{CATALOG}}`.`{{SCHEMA}}`.care_call_insights
COMMENT 'AI Functions output per call transcript: sentiment, intent, cancel threat, competitor mentioned, requested remedy, one-line summary.'
AS
SELECT
  call_id, customer_id, call_ts, reason_code, agent_id, disposition,
  ai_analyze_sentiment(transcript)                                         AS sentiment,
  ai_classify(transcript, ARRAY('network_complaint','bill_shock','competitor_offer',
                                'device_support','plan_change','billing_dispute')) AS primary_intent,
  ai_classify(transcript, ARRAY('threatening_to_cancel','not_threatening_to_cancel')) = 'threatening_to_cancel' AS cancel_threat,
  ai_extract(transcript, ARRAY('competitor','requested_remedy'))           AS extracted,
  ai_summarize(transcript, 20)                                             AS summary,
  transcript
FROM `{{CATALOG}}`.`{{SCHEMA}}`.care_calls
WHERE transcript IS NOT NULL;
