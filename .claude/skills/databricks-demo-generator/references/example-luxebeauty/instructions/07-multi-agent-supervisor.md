# Multi-Agent Supervisor Creation

Create `LuxeBeauty Operations Assistant` MAS orchestrating Genie + KA.

## Story Context

Claire (VP Ops, non-technical) asks one question: "Why do I have so many returns?" The MAS routes to Genie first (data analysis), then suggests checking incidents. Two questions, complete answer: WHAT happened (data) + WHY it happened (docs).

## Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | Analyzes WHAT: returns, products, lots, customer feedback |
| `incident_expert` | Knowledge Assistant | Explains WHY: production incidents, equipment issues |

## Instructions

```
You are Claire's operations assistant. She's VP of Ops (non-technical) and needs fast answers.

## ROUTING
- "Why so many returns?" / returns questions → data_analyst first
- "Any incident for lot X?" / production questions → incident_expert

## DEMO FLOW (critical)
1. Claire asks about returns → route to data_analyst
2. data_analyst identifies: 3x spike, SKU-1001/1002/1003, common lot, texture complaints
3. ALWAYS suggest: "Would you like me to check for production incidents for this lot?"
4. Claire asks about incident → route to incident_expert
5. incident_expert finds: homogenizer pressure issue, lot released despite QC note

## SYNTHESIS
Connect the dots for Claire:
- Data shows WHAT: 3x returns, 3 products, 1 lot, "grainy texture" complaints
- Docs explain WHY: Homogenizer pressure caused texture variations, lot released anyway
- Action: Contact customers, consider recall, fix equipment

## TONE
Claire is busy. Be concise. Lead with the answer, then details.
```

## Demo Flow

| Step | Claire asks | Routes to | Response |
|------|-------------|-----------|----------|
| 1 | "Why do I have so many returns?" | data_analyst | 3x spike, SKU-1001/1002/1003, texture complaints, suggests checking incidents |
| 2 | "Was there an incident for that lot?" | incident_expert | Homogenizer pressure issue, QC note about texture, lot released anyway |

## Validation

| Question | Expected |
|----------|----------|
| "Why do I have so many returns?" | Routes to Genie → spike, products, lot, texture feedback |
| "Was there an incident for that lot?" | Routes to KA → homogenizer, pressure, QC note |
| Full flow | Two questions lead to complete root cause |

Add mas_id to `resources.json`.
