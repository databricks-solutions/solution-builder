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
    """Load platform_architecture.md content for LLM context.

    Same path inside the wheel and the dev tree: `.claude/skills/databricks-demo-generator/`.
    """
    bundled = (
        Path(__file__).parent.parent.parent / ".claude" / "skills"
        / "databricks-demo-generator" / "references" / "platform_architecture.md"
    )
    if bundled.exists():
        return bundled.read_text()

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
1. **Assess the prompt specificity (3 tiers):**
   - **TIER 3 — VAGUE** (count=3): A topic, possibly with a sub-topic or light direction. No personas, no specific metrics, no multi-step story. This is the DEFAULT — most prompts land here. Examples: "IoT demo", "retail", "fraud detection", "customer 360", "predictive maintenance on wind turbines", "customer churn for telecom"
   - **TIER 2 — MODERATE** (count=2): The user wrote 2+ sentences with constraints that meaningfully narrow the story: named data sources, explicit output requirements, a described workflow, or a specific business scenario with numbers. But NO full narrative arc — no protagonist journey from problem to resolution. Examples: "predictive maintenance on wind turbines — we need to combine SCADA vibration data with weather forecasts to predict energy output AND detect gearbox failures 30 days out, customer is a 120-turbine offshore operator", "customer churn for telecom with real-time scoring served via an app, using CDR and billing data, targeting $2M annual save"
   - **TIER 1 — DETAILED** (count=1): The user provided a STORY, a very detailed explanation, a named persona who encounters a problem, investigates, and reaches a resolution. Key signal: the story or demo requirement is already defined and just need to be rephrased / add a narrative arc (setup → problem → investigation → outcome), named personas, $ metrics. If the prompt reads like a story or structured brief, it's TIER 1. Do NOT downgrade to TIER 2 just because the story is short. Default to TIER 3 unless the prompt clearly has specific constraints (→ TIER 2) or tells a story (→ TIER 1).

2. **Generate use-case ideas (detail scales with tier):**

   **TIER 3 (count=3)** — 3 short ideas for quick exploration:
   - Hook: 1-2 sentences PLAIN TEXT. Role + problem + $ metric. NO section headers, NO \\n line breaks. This is a teaser, not a story.
   - Example:
     {{"type": "idea", "title": "Regional bank's fraud spike", "hook": "VP of Fraud Ops sees card fraud losses jump 3x to $2.1M/month from compromised POS terminals.", "datasources": ["Core banking", "Card processor", "POS terminal logs"]}}

   **TIER 2 (count=2)** — 2 richer ideas with contrasting angles on the same requirements:
   - Hook uses 3 lightweight sections separated by \\n: **Context** (who + what's at stake + the specific problem), **Discovery** (what they find + how), **Impact** ($ outcome). Describe the BUSINESS JOURNEY, not Databricks product names.
   - Example (for "predictive maintenance wind turbine with weather, predict energy output and vibration"):
     {{"type": "idea", "title": "Offshore wind farm output forecasting", "hook": "**Context**\\nLars Eriksen, Operations Director at NorthSea Wind, manages 120 turbines generating $2.4M/month in energy revenue. Storm Katrina is approaching and his legacy weather model missed the last two wind ramp events, costing $380K in curtailment penalties. He needs to see output vs. forecast deviation by farm and ask: 'Which turbines underperformed during the last storm and why?'\\n\\n**Discovery**\\n8 turbines with specific bearing vibration signatures consistently drop output during high-wind events. An ML model trained on SCADA + weather features predicts output 48 hours ahead with 94% accuracy.\\n\\n**Impact**\\nLars pre-positions crews and renegotiates energy contracts. $1.8M/year saved in curtailment penalties.", "datasources": ["OSIsoft PI (SCADA)", "NOAA Weather API", "SAP PM", "Turbine spec sheets"]}}
     {{"type": "idea", "title": "Gearbox failure early warning system", "hook": "**Context**\\nMaria Santos, Reliability Engineer at Atlantic Power, oversees 85 onshore turbines where a single gearbox replacement costs $350K and 3 weeks of downtime. Last quarter two unplanned failures cost $1.2M with zero advance warning — her monitoring only flags failures days before they happen, and OEM manuals document the failure mode but nobody connects that knowledge to live sensor data.\\n\\n**Discovery**\\nA model trained on 18 months of vibration + weather history scores every turbine daily. The top 5 highest-risk units auto-generate work orders with the specific failure mode and recommended action.\\n\\n**Impact**\\nZero unplanned gearbox failures in 6 months. $2.4M saved.", "datasources": ["GE Vernova APM", "Weather Underground API", "CMMS", "OEM maintenance manuals"]}}

   **TIER 1 (count=1)** — 1 fully structured story:
   - Hook uses structured format with **Protagonist**, **Catalyst**, **Journey**, **Resolution** sections separated by \\n.
   - Example:
     {{"type": "idea", "title": "Supply chain forecast recovery", "hook": "**Protagonist**\\nAcme Retail — Sarah Chen, VP of Supply Chain. Obsessed with inventory turns and avoiding stockouts.\\n\\n**Catalyst**\\nDemand forecast accuracy dropped from 92% to 78% across 2,000 stores. $4.2M/month in markdowns from overstocks, $1.8M in lost sales from stockouts.\\n\\n**Journey**\\nSarah opens her executive dashboard and spots regional patterns — the Southeast is 3x worse. She asks: 'Which categories are driving the forecast errors?' and discovers that promotional events are the blind spot. She pulls up the demand planning SOP which confirms the legacy model has no promotional lift feature. The ML team retrains with event data in 48 hours.\\n\\n**Resolution**\\nForecast accuracy climbs to 94%. Markdowns drop 60%, stockouts cut in half. Projected savings: $3.1M annually. Sarah now gets a weekly accuracy scorecard by region.", "datasources": ["SAP S/4HANA", "Promotional calendar", "POS system", "Demand planning docs"]}}

   **Common rules for ALL tiers:**
   - `title`: Short punchy title (5-7 words)
   - `datasources`: Array of SOURCE SYSTEMS (not data types). These are the external systems Lakeflow Connect pulls from.
     Keep them short (2-3 words max).
     BAD: ["SCADA telemetry", "Vibration sensors"] — these are data types, not systems
     GOOD: ["OSIsoft PI", "SAP PM", "Weather API"] — these are actual source systems
     Include both structured (transactions, metrics) AND unstructured (docs, manuals, policies) sources.
     The datasources must support the ENTIRE demo story — dashboards, Genie, KA, ML models, apps all draw from them.
   - Always follow the user's request for what to demo; the rest are guidelines.

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
- "Demo about customer 360 with an app" →
  - synthetic-data-gen (always needed)
  - lakeflow-connect (data ingestion)
  - sdp (data processing)
  - aibi-dashboards + genie (simple wow effect)
  - databricks-apps + lakebase (app mentioned, lakebase is dependency)
  - unity-catalog, databricks-one, genie-code (talking track)
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
  - knowledge-assistant + supervisor-agent (AI agents for investigation — story explicitly involves unstructured-doc lookup)
  - model-training-mlflow + model-serving (fraud ML models for real-time scoring)
  - databricks-apps + lakebase (app mentioned, lakebase is dependency)
  - unity-catalog, genie-code (talking track)

## Output Format (LINE-DELIMITED JSON - ONE JSON OBJECT PER LINE)
Output each item on its own line as valid JSON. Do NOT wrap in an array or object.

FIRST, output how many ideas you will generate (1, 2, or 3 based on tier):
{{"type": "count", "count": 2}}

Then for each idea, output one line:
{{"type": "idea", "title": "...", "hook": "...", "datasources": [...]}}

After all ideas, output one line for capabilities (just the IDs):
{{"type": "capabilities", "capabilities": [...]}}

Finally, output one line explaining your reasoning (1-2 sentences max):
{{"type": "reasoning", "text": "Brief explanation of how data flows through the selected capabilities..."}}

### TIER 3 example (prompt: "retail demo", do not include sub-title/section, simple sentences, lead with default capabilities when possible):
{{"type": "count", "count": 3}}
{{"type": "idea", "title": "Luxury retailer's returns mystery", "hook": "VP of Ops sees returns spike 3x to $180K/week — three products from one production lot.", "datasources": ["Shopify", "Zendesk", "ERP"]}}
{{"type": "idea", "title": "Grocery chain demand forecasting", "hook": "Regional grocer loses $2.1M/quarter to stockouts from weather and promo surges.", "datasources": ["POS system", "Weather API", "Promotional calendar"]}}
{{"type": "idea", "title": "Fashion brand wasted ad spend", "hook": "CMO discovers 40% of marketing budget targets churned customers — $3.2M wasted annually.", "datasources": ["Salesforce", "Google Analytics", "Loyalty program DB"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "aibi-dashboards", "genie", "genie-code"]}}
{{"type": "reasoning", "text": "Retail data flows through SDP into dashboards for trend visualization, Genie for ad-hoc investigation."}}

### TIER 2 example (prompt: "predictive maintenance wind turbines, combine SCADA vibration + weather to predict output and detect gearbox failures 30 days out, 120-turbine offshore operator"):
{{"type": "count", "count": 2}}
{{"type": "idea", "title": "Offshore wind output forecasting", "hook": "**Context**\\nLars Eriksen, Operations Director at NorthSea Wind, manages 120 turbines generating $2.4M/month. His legacy weather model missed two wind ramp events, costing $380K in curtailment penalties. He needs output vs. forecast by farm and to ask: 'Which turbines underperformed last storm and why?'\\n\\n**Discovery**\\n8 turbines with bearing vibration anomalies consistently drop output in high wind. An ML model on SCADA + weather predicts output 48h ahead at 94% accuracy.\\n\\n**Impact**\\nPre-positioned crews, renegotiated contracts. $1.8M/year saved.", "datasources": ["OSIsoft PI (SCADA)", "NOAA Weather API", "SAP PM", "Turbine spec sheets"]}}
{{"type": "idea", "title": "Gearbox failure early warning", "hook": "**Context**\\nMaria Santos, Reliability Engineer at Atlantic Power, oversees 85 turbines — one gearbox costs $350K and 3 weeks down. Two failures last quarter cost $1.2M with zero warning. OEM manuals document the failure mode but nobody links it to live sensor data.\\n\\n**Discovery**\\nA model on 18 months of vibration + weather scores turbines daily. Top 5 risk units auto-generate work orders with failure mode and action.\\n\\n**Impact**\\nZero unplanned gearbox failures in 6 months. $2.4M saved.", "datasources": ["GE Vernova APM", "Weather Underground API", "CMMS", "OEM maintenance manuals"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "model-training-mlflow", "model-serving", "aibi-dashboards", "genie", "knowledge-assistant", "genie-code"]}}
{{"type": "reasoning", "text": "SCADA + weather flow through SDP, ML models predict output and failure risk, dashboards visualize fleet health, Genie investigates, KA explains from manuals."}}

### TIER 1 example (prompt: a full story with named persona, narrative arc, and resolution):
{{"type": "count", "count": 1}}
{{"type": "idea", "title": "Supply chain forecast recovery", "hook": "**Protagonist**\\nAcme Retail — Sarah Chen, VP of Supply Chain. Obsessed with inventory turns and avoiding stockouts.\\n\\n**Catalyst**\\nForecast accuracy dropped from 92% to 78% across 2,000 stores. $4.2M/month in markdowns, $1.8M in lost sales.\\n\\n**Journey**\\nSarah opens her dashboard and spots the Southeast is 3x worse. She asks which categories drive forecast errors — promotional events are the blind spot. The demand planning SOP confirms the model has no promo lift feature. ML team retrains with event data in 48 hours.\\n\\n**Resolution**\\nAccuracy climbs to 94%. Markdowns drop 60%, stockouts halved. $3.1M annually saved. Weekly accuracy scorecard by region.", "datasources": ["SAP S/4HANA", "Promotional calendar", "POS system", "Demand planning docs"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "model-training-mlflow", "aibi-dashboards", "genie", "knowledge-assistant", "genie-code"]}}
{{"type": "reasoning", "text": "POS + promo data through SDP, ML retrains forecast model, dashboards show regional accuracy, Genie drills into categories, KA explains from planning docs."}}"""

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

IMPORTANT — refinement UPGRADES the detail tier:
- If the current hook is plain text (no section headers) → it was TIER 3. Upgrade to TIER 2: use **Context**, **Discovery**, **Impact** sections separated by \\n.
- If the current hook already has **Context**/etc. sections → it was TIER 2. Upgrade to TIER 1: use **Protagonist**, **Catalyst**, **Journey**, **Resolution** sections separated by \\n. Make it a full structured story.

Output line-delimited JSON: count line (count=1), then one idea line, then capabilities line, then reasoning line."""
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
    ws: Dependencies.Client,
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

        # Exclude disabled caps from the LLM's candidate pool — talking-track-only
        # governance features (data-classification, data-quality, abac) aren't
        # relevant to most demos. User can still mandate them via show-hidden.
        available_caps = [c for c in load_capabilities() if not c.get("disabled")]
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
                max_tokens=2500,
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
