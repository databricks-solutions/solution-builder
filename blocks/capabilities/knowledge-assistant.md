---
name: Knowledge Assistant
slug: knowledge-assistant
category: capability
tags: [rag, documents, retrieval, unstructured, agent-bricks]
description: >
  Context for generating Knowledge Assistant specifications, including document corpus design,
  the smoking gun pattern for demos, system instructions for retrieval-augmented Q&A, and
  how documents must cross-reference the structured data layer.
related: [multi-agent-supervisor, vector-search, genie-space]
---

# Knowledge Assistant

## What It Does

A Knowledge Assistant performs retrieval-augmented Q&A over unstructured documents (PDFs, reports, policies). It searches a document corpus using vector similarity and synthesizes answers with citations. In demos, it provides the qualitative context that structured data cannot — intelligence reports, policy documents, clinical guidelines, manufacturer bulletins.

## When to Use in a Demo

- When the demo narrative requires context that cannot live in a SQL table — expert analysis, regulatory guidance, investigation reports, or domain knowledge documents.
- As the complement to Genie: Genie answers "what happened in the data?" while the KA answers "what does this mean?" and "what do the experts say?"
- In a multi-agent setup, the KA is typically Agent 2 (the document/context specialist).

## Key Configuration Decisions

1. **Document corpus:** Design 5-8 documents with varied types (reports, policies, alerts, guidelines). Include one "smoking gun" document that contains the critical revelation.
2. **The smoking gun pattern:** One document must contain a specific finding that connects to the data anomaly — a confirmed breach report, an inspection finding, a clinical study result. This is the "aha moment" in the demo.
3. **Identifier cross-referencing:** Documents must reference the same IDs, dates, and entity names as the structured data (merchant IDs, device fingerprints, patient IDs, part numbers). This creates the feeling of a unified investigation.
4. **System instructions:** Frame the KA as a domain specialist. Include guidance on how to search, what to quote, and how to connect findings to the data patterns.
5. **Document generation:** PDFs are generated synthetically and uploaded to a Unity Catalog volume, then indexed for retrieval.

## Common Pitfalls

- Documents that are completely generic and could apply to any company — they must reference the specific entities in the demo data.
- The smoking gun being too buried — the KA must be able to find and surface it from a straightforward question.
- Identifier mismatches between documents and data (e.g., document says "M-847291" but data uses "MERCH-847291").
- Too many documents diluting retrieval quality — keep the corpus focused.
- Forgetting to include date/version metadata on documents for temporal context.

## How It Connects to Other Components

- **Vector Search:** Documents are chunked and indexed in a Vector Search index for retrieval.
- **Data layer:** Document identifiers must match structured data identifiers exactly.
- **Multi-agent supervisor:** KA is the document specialist the supervisor routes qualitative questions to.
- **Synthetic data gen:** The smoking gun document's details (dates, amounts, entity names) must be generated to match the data layer.

## Example Specification Snippet

```yaml
knowledge_assistant:
  name: "Pacific Coast Fraud Intelligence Assistant"
  documents:
    - title: "Fraud Detection Rules Catalog v4.2"
      type: reference
      pages: 20
      purpose: "Current detection rules — shows what rules exist and their gaps"
    - title: "Fraud Intelligence Alert - TechDealz"
      type: alert
      pages: 3
      purpose: "SMOKING GUN — confirms breach, identifies fraud ring, device FPs"
      cross_references:
        - "M-847291 → merchants.merchant_id"
        - "FP-8821, FP-8822 → transactions.device_fingerprint"
        - "Breach date March 8 → first fraud March 10"
    - title: "Dark Web Monitoring Report"
      type: intelligence
      pages: 2
      purpose: "Evidence of cards being sold online"
  instructions: |
    You are a Fraud Intelligence Analyst for Pacific Coast Bank.
    When asked about TechDealz, search for the March 15 alert.
    Quote directly from documents. Connect findings to data patterns.
  sample_questions:
    - question: "What do we know about TechDealz fraud?"
      expected: "Surfaces the intelligence alert with breach confirmation"
```
