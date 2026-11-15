"""The opening message of a new project, for callers with no browser (the MCP routes).

The home page builds this text in the browser (`ui/routes/index.tsx`
handleCreateProject + `ui/lib/auto-build-prompt.ts`). This is the same text for
its three main entries, with the home page's defaults: story (auto-build, Simple
capabilities), architecture (architecture-first, one diagram style) and workshop
(Simple workshop). No uploads, no grounding tables, no picked idea.
`tests_backend/test_mcp_routes.py` checks the strings against the TypeScript, so a
change there fails until it's made here too.
"""

from __future__ import annotations

from typing import Literal

from ..core.constants import WORKSHOP_CAPABILITIES

Mode = Literal["story", "architecture", "workshop"]

# ui/lib/auto-build-prompt.ts AUTO_BUILD_KICKOFF
AUTO_BUILD_KICKOFF = """Auto-build mode. Follow DEMO_SKILL stages 0→3 end-to-end without pausing at the gates. Stage 4 (DAB) only if the user later asks for it.

Choose sensible defaults instead of asking. Batch independent reads and independent writes in the same turn. Don't narrate — let the tool calls speak. Surface a message only on a hard error you can't recover from, or as the final summary with workspace links.

Write specifications directly — don't think too long about them. Spec files are working drafts that get refined during build, not finished essays. Skip the deliberation, write the file, move on. The build stage will surface anything that doesn't work."""

# ui/lib/auto-build-prompt.ts BRAND_NOTE
BRAND_NOTE = "Note: don't search the web for the company's brand — we resolve it for you and populate `brand/brand.json` (palette, logo, site). If it's there, read it to personalize the demo; if not, don't fetch it."

# ui/lib/auto-build-prompt.ts DIAGRAM_STYLES, without `match` (it needs an uploaded image).
DIAGRAM_STYLES: dict[str, dict[str, str]] = {
    "marketing": {"label": "Marketing", "blurb": "Deck-ready story: few words, big tiles", "meaning": "a deck-ready Databricks story with catalog tiles and composites, few words", "read": "reference/style-marketing.md and its example reference/architecture-complete.jsonc"},
    "technical": {"label": "Technical", "blurb": "Named jobs, tables, keys and write modes", "meaning": "detailed engineering cards with named jobs and tables, key/value rows and tag pills, current vs proposed", "read": "reference/style-technical.md and its example reference/style-technical.jsonc"},
    "lifecycle": {"label": "Lifecycle", "blurb": "Process stages with numbered steps", "meaning": "process stages as columns, each a titled box with a pictogram and stacked items", "read": "reference/style-lifecycle.md and its example reference/style-lifecycle.jsonc"},
    "networking": {"label": "Networking", "blurb": "Account, region, VPC, PrivateLink", "meaning": "cloud topology: account, region, VPC and subnets, PrivateLink, control vs data plane", "read": "reference/style-networking.md and its example reference/style-networking.jsonc"},
}
DEFAULT_DIAGRAM_STYLE = "marketing"

# ui/components/capabilities-panel.tsx SIMPLE_BASELINE: the story tab's default selection.
STORY_DEFAULT_CAPABILITIES = [
    "synthetic-data-gen", "aibi-dashboards", "genie",
    "unity-catalog", "lakeflow-connect", "genie-one", "genie-code",
]
# ui/components/capabilities-panel.tsx WORKSHOP_SIMPLE: the workshop pool without Feature Store and ML.
WORKSHOP_DEFAULT_CAPABILITIES = sorted(WORKSHOP_CAPABILITIES - {"feature-store", "ml-training-serving"})

# The backend writes context/source-brief.md from this length (routes/projects.py).
SOURCE_BRIEF_MIN_CHARS = 280


def architecture_first_prompt(request: str, style: str | None = None) -> str:
    """ui/lib/auto-build-prompt.ts buildArchitectureFirstPrompt."""
    base = (
        "The user wants to START by creating an architecture diagram (architecture-first flow) — review it before building.\n\n"
        "What they wrote (may be a tidy brief OR pasted notes / a transcript — extract the intent + use-case from it):\n"
        f"{request}"
        "\n\nFirst read the architecture skill, `.claude/skills/databricks-architecture/SKILL.md` (NOT the solution-builder SKILL.md). Then design a coherent architecture that functionally solves the use-case, following its section 2 (design rules) and the guide for the kind you choose. If the user uploaded a diagram (an image, screenshot or exported drawing), redraw THAT diagram faithfully — same components, connections, labels and grouping — following `reference/redraw.md`, not a canonical template. Base the diagram on the request ABOVE — `resources.json` is empty at this stage, it is NOT the spec, do not read it and reproduce a canonical diagram from it. Write ONLY `architecture.md` at the project root. Do not write specs or build resources yet. Fill the tab `story` only with reader-facing context and out-of-scope items. Then produce the diagram and stop so the user can review and edit it on the Architecture tab."
    )
    s = DIAGRAM_STYLES.get(style or "")
    if not s:
        return base
    return (
        base
        + f"\n\nDiagram style: {s['label']} — {s['meaning']}. Read it together with SKILL.md, in one batch of parallel Read calls: {s['read']} (paths under .claude/skills/databricks-architecture/). Follow them."
    )


def capabilities_line(capabilities: list[str]) -> str:
    if not capabilities:
        return ""
    return f"\n\nUse these capabilities within the solution: {', '.join(capabilities)} (do not add extra unless it's a strict missing dependency)"


def opening_prompt(mode: Mode, request: str, capabilities: list[str], style: str | None = None) -> str:
    """The first user message, as handleCreateProject writes it for this entry."""
    caps = capabilities_line(capabilities)
    if mode == "architecture":
        prompt = architecture_first_prompt(request, style)
    elif mode == "workshop":
        prompt = (
            "Build a Genie Code workshop for this story (not a standard built demo).\n\n"
            f"User request:\n{request}{caps}\n\n"
            "Read `DEMO_SKILL` and follow flow B (Genie Code workshop → "
            "`DEMO_SKILL_DIR/stages/genie-workshop.md`) end to end instead of the stages: "
            "write the story (README.md), the specifications and CONTEXT.md, "
            "the data generation and its test, and finally `notebooks_html/workshop.html`. "
            "Run straight through with NO approval gates — choose sensible defaults instead of asking. "
            "Do NOT provision the demo's Databricks resources (no pipelines, dashboards, Genie spaces, "
            "apps or jobs); the only workspace action allowed is the data-generation test into the "
            "project's default schema described there."
        )
    else:
        prompt = f"Help me build a databricks solution.\n\nSolution description:\n{request}{caps}"

    if len(request) >= SOURCE_BRIEF_MIN_CHARS:
        prompt += (
            "\n\nThe user's full brief is saved verbatim at "
            "`context/source-brief.md`. It is the authoritative statement of "
            "intent — read it first and preserve its specifics (names, numbers, "
            "entities, requirements, phrasing) end-to-end. Do NOT dilute it into "
            "a shorter summary; whatever you produce should reflect everything the "
            "user actually asked for."
        )
        if mode == "workshop":
            prompt += (
                " For the workshop pages this means the brief's names, numbers and steps; "
                "the page copy itself stays short (a line or two per step)."
            )
    prompt += f"\n\n{BRAND_NOTE}"
    # Architecture-first stops after the diagram; a workshop has its own flow.
    if mode == "story":
        prompt += f"\n\n---\n\n{AUTO_BUILD_KICKOFF}"
    return prompt


def project_description(mode: Mode, request: str, capabilities: list[str]) -> str:
    """handleCreateProject's `description` (the backend names the project from it)."""
    if mode != "architecture" and capabilities:
        return f"{request}\n\nSelected capabilities: {', '.join(capabilities)}"
    return request
