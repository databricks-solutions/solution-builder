---
name: Synthetic Data Generation
category: lakeflow
disabled: false
buildable: true
skill: databricks-synthetic-data-gen
---

# Synthetic Data Generation

Creates realistic demo datasets using Spark + Faker (or dbldatagen). Produces raw tables the pipeline ingests, encoding specific patterns, anomalies, and distributions needed for dashboards, Genie, and KA to tell a compelling story.

## When to Use

- Every demo starts here — foundation every other component depends on.
- Generated data must encode "the event" — the anomaly the hero persona investigates.
- Runs once to produce static files (Parquet/CSV) the pipeline ingests.

## Key Decisions

1. **Table relationships:** Define entity-relationship model first. Typically 4-7 tables with foreign keys. Consistent ID scheme (e.g., `C-XXXXX` customers, `M-XXXXX` merchants).
2. **Volume:** Enough rows for realistic aggregations, not so many generation is slow. Typical: 1-5M transaction rows, 10K-100K entity rows.
3. **Distributions:** Avoid uniform random — looks fake. Use weighted for categories, log-normal for amounts, time-series patterns for dates.
4. **Event injection:** Most critical decision. Design anomaly window: specific date range, entity, pattern. Must produce exact KPI values the dashboard shows (e.g., 0.24% fraud rate, $1.8M losses).
5. **Referential integrity:** Every foreign key must resolve. Every transaction must reference a valid merchant/account. Broken references break pipeline joins.

## Pitfalls

- Data too uniform — real data has skew, seasonality, outliers. Include them.
- Event too subtle or too obvious — clearly visible on dashboard but requiring investigation for root cause.
- Foreign key mismatches — generate parent entities first, reference their IDs in children.
- Insufficient historical baseline — the event only looks anomalous with months of normal data for comparison.
- Data/document mismatch — if KA doc says "breach on March 8," data must show fraud starting March 10.

## Connections

- **Declarative pipeline:** Generated files placed in volumes, ingested by Bronze streaming tables.
- **Dashboard:** KPI values directly determined by generated data distributions.
- **Genie:** Sample question answers depend on data matching expected values.
- **Knowledge Assistant:** Document cross-references (IDs, dates, amounts) must match data.
- **Model serving:** Training data for the ML model comes from the generated dataset.

## URL

https://docs.databricks.com/aws/en/machine-learning/data-generation.html
