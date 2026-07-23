---
name: Genie Space
category: agent-bricks
disabled: false
buildable: true
skill: databricks-genie
---

# Genie Space

Natural-language-to-SQL over curated Gold and Silver tables. Acts as "data analyst on call" — answering quantitative questions with structured data.

Think of Genie as a new data analyst joining a company. It needs: quality table and column descriptions, example SQL queries, SQL expressions for business terminology, and text instructions only when other methods don't apply.

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

**Priority order for teaching Genie**: SQL expressions > certified queries > column descriptions > text instructions. SQL is unambiguous; text is a last resort.

- **SQL expressions:** Define reusable business metrics (revenue, return_rate, fraud_rate) and standard filters.
- **Certified queries:** 4-6 complete, runnable SQL queries following the demo narrative arc.
- **Column descriptions:** Include units, valid ranges, and enumeration values. The #1 driver of accuracy.
- **Text instructions:** Only for what SQL can't express — domain knowledge, thresholds, formatting preferences.
- **Column synonyms:** Map business terms to column names (e.g., "revenue" → `total_sales_amount`).

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

Best practices: https://docs.databricks.com/aws/en/genie/best-practices
- [AI/BI](https://docs.databricks.com/ai-bi/) - Databricks AI/BI provides self-service data analysis with AI-powered dashboards, conversational Genie spaces, and seamless platform integration.
- [Genie data rooms](https://docs.databricks.com/genie/) - Learn how Genie spaces are used to explore data through a natural language chat interface.