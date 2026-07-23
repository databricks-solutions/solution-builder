---
name: Vector Search
category: agent-bricks
disabled: true
buildable: true
skill: databricks-vector-search
---

# Vector Search

Creates and queries vector indexes for similarity search. Powers the retrieval step in RAG — finds the most relevant document chunks from a corpus given a user question. Infrastructure behind the Knowledge Assistant.

## When to Use

- Whenever the demo includes a Knowledge Assistant — vector search is the retrieval mechanism.
- Any RAG application searching over unstructured documents.
- Semantic search (finding related items by meaning, not keyword match).

## Key Decisions

1. **Endpoint type:** Storage-optimized for most demos (lower cost, sufficient for demo-scale corpora).
2. **Index type:** Delta Sync Index (auto-syncs with source table) is standard.
3. **Document corpus:** Chunk source table must include metadata (document title, section, page number) for proper KA citations.

The `databricks-vector-search` Databricks Agent Skill (DAS) handles endpoint creation, embedding config, chunking strategy, and index management.

## Pitfalls

- Chunks too large (>1500 tokens) lose retrieval precision; too small (<200 tokens) lose context.
- Missing metadata on chunks — without document title and section, KA cannot cite properly.
- Creating index before source table has data — sync shows zero vectors.
- External embedding API adding latency and requiring API key management.
- Not waiting for index sync after populating source table — brief delay exists.

## Connections

- **Knowledge Assistant:** KA queries the vector index to retrieve relevant chunks per question.
- **Document generation (synthetic data gen):** PDFs generated, chunked, embedded, loaded into source Delta table.
- **Declarative pipeline:** Optionally, a pipeline step handles chunking/embedding as part of data flow.
- **Model serving:** Embedding model runs on a serving endpoint (Foundation Model API).

## URL

https://docs.databricks.com/aws/en/generative-ai/vector-search.html
