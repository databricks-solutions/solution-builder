"""
AI Functions over every inbound passenger message (Winter Storm Harlan) → message_insights.

  ai_translate        normalise every message to English (Spanish / German messages keep their meaning)
  ai_classify         intent (rebook / refund / hotel / connection / special assistance / complaint / baggage / praise)
  ai_classify         urgency  (urgent life event / vulnerable passenger / time-critical connection / routine)
  ai_analyze_sentiment
  ai_summarize        a one-line summary for the desk

escalate = urgency is not routine, or a negative complaint from a Platinum/Diamond member.
The IROPS desk agent reads these per passenger and bumps escalations in its priority order.

    python message_insights.py --catalog retail_consumer_goods --schema travel_disruption_copilot
"""
import argparse
import json

INTENTS = json.dumps({
    "rebook_request": "wants a different or earlier flight",
    "refund_request": "wants a refund or to cancel the trip",
    "hotel_or_care": "asks about a hotel, meals or where to stay",
    "connection_at_risk": "worried about missing an onward connecting flight",
    "special_assistance": "needs help for a child travelling alone, wheelchair, baby, medical need",
    "complaint": "angry about how the disruption is handled",
    "baggage": "asks where a checked bag is",
    "praise": "thanks or praises staff",
})
URGENCY = json.dumps({
    "urgent_life_event": "funeral, medical emergency, birth, wedding or similar event the passenger must reach",
    "vulnerable_passenger": "child travelling alone, wheelchair user, elderly, medical need or medication, travelling with a baby",
    "missed_onward_connection": "passenger explicitly mentions an onward connecting flight they will miss",
    "routine": "everything else: general rebooking, refunds, hotels, complaints, baggage, praise",
})

from pyspark.sql import SparkSession


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="retail_consumer_goods")
    ap.add_argument("--schema", default="travel_disruption_copilot")
    a, _ = ap.parse_known_args()
    fqs = f"{a.catalog}.{a.schema}"
    spark = get_spark()
    sql = """
    CREATE OR REPLACE TABLE {fqs}.message_insights
    COMMENT 'AI Functions over passenger_messages: English text, intent, urgency, sentiment, one-line summary and an escalate flag.'
    AS
    WITH en AS (
      SELECT m.*, ai_translate(m.message_text, 'en') AS message_english
      FROM {fqs}.passenger_messages m
    ), cls AS (
      SELECT en.*,
        get_json_object(CAST(ai_classify(message_english, '{INTENTS}') AS STRING), '$.response[0]') AS intent,
        get_json_object(CAST(ai_classify(message_english, '{URGENCY}') AS STRING), '$.response[0]') AS urgency,
        ai_analyze_sentiment(message_english) AS sentiment,
        ai_summarize(message_english, 14) AS summary
      FROM en
    )
    SELECT c.message_id, c.pax_id, c.pnr, c.disrupted_flight_id, c.received_ts, c.channel, c.message_text,
           c.message_english, c.intent, c.urgency, c.sentiment, c.summary,
           (c.urgency <> 'routine' OR (c.sentiment = 'negative' AND c.intent = 'complaint'
             AND p.loyalty_tier IN ('Platinum', 'Diamond'))) AS escalate
    FROM cls c JOIN {fqs}.passengers p ON p.pax_id = c.pax_id
    """.replace("{fqs}", fqs).replace("{INTENTS}", INTENTS).replace("{URGENCY}", URGENCY)
    spark.sql(sql)
    for r in spark.sql(f"SELECT intent, urgency, COUNT(*) n, SUM(CAST(escalate AS INT)) esc FROM {fqs}.message_insights "
                       f"GROUP BY ALL ORDER BY n DESC").collect():
        print(r)


if __name__ == "__main__":
    main()
