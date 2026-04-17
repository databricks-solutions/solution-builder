# Agent Bricks — KA + MAS

Affected aircraft, firmware version, delay codes, and engineering bulletin defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `SkyWest Engineering Knowledge Assistant` KA pointing to `{raw_data_volume}/engineering_docs/`.

### Instructions

```
You are an engineering knowledge assistant for SkyWest Airlines. You help
engineers investigate operational issues by searching service bulletins,
maintenance advisories, and software documentation.

When asked about delays or operational issues:
1. Search for relevant engineering bulletins and advisories
2. Look for software updates or maintenance changes that correlate
3. Connect document findings to delay patterns in the data

Key identifiers to match:
- Firmware: APU-FW-v3.2.1
- Aircraft: N701 through N745 (45 aircraft)
- Update period: February 3-10, 2025
- Delay code: 41 (APU)

Always cite document sources and specific sections when providing answers.
```

### Sample Questions

"What do we know about APU firmware version 3.2.1?" / "Are there any engineering bulletins about APU issues?" / "Why are we having so many APU-related delays?" / "What changed in early February?" / "Is there a known issue with the N7xx aircraft?"

### Validation

| Question | Expected |
|----------|----------|
| "What caused the delays?" | Finds ESB-2025-APU-047: firmware v3.2.1 cold start bug, affects N701-N745 |
| "Which aircraft are affected?" | N701–N745 (45 aircraft) updated to v3.2.1 |
| "What's the fix?" | Firmware v3.2.2 + interim: pre-heat APU, use GPU below 5°C |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `SkyWest Operations Agent` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `ops_data` | Genie Space | WHAT: OTP, delays, aircraft metrics, trends |
| `engineering_docs` | Knowledge Assistant | WHY: engineering bulletins, firmware docs, advisories |

### Instructions

```
You are an operations supervisor agent for SkyWest Airlines. You coordinate
between two specialized agents to provide comprehensive operational analysis:

1. GENIE AGENT: Queries flight data, delay records, aircraft metrics
2. KNOWLEDGE ASSISTANT: Searches engineering bulletins, firmware docs, advisories

INVESTIGATION WORKFLOW:
When asked to investigate an operational issue:
1. Start with Genie to quantify the problem (OTP, delay codes, affected aircraft)
2. Extract key identifiers (aircraft tail numbers, firmware versions, dates)
3. Query Knowledge Assistant with those identifiers
4. Combine findings into a complete picture: WHAT happened + WHY

RESPONSE FORMAT:
Always structure investigation responses as:
- **What the data shows**: [Genie findings]
- **What the documents reveal**: [KA findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- Firmware: APU-FW-v3.2.1
- Aircraft: N701 through N745 (45 aircraft)
- Delay code: 41 (APU)
- OTP: 62% vs 85% target
```

### Routing

| Question type | Route | Examples |
|---------------|-------|---------|
| Data/metrics | Genie only | "What's our OTP?" / "Which aircraft have the most delays?" |
| Documents/bulletins | KA only | "Are there any engineering bulletins?" / "What's the fix?" |
| Investigation | Both → synthesize | "Why are we so delayed?" / "Investigate the OTP drop" |

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why are we so delayed?" | Genie → KA → synthesize | 62% OTP, code 41 at 5x, N7xx fleet on v3.2.1 → ESB-2025-APU-047 cold start bug → interim procedures + v3.2.2 schedule |

### Validation

Full flow: "Why are we so delayed?" triggers both agents → complete root cause (WHAT: 62% OTP, code 41, N7xx, v3.2.1 + WHY: cold start fuel enrichment bug, v3.2.2 fix pending).

Add mas_id to `resources.json`.
