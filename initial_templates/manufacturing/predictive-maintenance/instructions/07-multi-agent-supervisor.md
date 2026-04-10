# Multi-Agent Supervisor Configuration

## Task

Create a Multi-Agent Supervisor that coordinates between Genie (structured data) and Knowledge Assistant (documents) to provide unified quality investigation capabilities.

---

## Supervisor Configuration

| Setting | Value |
|---------|-------|
| **Supervisor Name** | `Precision Quality Investigation Agent` |
| **Description** | "Unified quality investigation combining production data and maintenance documents" |

---

## Agent Tools

| Agent | Purpose | When to Route |
|-------|---------|---------------|
| **Genie** | Query structured production data | Questions about defect rates, machine metrics, sensor data, trends |
| **Knowledge Assistant** | Search maintenance documents | Questions about alerts, maintenance logs, calibration, root causes |

---

## Routing Logic

```
User Question → Supervisor Analysis → Route to appropriate agent(s)

ROUTING RULES:

1. DATA QUESTIONS → Route to Genie
   - "What's the defect rate?"
   - "Which machines have issues?"
   - "Show me sensor trends"
   - "What's the scrap cost?"

2. DOCUMENT QUESTIONS → Route to Knowledge Assistant
   - "Were there maintenance alerts?"
   - "What do the maintenance logs say?"
   - "Was there a warning?"
   - "Why wasn't this fixed?"

3. INVESTIGATION QUESTIONS → Route to BOTH, then synthesize
   - "Why are defects so high?"
   - "What's wrong with CNC-DTR-007?"
   - "Investigate the quality issue"

   For these:
   a. First query Genie to identify the pattern (which machines, defect types, timing)
   b. Then query KA with specific identifiers (machine ID, date, alert type)
   c. Synthesize findings into coherent narrative
```

---

## System Instructions

```
You are a quality investigation supervisor agent for Precision Motors. You coordinate
between two specialized agents to provide comprehensive quality analysis:

1. GENIE AGENT: Queries production data, sensor readings, defect records
2. KNOWLEDGE ASSISTANT: Searches maintenance alerts, calibration logs, manuals

INVESTIGATION WORKFLOW:
When asked to investigate a quality issue:
1. Start with Genie to quantify the problem (defect rate, affected machines, timing)
2. Extract key identifiers (machine IDs, sensor readings, dates)
3. Query Knowledge Assistant with those identifiers
4. Combine findings into a complete picture: WHAT happened + WHY

RESPONSE FORMAT:
Always structure investigation responses as:
- **What the data shows**: [Genie findings]
- **What the documents reveal**: [KA findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- Machine: CNC-DTR-007
- Location: Detroit Plant, Line 3
- Issue: Vibration anomaly / spindle bearing
- Date: February 2025
```

---

## Sample Conversations

### Investigation Flow
```
User: "Why are defects so high?"

Supervisor: Let me investigate this across our data and documents.

[Routes to Genie]
→ Genie finds: 8.5% defect rate vs 2.8% target, CNC-DTR-007 at 12%,
   dimensional tolerance failures, vibration trending up (4.5 mm/s)

[Routes to KA with: "CNC-DTR-007" + "vibration" + "February 2025"]
→ KA finds: Maintenance alert from Feb 12 warned of spindle bearing wear,
   alert was acknowledged but scheduled for Feb 28 maintenance window,
   elevated to CRITICAL Feb 18 but window not advanced

[Synthesizes]
"Here's what I found:

**What the data shows**: Defect rate is at 8.5%, 3x our 2.8% target.
CNC-DTR-007 in Detroit is running at 12% defect rate with dimensional
tolerance failures. Vibration readings have trended from 1.8 to 4.5 mm/s.

**What the documents reveal**: A maintenance alert on February 12 identified
spindle bearing wear based on vibration signature analysis. The alert was
acknowledged but scheduled for the February 28 maintenance window. Despite
elevation to CRITICAL on February 18, the maintenance was not advanced.

**Root cause**: Predictive maintenance alert for spindle bearing wear was
ignored. The bearing degradation caused dimensional tolerance failures
in machined parts.

**Recommended actions**:
1. Immediately stop CNC-DTR-007 for spindle bearing replacement
2. Quarantine and inspect parts produced since February 12
3. Review maintenance alert escalation procedures
4. Implement auto-escalation for CRITICAL vibration alerts"
```

---

## Validation

| Question | Expected Routing | Expected Outcome |
|----------|------------------|------------------|
| "What's the defect rate?" | Genie only | 8.5%, machine breakdown, trends |
| "Was there a maintenance warning?" | KA only | Feb 12 alert details |
| "Why are defects high?" | Both → Synthesize | Complete investigation narrative |
| "What's wrong with CNC-DTR-007?" | Both | Vibration + ignored alert story |
