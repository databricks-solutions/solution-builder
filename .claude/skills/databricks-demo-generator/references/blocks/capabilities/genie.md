---
name: Genie Space
category: ai-bi
disabled: false
buildable: true
skill: databricks-genie
---

# Genie Space

## What It Does

Genie acts as the "data analyst on call" — answering quantitative questions with structured data. A Genie space lets users ask natural-language questions that are translated into SQL queries that are then interpreted in natural language.

Think of Genie as a new data analyst joining a company. It needs: quality table and column descriptions to understand the data, example SQL queries to learn how to solve problems, SQL expressions to define business terminology, and text instructions only when other methods don't apply.

## When to Use in a Demo

- Genie can be appended to existing data to immediately allow data democratization & mutual understanding.
- In a multi-agent setup, Genie is the data/metrics specialist that the supervisor routes quantitative queries to.
- Every demo that has a dashboard should also have a Genie space for follow-up exploration.

## Key Configuration Decisions

### 1. Table Selection

5 or fewer tables. A single wide Gold view is often better than 4 separate tables that need joining — pre-join and denormalize using views or materialized views from the pipeline. Include Gold tables as the primary source, one Silver enriched table for drill-down, and never Bronze.

Hide columns that don't serve the space's purpose (internal IDs, ETL timestamps, system columns). Fewer columns means less ambiguity for Genie.

### 2. Column Descriptions

Column descriptions are the #1 driver of Genie accuracy. The spec must define clear, precise descriptions for every column — include units, valid ranges, and enumeration values (e.g., "Order status: 'pending', 'shipped', 'returned', 'cancelled'"). The builder will set these as Unity Catalog column comments.

### 3. SQL Expressions and Certified Queries (Priority Over Text)

The spec should prioritize these over text instructions — they are far more effective:

- **SQL expressions:** Define reusable business metrics (revenue, return_rate, fraud_rate), standard filters (active users, recent period), and business dimensions. These teach Genie the domain vocabulary unambiguously.
- **Certified queries:** 4-6 complete, runnable SQL queries that follow the demo narrative arc. First broad ("What's our fraud rate?"), progressing to specific ("Which cards need reissue?"). Each must demonstrate the correct joins, filters, aggregations, and formatting for the demo's key questions.

### 4. Text Instructions (Use Sparingly)

Only for what SQL can't express — domain knowledge (thresholds, baselines, business rules), analysis methodology, and formatting preferences. Keep concise.

Be specific: not "You are a helpful analyst" but concrete numbers and domain terms. Not "Ask clarification questions when asked about sales" but "When users ask about sales metrics without specifying product name or sales channel, ask: To proceed with sales analysis, specify your product name and sales channel."

All instruction types must be consistent — if text says round to 2 digits, the certified SQL must also round to 2 digits. Conflicts degrade accuracy.

### 5. Column Synonyms

Map business terminology to column names (e.g., "revenue" → `total_sales_amount`, "churn" → `customer_attrition_flag`). Include these in the spec so the builder configures them.

### 6. Sample Questions and Expected Responses

Design 4-6 questions that create a compelling demo conversation. Document what a good answer looks like for each — which tables and columns should be queried, what values to expect. These serve double duty: they become certified queries AND the validation checklist.

## Common Pitfalls

- **Text-heavy specs with no SQL** — SQL expressions and certified queries are far more effective than paragraphs of text instructions.
- **Too many tables** — pre-join into views instead of including many separate tables.
- **Generic instructions** — "You are a helpful analyst" teaches Genie nothing. Include specific numbers, thresholds, and domain terms.
- **Sample questions the data can't answer** — every question must be answerable from the included tables with the generated data.
- **Missing formatting guidance** — include units, currency formatting ("$X.XM for millions"), decimal precision.
- **Not testing before the demo** — always validate each sample question returns the expected result.

## How It Connects to Other Components

- **Upstream:** Queries Gold and Silver tables produced by a Spark Declarative Pipeline, SQL views, or basic Unity Catalog tables.
- **Dashboard link:** Genie answers the deeper questions the dashboard surfaces.
- **Multi-agent supervisor:** Genie is typically Agent 1 (the data specialist) in a supervisor setup.

## Example Specification Snippet

```yaml
genie_space:
  name: "Pacific Coast Fraud Analyst"
  tables:
    - gold_daily_fraud_metrics
    - gold_merchant_fraud_analysis
    - gold_device_analysis
    - gold_compromised_cards
    - silver_transactions_enriched
  sql_expressions:
    - name: fraud_rate
      sql: "COUNT(CASE WHEN is_fraud THEN 1 END) * 100.0 / COUNT(*)"
      description: "Fraud rate as a percentage of total transactions"
    - name: high_risk_merchants
      sql: "fraud_rate > 0.15"
      description: "Merchants exceeding the alert threshold"
  certified_queries:
    - question: "What's our fraud rate this week?"
      sql: |
        SELECT DATE_TRUNC('week', txn_date) AS week,
               COUNT(CASE WHEN is_fraud THEN 1 END) * 100.0 / COUNT(*) AS fraud_rate_pct,
               SUM(CASE WHEN is_fraud THEN amount ELSE 0 END) AS fraud_losses
        FROM gold_daily_fraud_metrics
        WHERE txn_date >= CURRENT_DATE - INTERVAL 7 DAYS
        GROUP BY 1
      expected: "Shows 0.24% (3x baseline), $1.8M losses"
    - question: "Why did CNP fraud spike?"
      sql: |
        SELECT merchant_name, mcc_category, COUNT(*) AS fraud_count,
               SUM(amount) AS total_losses
        FROM gold_merchant_fraud_analysis
        WHERE channel = 'CNP' AND is_fraud
        GROUP BY 1, 2
        ORDER BY fraud_count DESC LIMIT 10
      expected: "Identifies TechDealz merchant, electronics MCC, device clusters"
    - question: "How many cards are compromised?"
      sql: |
        SELECT COUNT(DISTINCT card_id) AS compromised_cards
        FROM gold_compromised_cards
        WHERE merchant_name = 'TechDealz' AND exposure_confirmed
      expected: "Returns 2,847 cards with TechDealz exposure"
  instructions: |
    DOMAIN KNOWLEDGE:
    - Normal fraud rate baseline: 0.08%
    - Alert threshold: >0.15%, Critical: >0.20%
    - Channels: CNP (card-not-present), POS, ATM
    - Show currency as $X.XM for millions, round percentages to 2 decimal places
    ANALYSIS APPROACH:
    1. Start with the rate — is it above threshold?
    2. Segment by channel
    3. Identify merchant concentrations
    4. Look for device/velocity patterns
    CLARIFICATION:
    When users ask about fraud without specifying a time range or channel,
    ask: "What time period and channel would you like to analyze? Options:
    CNP (card-not-present), POS, or ATM. Default is last 7 days, all channels."
  column_synonyms:
    txn_date: ["transaction date", "date"]
    is_fraud: ["fraudulent", "fraud flag"]
    amount: ["transaction amount", "value"]
```

## URL

Best practices: https://docs.databricks.com/aws/en/genie/best-practices
- [AI/BI](https://docs.databricks.com/ai-bi/) - Databricks AI/BI provides self-service data analysis with AI-powered dashboards, conversational Genie spaces, and seamless platform integration.
- [Genie data rooms](https://docs.databricks.com/genie/) - Learn how Genie spaces are used to explore data through a natural language chat interface.