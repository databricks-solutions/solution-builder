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

Real-time pipelines require message brokers (Kafka, Kinesis), cluster management, custom consumers. IoT devices, mobile apps, services need low-latency data landing but teams spend months on infrastructure instead of applications.

## Key Features

- **Push-based API** — gRPC and REST endpoints for direct data push
- **Serverless** — no brokers, clusters, or infrastructure to manage
- **OpenTelemetry native** — built-in OTLP protocol support
- **Direct to Delta** — writes straight to UC managed tables
- **Low latency** — near real-time ingestion without polling

## Position

Any "stream data directly from devices/apps/services" scenario. IoT telemetry, application events, observability data, real-time sensor feeds. Pairs naturally with Lakebase for apps needing both push ingestion and low-latency reads.

## Demo Tips

- **Ideal for IoT/edge** — devices pushing telemetry without polling
- Combine with SDP for real-time transformations after ingestion
- REST/gRPC simplicity: one API call lands data in a governed table
- Observability demos: highlight OpenTelemetry support (logs, metrics, traces)
- For demos, simulate push ingestion — ai-dev-kit skill handles implementation

## Implementation

The `databricks-zerobus-ingest` ai-dev-kit skill covers implementation details. Specs should specify WHAT to build and WHY (demo story), not HOW.

## Use Cases

**IoT/Edge:** Sensor telemetry, device events, manufacturing signals, fleet tracking

**Applications:** User activity events, clickstream, mobile app analytics

**Observability:** Logs, metrics, traces via OpenTelemetry

**Gaming/Media:** Player events, content interactions, real-time engagement

## URL

https://docs.databricks.com/aws/en/ingestion/zerobus-overview
