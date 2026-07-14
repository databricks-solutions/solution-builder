---
name: Supervisor Agent
category: agent-bricks
disabled: false
buildable: true
skill: databricks-agent-bricks
genie_code_workshop: false
---

# Multi-Agent Supervisor

Routes user queries to the appropriate specialist agent. Standard pattern: Genie (structured data) + Knowledge Assistant (unstructured documents). Can also include model-serving agents or custom tool agents.

## When to Use

- When the demo has both Genie and KA — the supervisor is the unified interface.
- "Capstone" experience: audience asks one question, system picks the right specialist.
- Most effective when the narrative requires both data analysis and document context.

## Key Decisions

1. **Agent roster:** 2-3 agents with distinct roles. Standard: Genie (data) + KA (documents). Optional third for ML scoring or actions.
2. **Routing instructions:** Clear rules based on question intent. Signal words: "how many," "trend" -> Genie; "what do we know," "policy" -> KA.
3. **Supervisor persona:** Senior investigator/analyst who delegates and synthesizes findings.
4. **Demo flow:** 4-6 questions demonstrating routing. Start with data (Genie), shift to context (KA), end with cross-cutting question coordinating both.
5. **Coordination queries:** At least one question requiring multiple agents to show orchestration value.

## Pitfalls

- Ambiguous routing — if 50% of questions could go either way, routing feels random.
- Not making routing visible — audience should see which agent is called.
- Too many agents — 2 is the sweet spot, 3 max before it confuses.
- All questions hitting one agent — supervisor adds no visible value.
- Not testing full flow end-to-end: supervisor -> agent -> response.

## Connections

- **Genie space:** Agent 1 — structured data queries.
- **Knowledge Assistant:** Agent 2 — document/context queries.
- **Dashboard:** Raises questions the supervisor answers via the right agent.
- **Model serving:** Optional Agent 3 for real-time scoring.

## URL

https://docs.databricks.com/aws/en/generative-ai/agent-framework/build-multi-agent-supervisor.html
