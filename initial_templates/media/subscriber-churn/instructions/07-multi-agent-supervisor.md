# Multi-Agent Supervisor Configuration

## Task

Create a Multi-Agent Supervisor that coordinates between Genie (structured data) and Knowledge Assistant (documents) to provide unified customer success investigation capabilities.

---

## Supervisor Configuration

| Setting | Value |
|---------|-------|
| **Supervisor Name** | `StreamVue Customer Success Agent` |
| **Description** | "Unified customer investigation combining subscriber data and product documents" |

---

## Agent Tools

| Agent | Purpose | When to Route |
|-------|---------|---------------|
| **Genie** | Query structured subscriber data | Questions about churn rates, engagement, platform metrics, trends |
| **Knowledge Assistant** | Search product documents | Questions about releases, bugs, post-mortems, fixes |

---

## Routing Logic

```
User Question → Supervisor Analysis → Route to appropriate agent(s)

ROUTING RULES:

1. DATA QUESTIONS → Route to Genie
   - "What's the churn rate?"
   - "Which platforms have issues?"
   - "Show me engagement trends"
   - "How much revenue is at risk?"

2. DOCUMENT QUESTIONS → Route to Knowledge Assistant
   - "What changed in the iOS app?"
   - "Are there any known bugs?"
   - "Is there a post-mortem?"
   - "What's the fix?"

3. INVESTIGATION QUESTIONS → Route to BOTH, then synthesize
   - "Why is churn so high?"
   - "What's happening with iOS users?"
   - "Investigate the subscriber issue"

   For these:
   a. First query Genie to identify the pattern (which platforms, segments, timing)
   b. Then query KA with specific identifiers (app version, platform, date)
   c. Synthesize findings into coherent narrative
```

---

## System Instructions

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

---

## Sample Conversations

### Investigation Flow
```
User: "Why is churn so high?"

Supervisor: Let me investigate this across our data and documents.

[Routes to Genie]
→ Genie finds: 4.8% churn vs 2.4% baseline, iOS platform dominant,
   v4.2.0 at 9.2% churn, mobile-first segment hardest hit,
   offline plays dropped from 30% to 5%

[Routes to KA with: "iOS v4.2.0" + "offline" + "DRM"]
→ KA finds: Post-mortem report identifies DRM token validation bug
   in v4.2.0 (released Feb 25), 48-hour refresh requirement broke
   offline playback, 142,000 users affected

[Synthesizes]
"Here's what I found:

**What the data shows**: Monthly churn is at 4.8%, double our 2.4% baseline.
The spike is concentrated on iOS, specifically version 4.2.0 which has a
9.2% churn rate. Mobile-first subscribers are hardest hit. Engagement data
shows offline plays dropped from 30% to 5% of viewing.

**What the documents reveal**: A post-mortem report identifies that iOS
v4.2.0 (released February 25) introduced a bug in offline DRM validation.
The token refresh requirement was inadvertently changed from 30 days to
48 hours, invalidating all offline content for users without connectivity.

**Root cause**: A code refactor in v4.2.0 broke offline content playback
by requiring DRM token refresh every 48 hours. Users who downloaded content
and went offline found their content unplayable, leading to cancellations.

**Recommended actions**:
1. Push v4.2.1 update (released March 18) to all users
2. Auto-restore invalidated content licenses
3. Send push notification with apology + 1 month credit
4. Target win-back campaign at churned mobile-first users"
```

---

## Validation

| Question | Expected Routing | Expected Outcome |
|----------|------------------|------------------|
| "What's the churn rate?" | Genie only | 4.8%, platform breakdown |
| "Is there a known bug?" | KA only | v4.2.0 DRM issue details |
| "Why is churn high?" | Both → Synthesize | Complete investigation narrative |
| "What should we do?" | Both | Fix + win-back campaign |
