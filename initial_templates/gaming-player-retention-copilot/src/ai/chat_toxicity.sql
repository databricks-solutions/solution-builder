-- Player safety: AI Functions over the chat moderation queue (lines flagged by the keyword
-- filter or a player report). Runs on a SQL warehouse (DAB task src/deploy/run_sql_on_warehouse.py).
-- {{CATALOG}}/{{SCHEMA}} are substituted at run time.
--   ai_classify          -> harassment / threat / scam / trash_talk / friendly
--   ai_analyze_sentiment -> positive / negative / neutral / mixed
-- The keyword filter flags harmless competitive banter ("gg ez, get rekt") exactly like real
-- harassment. is_harmful separates them: only harmful messages count as a toxic encounter in
-- the churn model's features (src/ml/train_models.py).
CREATE OR REPLACE TABLE `{{CATALOG}}`.`{{SCHEMA}}`.chat_insights
COMMENT 'AI Functions output per flagged chat line: toxicity label (harassment / threat / scam / trash_talk / friendly), is_harmful (harassment, threat or scam), sentiment. recipient_player_id = the player who received the message.'
AS
WITH c AS (
  SELECT *, ai_classify(message_text, ARRAY('harassment', 'threat', 'scam', 'trash_talk', 'friendly')) AS toxicity_label
  FROM `{{CATALOG}}`.`{{SCHEMA}}`.chat_messages)
SELECT message_id, sent_at, CAST(sent_at AS DATE) AS sent_date, channel, flag_source,
       sender_player_id, recipient_player_id, message_text,
       toxicity_label,
       toxicity_label IN ('harassment', 'threat', 'scam') AS is_harmful,
       ai_analyze_sentiment(message_text) AS sentiment
FROM c;
