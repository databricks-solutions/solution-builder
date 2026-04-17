"""Constants API endpoints for industries, capabilities, and current user."""

from __future__ import annotations

import json
import logging
from enum import Enum
from pathlib import Path
from typing import Literal, Optional

from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..core.constants import INDUSTRIES, get_capabilities as load_capabilities
from ..services.llm_service import LLMService, ModelSize

router = create_router()
logger = logging.getLogger(__name__)


class Capability(BaseModel):
    """Capability definition."""
    id: str
    name: str
    category: str
    disabled: bool = False


class CapabilityStatus(str, Enum):
    """User's explicit selection status for a capability."""
    SELECTED = "selected"
    UNSELECTED = "unselected"


class CapabilityInput(BaseModel):
    """Capability with user's explicit selection status."""
    id: str
    status: Optional[Literal["selected", "unselected"]] = None


class IdeaToRefine(BaseModel):
    """An idea the user wants to refine."""
    title: str
    hook: str
    datasources: list[str]


class SuggestCapabilitiesRequest(BaseModel):
    """Request body for capability suggestion endpoint."""
    prompt: str
    capabilities: list[CapabilityInput]
    refine_idea: IdeaToRefine | None = None  # If set, refine this idea
    refine_comment: str | None = None  # User's refinement instructions


class UseCaseIdea(BaseModel):
    """A use-case idea with story structure."""
    title: str  # Short title, e.g. "Regional bank's fraud spike"
    hook: str  # 1-2 sentence story hook with protagonist and problem
    datasources: list[str]  # Data sources as list, e.g. ["Core banking", "Salesforce", "Payment processor"]


class SuggestCapabilitiesResponse(BaseModel):
    """Response with suggested capability IDs, reasoning, and use-case ideas."""
    capabilities: list[str]
    reasoning: str | None = None
    ideas: list[UseCaseIdea] = []  # 1-3 ideas (3 if vague, 1 if detailed PRD)


class CurrentUser(BaseModel):
    """Current user information."""
    email: str
    user_name: Optional[str] = None
    is_template_admin: bool


@router.get(
    "/constants/industries",
    response_model=list[str],
    operation_id="getIndustries",
)
def get_industries():
    """Get list of available industries."""
    return INDUSTRIES


@router.get(
    "/constants/capabilities",
    response_model=list[Capability],
    operation_id="getCapabilities",
)
def get_capabilities():
    """Get list of available capabilities loaded from markdown files."""
    return [
        Capability(
            id=c["id"],
            name=c["name"],
            category=c["category"],
            disabled=c.get("disabled", False),
        )
        for c in load_capabilities()
    ]


@router.get(
    "/current-user",
    response_model=CurrentUser,
    operation_id="getCurrentUser",
)
def get_current_user(
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Get current user info including admin status."""
    # Get email from headers (already falls back to Databricks SDK in dev mode)
    email = headers.user_email or "anonymous@local"
    user_name = headers.user_name
    is_admin = email in config.template_admin_emails

    return CurrentUser(
        email=email,
        user_name=user_name,
        is_template_admin=is_admin,
    )


def _load_platform_architecture() -> str:
    """Load platform_architecture.md content for LLM context."""
    # Find the platform_architecture.md file
    current_file = Path(__file__)
    for parent in current_file.parents:
        arch_file = (
            parent / ".claude" / "skills" / "databricks-demo-generator"
            / "references" / "platform_architecture.md"
        )
        if arch_file.exists():
            return arch_file.read_text()
    return ""


def _build_suggest_prompts(
    body: SuggestCapabilitiesRequest,
    platform_context: str,
    mandatory_list: str,
    excluded_list: str,
    cap_list: str,
) -> tuple[str, str]:
    """Build system and user prompts for capability suggestion."""
    system_prompt = f"""You are a Databricks demo architect. Your job is to help users design compelling demos.

## Platform Architecture
{platform_context}

## What Makes a Great Demo Story
A demo needs:
- **A clear protagonist** — A named persona with a business role and a problem to solve
- **Business metrics in $** — "$500K at risk" lands; "720 records affected" doesn't
- **A "wow moment"** — Root cause found in 60 seconds, a prediction that prevents downtime, an instant natural-language answer
- **A clear value statement** — "Days → minutes", "$2M saved annually"

## Your Task
1. **Assess the prompt specificity:**
   - VAGUE: Generic topics like "IoT demo", "retail", "fraud detection", "customer 360"
   - DETAILED: Has specific story elements, personas, metrics, or clear requirements (like a PRD)

2. **Generate use-case ideas:**
   - If VAGUE: Generate exactly 3 distinct story ideas. Each should have a different angle/scenario. Keep hooks concise (2-3 sentences).
   - If DETAILED: Generate exactly 1 idea that summarizes/refines the user's PRD into a compelling story.
     For the single detailed card, use a STRUCTURED STORY FORMAT with line breaks and sections:

     **Protagonist**
     [Company name] — [Persona name, title]. [One sentence about what they care about.]

     **Catalyst**
     [What triggered the demo — a spike, an alert, a question. Include a $ metric at risk.]

     **Journey**
     [How they use the Databricks platform to investigate — 2-3 steps showing the "wow moments".]

     **Resolution**
     [What they discover, the business impact in $, and the action taken.]

   Each idea needs:
   - `title`: Short punchy title (5-7 words), e.g. "Regional bank's fraud spike"
   - `hook`: For VAGUE prompts: 1-2 sentence story hook with a protagonist and their problem. Include a $ metric.
     For DETAILED prompts: Use the structured story format above with line breaks (\\n).
     Examples for VAGUE:
     - "VP of Fraud Ops at First National sees card fraud losses jump 3x to $2.1M/month. Traces it to compromised POS terminals in the Southwest region."
     - "Plant director at AutoCorp watches defect rates climb 40% on Line 3. Production is at risk — $500K/day if the line shuts down."
     Example for DETAILED:
     - "**Protagonist**\\nAcme Retail — Sarah Chen, VP of Supply Chain. Obsessed with inventory turns and avoiding stockouts.\\n\\n**Catalyst**\\nDemand forecast accuracy dropped from 92% to 78% across 2,000 stores. $4.2M/month in markdowns from overstocks, $1.8M in lost sales from stockouts.\\n\\n**Journey**\\nSarah opens the AI/BI Dashboard and spots regional patterns. She asks Genie: 'Which categories are driving the forecast errors?' The Knowledge Assistant pulls up the demand planning SOP and explains why the legacy model struggles with promotional events.\\n\\n**Resolution**\\nThe ML model identifies promotional lift as the missing signal. After retraining with event data, forecast accuracy climbs to 94%. Projected savings: $3.1M annually."
   - `datasources`: Array of SOURCE SYSTEMS (not data types). These are the external systems Lakeflow Connect pulls from.
     Keep them short (2-3 words max). Don't repeat what's already obvious from the hook.
     BAD: ["SCADA telemetry", "Vibration sensors", "Temperature sensors"] — these are data types, not systems
     GOOD: ["OSIsoft PI", "SAP PM", "Weather API", "Equipment manuals"] — these are actual source systems

     CRITICAL: The datasources must support the ENTIRE demo story end-to-end:
     - Dashboards visualize metrics FROM these sources
     - Genie answers questions ABOUT data in these sources
     - Knowledge Assistant explains context FROM documents in these sources
     - ML models train ON data from these sources
     - Apps display/act on data FROM these sources
     - Always follow the user request for the demo / what to output, the rest are just guidelines

     Think: "Can I build a dashboard, ask Genie a question, and get KA to explain why — all from these sources?"
     Include both structured (transactions, metrics) AND unstructured (docs, manuals, policies) sources.

   NOTE: All ideas share the SAME capabilities. The capabilities are selected globally based on the topic, not per-idea.

3. **Select capabilities** that apply to ALL the story ideas (they're exploring different angles of the same topic).

## Capability Selection Rules
- Pick capabilities based on the user's prompt — do not pre-bias toward any buildable capability.
- Always include "synthetic-data-gen" — all demos need realistic fake data
- Almost always include talking track: "lakeflow-connect", "unity-catalog", "databricks-one", "genie-code"
- Unity Catalog should almost always be included unless explicitly excluded
- Match capabilities to the story — each product should have a clear moment in the demo
- Consider dependencies (dashboards need SDP data, apps need lakebase, etc.)
- CRITICAL: the demo must be used to showcase Databricks capabilities and the whole must be coherent (input data is what we leverage at the end for apps / dash / genie... in the story)

## Examples
- "Demo about customer 360 with an app" → defaults + synthetic-data-gen + databricks-apps (mentioned) + lakebase (app dependency)
- "An IOT demo with sensor data streaming" →
  - synthetic-data-gen (always needed)
  - lakeflow-connect (data ingestion) + zerobus-ingest (realtime streaming)
  - sdp (data processing)
  - aibi-dashboards + genie (simple wow effect)
  - unity-catalog, genie-code (talking track)
- "Fraud detection in bank payment, with an app" →
  - synthetic-data-gen (always needed)
  - lakeflow-connect (data ingestion)
  - sdp (data processing)
  - aibi-dashboards + genie (analysis)
  - knowledge-assistant + supervisor-agent (AI agents for investigation)
  - model-training-mlflow + model-serving (fraud ML models for real-time scoring)
  - databricks-apps + lakebase (app mentioned, lakebase is dependency)
  - unity-catalog, genie-code (talking track)

## Output Format (LINE-DELIMITED JSON - ONE JSON OBJECT PER LINE)
Output each item on its own line as valid JSON. Do NOT wrap in an array or object.

FIRST, output how many ideas you will generate:
{{"type": "count", "count": 3}}  (or 1 for detailed prompts)

Then for each idea, output one line:
{{"type": "idea", "title": "...", "hook": "...", "datasources": [...]}}

After all ideas, output one line for capabilities (just the IDs):
{{"type": "capabilities", "capabilities": [...]}}

Finally, output one line explaining your reasoning (1-2 sentences max):
{{"type": "reasoning", "text": "Brief explanation of how data flows through the selected capabilities..."}}

Example output (5 lines for vague prompt):
{{"type": "count", "count": 3}}
{{"type": "idea", "title": "Regional bank's fraud spike", "hook": "VP of Fraud Ops...", "datasources": ["Core banking", "Card processor"]}}
{{"type": "idea", "title": "Hospital readmission surge", "hook": "CMO investigates...", "datasources": ["Epic EHR", "Claims system"]}}
{{"type": "idea", "title": "Auto plant quality mystery", "hook": "Plant director sees...", "datasources": ["MES system", "Quality DB"]}}
{{"type": "capabilities", "capabilities": ["sdp", "aibi-dashboards", "genie"]}}
{{"type": "reasoning", "text": "Telemetry flows through SDP to dashboards, with Genie for ad-hoc analysis."}}"""

    # Build user prompt - different for refinement vs new ideas
    if body.refine_idea and body.refine_comment:
        user_prompt = f"""User's original demo description:
"{body.prompt}"

=== EXISTING STORY TO REFINE ===
Title: {body.refine_idea.title}
Hook: {body.refine_idea.hook}
Datasources: {", ".join(body.refine_idea.datasources)}

=== USER'S REFINEMENT REQUEST ===
"{body.refine_comment}"

=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

The user wants to REFINE the existing story based on their feedback.
Return exactly 1 refined idea that incorporates their feedback.
Keep what works, adjust based on their comment.

Output line-delimited JSON (one idea line, then one capabilities line)."""
    else:
        user_prompt = f"""User's demo description:
"{body.prompt}"

=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

Output line-delimited JSON (idea lines first, then capabilities line)."""

    return system_prompt, user_prompt


@router.post(
    "/capabilities/suggest",
    operation_id="suggestCapabilities",
)
def suggest_capabilities(
    body: SuggestCapabilitiesRequest,
    ws: Dependencies.UserClient,
    config: Dependencies.Config,
):
    """
    Stream capability suggestions and use-case ideas as SSE events.

    Uses LLM to:
    1. Analyze the prompt specificity (vague vs detailed PRD)
    2. Generate 1-3 use-case ideas with story hooks (streamed as they complete)
    3. Recommend capabilities for the demo

    Returns SSE stream with events:
    - event: idea (for each idea as it completes)
    - event: capabilities (final capabilities and reasoning)
    - event: error (if something goes wrong)
    """
    # Separate capabilities by status
    always_include = [c.id for c in body.capabilities if c.status == "selected"]
    never_include = [c.id for c in body.capabilities if c.status == "unselected"]
    to_decide = [c.id for c in body.capabilities if c.status is None]

    def generate_events():
        # If no prompt or all capabilities have explicit status, skip LLM
        if not body.prompt.strip() or not to_decide:
            yield f"event: capabilities\ndata: {json.dumps({'capabilities': always_include, 'reasoning': None})}\n\n"
            return

        # Load platform architecture for context
        platform_context = _load_platform_architecture()

        # Build lists for the prompt
        available_caps = load_capabilities()
        available_for_llm = [c for c in available_caps if c["id"] in to_decide]
        valid_ids = {c["id"] for c in available_caps}

        # Format capability lists for the prompt
        mandatory_list = ", ".join(always_include) if always_include else "(none)"
        excluded_list = ", ".join(never_include) if never_include else "(none)"

        cap_list = "\n".join([
            f"- {c['id']}: {c['name']} ({c['category']})"
            for c in available_for_llm
        ])

        system_prompt, user_prompt = _build_suggest_prompts(
            body, platform_context, mandatory_list, excluded_list, cap_list
        )

        try:
            llm = LLMService(ws, config)

            # For refinements, we know there will be exactly 1 idea - send count immediately
            if body.refine_idea and body.refine_comment:
                yield f"event: count\ndata: {json.dumps({'count': 1})}\n\n"

            # Stream lines from LLM
            for line in llm.chat_stream_lines(
                user_prompt,
                system_prompt=system_prompt,
                size=ModelSize.MINI,
                max_tokens=1500,
            ):
                try:
                    data = json.loads(line)
                    event_type = data.get("type")

                    if event_type == "count":
                        # Forward count event to UI
                        count = data.get("count", 3)
                        yield f"event: count\ndata: {json.dumps({'count': count})}\n\n"

                    elif event_type == "idea":
                        # Parse and validate idea
                        ds = data.get("datasources", [])
                        if isinstance(ds, str):
                            ds = [s.strip() for s in ds.split(",") if s.strip()]
                        idea = {
                            "title": data.get("title", ""),
                            "hook": data.get("hook", ""),
                            "datasources": ds,
                        }
                        yield f"event: idea\ndata: {json.dumps(idea)}\n\n"

                    elif event_type == "capabilities":
                        # Validate and filter capabilities
                        suggested = data.get("capabilities", [])
                        llm_selected = [cap_id for cap_id in suggested if cap_id in valid_ids and cap_id in to_decide]
                        final_selection = list(set(always_include + llm_selected) - set(never_include))

                        caps_data = {"capabilities": final_selection}
                        yield f"event: capabilities\ndata: {json.dumps(caps_data)}\n\n"

                    elif event_type == "reasoning":
                        # Forward reasoning as its own event
                        reasoning_text = data.get("text", "")
                        yield f"event: reasoning\ndata: {json.dumps({'text': reasoning_text})}\n\n"

                except json.JSONDecodeError:
                    # Skip malformed lines
                    logger.warning(f"Skipping malformed JSON line: {line[:100]}")
                    continue

        except Exception as e:
            logger.error(f"Failed to suggest capabilities: {e}")
            # On error, return only explicitly selected capabilities
            fallback = list(set(always_include) - set(never_include))
            yield f"event: error\ndata: {json.dumps({'error': str(e), 'capabilities': fallback})}\n\n"

    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
