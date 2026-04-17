---
name: Genie Space
category: ai-bi
disabled: false
skill: databricks-genie
---

# Genie Space

Natural-language-to-SQL over curated Gold and Silver tables. Acts as "data analyst on call" — answering quantitative questions with structured data.

## When to Use

- Every demo with a dashboard should have a Genie space for follow-up exploration.
- Answers "why?" and "how much?" questions the dashboard raises.
- In multi-agent setup, Genie is the data/metrics specialist the supervisor routes quantitative queries to.

## Key Decisions

1. **Table selection:** 3-7 tables, primarily Gold. One Silver enriched table for drill-down. No Bronze — too raw for NL queries.
2. **System instructions:** 15-30 lines of domain-specific instructions. Include: persona, domain knowledge (thresholds, baselines, terminology), analysis approach (step-by-step), presentation preferences.
3. **Domain knowledge injection:** Embed numeric thresholds, baselines, business rules directly in instructions. Genie cannot look these up — must "know" them.
4. **Sample questions:** 4-6 following the narrative arc. Start broad ("What's our fraud rate?"), progress to specific ("Which cards need reissue?").
5. **Expected responses:** Document what a good answer looks like per sample question, including tables and columns queried.

## Pitfalls

- Instructions too generic — "You are a helpful analyst" teaches nothing. Include specific numbers, thresholds, domain terms.
- Too many tables — fewer well-structured Gold tables outperform many raw tables.
- Sample questions unanswerable from available tables.
- Not testing questions before the demo — always validate each returns expected results.
- Missing units and formatting guidance (e.g., "Show currency as $X.XM for millions").

## Connections

- **Upstream:** Queries Gold and Silver tables from the declarative pipeline.
- **Dashboard:** Answers deeper questions the dashboard surfaces.
- **Multi-agent supervisor:** Typically Agent 1 (data specialist) in a supervisor setup.
- **Data generation:** Sample question expected answers must align with synthetic data distributions.

## URL

https://www.databricks.com/product/business-intelligence/genie
