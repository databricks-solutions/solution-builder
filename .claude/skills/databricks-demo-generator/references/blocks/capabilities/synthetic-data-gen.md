---
name: Synthetic Data Generation
category: lakeflow
disabled: false
skill: databricks-synthetic-data-gen
---

# Synthetic Data Generation

## What It Does

Synthetic data generation creates realistic demo datasets using Spark + Faker (or dbldatagen). It produces the raw tables that the pipeline ingests, ensuring the data contains the specific patterns, anomalies, and distributions needed to make dashboards, Genie, and the KA tell a compelling story.

## When to Use in a Demo

- Every demo starts with data generation. It is the foundation that every other component depends on.
- The generated data must encode "the event" — the anomaly or pattern that the hero persona investigates.
- Data generation runs once to produce static files (Parquet/CSV) that the pipeline ingests.

## Key Configuration Decisions

1. **Table relationships:** Define the entity-relationship model first. Typically 4-7 tables with foreign key relationships. Use a consistent ID scheme (e.g., `C-XXXXX` for customers, `M-XXXXX` for merchants).
2. **Volume:** Size tables appropriately — enough rows for realistic aggregations but not so many that generation takes too long. Typical: 1-5M transaction-level rows, 10K-100K entity rows.
3. **Distributions:** Avoid uniform random distributions — they look fake. Use weighted distributions for categories, log-normal for amounts, time-series patterns for dates.
4. **The event injection:** The most critical decision. Design the anomaly window: specific date range, specific entity, specific pattern. The event must produce the exact KPI values the dashboard shows (e.g., 0.24% fraud rate, $1.8M losses).
5. **Referential integrity:** Every foreign key must resolve. Every transaction must reference a valid merchant and account. Broken references break joins in the pipeline.

## Common Pitfalls

- Generating data that is too uniform — real data has skew, seasonality, and outliers. Include them.
- Event injection that is too subtle or too obvious — the anomaly should be clearly visible on a dashboard but require investigation to understand root cause.
- Foreign key mismatches between tables — generate parent entities first, then reference their IDs in child tables.
- Not generating enough historical baseline data — the event only looks anomalous if there are months of normal data for comparison.
- Generating data that does not match what the documents say — if the KA document says "breach on March 8," the data must show fraud starting March 10.

## How It Connects to Other Components

- **Declarative pipeline:** Generated data files are placed in volumes and ingested by Bronze streaming tables.
- **Dashboard:** KPI values are directly determined by the generated data distributions.
- **Genie:** Sample question answers depend on the data matching expected values.
- **Knowledge Assistant:** Document cross-references (IDs, dates, amounts) must match the data.
- **Model serving:** Training data for the ML model comes from the generated dataset.

## Example Specification Snippet

```yaml
synthetic_data:
  output_format: parquet
  output_path: "/Volumes/catalog/schema/raw/"
  tables:
    - name: transactions
      rows: 15_000_000
      period: "2024-09-01 to 2025-03-17"
      distributions:
        amount: { type: log_normal, mean: 85, std: 120, min: 1, max: 15000 }
        channel: { type: weighted, values: { POS: 0.70, CNP: 0.25, ATM: 0.05 } }
      event_injection:
        window: "2025-03-10 to 2025-03-17"
        entity: "M-847291"  # TechDealz
        pattern: "8.5% fraud rate, electronics purchases, 12 device fingerprints"
        produces:
          fraud_rate: 0.24%  # must match dashboard KPI
          fraud_losses: "$1.8M"
          compromised_cards: 2847
    - name: merchants
      rows: 5000
      key_entity:
        merchant_id: "M-847291"
        name: "TechDealz Online"
        mcc_code: "5732"
    - name: cardholders
      rows: 50_000  # scaled down from 2.3M for demo
      distributions:
        segment: { weighted: { Premium: 0.15, Standard: 0.60, Basic: 0.25 } }
```

## URL

https://docs.databricks.com/aws/en/machine-learning/data-generation.html
