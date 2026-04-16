---
name: Genie Space
category: ai-bi
disabled: false
---

# Genie Space

## What It Does

A Genie space lets users ask natural-language questions that are translated into SQL against curated Gold and Silver tables. It acts as the "data analyst on call" — answering quantitative questions with structured data.

## When to Use in a Demo

- Every demo that has a dashboard should also have a Genie space for follow-up exploration.
- Genie answers "why?" and "how much?" questions the dashboard raises.
- In a multi-agent setup, Genie is the data/metrics specialist that the supervisor routes quantitative queries to.

## Key Configuration Decisions

1. **Table selection:** Include 3-7 tables, primarily Gold layer. Include one Silver enriched table for drill-down. Do not include Bronze tables — they are too raw for natural language queries.
2. **System instructions:** Write 15-30 lines of domain-specific instructions. Include: persona framing, domain knowledge (thresholds, baselines, terminology), analysis approach (step-by-step methodology), and presentation preferences.
3. **Domain knowledge injection:** Embed numeric thresholds, baseline values, and business rules directly in the instructions. Genie cannot look these up — it must "know" them.
4. **Sample questions:** Design 4-6 questions that follow the demo narrative arc. The first question should be broad ("What's our fraud rate?"), progressing to specific ("Which cards need reissue?").
5. **Expected responses:** Document what a good answer looks like for each sample question, including which tables and columns should be queried.

## Common Pitfalls

- Instructions that are too generic — "You are a helpful analyst" teaches Genie nothing. Include specific numbers, thresholds, and domain terms.
- Including too many tables — Genie performs better with fewer, well-structured Gold tables than many raw tables.
- Sample questions that Genie cannot answer from the available tables.
- Not testing questions before the demo — always validate each sample question returns the expected result.
- Forgetting to include units and formatting guidance (e.g., "Show currency as $X.XM for millions").

## How It Connects to Other Components

- **Upstream:** Queries Gold and Silver tables produced by the declarative pipeline.
- **Dashboard link:** Genie answers the deeper questions the dashboard surfaces.
- **Multi-agent supervisor:** Genie is typically Agent 1 (the data specialist) in a supervisor setup.
- **Data generation:** Sample question expected answers must align with synthetic data distributions.

## API Requirements

When building the `serialized_space` JSON for Genie:
- `example_question_sqls` **must be sorted by `id`** — the API rejects unsorted lists. Always sort: `sorted(sqls, key=lambda x: x["id"])`
- Each `id` must be a lowercase 32-hex UUID (`uuid.uuid4().hex`)
- `sample_questions` and `text_instructions` also use the same UUID format

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
  instructions: |
    You are a Fraud Analytics Specialist for Pacific Coast Bank.
    DOMAIN KNOWLEDGE:
    - Normal fraud rate baseline: 0.08%
    - Alert threshold: >0.15%, Critical: >0.20%
    - Channels: CNP (card-not-present), POS, ATM
    ANALYSIS APPROACH:
    1. Start with the rate — is it above threshold?
    2. Segment by channel
    3. Identify merchant concentrations
    4. Look for device/velocity patterns
  sample_questions:
    - question: "What's our fraud rate this week?"
      expected: "Shows 0.24% (3x baseline), $1.8M losses"
    - question: "Why did CNP fraud spike?"
      expected: "Identifies TechDealz merchant, electronics MCC, device clusters"
    - question: "How many cards are compromised?"
      expected: "Returns 2,847 cards with TechDealz exposure"
```

## URL

https://www.databricks.com/product/business-intelligence/genie
