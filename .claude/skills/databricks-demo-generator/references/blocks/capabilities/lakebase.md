---
name: Lakebase
category: apps-infra
disabled: false
buildable: true
---

# Lakebase (Databricks Postgres)

Fully managed **Postgres for operational workloads**, integrated with the lakehouse.

## Pain

Operational DBs live on islands: analytics teams ETL data out, app teams can't leverage analytics/AI, every change creates fragile pipelines. Spinning up new stores for AI agents/apps requires separate ops, security, governance.

## Key Features

- **Managed Postgres** - familiar API, zero ops
- **Autoscaling** - scale to zero, burst on demand
- **Instant branching** - dev/test environments in seconds
- **Lakehouse sync** - bidirectional with Delta tables
- **UC governed** - same permissions as rest of platform

## Position

When they need "low-latency transactions / HTAP / agent needs to store state." Show Lakebase powering an app, then same data visible in UC and SQL/AI.

## How It Works

- **Managed Postgres**: Create a database, get a connection string — standard Postgres API, pgvector included
- **Serverless + scale-to-zero**: Compute scales with load, shuts down when idle — no always-on clusters
- **Database branching**: Create instant copies for dev/test — copy-on-write means branches share storage until they diverge
- **Instant restore**: Point-in-time recovery to any moment in your retention window
- **Lakehouse sync**: Bidirectional replication with Delta tables via Lakeflow — analytics data flows to operational app, app data flows to analytics
- **UC governed**: Same permissions model as the rest of the platform

## Demo Tips

- Great for agent state management and app backends
- Position as "operational database + analytics in one" — no ETL needed
- Perfect companion to Databricks Apps
- Emphasize governance: "same UC permissions as your Delta tables"

## URL

https://www.databricks.com/product/lakebase
