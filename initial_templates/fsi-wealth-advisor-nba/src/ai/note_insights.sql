-- Calder Pine — AI Functions over advisor CRM notes (last 60 days).
-- Reads the free text advisors and client-service associates type after every call and turns it into
-- structured money-in-motion signals the Morning Book can rank: what happened, how much, when, who else is
-- involved (an heir, another firm), and how the client feels.
-- Each DISTINCT note text is read once (CRM quick-note templates repeat thousands of times) and joined back.
-- Run on a SQL warehouse; ${catalog}/${schema} are substituted by src/deploy/run_sql.py (or replace by hand).
CREATE OR REPLACE TABLE ${catalog}.${schema}.note_insights
COMMENT 'AI Functions over advisor CRM notes (last 60 days): ai_classify signal category, ai_extract amount / timeframe / family member / other institution, ai_analyze_sentiment. flight_risk_mention = the note names another financial institution or an intent to move assets.'
AS
WITH n AS (
  SELECT * FROM ${catalog}.${schema}.advisor_notes WHERE note_date >= DATE'2026-07-30'
),
texts AS (SELECT /*+ REPARTITION(48) */ note_text FROM (SELECT DISTINCT note_text FROM n)),
ai AS (
  SELECT note_text,
    ai_classify(note_text, ARRAY(
      'bereavement', 'inheritance', 'retirement', 'job change', 'business sale', 'home purchase or financing',
      'education funding', 'new grandchild', 'divorce', 'cash or interest rate question', 'intent to move assets',
      'routine service')) AS signal_category,
    ai_extract(note_text, ARRAY('dollar_amount', 'timeframe', 'family_member', 'other_financial_institution_name')) AS ex,
    ai_analyze_sentiment(note_text) AS sentiment
  FROM texts
)
SELECT n.note_id, n.household_id, n.advisor_id, n.note_date, n.channel, n.note_text, ai.signal_category,
       ai.ex.dollar_amount AS mentioned_amount, ai.ex.timeframe AS mentioned_timeframe,
       ai.ex.family_member AS family_member, ai.ex.other_financial_institution_name AS other_institution,
       ai.sentiment,
       ai.signal_category NOT IN ('routine service', 'cash or interest rate question') AS is_money_in_motion,
       (ai.ex.other_financial_institution_name IS NOT NULL AND ai.ex.other_financial_institution_name NOT RLIKE '(?i)employer|plan|401|online bank|calder')
         OR ai.signal_category = 'intent to move assets' AS flight_risk_mention
FROM n JOIN ai USING (note_text);
