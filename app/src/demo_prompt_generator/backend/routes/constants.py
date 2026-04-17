"""Constants API endpoints for industries, capabilities, and current user."""

from __future__ import annotations

import json
import logging
from enum import Enum
from pathlib import Path
from typing import Literal, Optional

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
    is_default: bool = False


class SuggestCapabilitiesRequest(BaseModel):
    """Request body for capability suggestion endpoint."""
    prompt: str
    capabilities: list[CapabilityInput]


class SuggestCapabilitiesResponse(BaseModel):
    """Response with suggested capability IDs and reasoning."""
    capabilities: list[str]
    reasoning: str | None = None


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


@router.post(
    "/capabilities/suggest",
    response_model=SuggestCapabilitiesResponse,
    operation_id="suggestCapabilities",
)
def suggest_capabilities(
    body: SuggestCapabilitiesRequest,
    ws: Dependencies.UserClient,
    config: Dependencies.Config,
):
    """
    Suggest capabilities based on user's demo description.

    Uses LLM to analyze the prompt and recommend which capabilities
    should be included in the demo. Respects user's explicit selections:
    - "selected" capabilities are always included
    - "unselected" capabilities are never included
    - null status capabilities are decided by the LLM
    """
    # Separate capabilities by status
    always_include = [c.id for c in body.capabilities if c.status == "selected"]
    never_include = [c.id for c in body.capabilities if c.status == "unselected"]
    default_caps = [c.id for c in body.capabilities if c.is_default]
    to_decide = [c.id for c in body.capabilities if c.status is None]

    # If no prompt or all capabilities have explicit status, skip LLM
    if not body.prompt.strip() or not to_decide:
        return SuggestCapabilitiesResponse(capabilities=always_include)

    # Load platform architecture for context
    platform_context = _load_platform_architecture()

    # Build lists for the prompt
    available_caps = load_capabilities()
    available_for_llm = [c for c in available_caps if c["id"] in to_decide]

    # Format capability lists for the prompt
    default_list = ", ".join(default_caps) if default_caps else "(none)"
    mandatory_list = ", ".join(always_include) if always_include else "(none)"
    excluded_list = ", ".join(never_include) if never_include else "(none)"

    cap_list = "\n".join([
        f"- {c['id']}: {c['name']} ({c['category']})" + (" [DEFAULT]" if c["id"] in default_caps else "")
        for c in available_for_llm
    ])

    # Build the LLM prompt
    system_prompt = f"""You are a Databricks demo architect. Based on the user's demo description,
select which capabilities should be included in their demo.

Here is the platform architecture reference that describes all available capabilities:

{platform_context}

IMPORTANT RULES:
1. The DEFAULT demo selection (when no specific instructions given) is: {default_list}
   If the user's prompt is generic or doesn't specifically require different capabilities, return the defaults, keep it simple, don't add any other capabilities or overthink.
   Example: "Demo about customer 360" should return the defaults.

2. Unity Catalog (unity-catalog) should ALMOST ALWAYS be included unless:
   - The user explicitly says they don't want it, OR
   - It is in the "User excluded" list below

3. Consider the relationships between capabilities (e.g., dashboards need data from SDP)

4. Only select capabilities that are relevant to the user's demo scenario or mentioned in the user's prompt.
   Example: "Demo about customer 360 with an app" should return the defaults + app-python (mentioned) and lakebase (because app leverages lakebase).
   Example: "An IOT demo with streaming" should return:
      - "sdp" (we always need data processing),
      - "streaming" (real-time ingestion as requested),
      - "aibi-dashboards" + "genie" (simple wow effect),
      - "unity-catalog" (governance)
   Example: "Fraud detection in bank payment, with an app" should return:
      - "sdp" (we always need data processing),
      - "aibi-dashboards" + "genie" (simple wow effect),
      - "unity-catalog" (governance is key for banking),
      - "knowledge-assistant" + "supervisor-agent" (AI agents for investigation),
      - "app-python" + "lakebase" (app was mentioned, lakebase is a dependency),
      - "model-serving" (fraud detection implies ML models for scoring transactions in real-time)

5. Only return capability IDs from the list provided

6. Write a "reasoning" field: a 1-2 sentence explanation describing the data flow and why each capability was selected (this shouldn't include a use-case or story specific details).
   Use product names naturally in the flow (processing → analysis → AI → app).
   Examples:
   - "Customer 360 demo": "Customer data unified through SDP. Business users explore insights with AI/BI Dashboards and ask questions via Genie. Knowledge Assistant provides context from documentation while Supervisor Agent orchestrates investigation workflows, all governed by Unity Catalog."
   - "Fraud detection with app": "Transaction data processed through SDP. Fraud models deployed via Model Serving for real-time scoring. Investigation workflows powered by Knowledge Assistant and Supervisor Agent. Analysis via AI/BI Dashboards and Genie. Operational app built with Databricks Apps backed by Lakebase, all governed by Unity Catalog.\""""

    user_prompt = f"""Demo description:
{body.prompt}

=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include these): {mandatory_list} (don't forget to include required dependencies)
- User EXCLUDED (never include these): {excluded_list}

=== AVAILABLE CAPABILITIES ===
(Capabilities marked [DEFAULT] are the standard demo selection)
{cap_list}

Return a JSON object with two keys:
- "capabilities": array of capability IDs to include
- "reasoning": 1-2 sentence explanation of the data flow mentioning each selected product by name

Remember: respect user constraints, and when in doubt, stick to the defaults.
Example: {{"capabilities": ["sdp", "aibi-dashboards", "genie", "unity-catalog", "knowledge-assistant", "supervisor-agent"], "reasoning": "Customer data processed through SDP, explored via AI/BI Dashboards and Genie..."}}"""

    try:
        llm = LLMService(ws, config)
        result = llm.chat_json(
            user_prompt,
            system_prompt=system_prompt,
            size=ModelSize.NORMAL,
            max_tokens=500,
        )

        # Extract and validate capability IDs
        suggested = result.get("capabilities", [])
        reasoning = result.get("reasoning")
        valid_ids = {c["id"] for c in available_caps}
        llm_selected = [cap_id for cap_id in suggested if cap_id in valid_ids and cap_id in to_decide]

        # Combine: always_include + LLM suggestions (excluding never_include)
        final_selection = list(set(always_include + llm_selected) - set(never_include))

        return SuggestCapabilitiesResponse(capabilities=final_selection, reasoning=reasoning)

    except Exception as e:
        logger.error(f"Failed to suggest capabilities: {e}")
        # On error, return the defaults + explicitly selected ones
        fallback = list(set(always_include + default_caps) - set(never_include))
        return SuggestCapabilitiesResponse(capabilities=fallback)
