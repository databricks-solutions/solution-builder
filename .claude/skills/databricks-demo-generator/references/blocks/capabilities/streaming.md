---
name: Streaming
category: lakeflow
disabled: false
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

1. **Ingestion pattern:** Choose based on source type:
   - **Auto Loader (cloudFiles):** Best for file-based ingestion from volumes. Most common in demos. Incrementally processes new files as they arrive.
   - **Kafka:** For demos that emphasize event-driven architecture. Requires a Kafka cluster or Confluent Cloud.
   - **Zerobus Ingest:** Databricks-native gRPC ingestion directly into Delta tables. No message bus needed. Best for demos that want to show Databricks-native real-time without Kafka complexity.
2. **Trigger mode:** `processingTime` for continuous (e.g., every 10 seconds), `availableNow` for micro-batch (process what is available, then stop). For demos, `availableNow` in a pipeline is typical.
3. **Watermarking:** Define watermarks for late-arriving data if using windowed aggregations. Standard: 10 minutes to 1 hour depending on the use case.
4. **Schema evolution:** Auto Loader handles schema evolution automatically with `cloudFiles.schemaEvolutionMode`. Set to `addNewColumns` for demos.
5. **Checkpoint location:** Every streaming query needs a checkpoint path. Use volumes: `/Volumes/catalog/schema/checkpoints/stream_name/`.

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
