---
name: SDP
category: data-processing
disabled: false
---

# Spark Declarative Pipelines (SDP)

**Declarative ETL** for batch + streaming: describe the tables you want, it figures out execution, scheduling, retries and data quality.

## Pain

Hand-rolled Spark/SQL jobs are snowflakes: each has its own orchestration, error handling, incremental logic. One bad schema change breaks 20 downstream jobs. Nobody wants to touch legacy pipelines. "Only three people understand our ETL."

## Key Features

- **Streaming tables** - real-time ingestion with exactly-once semantics
- **Materialized views** - auto-refreshed aggregations
- **Data quality expectations** - built-in validation, quarantine bad records
- **Auto-optimization** - partitioning, compaction, indexing handled
- **Pipeline observability** - data flow visualization, metrics, alerts

## Position

Operational analytics, near-real-time scenarios (fraud, risk monitoring, IoT). Anytime they complain about "pipeline sprawl."

## Demo Tips

- **The transformation layer** - sits between raw ingestion (Lakeflow Connect) and analytics (SQL/Dashboards)
- Show the bronze → silver → gold medallion architecture
- Emphasize **declarative** nature: "describe what you want, not how to build it"
- Data quality expectations are a great talking point: "bad data gets quarantined, not propagated"
- For demos with anomalies, the SDP pipeline creates the aggregated tables where the anomaly becomes visible
- Pipeline DAG visualization is impressive - show the lineage

## Medallion Architecture

```
Bronze (raw) → Silver (cleaned) → Gold (aggregated)
```

- **Bronze**: Raw data as-is from sources
- **Silver**: Cleaned, validated, enriched
- **Gold**: Business-level aggregations for analytics

## URL

https://www.databricks.com/product/data-engineering/spark-declarative-pipelines
