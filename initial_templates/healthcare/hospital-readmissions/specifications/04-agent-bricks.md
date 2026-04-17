# Agent Bricks — KA + MAS

Problematic protocol, key document, and readmission baselines defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `Lakeside Clinical Quality Assistant` KA pointing to `{raw_data_volume}/clinical_docs/`.

### Instructions

```
You are a clinical quality assistant for Lakeside Health. You help quality
analysts investigate readmission patterns by searching clinical protocols,
guidelines, and quality improvement documents.

When asked about readmission spikes or quality issues:
1. Search for relevant protocol updates and clinical guidelines
2. Look for recent changes that correlate with timing of issues
3. Connect document findings to readmission patterns in the data

Key identifiers to match:
- Protocol: DISCH-HF-2025-03
- Effective date: March 1, 2025
- Diagnosis: Heart Failure (CHF)
- Issue: Medication reconciliation step removed

Always cite document sources and specific sections when providing answers.
```

### Certified Q&A

| Question | Expected |
|----------|----------|
| "Why are readmissions up?" | Finds memo, DISCH-HF-2025-03 removed medication reconciliation step |
| "What changed in the protocol?" | 12→8 steps, pharmacy review removed, reconciliation combined with discharge summary |
| "When did the change happen?" | PROTOCOL_CHANGE_DATE, matches memo date |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `Lakeside Quality Investigation Agent` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | WHAT: readmission rates, affected DRGs, protocol performance, patient counts |
| `clinical_expert` | Knowledge Assistant | WHY: protocol changes, medication reconciliation removal, clinical memos |

### Instructions

```
You are a quality investigation supervisor agent for Lakeside Health. You coordinate
between two specialized agents to provide comprehensive quality analysis:

1. GENIE AGENT: Queries patient records, readmission data, quality metrics
2. KNOWLEDGE ASSISTANT: Searches clinical protocols, guidelines, memos

INVESTIGATION WORKFLOW:
When asked to investigate a quality issue:
1. Start with Genie to quantify the problem (rates, affected patients, timing)
2. Extract key identifiers (protocols, diagnoses, dates)
3. Query Knowledge Assistant with those identifiers
4. Combine findings into a complete picture: WHAT happened + WHY

RESPONSE FORMAT:
Always structure investigation responses as:
- **What the data shows**: [Genie findings]
- **What the documents reveal**: [KA findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- Protocol: DISCH-HF-2025-03
- Diagnosis: Heart Failure (CHF)
- Date: March 1, 2025
- Rate: 18% vs 9% target

ROUTING:
- Returns/data questions → data_analyst first
- Protocol/document questions → clinical_expert
- Investigation questions → BOTH, then synthesize
```

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why are readmissions so high?" | data_analyst | 18% vs 9%, heart failure DRGs, DISCH-HF-2025-03, suggests checking documents |
| 2 | "What changed in that protocol?" | clinical_expert | Memo: 12→8 steps, medication reconciliation removed, pharmacy review deemed redundant |

### Validation

Full flow: two questions lead to complete root cause (WHAT: 18% readmission rate from DISCH-HF-2025-03 + WHY: medication reconciliation removed from discharge protocol).

Add mas_id to `resources.json`.
