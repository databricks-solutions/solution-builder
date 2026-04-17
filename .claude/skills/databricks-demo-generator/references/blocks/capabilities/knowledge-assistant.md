---
name: Knowledge Assistant
category: agent-bricks
disabled: false
skill: databricks-agent-bricks
---

# Knowledge Assistant

RAG-based Q&A over unstructured documents (PDFs, reports, policies). Searches via vector similarity, synthesizes answers with citations. Provides qualitative context structured data cannot — intelligence reports, policy documents, clinical guidelines, manufacturer bulletins.

## When to Use

- When the narrative requires context that cannot live in a SQL table — expert analysis, regulatory guidance, investigation reports, domain knowledge.
- Complement to Genie: Genie answers "what happened in the data?" while KA answers "what does this mean?" and "what do the experts say?"
- In multi-agent setup, typically Agent 2 (document/context specialist).

## Key Decisions

1. **Document corpus:** 5-8 documents with varied types (reports, policies, alerts, guidelines). Include one "smoking gun" with the critical revelation.
2. **Smoking gun pattern:** One document containing a specific finding connecting to the data anomaly — confirmed breach, inspection finding, clinical study result. The "aha moment."
3. **Identifier cross-referencing:** Documents must reference the same IDs, dates, entity names as structured data (merchant IDs, device fingerprints, patient IDs). Creates unified investigation feel.
4. **System instructions:** Frame KA as domain specialist. Include guidance on searching, quoting, connecting findings to data patterns.
5. **Document generation:** PDFs generated synthetically — ai-dev-kit skill handles volume upload and indexing.

## Pitfalls

- Generic documents that could apply to any company — must reference specific demo entities.
- Smoking gun too buried — KA must surface it from a straightforward question.
- Identifier mismatches between documents and data (e.g., "M-847291" vs "MERCH-847291").
- Too many documents diluting retrieval quality — keep corpus focused.
- Missing date/version metadata for temporal context.

## Connections

- **Vector Search:** Documents chunked and indexed in Vector Search for retrieval.
- **Data layer:** Document identifiers must match structured data identifiers exactly.
- **Multi-agent supervisor:** KA is the document specialist the supervisor routes qualitative questions to.
- **Synthetic data gen:** Smoking gun details (dates, amounts, entity names) must match data layer.

## URL

https://docs.databricks.com/aws/en/generative-ai/agent-framework/build-knowledge-assistant.html
