---
name: Vector Search
category: agent-bricks
disabled: false
---

# Vector Search

## What It Does

Databricks Vector Search creates and queries vector indexes for similarity search. It powers the retrieval step in RAG (Retrieval Augmented Generation) applications — given a user question, it finds the most relevant document chunks from the corpus. In demos, it is the infrastructure behind the Knowledge Assistant.

## When to Use in a Demo

- Whenever the demo includes a Knowledge Assistant — vector search is the retrieval mechanism.
- When building any RAG application that needs to search over unstructured documents.
- When the demo needs semantic search (finding related items by meaning rather than keyword match).

## Key Configuration Decisions

1. **Endpoint type:** Storage-optimized endpoints are recommended for most demos (lower cost, sufficient for demo-scale corpora). Standard endpoints for latency-sensitive production patterns.
2. **Index type:** Delta Sync Index (automatically syncs with a Delta table of document chunks) is the standard choice. Direct Vector Access Index for manual management.
3. **Embedding model:** Use the Databricks Foundation Model API embedding endpoint (`databricks-bge-large-en` or similar). Avoids external API dependencies.
4. **Chunking strategy:** Chunk documents into 500-1000 token segments with 50-100 token overlap. Each chunk needs metadata (document title, section, page number) for citation.
5. **Source table:** A Delta table with columns: `chunk_id`, `document_title`, `chunk_text`, `embedding_vector`, and metadata columns. The pipeline or a notebook populates this.

## Common Pitfalls

- Chunks that are too large (>1500 tokens) lose retrieval precision; chunks that are too small (<200 tokens) lose context.
- Not including metadata on chunks — without document title and section, the KA cannot provide proper citations.
- Creating the index before the source table has data — the index sync will show zero vectors.
- Using an external embedding API that adds latency and requires API key management.
- Forgetting to wait for the index to sync after populating the source table — there is a brief delay.

## How It Connects to Other Components

- **Knowledge Assistant:** The KA queries the vector index to retrieve relevant document chunks for each user question.
- **Document generation (synthetic data gen):** PDFs are generated, chunked, embedded, and loaded into the source Delta table.
- **Declarative pipeline:** Optionally, a pipeline step can handle chunking and embedding as part of the data flow.
- **Model serving:** The embedding model runs on a serving endpoint (Foundation Model API).

## Example Specification Snippet

```yaml
vector_search:
  endpoint:
    name: "fraud-docs-vs-endpoint"
    type: storage_optimized
  index:
    name: "fraud_intelligence_docs_index"
    type: delta_sync
    source_table: "catalog.schema.document_chunks"
    embedding_column: "embedding"
    text_column: "chunk_text"
    embedding_model: "databricks-bge-large-en"
  source_table_schema:
    columns:
      - chunk_id: string
      - document_title: string
      - section_title: string
      - page_number: int
      - chunk_text: string
      - embedding: array<float>
  chunking:
    strategy: "fixed_size"
    chunk_size_tokens: 750
    overlap_tokens: 75
  documents_to_index:
    - "Fraud Detection Rules Catalog v4.2"
    - "Fraud Intelligence Alert - TechDealz"
    - "Dark Web Monitoring Report"
    - "CNP Fraud Prevention Guidelines"
```

## URL

https://docs.databricks.com/aws/en/generative-ai/vector-search.html
