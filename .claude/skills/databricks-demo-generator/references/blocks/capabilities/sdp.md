---
name: Spark Declarative Pipelines
category: lakeflow
disabled: false
buildable: true
skill: databricks-spark-declarative-pipelines
---

# Spark Declarative Pipelines

## What It Does

Spark Declarative Pipelines (SDP, formerly DLT) define medallion-architecture data pipelines using streaming tables and materialized views. They transform raw ingested data (Bronze) through enrichment (Silver) to business-ready aggregations (Gold) in a declarative, dependency-managed framework running on serverless compute.

## When to Use in a Demo

- Every demo needs a pipeline. It is the backbone that transforms synthetic raw data into the Gold tables that dashboards and Genie spaces query.
- The pipeline is typically not the centerpiece of the demo — it is the enabling infrastructure. Build it to be correct and complete, not flashy.

## Key Configuration Decisions

### 1. Design Gold Backward

Start from what the dashboard and Genie need, then work backward. Define Gold aggregations first, then figure out what Silver enrichment those require, then what Bronze sources feed it. This prevents the most common pitfall: Gold tables that don't match downstream queries.

### 2. Dataset Types Per Layer

Specify the correct type for each table in the spec — the builder needs to know:

- **Bronze:** Streaming tables. One per source, minimal transformation, Auto Loader ingestion from volumes.
- **Silver cleaning** (row-level filtering, dedup): Streaming tables.
- **Silver enrichment** (joins against dimensions, computed columns): Materialized views — they handle dimension updates via incremental refresh.
- **Gold** (aggregations, metrics, KPIs): Always materialized views — incrementally refreshed, fast reads for dashboards and Genie.
- **Intermediate logic** with no downstream readers: Temporary views (not tables).

Keep Silver to 2-4 tables. A single wide denormalized Silver view is often better than multiple narrow ones.

### 3. Data Quality Expectations

Always include expectations — they're low effort and demonstrate a key platform capability. Specify in the instruction file:

- **Bronze:** Minimal — `EXPECT (id IS NOT NULL)` to catch corrupt records.
- **Silver:** NOT NULL on join keys, value range validation, format checks. Use `ON VIOLATION DROP ROW` for expected noise.
- **Gold:** Business rule validation — metric bounds, referential integrity.

For demos that want to showcase data quality handling, include a quarantine pattern: route failed rows to a separate table for investigation.

### 4. Pipeline Mode

Use triggered mode with a single refresh for demos. The builder skill handles execution configuration.

### 5. Table Design for Downstream

Gold tables should be ready for direct consumption:
- Column names that are clear enough for Genie (not `col1`, `amt`, `dt`).
- Column descriptions with units, valid ranges, and enumeration values — these feed directly into Genie accuracy and dashboard readability.
- `CLUSTER BY` on date/region columns that dashboards will filter on.

The `databricks-spark-declarative-pipelines` ai-dev-kit skill handles all SQL/Python implementation, Auto Loader configuration, and pipeline deployment.

## Common Pitfalls

- **Gold tables that don't match downstream needs** — design Gold backward from dashboard and Genie requirements, not forward from Silver.
- **Missing joins in Silver** — leave NULL foreign keys that cascade into broken Gold aggregations.
- **Not running the pipeline before building downstream** — tables must be materialized with data before dashboards or Genie can work.
- **Overcomplicated Silver** — keep to 2-4 Silver tables. Use temporary views for intermediate logic, not materialized tables.
- **No data quality constraints** — they're low effort, demo well, and catch real issues.
- **Streaming tables where materialized views belong** — Gold aggregations and dimension enrichment joins should be materialized views.
- **Poor column names/descriptions** — these propagate directly to Genie and dashboard quality. Get them right in the pipeline spec.

## How It Connects to Other Components

- **Upstream (synthetic data gen):** Bronze streaming tables ingest generated data from volumes via Auto Loader.
- **Downstream (dashboard):** Gold materialized views are the primary data source for dashboard KPI cards and charts.
- **Downstream (Genie):** Genie queries Gold materialized views and occasionally Silver tables.
- **Downstream (ML/serving):** Gold tables can feed feature engineering or model training notebooks.

## Example Specification Snippet

```yaml
pipeline:
  name: "fraud-detection-pipeline"
  mode: triggered
  bronze:
    - table: bronze_transactions
      type: streaming_table
      source: "/Volumes/catalog/schema/raw/transactions/"
      format: parquet
    - table: bronze_merchants
      type: streaming_table
      source: "/Volumes/catalog/schema/raw/merchants/"
    - table: bronze_fraud_cases
      type: streaming_table
      source: "/Volumes/catalog/schema/raw/fraud_cases/"
  silver:
    - table: silver_transactions_enriched
      type: materialized_view
      description: "Transactions joined with merchants, accounts, fraud flags"
      joins: [bronze_transactions, bronze_merchants, bronze_accounts, bronze_fraud_cases]
      computed_columns: [is_fraud, merchant_risk_tier, txn_hour, is_high_value]
      expectations:
        - "valid_amount EXPECT (amount > 0) ON VIOLATION DROP ROW"
        - "valid_merchant EXPECT (merchant_id IS NOT NULL)"
  gold:
    - table: gold_daily_fraud_metrics
      type: materialized_view
      description: "Daily fraud KPIs by date, channel, merchant"
      group_by: [txn_date, channel, mcc_code, merchant_id]
      metrics: [total_transactions, fraud_count, fraud_rate, fraud_amount]
    - table: gold_merchant_fraud_analysis
      type: materialized_view
      description: "Merchant-level fraud rates with alert tier classification"
      expectations:
        - "valid_fraud_rate EXPECT (fraud_rate BETWEEN 0 AND 1)"
```

## URL

Best practices: https://docs.databricks.com/aws/en/ldp/best-practices
- [Spark Declarative Pipelines](https://www.databricks.com/product/data-engineering/spark-declarative-pipelines) — Product overview.
- [Pipeline development](https://docs.databricks.com/aws/en/ldp/) — Full documentation for creating and managing pipelines.
