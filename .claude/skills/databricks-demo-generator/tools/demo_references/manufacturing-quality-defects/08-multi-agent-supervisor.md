# Multi-Agent Supervisor - Manufacturing Quality

## Purpose

Route user queries to the appropriate specialist:
- **Genie** for structured data questions (production, quality metrics, machine data)
- **Knowledge Assistant** for unstructured document questions (maintenance reports, procedures, manuals)

## Agent Configuration

### Agent 1: Quality Data Analyst (Genie)
- **Handles:** Questions about production data, quality metrics, defect rates, machine performance
- **Keywords:** defect rate, production, quality, metrics, trend, machine data, how many, which, when, statistics

### Agent 2: Maintenance Specialist (KA)
- **Handles:** Questions about maintenance records, procedures, equipment documentation
- **Keywords:** maintenance, why, report, procedure, manual, documentation, history, inspection

## Routing Logic

```
USER QUERY
    │
    ▼
┌─────────────────────────────────────────┐
│  Is this about numbers/data/metrics?    │
│  (defect rate, counts, trends, which)   │
├─────────────────────────────────────────┤
│  YES → Route to Genie                   │
│  "What's our defect rate?"              │
│  "Which machine has most defects?"      │
│  "Show me the trend over time"          │
└─────────────────────────────────────────┘
    │ NO
    ▼
┌─────────────────────────────────────────┐
│  Is this about documents/context/why?   │
│  (maintenance, reports, procedures)     │
├─────────────────────────────────────────┤
│  YES → Route to Knowledge Assistant     │
│  "What maintenance issues exist?"       │
│  "Why was maintenance delayed?"         │
│  "What does the manual say about..."    │
└─────────────────────────────────────────┘
    │ BOTH/UNCLEAR
    ▼
┌─────────────────────────────────────────┐
│  Complex query - coordinate both        │
│  "Why are defects high and what can     │
│   we do about it?"                      │
│  → Genie for WHAT, KA for WHY           │
└─────────────────────────────────────────┘
```

## Instructions for Supervisor

```
You coordinate between two specialists to answer manufacturing quality questions:

1. QUALITY DATA ANALYST (Genie)
   - Expert in production data and quality metrics
   - Can query: defect rates, production volumes, machine performance, trends
   - Use for: "What", "How many", "Which", "When", "Show me data"

2. MAINTENANCE SPECIALIST (Knowledge Assistant)
   - Expert in maintenance records and equipment documentation
   - Can search: maintenance reports, procedures, manuals, inspection records
   - Use for: "Why", "What happened", "What does the report say"

ROUTING RULES:
- Numbers and metrics → Genie
- Documents and context → KA
- Root cause investigation → Both (Genie for data, KA for explanation)

DEMO INVESTIGATION FLOW:
1. "What's our defect rate?" → Genie (shows 3.2%, 4x spike)
2. "Why are defects so high?" → Genie (identifies CNC-B-007, tolerance_drift)
3. "What's happening with CNC-B-007?" → KA (finds maintenance report with bearing wear)
4. "Why was maintenance delayed?" → KA (finds production priority memo)

When both agents are needed, synthesize their responses into a coherent answer.
```

## Demo Questions Routing

| Question | Route To | Reason |
|----------|----------|--------|
| "What's our defect rate this week?" | Genie | Metrics question |
| "Why are defects so high?" | Genie | Data analysis (which machine, product, type) |
| "What maintenance issues exist for CNC-B-007?" | KA | Document search |
| "Why was maintenance postponed?" | KA | Document search |
| "What's the impact and what should we do?" | Both | Genie for impact data, KA for recommended actions |
