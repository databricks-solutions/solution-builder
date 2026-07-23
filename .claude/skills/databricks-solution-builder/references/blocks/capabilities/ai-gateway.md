---
name: AI Gateway
category: agent-bricks
disabled: false
buildable: false
---

# AI Gateway

**Central governance layer** for all LLM endpoints — route requests, enforce guardrails, manage costs, and audit usage across providers.

## Pain

LLM sprawl: teams spin up OpenAI, Anthropic, Bedrock endpoints with no central control. No cost visibility, no consistent safety policies, no audit trail. When something breaks, nobody knows who called what.

## Key Features

- **Unified routing** — one endpoint URL for multiple providers (OpenAI, Anthropic, Bedrock, etc.)
- **Guardrails** — PII detection, content safety, prompt injection blocking
- **Rate limiting** — per-user or per-endpoint token/request limits
- **Fallbacks** — auto-reroute to backup model on errors
- **Usage tracking** — costs and tokens across all LLM consumption

## Position

Any enterprise AI deployment. "You don't give teams direct API keys. Route through AI Gateway for governance, cost control, and safety."

## How It Works

- **Configure endpoints**: Add external providers (OpenAI, Anthropic, Bedrock) or internal models through a single Gateway URL
- **Apply guardrails**: PII redaction, content safety, prompt injection detection — bad requests blocked automatically
- **Set rate limits**: Cap tokens or requests per minute at user or endpoint level — prevent runaway costs
- **Enable fallbacks**: GPT-4 returns 429/5XX? Automatically route to Claude — no client-side changes
- **Track everything**: Usage, costs, requests logged centrally — query in Databricks SQL or export to observability

## Demo Tips

- Great for "how do you govern AI at scale?" questions
- Position as "single pane of glass" for all LLM usage
- Show guardrails: "if someone tries to extract PII, it's blocked"
- Cost control: "rate limits prevent a runaway agent from burning your budget"
- Fallbacks: "if OpenAI is down, traffic shifts to Anthropic automatically"

## URL

https://www.databricks.com/product/artificial-intelligence/ai-gateway
