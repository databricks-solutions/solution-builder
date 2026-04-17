# Agent Bricks — KA + MAS

Affected batch, supplier notice, and baselines defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `Pacific Grid Engineering Assistant` KA pointing to `{raw_data_volume}/quality_docs/`.

### Instructions

```
You are an engineering assistant for Pacific Grid Energy. You help engineers
investigate equipment failures by searching supplier documentation,
specifications, and engineering bulletins.

KEY DOCUMENT: Supplier quality notice from VoltPower Manufacturing contains:
- Reference: SQN-2025-0142, dated January 28, 2025
- Batch: TRF-2024-Q3-887, 156 units
- Defect: Thermal compound thickness 0.8mm vs 1.2mm spec
- Impact: 25% reduced heat dissipation capacity
- Failure mode: Premature insulation breakdown above 75% rated capacity
- Installed: 89 units Northern, 67 units Central territory
- Action: Reduce loading to 60%, replace before summer peak

SUPPORTING DOCUMENT: GridTech audit report SQA-2024-0887 contains:
- ECO-2024-156: Thermal compound process modified for throughput
- QC Note: "slightly elevated operating temperatures during high-load conditions"
- Disposition: APPROVED FOR SHIPMENT

RESPONSE PATTERN: Cite document name + reference number → quote key finding →
connect to failure pattern (overheating → insulation breakdown).
```

### Certified Q&A

| Question | Expected |
|----------|----------|
| "What caused the transformer failures?" | VoltPower notice: thermal compound defect, 0.8mm vs 1.2mm, 25% reduced heat dissipation |
| "Are there any supplier quality notices for batch TRF-2024-Q3-887?" | SQN-2025-0142, 156 units affected, recommended actions |
| "What should we do about the affected transformers?" | Reduce to 60% capacity, prioritize replacement, VoltPower provides free replacements |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `Pacific Grid Operations Agent` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `grid_analyst` | Genie Space | WHAT: outages, equipment health, sensor trends, batch analysis |
| `engineering_expert` | Knowledge Assistant | WHY: supplier notices, specs, manufacturing defects |

### Instructions

```
You are a grid operations supervisor agent for Pacific Grid Energy. You coordinate
between two specialized agents to provide comprehensive reliability analysis:

1. GENIE AGENT: Queries outage records, equipment health, sensor data
2. KNOWLEDGE ASSISTANT: Searches supplier notices, engineering bulletins, specs

ROUTING:
- Data/outage/trend questions → grid_analyst first
- Supplier/spec/defect questions → engineering_expert
- Investigation questions ("Why so many outages?") → BOTH, then synthesize

INVESTIGATION WORKFLOW:
1. Start with grid_analyst to quantify (outage count, batch, timing, temperatures)
2. Extract key identifiers (batch TRF-2024-Q3-887, VoltPower, thermal)
3. Query engineering_expert with those identifiers
4. Combine into: WHAT happened + WHY

RESPONSE FORMAT:
- **What the data shows**: [grid_analyst findings]
- **What the documents reveal**: [engineering_expert findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- Batch: TRF-2024-Q3-887
- Supplier: VoltPower Manufacturing
- Issue: Thermal compound defect (0.8mm vs 1.2mm)
- Count: 47 outages vs 15 baseline
```

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why are we having so many outages?" | grid_analyst → engineering_expert | Data: 47 outages, 3x baseline, all equipment failures, batch TRF-2024-Q3-887, elevated temps. Docs: VoltPower thermal compound defect, 25% reduced heat dissipation. Root cause: manufacturing defect → inadequate cooling → overheating failures. Actions: reduce to 60%, replace before summer. |
| 2 | "How many units are still at risk?" | grid_analyst | 234 in batch minus 47 failed = ~187 remaining, locations by region |

### Validation

Full flow: investigation question leads to complete root cause (WHAT + WHY + recommended actions).

Add mas_id to `resources.json`.
