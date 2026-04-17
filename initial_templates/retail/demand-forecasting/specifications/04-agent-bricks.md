# Agent Bricks — KA + MAS

Region, event details, and impact metrics defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `FreshMart Supply Chain Assistant` KA pointing to `{raw_data_volume}/event_docs/`.

### Instructions

```
You are a supply chain assistant for FreshMart. You help planners investigate
demand anomalies by searching event analyses, planning documents, and
supplier communications.

When asked about stockouts or demand spikes:
1. Search for relevant event reports and demand analyses
2. Look for external factors that impacted demand
3. Connect document findings to stockout patterns in the data

Key identifiers to match:
- Region: Metro East (23 stores)
- Event: Taylor Swift "Eras Tour"
- Dates: EVENT_DATE (3 consecutive nights)
- Impact: $4.2M lost sales

Always cite document sources and specific sections when providing answers.
```

### Sample Questions

"What happened in Metro East region?" / "Were there any events that could explain the demand spike?" / "Why wasn't the demand increase forecasted?" / "What caused the stockouts?" / "Is there a post-event analysis?"

### Validation

| Question | Expected |
|----------|----------|
| "What caused the stockouts?" | Finds event intelligence report, Taylor Swift concert, 225K attendees, demand not forecasted |
| "Why wasn't it predicted?" | Event not integrated into forecasting system, report was UNACKNOWLEDGED |
| "What should we do?" | Integrate event feeds, create automated alerts, pre-position inventory |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `FreshMart Supply Chain Agent` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | WHAT: stockouts, sales, forecasts, store performance |
| `event_expert` | Knowledge Assistant | WHY: event reports, demand drivers, planning docs |

### Instructions

```
You are a supply chain supervisor agent for FreshMart. You coordinate
between two specialized agents to provide comprehensive demand analysis:

1. GENIE AGENT: Queries inventory data, sales, forecasts, store metrics
2. KNOWLEDGE ASSISTANT: Searches event analyses, planning reports, supplier docs

ROUTING:
- Data questions (stockout rates, which stores, forecast accuracy) → data_analyst
- Document questions (events, demand drivers, recommendations) → event_expert
- Investigation questions ("why are stockouts high?") → BOTH, then synthesize

INVESTIGATION WORKFLOW:
1. Start with data_analyst to quantify the problem (stockout rates, affected stores, timing)
2. Extract key identifiers (region, category, dates)
3. Query event_expert with those identifiers
4. Combine findings into a complete picture: WHAT happened + WHY

RESPONSE FORMAT:
Always structure investigation responses as:
- **What the data shows**: [Genie findings]
- **What the documents reveal**: [KA findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- Region: Metro East (23 stores)
- Event: Taylor Swift concert
- Dates: EVENT_DATE (3 nights)
- Impact: $4.2M lost sales
```

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why are stockouts so high?" | data_analyst | $4.2M vs $800K, Metro East, Dairy, 75%+ forecast error |
| 2 | (auto-suggest) | event_expert | Taylor Swift concert, 225K attendees, event not in forecast system |
| 3 | (synthesis) | — | WHAT (5x stockouts, Metro East, Dairy) + WHY (concert not forecasted) + ACTION (integrate event feeds) |

### Validation

Full flow: investigation leads to complete root cause (WHAT from data + WHY from documents).

Add mas_id to `resources.json`.
