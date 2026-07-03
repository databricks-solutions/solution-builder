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
    # If set, the user just changed the capability selection and we want to
    # MINIMALLY rewrite the existing stories rather than regenerate them from
    # scratch. Without this, every toggle in the picker would replace the
    # ideas the user was reading — jarring UX. With this set, the LLM
    # keeps titles + core narrative intact and only adjusts hooks/datasources
    # so each story still hangs together with the new capability set.
    # `previous_capabilities` is the set BEFORE the change so the prompt
    # can describe the delta in plain English.
    previous_ideas: list[IdeaToRefine] | None = None
    previous_capabilities: list[str] | None = None
    # Pre-joined extraction of any files the user uploaded on the home
    # page (filename headers + extracted text per file). Capped at ~50 KB
    # by the frontend; we cap again server-side as belt-and-braces. When
    # present, it's injected into the user prompt as a ground-truth
    # context block so the suggested ideas reflect the file's domain.
    context_text: str | None = None
    # Architecture-first builds: the names of the data-source tiles the user
    # placed in their architecture diagram. When present, the prompt tells the
    # LLM to anchor each idea's `datasources` in these exact systems so the
    # generated demo lines up with the architecture the user drew.
    datasources: list[str] | None = None
    # Capabilities-only mode (home page's ARCHITECTURE tab): select the
    # capabilities that match the user's text — NO use-case ideas/story. The
    # stream emits only `capabilities` (+ `reasoning`); never `count`/`idea`.
    capabilities_only: bool = False


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
    is_admin: bool


@router.get(
    "/constants/industries",
    response_model=list[str],
    operation_id="getIndustries",
)
def get_industries():
    """Get list of available industries."""
    return INDUSTRIES


@router.get(
    "/constants/architecture-standalone-template",
    operation_id="getArchitectureStandaloneTemplate",
)
def get_architecture_standalone_template():
    """Serve the standalone architecture EDITOR html (the databricks-
    architecture skill's renderer template). The frontend's "Download
    standalone HTML" injects the current diagram JSON into its inline
    `<script id="architecture">` block — giving the user a self-contained,
    editable copy of their architecture."""
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    from ..services.skills_manager import get_architecture_skill_path

    skill = get_architecture_skill_path()
    template = (skill / "renderer" / "architecture-editor.html") if skill else None
    if not template or not template.exists():
        raise HTTPException(
            status_code=404,
            detail="Standalone architecture template not available on this install",
        )
    return FileResponse(template, media_type="text/html")


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
    admin_flag = email in config.template_admin_emails

    return CurrentUser(
        email=email,
        user_name=user_name,
        is_template_admin=admin_flag,
        is_admin=admin_flag,
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
    # ---- Capabilities-only variant (architecture tab) -----------------------
    # No use-case ideas — the LLM only maps the user's text to the capability
    # catalog. Same selection rules + mandatory/excluded semantics; the output
    # format drops the count/idea lines entirely.
    if body.capabilities_only:
        system_prompt = f"""You are a Databricks solution architect. Map the user's description to the platform capabilities their architecture needs. Do NOT invent a demo story — only select capabilities.

## Platform Architecture
{platform_context}

## Capability Selection Rules
- **Keep it LEAN — a simple demo is the default.** Start from the minimal coherent path and only add a capability when the user's text clearly calls for it. Each selected product must earn its place with an obvious role.
- The simple default backbone is: "synthetic-data-gen" + "lakeflow-connect" + "sdp" + "unity-catalog" + "aibi-dashboards" + "genie" + "genie-one" + "genie-code". That is a complete, compelling demo on its own — do NOT pad beyond it without a reason in the text.
- Add heavier capabilities ONLY when the text implies them, e.g.: "lakeflow-jobs" (an explicit orchestration/scheduling need), "metric-views" (a governed-metrics / semantic-layer ask), model training/serving (an ML/prediction story), "databricks-apps"+"lakebase" (an app), "zerobus-ingest" (realtime streaming). If the text or the story doesn't imply it, leave it out.
- **"knowledge-assistant" (KA) and "supervisor-agent" (MAS) are the expensive ones** — they need UNSTRUCTURED documents and take several minutes to set up. Default to a **tabular-data** story that needs neither. Only add KA/MAS when the user's text clearly involves document Q&A, policy/manual lookup, or multi-agent investigation over unstructured content. When in doubt, leave them out.
- Always include "synthetic-data-gen" — all demos need realistic fake data.
- Almost always include talking track: "lakeflow-connect", "unity-catalog", "genie-one", "genie-code". Unity Catalog unless explicitly excluded.
- Consider dependencies (dashboards need SDP data, apps need lakebase, etc.) — but a dependency is not a reason to add the heavier parent unless the parent is itself warranted.

## Output Format (LINE-DELIMITED JSON - ONE JSON OBJECT PER LINE)
Output exactly two lines and nothing else:
{{"type": "capabilities", "capabilities": [...]}}
{{"type": "reasoning", "text": "1 sentence: how the selected capabilities fit the described architecture."}}"""

        user_prompt = f"""User's architecture description:
"{body.prompt}"

=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

Select the capabilities this architecture needs. Output the two JSON lines only."""

        user_prompt = _append_shared_context(body, user_prompt)
        return system_prompt, user_prompt

    system_prompt = f"""You are a Databricks demo architect. Your job is to help users design compelling demos.

## Platform Architecture
{platform_context}

## What Makes a Great Demo Story
A demo needs:
- **A clear protagonist** — A named persona with a business role and a problem to solve
- **Business metrics in $** — "$500K at risk" lands; "720 records affected" doesn't
- **A "wow moment"** — Root cause found in 60 seconds, a prediction that prevents downtime, an instant natural-language answer
- **A clear value statement** — "Days → minutes", "$2M saved annually"

## Catalyst Design Rules (default — follow unless the user says otherwise)
- **Place the event in the recent past, not "now".** The catalyst should have peaked 2–4 weeks ago and currently be decaying back toward baseline. This is what makes the chart story readable: build-up → peak → decay. A spike happening "right now" or "this week" puts the peak at the rightmost edge of the chart and reads as a cliff, not a story.
  - Use phrasing like *"peaked 3 weeks ago at 3x normal, now decaying toward baseline"* — anchor the time in the hook explicitly.
  - Avoid *"happening now"*, *"this week"*, *"is spiking"*, *"is approaching"* unless the user explicitly asks for a live/in-progress event.
- **Signal must dominate noise.** The event should be ≥3x baseline so the chart reads at a glance — anyone in the room can point at it without squinting. State the multiple in the hook (*"3x normal"*, *"$180K vs $60K typical"*).
- **User override wins.** If the prompt asks for a present-tense or live-event story (e.g. *"a fraud attack happening right now"*, *"show real-time alerting"*), follow that instead — these rules are the default, not a hard constraint.

## App Action Chain (the demo's climax — pick topics that support it)
A Databricks App is the demo's last beat. Its chat assistant runs a **3-phase action chain**: **Discover** (investigate) → **Draft + Confirm (STOP for approval)** → **Execute** (real writes back to the operational store).

Pick story topics whose persona has a clear remediation: freeze accounts, approve refunds, dispatch crews, file work orders, send goodwill credits, escalate cases, recommend recalls, … Pure-insight topics (only a dashboard, only a prediction with no follow-up action) make the app's climax limp.

TIER scaling for the action:
- **TIER 3** (3 short ideas): pick actionable topics; **do not** add an action sentence to the hook — keep it tight. The downstream tier-2/tier-1 upgrade will wire the action in.
- **TIER 2** (richer ideas): name the action in **Impact** — what gets drafted, what the user approves, what gets written.
- **TIER 1** (full story): the **Resolution** section names the in-app action chain explicitly (draft → approve → execute).

LuxeBeauty's canonical example for the action chain itself:
> *Discover* → find the worst production lot + split affected customers premium-vs-standard. *Draft + Confirm* → two apology email templates (20% for premium, 5% for standard) shown for approval. *Execute* → emails sent + refunds approved + audit trail written.

## Your Task
1. **Assess the prompt specificity (3 tiers):**
   - **TIER 3 — VAGUE** (count=3): A topic, possibly with a sub-topic or light direction. No personas, no specific metrics, no multi-step story. This is the DEFAULT — most prompts land here. Examples: "IoT demo", "retail", "fraud detection", "customer 360", "predictive maintenance on wind turbines", "customer churn for telecom"
   - **TIER 2 — MODERATE** (count=2): The user wrote 2+ sentences with constraints that meaningfully narrow the story: named data sources, explicit output requirements, a described workflow, or a specific business scenario with numbers. But NO full narrative arc — no protagonist journey from problem to resolution. Examples: "predictive maintenance on wind turbines — we need to combine SCADA vibration data with weather forecasts to predict energy output AND detect gearbox failures 30 days out, customer is a 120-turbine offshore operator", "customer churn for telecom with real-time scoring served via an app, using CDR and billing data, targeting $2M annual save"
   - **TIER 1 — DETAILED** (count=1): The user provided a STORY, a very detailed explanation, a named persona who encounters a problem, investigates, and reaches a resolution. Key signal: the story or demo requirement is already defined and just need to be rephrased / add a narrative arc (setup → problem → investigation → outcome), named personas, $ metrics. If the prompt reads like a story or structured brief, it's TIER 1. Do NOT downgrade to TIER 2 just because the story is short. Default to TIER 3 unless the prompt clearly has specific constraints (→ TIER 2) or tells a story (→ TIER 1).

2. **Generate use-case ideas (detail scales with tier):**

   **TIER 3 (count=3)** — 3 short ideas for quick exploration:
   - Hook: 1-2 sentences PLAIN TEXT. Role + problem + $ metric + when it peaked. NO section headers, NO \\n line breaks. This is a teaser, not a story — **keep it short** (≈25 words).
   - Anchor the catalyst in the past per the Catalyst Design Rules above — *"peaked 3 weeks ago"*, *"jumped to $X 3 weeks back, still decaying"*, etc.
   - The story must be **actionable** — the persona's domain must support a clear remediation verb (freeze, refund, dispatch, escalate, …) downstream. You don't have to name it in the 1-liner, but if the topic is purely observational (a dashboard with no obvious action) flag that with a softer outcome verb so a later tier upgrade can wire in the action chain.
   - Example:
     {{"type": "idea", "title": "Regional bank's fraud spike", "hook": "VP of Fraud Ops sees card fraud losses that peaked 3 weeks ago at 3x normal ($2.1M/month), now decaying as compromised POS terminals get rotated out.", "datasources": ["Core banking", "Card processor", "POS terminal logs"]}}

   **TIER 2 (count=2)** — 2 richer ideas with contrasting angles on the same requirements:
   - Hook uses 3 lightweight sections separated by \\n: **Context** (who + what's at stake + the specific problem), **Discovery** (what they find + how), **Impact** ($ outcome AND the in-app action chain — discover → draft + STOP for approval → execute writes). Describe the BUSINESS JOURNEY, not Databricks product names.
   - **Impact** must name the persona's action verb that lands as a real write (work orders generated, refunds approved, emails dispatched, crews tasked, accounts frozen, …). This is what the app's featured-action button will run.
   - Example (for "predictive maintenance wind turbine with weather, predict energy output and vibration"):
     {{"type": "idea", "title": "Offshore wind farm output forecasting", "hook": "**Context**\\nLars Eriksen, Operations Director at NorthSea Wind, manages 120 turbines generating $2.4M/month in energy revenue. Three weeks ago a wind ramp event blew his legacy forecast wide — $380K in curtailment penalties, the worst week of the year — and accuracy hasn't fully recovered since. He needs to see output vs. forecast deviation by farm and ask: 'Which turbines underperformed during that storm and why?'\\n\\n**Discovery**\\n8 turbines with specific bearing vibration signatures consistently drop output during high-wind events. An ML model trained on SCADA + weather features predicts output 48 hours ahead with 94% accuracy.\\n\\n**Impact**\\nLars asks the in-app assistant to draft crew assignments + an energy-trader notification for the next forecast storm. He approves the draft in one click and the app dispatches work orders + sends the contract update. $1.8M/year saved in curtailment penalties.", "datasources": ["OSIsoft PI (SCADA)", "NOAA Weather API", "SAP PM", "Turbine spec sheets"]}}
     {{"type": "idea", "title": "Gearbox failure early warning system", "hook": "**Context**\\nMaria Santos, Reliability Engineer at Atlantic Power, oversees 85 onshore turbines where a single gearbox replacement costs $350K and 3 weeks of downtime. Last quarter two unplanned failures cost $1.2M with zero advance warning — her monitoring only flags failures days before they happen, and OEM manuals document the failure mode but nobody connects that knowledge to live sensor data.\\n\\n**Discovery**\\nA model trained on 18 months of vibration + weather history scores every turbine daily. The top 5 highest-risk units auto-generate work orders with the specific failure mode and recommended action.\\n\\n**Impact**\\nMaria reviews the drafted work orders + crew assignments in the app, approves the batch, and the app pushes them to the CMMS with the audit trail. Zero unplanned gearbox failures in 6 months. $2.4M saved.", "datasources": ["GE Vernova APM", "Weather Underground API", "CMMS", "OEM maintenance manuals"]}}

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
     Default to STRUCTURED/tabular sources (transactions, metrics, logs, sensor data). Add unstructured sources (docs, manuals, policies) ONLY when the story genuinely needs document Q&A — those pull in KA/MAS, which are slow to set up (see Capability Selection Rules).
     The datasources must support the ENTIRE demo story — dashboards, Genie, ML models, apps all draw from them.
   - Always follow the user's request for what to demo; the rest are guidelines.

   NOTE: All ideas share the SAME capabilities. The capabilities are selected globally based on the topic, not per-idea.

3. **Select capabilities** that apply to ALL the story ideas (they're exploring different angles of the same topic).

## Capability Selection Rules
- **Keep it LEAN — a simple demo is the default.** Start from the minimal coherent path and only add a capability when the story clearly needs it. Each selected product must earn a clear moment in the demo.
- The simple default backbone is: "synthetic-data-gen" + "lakeflow-connect" + "sdp" + "unity-catalog" + "aibi-dashboards" + "genie" + "genie-one" + "genie-code" — a complete, compelling demo on its own. Don't pad beyond it without a reason in the story.
- Add heavier capabilities ONLY when the story implies them: "lakeflow-jobs" (explicit orchestration), "metric-views" (governed metrics / semantic layer), model training/serving (an ML/prediction beat), "databricks-apps"+"lakebase" (an app), "zerobus-ingest" (realtime streaming).
- **"knowledge-assistant" (KA) and "supervisor-agent" (MAS) are the expensive ones** — they need UNSTRUCTURED documents and take several minutes to set up. **Prefer a tabular-data story** that needs neither, and default your generated ideas toward structured/tabular sources. Only reach for KA/MAS (and unstructured datasources like manuals/policies/PDFs) when the topic genuinely centers on document Q&A or multi-agent investigation over unstructured content.
- Always include "synthetic-data-gen" — all demos need realistic fake data
- Almost always include talking track: "lakeflow-connect", "unity-catalog", "genie-one", "genie-code". Unity Catalog unless explicitly excluded.
- Consider dependencies (dashboards need SDP data, apps need lakebase, etc.) — but a dependency isn't a reason to add the heavier parent unless the parent is itself warranted.
- CRITICAL: the demo must showcase Databricks capabilities coherently (input data is what we leverage at the end for apps / dash / genie... in the story)

## Examples
- "Demo about customer 360 with an app" →
  - synthetic-data-gen (always needed)
  - lakeflow-connect (data ingestion)
  - sdp (data processing)
  - aibi-dashboards + genie (simple wow effect)
  - databricks-apps + lakebase (app mentioned, lakebase is dependency)
  - unity-catalog, genie-one, genie-code (talking track)
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

### TIER 3 example (prompt: "retail demo", do not include sub-title/section, simple sentences, lead with default capabilities when possible. Each hook anchors the catalyst in the recent past per the Catalyst Design Rules):
{{"type": "count", "count": 3}}
{{"type": "idea", "title": "Luxury retailer's returns mystery", "hook": "VP of Ops sees returns that peaked 3 weeks ago at 3x normal ($180K/week vs $60K), now decaying — traced to three products from one production lot.", "datasources": ["Shopify", "Zendesk", "ERP"]}}
{{"type": "idea", "title": "Grocery chain demand forecasting", "hook": "Regional grocer's last quarter post-mortem: $2.1M lost to stockouts during the promo + storm overlap two weeks ago, with the forecast accuracy still recovering.", "datasources": ["POS system", "Weather API", "Promotional calendar"]}}
{{"type": "idea", "title": "Fashion brand wasted ad spend", "hook": "CMO's Monday review of the last 3-month campaign shows 40% of budget targeted customers who churned 6+ months ago — $3.2M wasted, with the worst week 3 weeks back.", "datasources": ["Salesforce", "Google Analytics", "Loyalty program DB"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "aibi-dashboards", "genie", "genie-code"]}}
{{"type": "reasoning", "text": "Retail data flows through SDP into dashboards for trend visualization, Genie for ad-hoc investigation."}}

### TIER 2 example (prompt: "predictive maintenance wind turbines, combine SCADA vibration + weather to predict output and detect gearbox failures 30 days out, 120-turbine offshore operator"):
{{"type": "count", "count": 2}}
{{"type": "idea", "title": "Offshore wind output forecasting", "hook": "**Context**\\nLars Eriksen, Operations Director at NorthSea Wind, manages 120 turbines generating $2.4M/month. A wind ramp event 3 weeks ago blew his legacy forecast wide — $380K in curtailment penalties, the worst week of the year. He needs output vs. forecast by farm and to ask: 'Which turbines underperformed that storm and why?'\\n\\n**Discovery**\\n8 turbines with bearing vibration anomalies consistently drop output in high wind. An ML model on SCADA + weather predicts output 48h ahead at 94% accuracy.\\n\\n**Impact**\\nLars approves the drafted crew assignments + trader notification; the app dispatches the work orders. $1.8M/year saved.", "datasources": ["OSIsoft PI (SCADA)", "NOAA Weather API", "SAP PM", "Turbine spec sheets"]}}
{{"type": "idea", "title": "Gearbox failure early warning", "hook": "**Context**\\nMaria Santos, Reliability Engineer at Atlantic Power, oversees 85 turbines — one gearbox costs $350K and 3 weeks down. Two failures last quarter cost $1.2M with zero warning. OEM manuals document the failure mode but nobody links it to live sensor data.\\n\\n**Discovery**\\nA model on 18 months of vibration + weather scores turbines daily. Top 5 risk units auto-generate work orders with failure mode and action.\\n\\n**Impact**\\nMaria approves the drafted batch; the app pushes work orders to the CMMS with the audit trail. Zero unplanned gearbox failures in 6 months. $2.4M saved.", "datasources": ["GE Vernova APM", "Weather Underground API", "CMMS", "OEM maintenance manuals"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "model-training-mlflow", "model-serving", "aibi-dashboards", "genie", "knowledge-assistant", "genie-code"]}}
{{"type": "reasoning", "text": "SCADA + weather flow through SDP, ML models predict output and failure risk, dashboards visualize fleet health, Genie investigates, KA explains from manuals."}}

### TIER 1 example (prompt: a full story with named persona, narrative arc, and resolution):
{{"type": "count", "count": 1}}
{{"type": "idea", "title": "Supply chain forecast recovery", "hook": "**Protagonist**\\nAcme Retail — Sarah Chen, VP of Supply Chain. Obsessed with inventory turns and avoiding stockouts.\\n\\n**Catalyst**\\nForecast accuracy dropped from 92% to 78% across 2,000 stores. $4.2M/month in markdowns, $1.8M in lost sales.\\n\\n**Journey**\\nSarah opens her dashboard and spots the Southeast is 3x worse. She asks which categories drive forecast errors — promotional events are the blind spot. The demand planning SOP confirms the model has no promo lift feature. ML team retrains with event data in 48 hours.\\n\\n**Resolution**\\nIn the ops app Sarah asks the assistant to draft markdown-pullback orders for the over-stocked SKUs in the Southeast; she approves the batch and the app pushes the orders to S/4HANA with the audit trail. Accuracy climbs to 94%, markdowns drop 60%, stockouts halved. $3.1M annually saved.", "datasources": ["SAP S/4HANA", "Promotional calendar", "POS system", "Demand planning docs"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "model-training-mlflow", "aibi-dashboards", "genie", "knowledge-assistant", "genie-code"]}}
{{"type": "reasoning", "text": "POS + promo data through SDP, ML retrains forecast model, dashboards show regional accuracy, Genie drills into categories, KA explains from planning docs."}}"""

    # Build user prompt — three distinct shapes:
    #   1. Capability-change refresh (previous_ideas set): minimal rewrite
    #      of the existing ideas to fit the NEW capability set. Preserves
    #      titles and core narrative; only touches what the diff demands.
    #   2. Single-idea refinement (refine_idea + refine_comment): rewrite
    #      one idea per the user's free-text instructions, upgrade tier.
    #   3. Cold start (neither set): full ideation from the topic alone.
    if body.previous_ideas:
        # Format the previous ideas + diff. Capabilities marked as
        # mandatory_list are the new set the user wants; previous_capabilities
        # tells the LLM what was there so it can reason about the delta.
        prev_ideas_block = "\n\n".join(
            f"Story {i + 1}: {p.title}\nHook: {p.hook}\nDatasources: {', '.join(p.datasources)}"
            for i, p in enumerate(body.previous_ideas)
        )
        prev_caps = ", ".join(body.previous_capabilities or []) or "(none)"
        added = sorted(set((m.strip() for m in mandatory_list.split(","))) - set(body.previous_capabilities or []))
        removed = sorted(set(body.previous_capabilities or []) - set((m.strip() for m in mandatory_list.split(","))))
        added_str = ", ".join(added) if added else "(none)"
        removed_str = ", ".join(removed) if removed else "(none)"
        idea_count = len(body.previous_ideas)

        user_prompt = f"""User's original demo description:
"{body.prompt}"

=== EXISTING STORIES (the user is currently looking at these — keep them recognizable) ===
{prev_ideas_block}

=== CAPABILITY CHANGE ===
Previous capabilities: {prev_caps}
Added: {added_str}
Removed: {removed_str}

=== USER CONSTRAINTS (MUST RESPECT — these are the NEW capability set) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

The user has the {idea_count} stor{"y" if idea_count == 1 else "ies"} above on screen.
They JUST changed the capability mix. Do a MINIMAL rewrite:
- Keep every story's TITLE unchanged unless a removed capability made it nonsensical.
- Keep the core narrative arc (protagonist, problem, $ stakes) unchanged.
- Only adjust the hook + datasources to reflect added / removed capabilities.
- Match the existing detail tier of each story (plain text → plain text; **Context/Discovery/Impact** → same sections; **Protagonist/Catalyst/...** → same).
- Do NOT replace the stories with brand-new ones — the user is mid-decision and resetting their context is jarring.

Output line-delimited JSON: count line (count={idea_count}), then {idea_count} idea line{"s" if idea_count > 1 else ""}, then capabilities line, then reasoning line."""
    elif body.refine_idea and body.refine_comment:
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

    user_prompt = _append_shared_context(body, user_prompt)

    return system_prompt, user_prompt


def _append_shared_context(body: SuggestCapabilitiesRequest, user_prompt: str) -> str:
    """Append the uploaded-files + architecture-datasources context blocks.

    Shared by every prompt shape (cold start / refine / capability refresh /
    capabilities-only) so file content and diagram sources always reach the
    LLM regardless of mode.
    """
    # If the user uploaded files on the home page, inject their joined
    # extraction as a ground-truth block. Cap at 50 KB server-side as
    # belt-and-braces (frontend already caps).
    if body.context_text:
        ctx = body.context_text[:50_000]
        user_prompt += (
            "\n\n=== UPLOADED FILES (user-shared context — treat as ground truth) ===\n"
            f"{ctx}\n"
            "Use the file content above to anchor the story domain, data shape, "
            "and any specific entities. The user wants the suggested demo to fit "
            "what's actually in these files."
        )

    # Architecture-first: the diagram already names the demo's data sources.
    # Anchoring the ideas in those exact systems keeps the generated story
    # consistent with the architecture the user drew.
    if body.datasources:
        names = ", ".join(n.strip() for n in body.datasources[:10] if n and n.strip())
        if names:
            user_prompt += (
                "\n\n=== ARCHITECTURE DATA SOURCES (already defined in the user's diagram) ===\n"
                f"{names}\n"
                "Anchor each use-case idea in these systems — reuse these exact "
                "names in the idea's `datasources` (add at most 1-2 extra sources "
                "only if the story truly needs them)."
            )

    return user_prompt


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
        # No prompt → nothing for the LLM to story about, return just caps.
        if not body.prompt.strip():
            yield f"event: capabilities\ndata: {json.dumps({'capabilities': always_include, 'reasoning': None})}\n\n"
            return

        # Load platform architecture for context
        platform_context = _load_platform_architecture()

        # Exclude disabled caps from the LLM's candidate pool — talking-track-only
        # governance features (data-classification, data-quality, abac) aren't
        # relevant to most demos. User can still mandate them via show-hidden.
        available_caps = [c for c in load_capabilities() if not c.get("disabled")]
        # When `to_decide` is empty (Simple-tab lock: every id is explicitly
        # selected or unselected), the LLM has no capability choice to make
        # — but it STILL needs to generate ideas. Feed it the mandatory list
        # as the candidate pool so the prompt structure stays valid and the
        # LLM echoes the mandatory ids back in its `capabilities` line.
        available_for_llm = [
            c for c in available_caps
            if c["id"] in (to_decide if to_decide else always_include)
        ]
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

            # For refinements (single-idea rewrite) and capability-change
            # refreshes (N ideas preserved) we already know the count —
            # send it immediately so the UI renders skeletons in the right
            # shape instead of flashing 3-then-1 (or 3-then-2).
            # (Never in capabilities-only mode — there are no idea skeletons.)
            if body.capabilities_only:
                pass
            elif body.refine_idea and body.refine_comment:
                yield f"event: count\ndata: {json.dumps({'count': 1})}\n\n"
            elif body.previous_ideas:
                yield f"event: count\ndata: {json.dumps({'count': len(body.previous_ideas)})}\n\n"

            # Stream lines from LLM. Capabilities-only answers are two short
            # JSON lines — cap tokens accordingly.
            for line in llm.chat_stream_lines(
                user_prompt,
                system_prompt=system_prompt,
                size=ModelSize.MINI,
                max_tokens=600 if body.capabilities_only else 2500,
            ):
                try:
                    data = json.loads(line)
                    event_type = data.get("type")

                    # Capabilities-only: defensively drop any story events the
                    # LLM might emit despite the prompt — the contract is
                    # capabilities (+ reasoning) only.
                    if body.capabilities_only and event_type in ("count", "idea"):
                        continue

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
