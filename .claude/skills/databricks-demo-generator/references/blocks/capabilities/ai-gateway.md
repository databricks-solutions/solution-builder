---
name: AI Gateway
category: agent-bricks
disabled: false
buildable: false
---

# AI Gateway

**Central governance layer** for all LLM endpoints — route requests, enforce guardrails, manage costs, and audit usage across providers.

## Pain

LLM sprawl: teams spin up OpenAI, Anthropic, Bedrock endpoints with no central control. No visibility into costs, no consistent safety policies, no audit trail. When something goes wrong, nobody knows who called what.

## Key Features

- **Unified routing** - one endpoint URL for multiple providers (OpenAI, Anthropic, Bedrock, etc.)
- **Guardrails** - PII detection, content safety, prompt injection blocking
- **Rate limiting** - per-user or per-endpoint token/request limits
- **Fallbacks** - auto-reroute to backup model on errors
- **Usage tracking** - costs and tokens across all LLM consumption

## Position

Any enterprise AI deployment. "You don't give teams direct API keys. You route through AI Gateway for governance, cost control, and safety."

## How It Works

- **Configure model serving endpoints**: Add external providers (OpenAI, Anthropic, Bedrock) or internal models through a single Gateway URL
- **Apply guardrails**: Enable PII redaction, content safety filters, prompt injection detection — bad requests get blocked automatically
- **Set rate limits**: Cap tokens or requests per minute at user or endpoint level — prevent runaway costs
- **Enable fallbacks**: If GPT-4 returns a 429/5XX, automatically route to Claude — no client-side changes
- **Track everything**: Usage, costs, and requests logged centrally — query in Databricks SQL or export to your observability stack

## Demo Tips

- Great for "how do you govern AI at scale?" questions
- Position as the "single pane of glass" for all LLM usage
- Show guardrails: "if someone tries to extract PII, it's blocked"
- Emphasize cost control: "rate limits prevent a runaway agent from burning your budget"
- Mention fallbacks: "if OpenAI is down, traffic shifts to Anthropic automatically"

## URL

https://www.databricks.com/product/artificial-intelligence/ai-gateway
