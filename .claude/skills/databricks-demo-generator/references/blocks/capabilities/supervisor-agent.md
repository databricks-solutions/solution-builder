---
name: Supervisor Agent
category: agent-bricks
disabled: false
skill: databricks-agent-bricks
---

# Multi-Agent Supervisor

## What It Does

A multi-agent supervisor (MAS) routes user queries to the appropriate specialist agent. In the standard demo pattern, it coordinates between a Genie space (structured data) and a Knowledge Assistant (unstructured documents), but it can also include model-serving agents or custom tool agents.

## When to Use in a Demo

- When the demo has both a Genie space and a Knowledge Assistant — the supervisor is the unified interface.
- It is the "capstone" experience: the audience asks a single question and the system figures out which specialist to consult.
- Most effective when the demo narrative requires both data analysis and document context to reach a conclusion.

## Key Configuration Decisions

1. **Agent roster:** Define 2-3 agents with distinct roles. The standard pattern is Genie (data) + KA (documents). A third agent for ML scoring or actions is optional.
2. **Routing instructions:** Write clear routing rules based on question intent. Use signal words: "how many," "show me," "trend" route to Genie; "what do we know," "policy," "report" route to KA.
3. **Supervisor persona:** Frame the supervisor as a senior investigator or analyst who delegates to specialists and synthesizes their findings.
4. **Demo flow sequence:** Design 4-6 questions that demonstrate routing to different agents. Start with data questions (Genie), shift to context questions (KA), end with a cross-cutting question that coordinates both.
5. **Coordination queries:** Include at least one question that requires consulting multiple agents to show the orchestration value.

## Common Pitfalls

- Routing logic that is too ambiguous — if 50% of questions could go to either agent, the routing feels random rather than intelligent.
- Not demonstrating the routing — the audience should understand that different agents are being called. Make the transition visible.
- Over-complicating with too many agents — 2 agents is the sweet spot for demos, 3 is the maximum before it becomes confusing.
- Questions that only use one agent — if every demo question goes to Genie, the supervisor adds no visible value.
- Forgetting to test the full flow end-to-end: supervisor → agent → response.

## How It Connects to Other Components

- **Genie space:** Agent 1 — handles all structured data queries.
- **Knowledge Assistant:** Agent 2 — handles all document/context queries.
- **Dashboard:** The dashboard raises questions; the supervisor answers them via the appropriate agent.
- **Model serving:** Optionally, a third agent can call a serving endpoint for real-time scoring.

## Example Specification Snippet

```yaml
multi_agent_supervisor:
  name: "Pacific Coast Fraud Investigation Agent"
  persona: "Senior fraud investigator coordinating between data and intelligence"
  agents:
    - name: "Fraud Data Analyst"
      type: genie
      handles: "Transaction data, fraud rates, merchant patterns, device analysis"
      signal_words: [rate, transactions, how many, which merchants, trend, amount]
    - name: "Fraud Intelligence Specialist"
      type: knowledge_assistant
      handles: "Threat intelligence, breach reports, policies, fraud patterns"
      signal_words: [intelligence, report, breach, threat, what do we know]
  routing:
    data_questions: genie
    context_questions: knowledge_assistant
    investigation_questions: both
  demo_flow:
    - question: "What's our fraud rate this week?"
      routes_to: genie
    - question: "Why did CNP fraud spike?"
      routes_to: genie
    - question: "What do we know about TechDealz?"
      routes_to: knowledge_assistant
    - question: "Which cards need reissue?"
      routes_to: genie
    - question: "What should we do about this?"
      routes_to: both
```

## URL

https://docs.databricks.com/aws/en/generative-ai/agent-framework/build-multi-agent-supervisor.html
