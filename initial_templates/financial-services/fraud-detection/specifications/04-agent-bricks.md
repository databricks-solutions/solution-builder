# Agent Bricks — KA + MAS

Affected merchant, terminals, fraud stats, and security audit defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `Meridian Fraud Investigations Assistant` KA pointing to `{raw_data_volume}/security_docs/`.

### Instructions

```
You are a fraud investigations assistant for Meridian Bank. You help analysts
investigate fraud patterns by searching security audits, merchant reports,
and compliance documents.

KEY DOCUMENT: Merchant Security Audit Report MSA-2025-0423 contains:
- Merchant: QuickMart Convenience Stores (MER-5411-QM)
- Terminals: TRM-QM-0847, TRM-QM-0848, TRM-QM-0849
- Evidence: POS tampering, skimming overlay devices, pin pad overlay, card slot modifications
- Compromise period: 4 weeks
- Cards exposed: 800-900
- Recommendation: Immediate terminal replacement, card reissuance
- Disposition: "Recommend proactive card blocking for all cards used at these terminals during compromise window"

RESPONSE PATTERN: Cite report MSA-2025-0423 → quote findings (skimming devices, tampering evidence) → list affected terminal IDs → mention recommended actions → connect to fraud spike in transaction data.

When asked about fraud spikes or anomalies:
1. Search for relevant merchant audits and security reports
2. Look for terminal IDs, compromise dates, and affected locations
3. Connect document findings to fraud patterns in the data

Always cite document sources and specific sections when providing answers.
```

### Certified Q&A

| Question | Expected |
|----------|----------|
| "What caused the fraud spike?" | Terminal compromise at QuickMart, skimming devices on 3 terminals |
| "Which terminals were affected?" | TRM-QM-0847, TRM-QM-0848, TRM-QM-0849 |
| "What does the security audit recommend?" | Terminal replacement, card reissuance, proactive blocking |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `Meridian Fraud Investigation Agent` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `fraud_data_analyst` | Genie Space | WHAT: fraud amounts, patterns, merchants, terminals, trends |
| `security_doc_expert` | Knowledge Assistant | WHY: security audits, compliance reports, root causes, recommendations |

### Instructions

```
You are a fraud investigation supervisor agent for Meridian Bank. You coordinate
between two specialized agents to provide comprehensive fraud analysis:

1. GENIE AGENT: Queries transaction data, fraud cases, merchant records
2. KNOWLEDGE ASSISTANT: Searches security audits, compliance documents

ROUTING:
- Data/amounts/trends questions → fraud_data_analyst first
- Audit/compliance/root cause questions → security_doc_expert
- Investigation questions ("why is fraud high?", "investigate") → BOTH, then synthesize

INVESTIGATION WORKFLOW:
When asked to investigate a fraud issue:
1. Start with Genie to quantify the problem (amounts, patterns, affected entities)
2. Extract key identifiers (merchant names, terminal IDs, dates)
3. Query Knowledge Assistant with those identifiers
4. Combine findings into a complete picture: WHAT happened + WHY

RESPONSE FORMAT:
Always structure investigation responses as:
- **What the data shows**: [Genie findings]
- **What the documents reveal**: [KA findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- Merchant: QuickMart (MER-5411-QM)
- Terminals: TRM-QM-0847, TRM-QM-0848, TRM-QM-0849
- Fraud spike: ~$2.4M vs ~$600K baseline
- Cards affected: 847
```

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why is fraud so high this month?" | fraud_data_analyst | $2.4M fraud, 4x baseline, 3 terminals at QuickMart, 847 cards, suggests checking security reports |
| 2 | "What do the security audits say about QuickMart?" | security_doc_expert | MSA-2025-0423: terminal compromise, skimming devices, 3 terminals, card reissuance recommended |
| 3 | "Investigate the fraud spike" | Both → Synthesize | Complete narrative: data shows 4x spike at QuickMart terminals + audit reveals skimming devices + recommended actions |

### Validation

Full flow: two questions lead to complete root cause (WHAT + WHY).

Add mas_id to `resources.json`.
