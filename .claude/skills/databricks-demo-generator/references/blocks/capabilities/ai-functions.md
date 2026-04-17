---
name: AI Functions
category: lakeflow
disabled: false
buildable: false
skill: databricks-ai-functions
---

# AI Functions (ai_query)

**SQL-native AI** for data enrichment - apply LLMs to your data at scale using simple SQL functions.

## Pain

Applying AI to production data requires moving data out, building pipelines, managing infrastructure, handling retries. Teams end up with fragile Python scripts or Spark jobs just to classify, extract, or summarize at scale.

## Key Features

- **SQL-native** — call `ai_query('databricks-gpt-5-4-nano', text)` and task-specific functions directly in SQL
- **Batch inference** — process millions of rows with auto-scaling
- **Task-specific functions** — `ai_classify`, `ai_extract`, `ai_summarize`, `ai_translate`, `ai_sentiment`, `ai_mask`, `ai_gen`, and more
- **Any model** — Databricks-hosted, fine-tuned, or external endpoints
- **Built-in reliability** — automatic parallelization, retries, fault tolerance
- **Governed** — runs where your data lives, no data movement

## Position

Data enrichment at scale — classify tickets, extract entities, summarize documents, translate content. "Just add a column with `SELECT ai_classify(text, '["urgent", "normal"]') FROM tickets`."

## Implementation

The `databricks-ai-functions` ai-dev-kit skill covers implementation details. Specs should specify WHAT to build and WHY (demo story), not HOW.

## Demo Tips

- Perfect for enrichment: sentiment analysis, classification, entity extraction
- Show simplicity: one SQL function call processes entire tables
- Position in the SDP pipeline, ideally in SQL
- CAREFUL WITH SIZE — can be slow, avoid on large tables
- Use databricks-gpt-5-4-nano for fast demo answers

## URL

https://docs.databricks.com/aws/en/large-language-models/ai-functions
