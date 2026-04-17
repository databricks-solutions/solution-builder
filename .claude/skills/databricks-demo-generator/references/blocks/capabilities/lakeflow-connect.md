---
name: Lakeflow Connect
category: lakeflow
disabled: false
buildable: false
---

# Lakeflow Connect

Fully managed **connectors + pipelines** from SaaS apps, DBs and files into governed lakehouse tables.

## Pain

New source = new bespoke pipeline, custom scripts, separate ingestion tool, manual monitoring. Data engineering time vanishes into plumbing. Business users wait weeks for "just get me Salesforce into the warehouse."

## Key Features

- **200+ connectors** - Salesforce, Workday, SAP, ServiceNow, databases, files
- **Incremental sync** - CDC, change tracking, efficient updates
- **Schema inference** - auto-detect and evolve schemas
- **Error recovery** - automatic retries, dead-letter handling

## Position

Any "can you pull from Salesforce / Workday / SQL Server / GA4 / ServiceNow?" moment. Great opener for Day 0: click-to-ingest → data appears in UC → pipeline auto-runs.

## Demo Tips

- **Typically the first step** in a demo - shows easy data ingestion before any transformation
- Great for Day 0 narrative: click-to-ingest → data appears in UC → pipeline auto-runs
- Mention specific sources relevant to the customer's industry (Salesforce for sales, Workday for HR, ServiceNow for IT)
- In the demo story, Lakeflow Connect brings in the raw data that will later reveal the anomaly
- **Implementation note**: For demos, generate synthetic data that "looks like" it came from these sources - don't actually connect to live systems

## How It Works

- **Pick a source, configure credentials**: Select Salesforce/Workday/SQL Server/etc, enter connection details, choose what to sync
- **Data lands in UC tables**: Creates managed Delta tables in Unity Catalog — governed, queryable immediately
- **Incremental by default**: First run pulls everything, subsequent runs pull only changes (CDC for DBs, cursor for SaaS)
- **Runs on serverless**: No clusters to manage — schedules create Lakeflow Jobs automatically
- **Self-healing**: Retries on failure, remembers where it left off if credentials expire

## Available Sources

**SaaS (GA):** Salesforce, Workday, SQL Server
**SaaS (Preview):** ServiceNow, SharePoint, Google Analytics, NetSuite, Dynamics 365, Google Ads

**Databases:** MySQL, PostgreSQL, SQL Server (with CDC support)

**Standard Connectors:** Cloud object storage (S3, ADLS, GCS), message buses (Kafka, Kinesis, Pub/Sub, EventHub, Pulsar)

## URL

https://www.databricks.com/product/data-engineering/lakeflow-connect
