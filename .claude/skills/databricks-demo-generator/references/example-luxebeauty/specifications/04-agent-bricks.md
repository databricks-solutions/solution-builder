# Agent Bricks — KA + MAS

**Skill to use** (both sections): `databricks-agent-bricks` — read `SKILLS/databricks-agent-bricks/SKILL.md` before implementing.

Affected products, lot, and texture complaints defined in 01-lakeflow.md (Shared Context).

> **MLflow tracing**: every KA, Genie, and MAS call is auto-traced into MLflow — nothing to wire up. The app links to those traces from the chat UI (see `specifications/app/00_OVERVIEW.md`). Talking track only; no extra resource to build.

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**. KA has a blocking dependency on the incident PDFs from `01-lakeflow.md` (Section C).

## A. Knowledge Assistant

Create `LuxeBeauty Incidents` KA pointing to `{raw_data_volume}/incident_pdf/`.

~10 PDFs total: ~9 routine facility docs (resolved incidents, QC summaries, maintenance logs) that DON'T mention the affected lot. Only 1 contains the smoking gun — the KA must find the needle, which makes the demo impressive.

### Instructions

```
You are a knowledge assistant for LuxeBeauty Co.'s production incident reports.

KEY DOCUMENT: Incident report for the affected lot contains:
- Equipment: Homogenizer Unit HMG-03 at Lyon
- Issue: Pressure fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar)
- Cause: Calibration drift in pressure regulation valve
- Products: SKU-1001, SKU-1002, SKU-1003 (~5,000 units)
- QC Note: "texture variations due to pressure fluctuations during emulsification"
- Disposition: RELEASED despite the issue

RESPONSE PATTERN: Cite document name + report number → quote QC assessment → mention lot was released → connect to customer complaints about "grainy texture" and "separated product".
```

### Certified Q&A

| Question | Expected |
|----------|----------|
| "Was there any incident for this lot?" | Finds report, pressure fluctuations, QC note, release decision |
| "What caused the texture problems?" | Homogenizer pressure during emulsification |
| "Why was the lot released?" | QC visual inspection passed, deemed "cosmetic variation only" |

Add knowledge_assistant_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `LuxeBeauty Operations Assistant` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | WHAT: returns, products, lots, customer feedback |
| `incident_expert` | Knowledge Assistant | WHY: production incidents, equipment issues |

### Instructions

```
You are Claire's operations assistant. She's VP of Ops (non-technical), needs fast answers.

ROUTING:
- Returns/data questions → data_analyst first
- Incident/production questions → incident_expert

DEMO FLOW:
1. Claire asks about returns → data_analyst → 3x spike, SKU-1001/1002/1003, common lot, texture complaints
2. ALWAYS suggest: "Would you like me to check for production incidents for this lot?"
3. Claire asks about incident → incident_expert → homogenizer pressure, lot released despite QC note

SYNTHESIS: Data = WHAT (3x returns, 3 products, 1 lot, texture complaints). Docs = WHY (homogenizer pressure, released anyway). Action: contact customers, consider recall, fix equipment.

TONE: Claire is busy. Lead with the answer, then details.
```

### Demo Flow

| Step | Claire asks | Routes to | Response |
|------|-------------|-----------|----------|
| 1 | "Why do I have so many returns?" | data_analyst | 3x spike, SKU-1001/1002/1003, texture complaints, suggests checking incidents |
| 2 | "Was there an incident for that lot?" | incident_expert | Homogenizer pressure, QC note, lot released anyway |

### Validation

Full flow: two questions lead to complete root cause (WHAT + WHY).

Add multi_agent_supervisor_id to `resources.json`.
