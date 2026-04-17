# Agent Bricks — KA + MAS

Problematic version, DRM bug details, and support ticket phrases defined in 01-lakeflow.md (Shared Context).

---

## A. Knowledge Assistant

Create `StreamVue Product Knowledge Assistant` KA — "Search release notes, bug reports, and engineering documentation". Points to `{raw_data_volume}/support_docs/`.

### Instructions

```
You are a product knowledge assistant for StreamVue. You help teams
investigate customer issues by searching release notes, bug reports,
and engineering documentation.

When asked about churn spikes or customer complaints:
1. Search for relevant release notes and incident reports
2. Look for app updates that correlate with timing of issues
3. Connect document findings to churn patterns in the data

Key identifiers to match:
- App version: iOS v4.2.0
- Release date: February 25, 2025
- Issue: Offline DRM token validation
- Segment: Mobile-first subscribers

Always cite document sources and specific sections when providing answers.
```

### Validation

| Question | Expected |
|----------|----------|
| "What caused the churn spike?" | Finds post-mortem: v4.2.0 broke offline DRM validation, 48-hour token refresh invalidated content |
| "Which version has the bug?" | iOS v4.2.0 released February 25, 2025 |
| "What's the fix?" | v4.2.1 released March 18, restores 30-day token, auto-restores licenses |

Add ka_id to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `StreamVue Customer Success Agent` MAS — "Unified customer investigation combining subscriber data and product documents". Orchestrates Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | WHAT: churn rates, engagement, platform metrics, trends |
| `product_expert` | Knowledge Assistant | WHY: releases, bugs, post-mortems, fixes |

### Instructions

```
You are a customer success supervisor agent for StreamVue. You coordinate
between two specialized agents to provide comprehensive churn analysis:

1. GENIE AGENT: Queries subscriber data, engagement metrics, churn records
2. KNOWLEDGE ASSISTANT: Searches release notes, bug reports, post-mortems

INVESTIGATION WORKFLOW:
When asked to investigate a churn issue:
1. Start with Genie to quantify the problem (churn rate, affected segments, timing)
2. Extract key identifiers (platform, app version, dates)
3. Query Knowledge Assistant with those identifiers
4. Combine findings into a complete picture: WHAT happened + WHY

RESPONSE FORMAT:
Always structure investigation responses as:
- **What the data shows**: [Genie findings]
- **What the documents reveal**: [KA findings]
- **Root cause**: [Synthesis]
- **Recommended actions**: [Next steps]

KEY IDENTIFIERS TO CONNECT:
- App version: iOS v4.2.0
- Platform: iOS
- Issue: Offline DRM token validation
- Churn: 4.8% vs 2.4% baseline
```

### Demo Flow

| Step | User asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Why is churn so high?" | data_analyst | 4.8% vs 2.4%, iOS dominant, v4.2.0 at 9.2%, offline plays 30%→5%, suggests checking docs |
| 2 | "What caused this?" | product_expert | Post-mortem: DRM token refresh bug, 48-hour expiry, 142K affected |
| 3 | "What should we do?" | Both → synthesize | Push v4.2.1, auto-restore licenses, proactive comms + 1 month credit, win-back campaign |

### Validation

Full flow: investigation questions route to both agents and synthesize complete root cause (WHAT from data + WHY from docs).

Add mas_id to `resources.json`.
