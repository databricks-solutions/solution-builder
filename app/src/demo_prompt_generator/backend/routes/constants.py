"""Constants API endpoints for industries, capabilities, and current user."""

from __future__ import annotations

import json
import logging
from enum import Enum
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..core.constants import (
    INDUSTRIES,
    WORKSHOP_CAPABILITIES,
    WORKSHOP_CORE_CAPABILITIES,
    get_capabilities as load_capabilities,
)
from ..services.llm_service import LLMService, ModelSize
from ..services.shutdown import shutdown_requested

router = create_router()
logger = logging.getLogger(__name__)


class Capability(BaseModel):
    """Capability definition."""
    id: str
    name: str
    category: str
    disabled: bool = False
    # Offered in the "Prepare a workshop" (Genie Code) mode? Defaults True;
    # the workshop tab hides capabilities where this is False.
    genie_code_workshop: bool = True


class CapabilityStatus(str, Enum):
    """User's explicit selection status for a capability."""
    SELECTED = "selected"
    UNSELECTED = "unselected"


class CapabilityInput(BaseModel):
    """Capability with user's explicit selection status."""
    id: str
    status: Optional[Literal["selected", "unselected"]] = None


# Workshop mode always shows this many story ideas (cold start).
WORKSHOP_IDEA_COUNT = 3


def _workshop_idea_count(body: "SuggestCapabilitiesRequest") -> int | None:
    """Exact number of ideas a workshop request must yield, or None outside
    workshop mode. Mirrors the branch order in `_build_suggest_prompts`: a
    capability-change refresh keeps its count, a refine is one idea, and the
    cold start is always WORKSHOP_IDEA_COUNT."""
    if body.mode != "workshop" or body.capabilities_only:
        return None
    if body.previous_ideas:
        return len(body.previous_ideas)
    if body.refine_idea and body.refine_comment:
        return 1
    return WORKSHOP_IDEA_COUNT


def _workshop_framing(idea_count: int) -> str:
    """The workshop-mode block appended to every suggest prompt shape. It
    overrides the story tier/capability rules above it."""
    baseline = ", ".join(sorted(WORKSHOP_CAPABILITIES))
    core = ", ".join(WORKSHOP_CORE_CAPABILITIES)
    ideas = "idea line" if idea_count == 1 else "idea lines"
    return f"""

=== WORKSHOP MODE (overrides the tier rules and capability rules above) ===
This story becomes a hands-on Genie Code WORKSHOP that the attendee builds live, prompt by prompt.
- Output EXACTLY {idea_count} {ideas} (count={idea_count}). Each idea is a short plain-text teaser (~25 words, no section headers, no line breaks). Each hook names the persona and the business question the workshop answers, with the catalyst anchored in the recent past per the Catalyst Design Rules.
- The workshop arc is: raw data → exploration notebooks → SDP pipeline → data quality → dashboard + Genie → metric view → governance (ABAC, classification) → ML model → Genie Code / Genie One → AI functions. Pick data and personas where that arc is natural.
- CAPABILITIES: start from the workshop baseline ({baseline}). Drop any baseline capability the brief does not need, and always drop the steps the brief rules out (e.g. "no ML" → ml-training-serving; "no governance" → abac, data-classification), but these always stay: {core}. Add another capability from AVAILABLE CAPABILITIES only if the brief clearly needs it. Never output an id that is not in AVAILABLE CAPABILITIES."""


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
    # Home-page entry mode. "workshop" (Genie Code workshop): the capability
    # pool excludes genie_code_workshop=false blocks and cold-start ideation
    # always yields exactly WORKSHOP_IDEA_COUNT stories framed as a workshop.
    mode: Literal["story", "architecture", "workshop"] = "story"
    # "Use existing data" grounding: the fully-qualified UC tables the user
    # picked (catalog.schema.table). When present, we inject their scanned
    # schema + light stats + a few sample rows (from the process-level cache
    # warmed by POST /grounding/scan) into the prompt and REQUIRE the story to
    # be built on ONLY these tables. Read entirely by `_append_shared_context`.
    grounding_tables: list[str] | None = None
    # "Use existing data" opt-in. When False (default) the grounded flow proposes
    # READ-ONLY analytics only (dashboards/Genie/metric-views). When True the demo
    # may create its OWN auxiliary tables, so write-needing capabilities (apps,
    # lakebase, ML, and synthetic-data-gen for the aux tables) become fair game —
    # the user's real tables stay read-only regardless.
    allow_data_write: bool = False


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
            genie_code_workshop=c.get("genie_code_workshop", True),
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

    Same path inside the wheel and the dev tree: `.claude/skills/databricks-solution-builder/`.
    """
    bundled = (
        Path(__file__).parent.parent.parent / ".claude" / "skills"
        / "databricks-solution-builder" / "references" / "platform_architecture.md"
    )
    if bundled.exists():
        return bundled.read_text()

    current_file = Path(__file__)
    for parent in current_file.parents:
        arch_file = (
            parent / ".claude" / "skills" / "databricks-solution-builder"
            / "references" / "platform_architecture.md"
        )
        if arch_file.exists():
            return arch_file.read_text()
    return ""


def _build_grounded_system_prompt(
    platform_context: str,
    allow_data_write: bool = False,
    task_mode: str = "cold",
    idea_count: int | None = None,
) -> str:
    """System prompt for the "Use existing data" flow.

    The demo is built DIRECTLY on the user's REAL Unity Catalog tables, READ-ONLY
    — no data is generated or copied. Dashboards, Genie, metric views, etc. query
    those exact tables. Propose analytics use-cases that run on the real data as
    it is; there is no synthetic catalyst to craft.

    `allow_data_write` reflects the user's opt-in: when True the demo may create
    its OWN auxiliary tables, so write-needing capabilities are allowed (the real
    tables stay read-only). When False the capability set is read-only analytics.

    `task_mode` selects the generation shape:
      - "cold"    — fresh ideation (the 3-tier count logic below applies).
      - "refine"  — rewrite ONE existing story per the user's request; count=1.
      - "refresh" — minimally rewrite `idea_count` existing stories to fit a new
                    capability set; count=`idea_count`.
    For refine/refresh a MODE OVERRIDE is appended LAST so it wins over the
    3-tier count logic (the grounding + fit + why rules still apply). Without it
    the grounded LLM ignores the refine/refresh and regenerates a full new set,
    which on the client wipes/replaces the OTHER cards the user didn't touch.
    """
    if allow_data_write:
        capability_rules = """## Capability Selection Rules (grounded, data-write opted in)
- **Keep it LEAN.** Start minimal; add a capability only when the use-case needs it.
- The read-only backbone still applies: "unity-catalog" + "aibi-dashboards" + "genie" + "genie-one" + "genie-code" over the user's real tables.
- The user opted into letting the demo create its OWN auxiliary data, so write-needing capabilities are ALLOWED when a use-case calls for them: "metric-views", model training/serving, "unstructured-documents" (doc Q&A, requires "genie"), and even "databricks-apps"+"lakebase" (an action app). Any tables these create live in the DEMO's own catalog — the user's real tables above are STILL read-only.
- You may include "synthetic-data-gen" ONLY to create AUXILIARY tables in the demo's own catalog (e.g. an app write-back table or ML labels) — never to regenerate or replace the user's real tables.
- Almost always include talking track: "unity-catalog", "genie-one", "genie-code"."""
    else:
        capability_rules = """## Capability Selection Rules (read-only-on-real-data flow)
- **Keep it LEAN.** Start minimal; add a capability only when the use-case needs it.
- The default backbone is: "unity-catalog" + "aibi-dashboards" + "genie" + "genie-one" + "genie-code" — read-only analytics on the user's real tables.
- **Do NOT include "synthetic-data-gen"** — the demo uses the real data, it does not generate any. **Do NOT include ingest capabilities** ("lakeflow-connect", "sdp", "zerobus-ingest") — the data already exists in Unity Catalog; there is no ingest/medallion beat to build.
- Add heavier capabilities ONLY when the use-case clearly implies them AND the real data supports them, read-only: "metric-views" (governed metrics over the real tables), model training/serving (an ML/prediction angle trained on the real tables). **Avoid "databricks-apps"+"lakebase"** — the app's write-back action chain can't run against read-only customer tables.
- **"unstructured-documents"** needs unstructured docs (PDFs) — only when the topic centers on document Q&A. It requires "genie" (the Genie agent answers from the documents volume).
- Almost always include talking track: "unity-catalog", "genie-one", "genie-code"."""
    base = f"""You are a Databricks solution architect. The user picked some of their OWN Unity Catalog tables, and the solution will be built DIRECTLY on those real tables — READ-ONLY. Nothing is generated, nothing is copied: the dashboards, Genie space, metric views, etc. query the user's actual tables in place. Your job is to propose valuable analytics use-cases that run on their real data exactly as it is.

## Platform Architecture
{platform_context}

## Build directly on the real tables (read-only) — most important
The user prompt includes a PROFILE of the real tables — per column: type, distinct count, null %, min/max range, mean/quartiles for numerics, and the top values for categoricals — and a DATA CAPABILITY SIGNALS summary (the time columns, measures, dimensions, and join keys the data actually has). Use both to find the use-cases the REAL data genuinely supports, and to RATE each idea's fit.

- **Everything queries the real tables in place.** Reuse the real fully-qualified table + column names verbatim. The dashboards/Genie/metric-views read these exact tables — nothing is generated or duplicated.
- **The story is whatever the data actually shows — do NOT fabricate a catalyst.** There is no synthetic spike/anomaly to design; the data is real. Propose use-cases that surface real value: a clear view of the business, a diagnostic that explains a real pattern by joining tables, a forward-looking read the data supports. If the data happens to contain a notable trend or outlier, great — lean on it; but never invent one.
- Prefer a numeric measure + a time/date column + a categorical dimension the tables actually contain — that's what makes the dashboard/Genie use-case land, and it's exactly what earns a "Great" fit.
- **When multiple tables were selected, prefer a use-case that JOINS them** on the keys shown in DATA CAPABILITY SIGNALS — a fact table joined to its dimensions is the strongest read. Reach across the related tables rather than anchoring on one; only fall back to a single table when no join key connects the selection.
- A named persona + business framing + $/volume metric are great; tie them to the real entities and the magnitudes the profile actually shows (do not inflate beyond the data).

## The use-case MUST run on these exact tables
- Every idea must be expressible as read-only queries over the listed tables + their columns. Do NOT assume columns that aren't there, do NOT propose generating or copying data, and NEVER write to or modify the user's tables.
- `datasources` MUST reference the real tables (their fully-qualified `catalog.schema.table` names from the profile), not made-up source systems.

## Your Task
1. **Assess the prompt specificity (3 tiers)** — the SCHEMA anchors the data model; the user's text (if any) is a STEER:
   - **TIER 3 — VAGUE / EMPTY** (count=3): little or no typed text — the schema leads. Propose 3 DISTINCT, substantive use-cases that span a RANGE of analytical sophistication — NOT three variations of the same "spot a trend" story. Aim for a spread like: (a) an executive/descriptive view of the business, (b) a diagnostic deep-dive that explains a pattern by JOINING tables, and (c) a forward-looking angle the data can support — a forecast, a churn/propensity score, customer or product segmentation, an anomaly watch. Only propose (c)-style predictive/ML angles when the columns plausibly support them; otherwise offer a second diagnostic or operational angle instead.
   - **TIER 2 — MODERATE** (count=2): a couple of sentences steering the focus. 2 contrasting angles that fit both the steer AND the schema.
   - **TIER 1 — DETAILED** (count=1): a described story/persona/goal. 1 structured story, grounded in the real columns.
   Default to TIER 3 when the text box is empty or vague.

2. **Generate use-case ideas (detail scales with tier):**
   - **TIER 3 (count=3):** Hook = 2-3 substantive sentences PLAIN TEXT (no headers, ≈45-65 words): name a persona/role, the real business situation or opportunity in their data, and the concrete payoff — enough that it reads like a real use-case, not a one-line teaser. Express it over the real tables/columns/joins. Keep it prose (no section headers) so it stays scannable on a card; the deeper detail belongs in `why`.
     Example (spans TWO joined tables): {{"type": "idea", "title": "Regional revenue anomaly", "hook": "A RevOps lead needs to know which regions and product lines are actually driving revenue — and why last quarter's numbers wobbled. By joining orders to customers, they can track revenue by region and product over time, catch the West-region jump from three weeks ago, and trace it to a single product line. It turns a vague 'sales feel off' into a specific, shareable answer the team can act on each week.", "datasources": ["main.retail.orders", "main.retail.customers"], "fit": {{"tier": "Great", "reason": "trends orders.amount over order_date, joined to customers.region"}}, "why": "You'd finally get a straight answer to 'which regions and product lines are actually moving our revenue?' — and when something spikes, you could just ask why and know in seconds instead of waiting days for someone to pull the numbers. Since your orders already tie back to customers, you can slice sales by region and product without any extra data wrangling, so this is something you could stand up fast and lean on week to week."}}
   - **TIER 2 (count=2):** Hook uses **Context** / **Discovery** / **Impact** sections separated by \\n. Context = persona + the business question over the schema; Discovery = the pattern/anomaly (expressed on real columns); Impact = the decision/action + a $/volume metric in realistic magnitudes.
   - **TIER 1 (count=1):** Hook uses **Protagonist** / **Catalyst** / **Journey** / **Resolution** sections separated by \\n — a full narrative arc, with the catalyst + resolution expressed over the real tables/columns.

   **Common rules for ALL tiers:**
   - `title`: short punchy title (5-7 words).
   - `datasources`: list EVERY real table the use-case touches (fully-qualified names from the profile) — NOT just one. When the user selected several related tables (see the join keys in DATA CAPABILITY SIGNALS), PREFER a use-case that SPANS them — a fact joined to its dimensions is the strongest read. Build each idea on a COHERENT SUBSET (typically 2–6 related tables — a fact + the dimensions/keys it joins to), never a single lonely table when related ones exist, and never dump all of them. Different ideas MAY center on different subsets.
   - Keep the table + column names faithful; everything queries the real tables in place.
   - `fit` (REQUIRED on every idea): rate how well the user's REAL data supports THIS read-only use-case, using the DATA CAPABILITY SIGNALS. A CONSULTATION signal for the user — which ideas their data backs best — NOT a gate.
     - `fit.tier` is one of exactly: `"Great"` (the real data fully supports it — the measure, time column, dimension, and any needed join key are all present), `"Good"` (supported but partial — e.g. a key column is sparse/often-null, the time span is short, or a needed dimension is coarse), or `"Possible"` (the data only weakly supports it — the core entity/measure is thin or barely present, so you'd be stretching what's there).
     - `fit.reason` is ONE short clause (≤12 words) naming the REAL tables/columns the idea uses, e.g. "trends orders.amount over order_date by region". For Good/Possible, name the limitation, e.g. "customer region is 60% null" or "only 3 months of history".
     - Be HONEST — do not inflate every idea to Great. A varied, truthful spread is what makes this useful.
   - `why` (REQUIRED): 2–4 sentences, CONVERSATIONAL and casual (write to the user as "you"), on the VALUE you'd get from running this USE-CASE on your data — shown when the user expands the idea. Lead with the payoff: the question it finally answers, the decision or action it unlocks, what you'd stop guessing about or doing by hand. Mention their real tables/columns naturally (because they already have X and Y, you can…), but keep it about the business value, NOT the mechanics. Do NOT say "demo" or "wow moment", do NOT list Databricks product names, do NOT describe chart types. Talk like a helpful colleague pointing out an opportunity, not a sales deck.

   NOTE: All ideas share the SAME capabilities.

3. **Select capabilities** that apply to ALL ideas.

{capability_rules}

## Output Format (LINE-DELIMITED JSON - ONE JSON OBJECT PER LINE)
Output each item on its own line as valid JSON. Do NOT wrap in an array or object.
FIRST: {{"type": "count", "count": 3}}
Then one line per idea: {{"type": "idea", "title": "...", "hook": "...", "datasources": [...], "fit": {{"tier": "Great|Good|Possible", "reason": "..."}}, "why": "2-4 casual, conversational sentences on the VALUE you'd get from this use-case on your data (payoff + what it unlocks, grounded in your real tables — no 'demo'/product names/chart talk)"}}
  **Emit the ideas BEST-FIT-FIRST** — the highest-fit idea (Great before Good before Possible) on the FIRST idea line, so the user sees the strongest option at the top.
Then: {{"type": "capabilities", "capabilities": [...]}}
Finally: {{"type": "reasoning", "text": "1-2 sentences: how the real tables flow through the selected capabilities."}}"""

    if task_mode == "refine":
        base += """

## ⚠️ MODE OVERRIDE — SINGLE-IDEA REFINE (takes precedence over the 3-tier logic above)
The user is looking at several stories and asked to REFINE exactly ONE of them (given in the user prompt with their refinement request). This is NOT a fresh ideation pass.
- Return **EXACTLY 1 idea** — the refined version of that one story. **count = 1.**
- Do NOT generate alternatives, do NOT re-pitch the other stories, do NOT propose 2-3 ideas. Only the single refined idea.
- Keep what already works in that story; apply the user's refinement request; keep it grounded in the SAME real tables (adjust the table subset only if the request truly calls for it).
- UPGRADE the detail tier: plain-text hook → **Context/Discovery/Impact** sections; already-sectioned → **Protagonist/Catalyst/Journey/Resolution**. Still emit `fit` + `why`.
- Output: `{"type":"count","count":1}` line, then EXACTLY ONE `{"type":"idea",...}` line, then the `capabilities` line, then the `reasoning` line. Nothing else."""
    elif task_mode == "refresh" and idea_count:
        base += f"""

## ⚠️ MODE OVERRIDE — MINIMAL CAPABILITY REFRESH (takes precedence over the 3-tier logic above)
The user has {idea_count} stor{"y" if idea_count == 1 else "ies"} on screen and just changed the capability mix. Do a MINIMAL rewrite — this is NOT a fresh ideation pass.
- Return **EXACTLY {idea_count} idea{"" if idea_count == 1 else "s"}** — the SAME stories, rewritten only as needed. **count = {idea_count}.**
- Keep each story's TITLE and core narrative arc; only adjust the hook + datasources to reflect the added/removed capabilities. Match each story's existing detail tier.
- Keep them grounded in the real tables; still emit `fit` + `why`.
- Output: `{{"type":"count","count":{idea_count}}}` line, then EXACTLY {idea_count} `idea` line{"" if idea_count == 1 else "s"} (same order as given), then `capabilities`, then `reasoning`. Nothing else."""

    return base


def _capability_delta(
    mandatory_list: str, previous_capabilities: list[str] | None
) -> tuple[str, str, str]:
    """Compute the capability diff for a refresh prompt → (prev, added, removed)
    display strings. `mandatory_list` is the comma-joined NEW selected set;
    `previous_capabilities` is what the on-screen ideas were generated for.
    Shared by the grounded + non-grounded refresh branches so the delta the
    model is told to act on is computed identically in both."""
    prev = set(previous_capabilities or [])
    new = {m.strip() for m in mandatory_list.split(",") if m.strip()}
    prev_caps = ", ".join(previous_capabilities or []) or "(none)"
    added = ", ".join(sorted(new - prev)) or "(none)"
    removed = ", ".join(sorted(prev - new)) or "(none)"
    return prev_caps, added, removed


def _build_grounded_user_prompt(
    body: SuggestCapabilitiesRequest,
    mandatory_list: str,
    excluded_list: str,
    cap_list: str,
) -> str:
    """User prompt for the grounded flow. The real-table PROFILE is appended by
    `_append_grounding_tables` (via `_append_shared_context`), so here we just
    frame the (optional) typed steer / refine-target / refresh-set + the
    capability constraints. The system prompt's MODE OVERRIDE (refine/refresh)
    pairs with the matching block here so a grounded refine/refresh honors the
    request instead of regenerating a full new set."""
    steer = body.prompt.strip()
    # The user's typed steer is context for refine/refresh too (the ideas were
    # generated under it) — mirror the non-grounded builder, which keeps it.
    steer_prefix = (
        f'The user typed this to steer the use-cases (a hint, not a script):\n"{steer}"\n\n'
        if steer
        else ""
    )
    # Branch order matches the non-grounded builder: refresh (previous_ideas)
    # first, then single-idea refine, then cold start.
    if body.previous_ideas:
        # Capability-change refresh: the existing stories to minimally rewrite,
        # WITH their datasources + the capability delta the model must act on
        # (the system-prompt override says "adjust hook + datasources to reflect
        # added/removed" — it can only do that if shown both).
        prev_block = "\n\n".join(
            f"Story {i + 1}: {p.title}\nHook: {p.hook}\nDatasources: {', '.join(p.datasources)}"
            for i, p in enumerate(body.previous_ideas)
        )
        prev_caps, added_str, removed_str = _capability_delta(
            mandatory_list, body.previous_capabilities
        )
        steer_block = (
            f"{steer_prefix}"
            "=== EXISTING STORIES (keep them recognizable; minimal rewrite) ===\n"
            f"{prev_block}\n\n"
            "=== CAPABILITY CHANGE ===\n"
            f"Previous capabilities: {prev_caps}\n"
            f"Added: {added_str}\n"
            f"Removed: {removed_str}\n\n"
        )
    elif body.refine_idea and body.refine_comment:
        # Single-idea refine: name the ONE story to rewrite + the user's request.
        steer_block = (
            f"{steer_prefix}"
            "=== EXISTING STORY TO REFINE (rewrite ONLY this one) ===\n"
            f"Title: {body.refine_idea.title}\n"
            f"Hook: {body.refine_idea.hook}\n"
            f"Datasources: {', '.join(body.refine_idea.datasources)}\n\n"
            "=== USER'S REFINEMENT REQUEST ===\n"
            f'"{body.refine_comment}"\n\n'
        )
    elif steer:
        steer_block = (
            f'The user typed this to steer the use-case (a hint, not a script):\n"{steer}"\n\n'
        )
    else:
        steer_block = "The user did NOT type anything — let the tables lead. Propose 3 distinct angles the real data supports.\n\n"
    return f"""Propose read-only analytics use-cases built directly on the user's real Unity Catalog tables (profiled below).

{steer_block}=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

Output line-delimited JSON per the format above (count line, idea lines, capabilities line, reasoning line)."""


def _build_suggest_prompts(
    body: SuggestCapabilitiesRequest,
    platform_context: str,
    mandatory_list: str,
    excluded_list: str,
    cap_list: str,
    ws=None,
) -> tuple[str, str]:
    """Build system and user prompts for capability suggestion.

    `ws` (the app service-principal WorkspaceClient) is only needed when the
    request grounds on real UC tables (`grounding_tables`) — it lets
    `_append_shared_context` read the cached scan (or lazily scan) and inject it.
    """
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
- **"unstructured-documents" is the expensive one** — it needs UNSTRUCTURED documents (PDFs) uploaded and indexed, and takes several minutes to set up. Default to a **tabular-data** story that needs neither. Only add it when the user's text clearly involves document Q&A or policy/manual lookup over unstructured content. When in doubt, leave it out. **But an explicit ask wins:** if the user's text says the demo must answer from PDFs, documents, manuals, policies, contracts or reports, ALWAYS include "unstructured-documents" (with "genie"), even in a lean demo.
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

        user_prompt = _append_shared_context(body, user_prompt, ws)
        return system_prompt, user_prompt

    # ---- Grounded variant ("Use existing schema") --------------------------
    # The user picked REAL UC tables as a SCHEMA blueprint. The demo STILL
    # builds READ-ONLY on those real tables — nothing is generated or copied, so
    # ideas must run as read-only queries on the data as it is (no crafted
    # catalyst). The capability set is read-only analytics UNLESS the user opted
    # into data-write (`allow_data_write`), which lets the demo create its own
    # auxiliary tables and re-enables write-needing capabilities.
    if body.grounding_tables:
        # Honor refine / capability-refresh in the grounded flow too — otherwise
        # the grounded LLM ignores them and regenerates a fresh set, replacing the
        # OTHER stories the user didn't touch. Precedence matches the non-grounded
        # builder: refresh (previous_ideas) before single-idea refine.
        if body.previous_ideas:
            task_mode, idea_count = "refresh", len(body.previous_ideas)
        elif body.refine_idea and body.refine_comment:
            task_mode, idea_count = "refine", 1
        else:
            task_mode, idea_count = "cold", None
        system_prompt = _build_grounded_system_prompt(
            platform_context, body.allow_data_write, task_mode, idea_count
        )
        user_prompt = _build_grounded_user_prompt(body, mandatory_list, excluded_list, cap_list)
        user_prompt = _append_shared_context(body, user_prompt, ws)
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
     Default to STRUCTURED/tabular sources (transactions, metrics, logs, sensor data). Add unstructured sources (docs, manuals, policies) ONLY when the story genuinely needs document Q&A — those pull in the "unstructured-documents" capability, which is slow to set up (see Capability Selection Rules).
     The datasources must support the ENTIRE demo story — dashboards, Genie, ML models, apps all draw from them.
   - Always follow the user's request for what to demo; the rest are guidelines.

   NOTE: All ideas share the SAME capabilities. The capabilities are selected globally based on the topic, not per-idea.

3. **Select capabilities** that apply to ALL the story ideas (they're exploring different angles of the same topic).

## Capability Selection Rules
- **Keep it LEAN — a simple demo is the default.** Start from the minimal coherent path and only add a capability when the story clearly needs it. Each selected product must earn a clear moment in the demo.
- The simple default backbone is: "synthetic-data-gen" + "lakeflow-connect" + "sdp" + "unity-catalog" + "aibi-dashboards" + "genie" + "genie-one" + "genie-code" — a complete, compelling demo on its own. Don't pad beyond it without a reason in the story.
- Add heavier capabilities ONLY when the story implies them: "lakeflow-jobs" (explicit orchestration), "metric-views" (governed metrics / semantic layer), model training/serving (an ML/prediction beat), "databricks-apps"+"lakebase" (an app), "zerobus-ingest" (realtime streaming).
- **"unstructured-documents" is the expensive one** — it needs UNSTRUCTURED documents (PDFs) uploaded and indexed, and takes several minutes to set up. **Prefer a tabular-data story** that needs neither, and default your generated ideas toward structured/tabular sources. Only reach for "unstructured-documents" (and unstructured datasources like manuals/policies/PDFs) when the topic genuinely centers on document Q&A over unstructured content. It always comes with "genie". **An explicit ask wins:** if the user's text says answers must come from PDFs, documents, manuals, policies, contracts or reports, ALWAYS include it.
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
  - unstructured-documents + genie (document lookup answered by the Genie agent — story explicitly involves unstructured-doc lookup)
  - ml-training-serving (fraud ML models for real-time scoring)
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
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "ml-training-serving", "aibi-dashboards", "genie", "unstructured-documents", "genie-code"]}}
{{"type": "reasoning", "text": "SCADA + weather flow through SDP, ML models predict output and failure risk, dashboards visualize fleet health, Genie investigates and answers from the OEM manuals volume."}}

### TIER 1 example (prompt: a full story with named persona, narrative arc, and resolution):
{{"type": "count", "count": 1}}
{{"type": "idea", "title": "Supply chain forecast recovery", "hook": "**Protagonist**\\nAcme Retail — Sarah Chen, VP of Supply Chain. Obsessed with inventory turns and avoiding stockouts.\\n\\n**Catalyst**\\nForecast accuracy dropped from 92% to 78% across 2,000 stores. $4.2M/month in markdowns, $1.8M in lost sales.\\n\\n**Journey**\\nSarah opens her dashboard and spots the Southeast is 3x worse. She asks which categories drive forecast errors — promotional events are the blind spot. The demand planning SOP confirms the model has no promo lift feature. ML team retrains with event data in 48 hours.\\n\\n**Resolution**\\nIn the ops app Sarah asks the assistant to draft markdown-pullback orders for the over-stocked SKUs in the Southeast; she approves the batch and the app pushes the orders to S/4HANA with the audit trail. Accuracy climbs to 94%, markdowns drop 60%, stockouts halved. $3.1M annually saved.", "datasources": ["SAP S/4HANA", "Promotional calendar", "POS system", "Demand planning docs"]}}
{{"type": "capabilities", "capabilities": ["synthetic-data-gen", "lakeflow-connect", "sdp", "unity-catalog", "ml-training-serving", "aibi-dashboards", "genie", "unstructured-documents", "genie-code"]}}
{{"type": "reasoning", "text": "POS + promo data through SDP, ML retrains forecast model, dashboards show regional accuracy, Genie drills into categories and answers from the planning docs volume."}}"""

    # Build user prompt — three distinct shapes:
    #   1. Capability-change refresh (previous_ideas set): minimal rewrite
    #      of the existing ideas to fit the NEW capability set. Preserves
    #      titles and core narrative; only touches what the diff demands.
    #   2. Single-idea refinement (refine_idea + refine_comment): rewrite
    #      one idea per the user's free-text instructions, upgrade tier.
    #   3. Cold start (neither set): full ideation from the topic alone.
    # Workshop mode keeps its framing (and exact count) in all three shapes;
    # story mode gets an empty block, so its prompts are unchanged.
    fixed_count = _workshop_idea_count(body)
    workshop_block = _workshop_framing(fixed_count) if fixed_count is not None else ""
    if body.previous_ideas:
        # Format the previous ideas + diff. Capabilities marked as
        # mandatory_list are the new set the user wants; previous_capabilities
        # tells the LLM what was there so it can reason about the delta.
        prev_ideas_block = "\n\n".join(
            f"Story {i + 1}: {p.title}\nHook: {p.hook}\nDatasources: {', '.join(p.datasources)}"
            for i, p in enumerate(body.previous_ideas)
        )
        prev_caps, added_str, removed_str = _capability_delta(
            mandatory_list, body.previous_capabilities
        )
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

{workshop_block}

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

{workshop_block}

Output line-delimited JSON: count line (count=1), then one idea line, then capabilities line, then reasoning line."""
    elif body.mode == "workshop":
        user_prompt = f"""User's demo description:
"{body.prompt}"

=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

{_workshop_framing(WORKSHOP_IDEA_COUNT)}

Output line-delimited JSON (count line, {WORKSHOP_IDEA_COUNT} idea lines, capabilities line, reasoning line)."""
    else:
        user_prompt = f"""User's demo description:
"{body.prompt}"

=== USER CONSTRAINTS (MUST RESPECT) ===
- User MANDATORY (always include): {mandatory_list}
- User EXCLUDED (never include): {excluded_list}

=== AVAILABLE CAPABILITIES ===
{cap_list}

Output line-delimited JSON (idea lines first, then capabilities line)."""

    user_prompt = _append_shared_context(body, user_prompt, ws)

    return system_prompt, user_prompt


def _append_shared_context(
    body: SuggestCapabilitiesRequest, user_prompt: str, ws=None
) -> str:
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

    # "Use existing data": the user picked REAL Unity Catalog tables to ground
    # the demo on. Inject their scanned schema + light stats + a few sample rows
    # (from the process-level cache warmed by /grounding/scan; lazily scanned on
    # a miss) and REQUIRE the story to be built on ONLY these tables.
    user_prompt = _append_grounding_tables(body, user_prompt, ws)

    return user_prompt


def _append_grounding_tables(
    body: SuggestCapabilitiesRequest, user_prompt: str, ws
) -> str:
    """If the request grounds on real UC tables, inject their scan + a hard
    constraint that the story use ONLY those tables."""
    tables = [t.strip() for t in (body.grounding_tables or []) if t and t.strip()]
    if not tables or ws is None:
        return user_prompt

    from ..routes.resources import pick_query_warehouse
    from ..services import table_stats

    # Prefer the cache (warmed by /grounding/scan). Lazily scan any miss so the
    # block is never empty even if the scan call was skipped or expired.
    cached = [table_stats.get_cached(ws, t) for t in tables]
    if any(s is None for s in cached):
        warehouse_id, _ = pick_query_warehouse(ws)
        if warehouse_id:
            try:
                table_stats.scan_tables(ws, tables, warehouse_id)
            except Exception as e:  # noqa: BLE001 — degrade to whatever's cached
                logger.warning("suggest: lazy table scan failed: %s", e)
        cached = [table_stats.get_cached(ws, t) for t in tables]

    scans = [s for s in cached if s is not None]
    if not scans:
        return user_prompt

    block = table_stats.render_scans_for_prompt(scans)
    signals = table_stats.render_capability_signals(scans)
    fq_names = ", ".join(s.full_name for s in scans)
    user_prompt += (
        "\n\n=== REAL UNITY CATALOG TABLES — USE THIS SCHEMA AS THE BLUEPRINT ===\n"
        f"{block}\n\n"
        "HARD CONSTRAINT: the solution is built DIRECTLY on these real tables, "
        "READ-ONLY. Every component (dashboards, Genie, metric views) queries "
        "these exact tables in place — do NOT generate synthetic data, do NOT "
        "copy the tables, and NEVER write to or modify them. Every use-case idea "
        "MUST be expressible as read-only queries over these tables + their "
        "columns; reuse the real table/column names and the entities/categories "
        "shown; do NOT invent unrelated systems or assume columns that aren't "
        f"listed. The idea's `datasources` MUST be drawn from this exact set: "
        f"{fq_names}. Ground the persona, measure/KPI, and any trend in these "
        "columns + their profiled ranges — the story is whatever the real data "
        "shows, so do NOT fabricate a spike/anomaly; lean on a real one only if "
        "the profile reveals it."
    )
    if signals:
        user_prompt += (
            "\n\n=== DATA CAPABILITY SIGNALS — RATE EACH IDEA'S FIT AGAINST THESE ===\n"
            f"{signals}"
        )
    return user_prompt


_VALID_FIT_TIERS = {"Great", "Good", "Possible"}


def _normalize_fit(raw: Any) -> dict | None:
    """Validate the LLM's per-idea `fit` object → {tier, reason} or None.

    Only the grounded ("Use existing data") flow asks for `fit`; a missing or
    malformed value yields None so the UI shows no badge rather than a broken
    one. `tier` is normalized to one of Great/Good/Possible."""
    if not isinstance(raw, dict):
        return None
    tier = str(raw.get("tier", "")).strip().capitalize()
    if tier not in _VALID_FIT_TIERS:
        return None
    reason = str(raw.get("reason", "")).strip()
    return {"tier": tier, "reason": reason}


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
        # No prompt AND no grounding tables → nothing for the LLM to story about,
        # return just caps. The GROUNDED flow ("Use existing schema") is valid
        # with an empty prompt — the picked tables' schema drives the story — so
        # don't bail then.
        if not body.prompt.strip() and not body.grounding_tables:
            yield f"event: capabilities\ndata: {json.dumps({'capabilities': always_include, 'reasoning': None})}\n\n"
            return

        # Load platform architecture for context
        platform_context = _load_platform_architecture()

        # Exclude disabled caps from the LLM's candidate pool — talking-track-only
        # governance features (data-classification, data-quality, abac) aren't
        # relevant to most demos. User can still mandate them via show-hidden.
        if body.mode == "workshop":
            # Workshop pool = the allowlist, regardless of the global `disabled`
            # flag (data-quality, abac, data-classification are disabled in story
            # mode but are workshop baseline). Excludes apps/lakebase/documents.
            available_caps = [c for c in load_capabilities() if c["id"] in WORKSHOP_CAPABILITIES]
        else:
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
            body, platform_context, mandatory_list, excluded_list, cap_list, ws
        )

        # Workshop: the idea count is fixed (cold start / refine / refresh), so
        # the LLM's count line and any extra ideas are ignored.
        fixed_count = _workshop_idea_count(body)
        ideas_sent = 0

        try:
            llm = LLMService(ws, config)

            # For refinements (single-idea rewrite) and capability-change
            # refreshes (N ideas preserved) we already know the count —
            # send it immediately so the UI renders skeletons in the right
            # shape instead of flashing 3-then-1 (or 3-then-2).
            # (Never in capabilities-only mode — there are no idea skeletons.)
            if body.capabilities_only:
                pass
            elif fixed_count is not None:
                yield f"event: count\ndata: {json.dumps({'count': fixed_count})}\n\n"
            elif body.refine_idea and body.refine_comment:
                yield f"event: count\ndata: {json.dumps({'count': 1})}\n\n"
            elif body.previous_ideas:
                yield f"event: count\ndata: {json.dumps({'count': len(body.previous_ideas)})}\n\n"

            # Stream lines from LLM. Capabilities-only answers are two short
            # JSON lines — cap tokens accordingly.
            # Grounded runs ("Use existing data") reason over the user's real
            # multi-table schema + rate each idea's fit — that's where MINI is
            # weakest, and these runs are low-volume, so use the NORMAL model.
            grounded = bool(body.grounding_tables)
            max_tokens = 600 if body.capabilities_only else (3000 if grounded else 2500)
            for line in llm.chat_stream_lines(
                user_prompt,
                system_prompt=system_prompt,
                size=ModelSize.NORMAL if grounded else ModelSize.MINI,
                max_tokens=max_tokens,
            ):
                # Redeploy in flight → stop streaming so we don't hold uvicorn's
                # graceful-shutdown drain open. This is a SYNC generator run in a
                # threadpool, so task.cancel() can't reach it — poll the flag set
                # by cancel_all_on_shutdown() on SIGTERM. See services/shutdown.py.
                if shutdown_requested():
                    return
                try:
                    data = json.loads(line)
                    event_type = data.get("type")

                    # Capabilities-only: defensively drop any story events the
                    # LLM might emit despite the prompt — the contract is
                    # capabilities (+ reasoning) only.
                    if body.capabilities_only and event_type in ("count", "idea"):
                        continue

                    if event_type == "count":
                        # Forward count event to UI (workshop: already sent)
                        if fixed_count is not None:
                            continue
                        count = data.get("count", 3)
                        yield f"event: count\ndata: {json.dumps({'count': count})}\n\n"

                    elif event_type == "idea":
                        if fixed_count is not None:
                            if ideas_sent >= fixed_count:
                                continue
                            ideas_sent += 1
                        # Parse and validate idea
                        ds = data.get("datasources", [])
                        if isinstance(ds, str):
                            ds = [s.strip() for s in ds.split(",") if s.strip()]
                        idea = {
                            "title": data.get("title", ""),
                            "hook": data.get("hook", ""),
                            "datasources": ds,
                        }
                        # Richer "why this demo is good" shown when the idea is
                        # expanded (grounded flow asks for it; optional elsewhere).
                        why = data.get("why")
                        if isinstance(why, str) and why.strip():
                            idea["why"] = why.strip()
                        # Grounded flow: forward the per-idea FIT signal (tier +
                        # one-line reason) when the model emitted a valid one. It's
                        # a consultation hint for the UI, so drop malformed values
                        # rather than surfacing a broken badge.
                        fit = _normalize_fit(data.get("fit"))
                        if fit is not None:
                            idea["fit"] = fit
                        yield f"event: idea\ndata: {json.dumps(idea)}\n\n"

                    elif event_type == "capabilities":
                        # Validate and filter capabilities
                        suggested = data.get("capabilities", [])
                        llm_selected = [cap_id for cap_id in suggested if cap_id in valid_ids and cap_id in to_decide]
                        final_selection = set(always_include + llm_selected)
                        if body.mode == "workshop":
                            # Core workshop arc stays unless the SA unselected it.
                            final_selection |= set(WORKSHOP_CORE_CAPABILITIES)
                        final_selection = list(final_selection - set(never_include))

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
