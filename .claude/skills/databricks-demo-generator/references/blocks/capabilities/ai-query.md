---
name: AI Functions
category: data-engineering
disabled: false
---

# AI Functions (ai_query)

**SQL-native AI** for data enrichment - apply LLMs to your data at scale using simple SQL functions.

## Pain

Applying AI to production data requires moving data out, building pipelines, managing infrastructure, and handling retries. Teams end up with fragile Python scripts or Spark jobs just to classify, extract, or summarize data at scale.

## Key Features

- **SQL-native** - call `ai_query('databricks-gpt-5-4-nano', text)` and task-specific functions directly in SQL
- **Batch inference** - process millions of rows efficiently with auto-scaling
- **Task-specific functions** - `ai_classify`, `ai_extract`, `ai_summarize`, `ai_translate`, `ai_sentiment`, `ai_mask`, `ai_gen`, and more
- **Any model** - Databricks-hosted foundation models, fine-tuned models, or external endpoints
- **Built-in reliability** - automatic parallelization, retries, and fault tolerance
- **Governed** - runs where your data lives, no data movement required

## Position

When they need to enrich data at scale - classify tickets, extract entities, summarize documents, translate content, or apply any AI transformation. "Just add a column with `SELECT ai_classify(text, '["urgent", "normal"]') FROM tickets`."

## Demo Tips

- Perfect for data enrichment use cases: sentiment analysis, classification, entity extraction
- Show the simplicity: one SQL function call processes entire tables
- Position it in the SDP pipeline ideally in SQL
- CAREFULL WITH SIZE, this function can be slow, avoid on big table
- Use databricks-gpt-5-4-nano for fast answer in the demo

## URL

https://docs.databricks.com/aws/en/large-language-models/ai-functions
