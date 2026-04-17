# Agent Bricks — KA + MAS

Affected machine, sensor thresholds, and alert details defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `Precision Maintenance Knowledge Assistant` KA pointing to `{raw_data_volume}/maintenance_docs/`.

### Instructions

```
You are a maintenance knowledge assistant for Precision Motors. You help
engineers investigate equipment issues by searching maintenance logs,
sensor alerts, and engineering documents.

When asked about defect spikes or machine issues:
1. Search for relevant maintenance alerts and sensor data
2. Look for warning signs that preceded the problem
3. Connect document findings to quality patterns in the data

Key identifiers to match:
- Machine: CNC-DTR-007
- Location: Detroit Plant, Line 3
- Issue: Spindle bearing wear
- Alert: PMA-2025-0847

KEY DOCUMENT: Predictive maintenance alert for CNC-DTR-007 contains:
- Sensor: Vibration monitor (spindle assembly), reading 3.2 mm/s
- Pattern: Spindle bearing wear, characteristic defect at 847 Hz
- Technician assessment: "Reading within acceptable operating range" — deferred to PM window
- Escalation: WARNING → CRITICAL (5.2 mm/s) — PM window NOT advanced
- Consequence: Dimensional tolerance failures, ~12,400 defective parts

RESPONSE PATTERN: Cite document name + alert ID → quote technician assessment →
mention escalation to CRITICAL was ignored → connect to defect spike.

Always cite document sources and specific sections when providing answers.
```

### Validation

| Question | Expected |
|----------|----------|
| "What maintenance alerts exist for CNC-DTR-007?" | Finds PMA-2025-0847, vibration anomaly, bearing wear, deferred PM |
| "Was there a warning before the defect spike?" | Yes — WARNING Feb 12, CRITICAL Feb 18, PM not advanced |
| "Why wasn't the alert acted on?" | Technician deemed acceptable, scheduled 6 weeks out, not advanced despite CRITICAL |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `Precision Quality Investigation Agent` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | WHAT: defect rates, machine metrics, sensor trends, quality data |
| `maintenance_expert` | Knowledge Assistant | WHY: maintenance alerts, calibration logs, equipment history |

### Instructions

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

ROUTING:
- Data/metrics questions → data_analyst first
- Document/alert questions → maintenance_expert
- Investigation questions → BOTH, then synthesize

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
- Alert: PMA-2025-0847
```

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why are defects so high?" | data_analyst | 8.5% rate (3x baseline), CNC-DTR-007 at 12%, dimensional failures, vibration 4.5 mm/s → suggests checking maintenance docs |
| 2 | "Was there a maintenance warning?" | maintenance_expert | PMA-2025-0847: bearing wear detected, deferred to PM, escalated to CRITICAL but not advanced |
| 3 | "What's the full picture?" | both → synthesize | WHAT: 12% defects from CNC-DTR-007, bearing wear. WHY: alert ignored, PM not advanced. ACTION: stop machine, replace bearing, quarantine parts, fix escalation process |

### Validation

Full flow: investigation questions lead to complete root cause (WHAT from data + WHY from documents).

Add mas_id to `resources.json`.
