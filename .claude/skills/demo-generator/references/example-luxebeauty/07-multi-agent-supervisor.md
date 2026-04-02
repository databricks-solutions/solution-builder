# Multi-Agent Supervisor Creation

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

## Demo Questions (Configure as Sample Questions)

These questions must work reliably for the demo:

### Primary Demo Flow

**Step 1 - Ask Genie via MAS:**
```
"Why do I have so many returns?"
```
**Expected**: Routes to data_analyst, performs deep analysis, identifies LOT-2025-0212, suggests checking incidents.

**Step 2 - Follow-up to KA:**
```
"Was there any incident reported for lot LOT-2025-0212?"
```
**Expected**: Routes to incident_expert, finds the incident report, explains pressure fluctuation cause.

### Alternative Demo Questions

| Question | Routes To | Expected Behavior |
|----------|-----------|-------------------|
| "What's happening with returns?" | data_analyst | Weekly comparison, identifies spike |
| "Which products are affected?" | data_analyst | Lists SKU-1001, SKU-1002, SKU-1003 |
| "What are customers complaining about?" | data_analyst | Texture complaints from return feedback |
| "What caused the manufacturing problem?" | incident_expert | Homogenizer pressure issues |
| "Was the lot released?" | incident_expert | Yes, RELEASE FOR DISTRIBUTION |

---

## Example Question/Guideline Pairs

Add these to ensure reliable routing:

```json
[
  {
    "question": "Why do I have so many returns?",
    "guideline": "Route to data_analyst. The Genie has smart instructions to automatically perform deep analysis and identify the problematic lot."
  },
  {
    "question": "Was there any incident reported for lot LOT-2025-0212?",
    "guideline": "Route to incident_expert. Search for production incident reports mentioning this lot ID."
  },
  {
    "question": "What caused the texture problems?",
    "guideline": "Route to incident_expert. Find documentation explaining the manufacturing issue with the homogenizer."
  },
  {
    "question": "Which products have the highest returns?",
    "guideline": "Route to data_analyst for product return analysis from the operational data."
  },
  {
    "question": "What are customers saying about the products?",
    "guideline": "Route to data_analyst. Query return feedback data for customer complaints."
  },
  {
    "question": "What happened during production?",
    "guideline": "Route to incident_expert. Search production incident reports for manufacturing details."
  }
]
```

---

## Demo Script

For a reliable demo, follow this sequence:

1. **Open with the key question:**
   > "Why do I have so many returns?"

   The MAS routes to Genie, which performs deep analysis and identifies:
   - Returns 3x higher than normal
   - 3 Skincare products affected
   - All trace to lot LOT-2025-0212
   - Customers report texture issues

2. **Follow up on the lot:**
   > "Was there any incident reported for that lot?"

   The MAS routes to KA, which finds:
   - Incident report PIR-2025-0212
   - Homogenizer pressure fluctuations
   - QC note about texture variations
   - Lot was released despite the issue

3. **Connect the dots:**
   The user now has the full picture - data shows the problem (high returns), documentation explains why (manufacturing incident).

---

## Resource Tracking

After creating the Multi-Agent Supervisor, **add the MAS ID to `resources.json`**:
```json
{
  "multi_agent_supervisor_id": "<the-mas-id>"
}
```

---

## Validation

After creating the MAS, test the full demo flow:

| Step | Question | Expected Result |
|------|----------|-----------------|
| 1 | "Why do I have so many returns?" | Routes to Genie, identifies LOT-2025-0212 |
| 2 | "Was there an incident for that lot?" | Routes to KA, finds incident report |
| 3 | "What caused it?" | Routes to KA, explains pressure fluctuation |

The MAS should correctly route each question and provide coherent answers that connect the structured data insights with the incident documentation.
