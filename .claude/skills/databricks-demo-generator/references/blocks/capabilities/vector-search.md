---
name: Vector Search
category: agent-bricks
disabled: false
buildable: true
---

# Vector Search

**Managed embeddings + similarity search** for RAG applications, fully integrated with Unity Catalog.

## Pain

DIY vector DBs mean separate infra, syncing nightmares when source data changes, and no governance. Embeddings drift out of sync with tables, and nobody knows which version is live.

## Key Features

- **Managed index** - auto-sync with Delta tables
- **Incremental updates** - embeddings stay fresh as data changes
- **UC governed** - same permissions as source tables
- **Hybrid search** - combine semantic + keyword for better recall
- **Scale** - billions of vectors, low-latency queries

## Position

Any RAG / copilot scenario. "Your knowledge base stays in sync automatically - no ETL to vector DB. Governed by the same UC permissions as your tables."

## How It Works

- **Create an index from a Delta table**: Point at a table with text, Databricks computes embeddings and builds the index
- **Two modes**: Databricks-managed (you provide text, it computes embeddings) or self-managed (you provide pre-computed embeddings)
- **Auto-sync**: As the source Delta table changes, the index updates automatically — no manual reindexing
- **Query via REST API**: Send a query, get back the most similar documents with metadata
- **Scales to billions**: Serverless architecture handles massive indexes without cluster management

## Demo Tips

- For custom RAG when you need control over chunking/retrieval
- Position as the "plumbing" — Knowledge Assistant uses this under the hood but abstracts it away
- Key differentiator: auto-sync with Delta tables (no manual ETL to vector store)

## URL

https://www.databricks.com/product/vector-search
