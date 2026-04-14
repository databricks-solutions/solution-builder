---
name: Knowledge Assistant
category: genai-ml
disabled: false
---

# Knowledge Assistant

**Fully managed RAG agent** that turns your documents into accurate, grounded answers with page-level citations.

## Pain

Building RAG from scratch means chunking strategies, embedding pipelines, retrieval tuning, prompt engineering - months of work before you know if it even helps. Basic similarity search misses context, gives wrong answers, or hallucinates.

## Key Features

- **Instructed Retriever** - 70% higher answer quality than basic RAG
- **Page-level citations** - every answer cites its source, reducing hallucinations
- **Supported formats** - PDF, DOCX, PPTX, MD, TXT from UC Volumes
- **Natural language feedback** - improve quality by telling it what's wrong
- **Managed lifecycle** - ingestion, updates, retrieval, inference all handled

## Position

"Point it at your policy docs, product manuals, or research papers - get a Q&A bot in minutes, not months." FSI: compliance docs, policy search. Healthcare: clinical guidelines. Legal: contract analysis.

## Demo Tips

- **The WHY to Genie's WHAT** - Genie finds the problem in data, KA explains WHY from documents
- Include a "smoking gun" document that reveals the root cause
- Document identifiers (lot numbers, case IDs, product codes) must match the structured data exactly
- Generate "noise" documents (realistic but unrelated) plus the key document
- KA should cite the specific page/section when answering
- Demo flow: Genie → "these products have lot X in common" → KA → "memo about lot X quality issue"
- Instructions should guide KA to connect document findings to business impact

## Document Strategy

For demos, generate:
1. **Background noise** - 3-5 realistic documents (reports, memos, guides) that are plausible but don't contain the answer
2. **The smoking gun** - 1 document that contains the root cause explanation
3. **Matching identifiers** - lot numbers, dates, product codes that exactly match the structured data

## Configuration

- **Instructions** - domain context, what to look for, how to connect to business
- **Documents** - uploaded to UC Volumes
- **Identifiers** - key fields that link documents to structured data

## URL

https://docs.databricks.com/en/generative-ai/agent-bricks/knowledge-assistant
