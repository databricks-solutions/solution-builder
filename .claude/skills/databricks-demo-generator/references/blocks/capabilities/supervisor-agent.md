---
name: Supervisor Agent
category: ai-genai-ml
disabled: false
---

# Supervisor Agent (Multi-Agent Supervisor)

**Managed orchestration layer** that coordinates multiple agents - Genie Spaces, Knowledge Assistants, UC functions, and MCP servers - to handle complex tasks.

## Pain

Real business questions span structured and unstructured data: "What's our exposure to this client and what do our contracts say about it?" Single agents can't handle this. DIY orchestration means building routing logic, managing state, handling failures - and no governance.

## Key Features

- **Dynamic routing** - analyzes questions, picks the right agent(s)
- **Multi-agent coordination** - Genie for SQL, KA for docs, functions for actions
- **On-Behalf-Of auth** - uses the human's UC permissions, not a service account
- **MCP integration** - connect external tools and systems
- **Natural language tuning** - improve routing with expert feedback

## Position

"One agent that knows when to query your data warehouse, when to search your documents, and when to call an external API - all governed by your existing permissions." FSI: RM copilot spanning client data + research + compliance docs.

## Demo Tips

- **The capstone of the AI story** - combines everything into one intelligent interface
- Supervisor sits on top of Genie + KA, routing questions to the right agent
- Demo flow: user asks a complex question → Supervisor decides: "this needs data, let me ask Genie" → then "this needs documents, let me check KA"
- Great for "ask anything" scenarios - the user doesn't need to know which system to query
- Emphasize **On-Behalf-Of auth** - the agent uses the user's permissions, not a superuser account
- Perfect for RM/advisor copilots that span multiple data sources

## Architecture

```
User Question
     ↓
Supervisor Agent (routing)
     ↓
┌────────────────┬────────────────┬────────────────┐
│  Genie Space   │ Knowledge Asst │  UC Functions  │
│  (structured)  │  (documents)   │   (actions)    │
└────────────────┴────────────────┴────────────────┘
```

## Configuration

- **Child agents** - connect Genie Spaces and Knowledge Assistants
- **Routing instructions** - when to use each agent
- **UC functions** - optional actions the agent can take

## URL

https://docs.databricks.com/en/generative-ai/agent-bricks/multi-agent-supervisor
