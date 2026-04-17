---
name: Streaming
category: lakeflow
disabled: false
skill: databricks-spark-structured-streaming
---

# Streaming

## What It Does

Structured Streaming and related ingestion tools (Auto Loader, Kafka, Zerobus) enable near-real-time data ingestion into Delta tables. In demos, streaming creates the sense of "live data flowing in" — transactions arriving, sensors reporting, events accumulating — that makes the demo feel dynamic rather than static.

## When to Use in a Demo

- When the demo narrative requires real-time or near-real-time data arrival — fraud transactions streaming in, IoT sensor readings, patient vitals.
- When the audience cares about latency: "How fast do we see new data?"
- When demonstrating Auto Loader for incremental file ingestion (the most common demo pattern).
- NOT required for every demo — many demos work fine with batch-loaded historical data and a pipeline refresh.

## Key Configuration Decisions

1. **Ingestion pattern:** Auto Loader for file-based ingestion (most common in demos). Kafka for event-driven architecture demos. Zerobus for Databricks-native real-time without Kafka complexity.
2. **Trigger mode:** For demos, `availableNow` in a pipeline is typical (process what's available, then stop).

The `databricks-spark-structured-streaming` ai-dev-kit skill handles all streaming configuration, checkpointing, and schema evolution details.

## Common Pitfalls

- Setting up Kafka infrastructure for a demo that does not need real-time — Auto Loader from files is far simpler and sufficient for most demo narratives.
- Forgetting checkpoints — streaming queries without checkpoints lose their progress on restart.
- Watermarks that are too tight (dropping legitimate late data) or too loose (holding too much state).
- Generating streaming data faster than the pipeline can process — this causes backpressure and demo delays.
- Mixing batch and streaming reads on the same table without understanding the consistency model.

## How It Connects to Other Components

- **Declarative pipeline:** Streaming tables in the pipeline Bronze layer use Auto Loader or Kafka sources for real-time ingestion.
- **Synthetic data gen:** For streaming demos, data generation produces files incrementally or pushes events via Zerobus.
- **Dashboard:** Real-time data means dashboards can show "live" metrics that update during the demo.
- **Databricks App:** Apps can display streaming data arrival indicators or real-time counters.
- **Lakebase:** Streaming data can be synced to Lakebase for operational consumption.

## Example Specification Snippet

```yaml
streaming:
  ingestion_pattern: auto_loader
  sources:
    - name: transactions_stream
      format: cloudFiles
      path: "/Volumes/catalog/schema/raw/transactions/"
      file_format: parquet
      schema_evolution: addNewColumns
      trigger: availableNow
      checkpoint: "/Volumes/catalog/schema/checkpoints/txn_stream/"
    - name: fraud_alerts_stream
      format: cloudFiles
      path: "/Volumes/catalog/schema/raw/fraud_alerts/"
      file_format: json
      trigger: availableNow
  # Alternative: Zerobus for real-time demo
  zerobus_alternative:
    - name: live_transactions
      table: "catalog.schema.bronze_transactions"
      sdk: python
      description: "gRPC producer pushes transaction events directly to Delta"
  # Alternative: Kafka for event-driven demo
  kafka_alternative:
    - name: transaction_events
      bootstrap_servers: "${var.kafka_bootstrap}"
      topic: "transactions"
      starting_offsets: latest
      watermark: "10 minutes"
```

## URL

https://docs.databricks.com/aws/en/structured-streaming/index.html
