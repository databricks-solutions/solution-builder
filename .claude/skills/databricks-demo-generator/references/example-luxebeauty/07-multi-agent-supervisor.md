# Multi-Agent Supervisor Creation

> **Before starting**: Check if you have a relevant skill available and read it for best practices.

## Task

Create a Multi-Agent Supervisor (MAS) that orchestrates the Knowledge Assistant and Genie Space to answer investigation questions.

**Important**: The MAS is the entry point for the demo. It should route "Why do I have so many returns?" to Genie first, then suggest checking incidents when the lot is identified.

---

## MAS Configuration

| Setting | Value |
|---------|-------|
| **MAS Name** | `LuxeBeauty Operations Assistant` |
| **Description** | "Your intelligent assistant for investigating operational issues. Ask about returns, product performance, quality incidents, and get comprehensive analysis." |

---

## Agent Configuration

### Agent 1: Operations Data Analyst (Genie)

| Setting | Value |
|---------|-------|
| **Name** | `data_analyst` |
| **Type** | Genie Space |
| **Genie Space** | `LuxeBeauty Operations Analytics` |
| **Description** | "Analyzes operational data - orders, returns, products, production lots. Answers WHAT happened with specific numbers and lot IDs." |

**Routes to this agent when**:
- Questions about returns, orders, revenue
- Questions about products or production lots
- Questions about trends and comparisons
- Questions starting with "why" about operations
- Questions about what customers are saying

---

### Agent 2: Incident Documentation Expert (KA)

| Setting | Value |
|---------|-------|
| **Name** | `incident_expert` |
| **Type** | Knowledge Assistant |
| **KA** | `LuxeBeauty Incidents` |
| **Description** | "Searches production incident reports and quality documentation. Answers questions about documented incidents and manufacturing issues." |

**Routes to this agent when**:
- Questions about incidents or incident reports
- Questions mentioning specific lot IDs with "incident" context
- Questions about what happened during production
- Questions about manufacturing issues or equipment problems

---

## MAS Instructions

Add instructions like these to the Multi-Agent Supervisor (adapt as needed):

```
You are the LuxeBeauty Operations Assistant, helping investigate operational issues.

## YOUR AGENTS

1. DATA ANALYST (Genie): For operational data
   - Return statistics and trends
   - Product performance and return rates
   - Production lot analysis
   - Customer feedback from returns data

2. INCIDENT EXPERT (KA): For incident documentation
   - Production incident reports
   - Equipment issues
   - Quality incidents
   - Manufacturing problems

## ROUTING LOGIC

### For general operations questions → Route to DATA ANALYST first:
- "Why do I have so many returns?"
- "What's happening with returns this week?"
- "Which products have issues?"
- "What are customers saying?"

The DATA ANALYST will provide comprehensive analysis including lot IDs.

### For incident/documentation questions → Route to INCIDENT EXPERT:
- "Was there any incident for lot LOT-2025-0212?"
- "What happened during production of this lot?"
- "Any manufacturing issues reported?"
- "What caused the texture problems?"

## SYNTHESIS PATTERN

When the DATA ANALYST identifies a problematic lot (e.g., LOT-2025-0212),
ALWAYS suggest checking incident documentation:

"The data shows that lot LOT-2025-0212 is the common factor. Would you like
me to check if there were any production incidents reported for this lot?"

When providing final answers that combine both sources:
- Lead with the data findings (what happened)
- Follow with the documentation findings (why it happened)
- Connect the dots for the user
```

---

## Demo Flow

1. **"Why do I have so many returns?"** → data_analyst → Identifies LOT-2025-0212, suggests checking incidents
2. **"Was there any incident for that lot?"** → incident_expert → Finds PIR-2025-0212, explains pressure issue

---

## Question/Guideline Pairs

Add these to ensure reliable routing and safe demos without surprises:

| Question | Route To | Guideline |
|----------|----------|-----------|
| "Why do I have so many returns?" | data_analyst | Genie performs deep analysis, identifies problematic lot |
| "Was there any incident for lot LOT-2025-0212?" | incident_expert | Search incident reports for this lot ID |
| "What caused the texture problems?" | incident_expert | Find homogenizer documentation |
| "Which products have the highest returns?" | data_analyst | Product return analysis |
| "What are customers saying?" | data_analyst | Query return feedback data |
| "What happened during production?" | incident_expert | Search production incident reports |

---

## Resource Tracking

After creating, add the MAS ID to `resources.json`.

---

## Validation

After creating the MAS, test the full demo flow:

| Step | Question | Expected Result |
|------|----------|-----------------|
| 1 | "Why do I have so many returns?" | Routes to Genie, identifies LOT-2025-0212 |
| 2 | "Was there an incident for that lot?" | Routes to KA, finds incident report |
| 3 | "What caused it?" | Routes to KA, explains pressure fluctuation |
