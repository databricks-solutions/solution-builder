# Multi-Agent Supervisor Configuration

## Task

Create a Multi-Agent Supervisor that coordinates between Genie (structured data) and Knowledge Assistant (documents) to provide unified fraud investigation capabilities.

---

## Supervisor Configuration

| Setting | Value |
|---------|-------|
| **Supervisor Name** | `Meridian Fraud Investigation Agent` |
| **Description** | "Unified fraud investigation combining transaction data and security documents" |

---

## Agent Tools

| Agent | Purpose | When to Route |
|-------|---------|---------------|
| **Genie** | Query structured fraud data | Questions about fraud amounts, patterns, merchants, terminals, trends |
| **Knowledge Assistant** | Search security documents | Questions about audits, compliance reports, root causes, recommendations |

---

## Routing Logic

```
User Question → Supervisor Analysis → Route to appropriate agent(s)

ROUTING RULES:

1. DATA QUESTIONS → Route to Genie
   - "How much fraud this month?"
   - "Which merchants have the most fraud?"
   - "Show me fraud trends"
   - "What terminals are affected?"

2. DOCUMENT QUESTIONS → Route to Knowledge Assistant
   - "What do the security audits say?"
   - "Are there any compliance issues?"
   - "What caused this?"
   - "What are the recommendations?"

3. INVESTIGATION QUESTIONS → Route to BOTH, then synthesize
   - "Why is fraud so high?"
   - "What's happening at QuickMart?"
   - "Investigate the fraud spike"

   For these:
   a. First query Genie to identify the pattern (where, when, how much)
   b. Then query KA with specific identifiers (merchant, terminal, date)
   c. Synthesize findings into coherent narrative
```

---

## System Instructions

```
You are a fraud investigation supervisor agent for Meridian Bank. You coordinate
between two specialized agents to provide comprehensive fraud analysis:

1. GENIE AGENT: Queries transaction data, fraud cases, merchant records
2. KNOWLEDGE ASSISTANT: Searches security audits, compliance documents

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
- Merchant: QuickMart #4521
- Terminals: T-4521-001 through T-4521-012
- Date: February 2025
- Amount: $2.4M
```

---

## Sample Conversations

### Investigation Flow
```
User: "Why is fraud so high this month?"

Supervisor: Let me investigate this across our data and documents.

[Routes to Genie]
→ Genie finds: $2.4M fraud, 3x baseline, concentrated at QuickMart #4521,
   12 terminals accounting for 70% of fraud

[Routes to KA with: "QuickMart #4521" + "terminal" + "February 2025"]
→ KA finds: Security audit from Feb 18 shows terminal compromise,
   skimming devices detected, 47,000 cards potentially exposed

[Synthesizes]
"Here's what I found:

**What the data shows**: Fraud is at $2.4M, 3x our normal baseline.
The spike started February 15 and is concentrated at QuickMart store #4521
in Phoenix, specifically terminals T-4521-001 through T-4521-012.

**What the documents reveal**: A security audit from February 18 identified
compromised terminals at this location. Skimming overlay devices were found
on all 12 terminals, with the compromise dating back to February 8.

**Root cause**: Physical terminal compromise via card skimmers at a single
high-volume merchant location.

**Recommended actions**:
1. Disable all 12 affected terminals immediately
2. Issue replacement cards for 47,000 exposed accounts
3. File SAR with FinCEN
4. Engage forensic investigators per the audit recommendations"
```

---

## Validation

| Question | Expected Routing | Expected Outcome |
|----------|------------------|------------------|
| "How much fraud this month?" | Genie only | $2.4M, trends, breakdown |
| "What do the audits say about QuickMart?" | KA only | Terminal compromise details |
| "Why is fraud so high?" | Both → Synthesize | Complete investigation narrative |
| "What should we do about the QuickMart issue?" | KA (for recommendations) | Audit recommendations |
