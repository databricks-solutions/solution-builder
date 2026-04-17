---
name: Spark Declarative Pipelines
category: lakeflow
disabled: false
buildable: true
skill: databricks-spark-declarative-pipelines
---

# Spark Declarative Pipelines

SDP (formerly DLT) defines medallion-architecture pipelines using streaming tables and materialized views. Transforms raw data (Bronze) through enrichment (Silver) to business-ready aggregations (Gold) in a declarative, dependency-managed framework on serverless compute.

## When to Use

- Every demo needs a pipeline — the backbone transforming synthetic raw data into Gold tables for dashboards and Genie.
- Not the centerpiece — enabling infrastructure. Build it correct and complete, not flashy.

## Key Decisions

1. **Bronze:** One streaming table per source system. Keep schema as-is from source — no transforms.
2. **Silver:** Enrichment and joins. Combine Bronze into denormalized, analysis-ready tables. Add computed columns (flags, scores, categorizations).
3. **Gold:** Aggregations and business metrics. Design backward from dashboard and Genie needs.
4. **Data quality:** Add expectations on Silver/Gold for NULL checks and value range validation.
5. **Pipeline mode:** Triggered with a single refresh for demos.

The `databricks-spark-declarative-pipelines` ai-dev-kit skill handles SQL/Python implementation, Auto Loader config, and pipeline deployment.

**Design Gold backward** — start from dashboard/Genie needs, then work backward through Silver to Bronze. This prevents the most common pitfall: Gold tables that don't match downstream queries.

**Dataset types per layer:**
- **Bronze:** Streaming tables. One per source, minimal transformation.
- **Silver cleaning** (filtering, dedup): Streaming tables.
- **Silver enrichment** (joins, computed columns): Materialized views.
- **Gold** (aggregations, KPIs): Always materialized views.

**Data quality expectations:** Always include — low effort, demos well. Bronze: `EXPECT (id IS NOT NULL)`. Silver: NOT NULL on join keys, value ranges. Gold: business rule validation.

**Gold table design for downstream:** Clear column names (not `col1`, `amt`), descriptions with units and valid ranges, `CLUSTER BY` on filter columns.

## Pitfalls

- Gold tables not matching dashboard query needs — design Gold backward from dashboard and Genie requirements.
- Missing Silver joins leaving NULL foreign keys in Gold aggregations.
- Not running the pipeline before building the dashboard — tables must be materialized with data.
- Overcomplicated Silver with too many intermediates — keep to 2-4 Silver tables.
- Forgetting data quality constraints — low effort, demonstrates platform capability.

## Connections

- **Upstream (synthetic data gen):** Bronze tables ingest generated synthetic data from volumes via Auto Loader.
- **Downstream (dashboard):** Gold materialized views feed dashboard KPI cards and charts.
- **Downstream (Genie):** Genie queries Gold and occasionally Silver tables.
- **Downstream (ML/serving):** Gold tables can feed feature engineering or model training notebooks.


## URL

Best practices: https://docs.databricks.com/aws/en/ldp/best-practices
- [Spark Declarative Pipelines](https://www.databricks.com/product/data-engineering/spark-declarative-pipelines) — Product overview.
- [Pipeline development](https://docs.databricks.com/aws/en/ldp/) — Full documentation for creating and managing pipelines.
