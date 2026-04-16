---
name: Data Quality Monitoring
category: uc-governance
disabled: false
buildable: true
---

# Data Quality Monitoring (Lakehouse Monitoring)

**Automatic anomaly detection** for data freshness and completeness across all tables in a Unity Catalog schema.

## Pain

Bad data silently propagates. Dashboards show stale numbers. ML models train on corrupt data. Nobody knows until a customer complains or a report is wrong. Manual monitoring is tedious and doesn't scale.

## Key Features

- **Automatic freshness detection** - analyzes commit history to predict when tables should update; flags stale data when commits are late
- **Completeness monitoring** - tracks historical row counts and alerts when 24-hour additions fall below expected thresholds
- **Null value tracking** - detects elevated null values in columns (beta)
- **Schema-level enablement** - monitor all tables in a schema with one click, no per-table configuration
- **Non-invasive** - doesn't modify tables or add overhead to jobs
- **Health indicators** - results appear directly in Catalog Explorer with incident reports

## How It Works

Databricks runs a background job that continuously evaluates tables:
1. **Freshness**: Predicts next expected commit based on historical patterns. If late → marked stale.
2. **Completeness**: Calculates expected row count range. If actual falls below → flagged incomplete.

Results surface as health badges in Catalog Explorer and generate detailed incident reports.

## Position

Data reliability and trust conversations. "How do you know your dashboard is showing fresh data?" "What happens when ETL fails silently?" Part of the governance story — Unity Catalog doesn't just govern access, it monitors data health.

## Demo Tips

- **Enable at schema level** - show how one click monitors all tables
- **Show Catalog Explorer health badges** - visual data quality at a glance
- **Pair with SDP expectations** - SDP validates data at build time (schema, rules), Lakehouse Monitoring validates at rest (freshness, completeness)
- **Governance story** - positions UC as more than permissions: it's your data health platform

## URL

https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/
