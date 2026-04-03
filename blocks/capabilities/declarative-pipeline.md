---
name: Spark Declarative Pipelines
slug: declarative-pipeline
category: capability
tags: [pipeline, medallion, etl, sdp, lakeflow, streaming-tables, materialized-views]
description: >
  Context for generating Spark Declarative Pipeline (SDP) specifications using the medallion
  architecture pattern (Bronze, Silver, Gold), including table design, transformation logic,
  data quality checks, and how pipeline outputs feed dashboards and Genie spaces.
related: [aibi-dashboards, genie-space, synthetic-data-gen, streaming]
---

# Spark Declarative Pipelines

## What It Does

Spark Declarative Pipelines (SDP, formerly DLT) define medallion-architecture data pipelines using streaming tables and materialized views. They transform raw ingested data (Bronze) through enrichment (Silver) to business-ready aggregations (Gold) in a declarative, dependency-managed framework running on serverless compute.

## When to Use in a Demo

- Every demo needs a pipeline. It is the backbone that transforms synthetic raw data into the Gold tables that dashboards and Genie spaces query.
- The pipeline is typically not the centerpiece of the demo — it is the enabling infrastructure. Build it to be correct and complete, not flashy.

## Key Configuration Decisions

1. **Bronze layer:** One streaming table per source system. Use Auto Loader or cloud files for ingestion. Keep the schema as-is from the source — no transformation here.
2. **Silver layer:** Enrichment and joins. Combine Bronze tables into denormalized, analysis-ready tables. Add computed columns (flags, scores, categorizations). This is where foreign key joins happen.
3. **Gold layer:** Aggregations and business metrics. Materialized views grouped by the dimensions the dashboard and Genie need (date, category, entity). Design Gold tables to answer the demo's key questions directly.
4. **Data quality expectations:** Add `CONSTRAINT` expectations on Silver and Gold tables for NULL checks, referential integrity, and value range validation.
5. **Pipeline configuration:** Serverless compute, continuous or triggered mode. For demos, triggered mode with a single refresh is typical.

## Common Pitfalls

- Gold tables that do not match what the dashboard queries need — design Gold tables backward from the dashboard and Genie requirements.
- Missing joins in Silver that leave NULL foreign keys in Gold aggregations.
- Not running the pipeline before building the dashboard — the tables must be materialized with data.
- Overcomplicated Silver layer with too many intermediate tables — keep it to 2-4 Silver tables.
- Forgetting data quality constraints — they are low effort and demonstrate platform capability.

## How It Connects to Other Components

- **Upstream (synthetic data gen):** Bronze tables ingest the generated synthetic data from volumes or streaming sources.
- **Downstream (dashboard):** Gold tables are the primary data source for dashboard KPI cards and charts.
- **Downstream (Genie):** Genie queries Gold and occasionally Silver tables.
- **Streaming:** Bronze streaming tables can use Auto Loader or structured streaming for real-time ingestion.

## Example Specification Snippet

```yaml
pipeline:
  name: "fraud-detection-pipeline"
  mode: triggered  # or continuous
  bronze:
    - table: bronze_transactions
      source: "cloud_files('/Volumes/catalog/schema/raw/transactions/')"
      format: parquet
    - table: bronze_merchants
      source: "cloud_files('/Volumes/catalog/schema/raw/merchants/')"
    - table: bronze_fraud_cases
      source: "cloud_files('/Volumes/catalog/schema/raw/fraud_cases/')"
  silver:
    - table: silver_transactions_enriched
      description: "Transactions joined with merchants, accounts, fraud flags"
      joins: [bronze_transactions, bronze_merchants, bronze_accounts, bronze_fraud_cases]
      computed_columns: [is_fraud, merchant_risk_tier]
      constraints:
        - "valid_amount EXPECT (amount > 0)"
        - "valid_merchant EXPECT (merchant_id IS NOT NULL)"
  gold:
    - table: gold_daily_fraud_metrics
      description: "Daily fraud KPIs by date, channel, merchant"
      group_by: [txn_date, channel, mcc_code, merchant_id]
      metrics: [total_transactions, fraud_count, fraud_rate, fraud_amount]
    - table: gold_merchant_fraud_analysis
      description: "Merchant-level fraud with alert levels"
```
