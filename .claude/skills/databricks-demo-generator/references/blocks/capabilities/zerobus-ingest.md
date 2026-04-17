---
name: Zerobus Ingest
category: lakeflow
disabled: false
buildable: false
skill: databricks-zerobus-ingest
---

# Zerobus Ingest

Serverless **push-based ingestion API** that writes data directly into Unity Catalog Delta tables.

## Pain

Building real-time data pipelines requires message brokers (Kafka, Kinesis), cluster management, and custom consumers. IoT devices, mobile apps, and services need low-latency data landing but teams spend months on infrastructure instead of building applications.

## Key Features

- **Push-based API** - gRPC and REST endpoints for direct data push
- **Serverless** - no brokers, clusters, or infrastructure to manage
- **OpenTelemetry native** - built-in support for OTLP protocol
- **Direct to Delta** - writes straight to Unity Catalog managed tables
- **Low latency** - near real-time ingestion without polling

## Position

Any "stream data directly from devices/apps/services" scenario. Perfect for IoT telemetry, application events, observability data, and real-time sensor feeds. Pairs naturally with Lakebase for operational applications that need both push ingestion and low-latency reads.

## Demo Tips

- **Ideal for IoT/edge scenarios** - devices pushing telemetry without polling
- Combine with SDP for real-time transformations after ingestion
- Show the REST/gRPC simplicity: one API call lands data in a governed table
- For observability demos, highlight OpenTelemetry support (logs, metrics, traces)
- For demos, simulate push ingestion — the ai-dev-kit skill handles the implementation

## Implementation

The `databricks-zerobus-ingest` ai-dev-kit skill provides all implementation details — API usage, configuration, and code patterns. The instructions you generate should specify WHAT to build and WHY (based on the demo story), not HOW.

## Use Cases

**IoT/Edge:** Sensor telemetry, device events, manufacturing signals, fleet tracking

**Applications:** User activity events, clickstream, mobile app analytics

**Observability:** Logs, metrics, traces via OpenTelemetry

**Gaming/Media:** Player events, content interactions, real-time engagement

## URL

https://docs.databricks.com/aws/en/ingestion/zerobus-overview
