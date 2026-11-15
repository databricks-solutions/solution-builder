"""/api/mcp/* — what a trusted MCP server calls to build in Solution Builder for a user.

The MCP server holds the connection and the user's identity; it calls these routes as
its own service principal and names the user in `X-MCP-Caller-Email`. Deployed, the header is honored
only from `MCP_CALLER_SP_ID`, and the request then runs as that user: they own the
project and its resources, exactly as if they had used the home page. Locally the
header is accepted as is (no service principal to check).

Three routes, kept small on purpose:
- `GET  /mcp/guide[?mode=]` — Markdown for the agent: the overview (which kind to pick), or one
                        kind's guide with its options, read live from the home page's sources.
- `POST /mcp/create` — a solution, an architecture or a workshop, from one
                        request, started like the home page starts it; answers the link.
- `GET  /mcp/projects` — the user's projects (list, `query` search), or one (`id`): where
                        it stands and the links to what it deployed.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime
from typing import Annotated, Literal

from fastapi import BackgroundTasks, Depends, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlmodel import or_, select

from ..core import Dependencies, create_router
from ..core._config import logger
from ..core._headers import DatabricksAppsHeaders, HeadersDependency
from ..core.constants import WORKSHOP_CAPABILITIES, get_capabilities
from ..models import (
    CapabilityBuildStatus,
    DeployedResourceLink,
    InvokeAgentRequest,
    Message,
    Project,
    ProjectCreateRequest,
    ProjectShare,
    ShareStatus,
)
from ..services import opening_prompt
from ..services.active_stream import get_stream_manager
from ..services.workspace_scan import Detail, scan_prompt
from .agent import invoke_agent
from .project_files import get_deployed_resources
from .projects import _deploy_target, _get_authorized_project, create_project

router = create_router()

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _caller_sp(*values: str | None) -> str | None:
    """The calling service principal's application id, as the Apps proxy names it: a
    bare UUID or the tail of `workspaces/<id>/apps/<uuid>`. A user's email never is one."""
    for raw in values:
        raw = (raw or "").strip().lower()
        sp = raw.rsplit("/", 1)[-1]
        if _UUID.match(sp):
            return sp
    return None


def _deployed(proxy_email: str | None) -> bool:
    # Fail closed: a proxy header OR the Apps runtime both mean deployed.
    return bool(proxy_email) or bool(os.environ.get("DATABRICKS_APP_NAME"))


def mcp_caller(
    headers: HeadersDependency,
    config: Dependencies.Config,
    caller_email: Annotated[str | None, Header(alias="X-MCP-Caller-Email")] = None,
    proxy_email: Annotated[str | None, Header(alias="X-Forwarded-Email")] = None,
    proxy_username: Annotated[str | None, Header(alias="X-Forwarded-Preferred-Username")] = None,
) -> DatabricksAppsHeaders:
    """The headers of the user the MCP server named, for the routes below to act as."""
    want = (caller_email or "").strip().lower()
    if not _deployed(proxy_email):
        # Local: open. Without the header, the dev user (as everywhere else).
        if not want:
            return headers
        if not _EMAIL.match(want):
            raise HTTPException(400, "X-MCP-Caller-Email must be an email")
        return headers.model_copy(update={"user_email": want})

    caller = _caller_sp(proxy_email, proxy_username)
    trusted = (config.mcp_caller_sp_id or "").strip().lower()
    if not trusted or caller != trusted:
        # Refused, not ignored: going on as the caller would make the project a service principal's.
        logger.warning(f"[mcp] refused call from {caller or 'a caller that is not a service principal'}")
        raise HTTPException(401, "Only the trusted MCP service principal (MCP_CALLER_SP_ID) may call /api/mcp")
    if not want:
        raise HTTPException(401, "Name the user in X-MCP-Caller-Email")
    if not _EMAIL.match(want):
        raise HTTPException(400, "X-MCP-Caller-Email must be an email")
    # The MCP server's own token is dropped: it must never become the identity a build runs as.
    return headers.model_copy(update={"user_email": want, "user_name": want, "token": None, "delegated_by": caller})


McpCaller = Annotated[DatabricksAppsHeaders, Depends(mcp_caller)]


def _project_url(request: Request, project_id: str, mode: str) -> str:
    host = request.headers.get("x-forwarded-host")
    base = f"https://{host}" if host else str(request.base_url).rstrip("/")
    tab = {"architecture": "?tab=architecture", "workshop": "?tab=workshop"}.get(mode, "")
    return f"{base}/project/{project_id}{tab}"


Mode = Literal["story", "architecture", "workshop"]

OVERVIEW = """# Solution Builder, through MCP

Solution Builder turns a request into a Databricks demo, one of three kinds (its home page's):

- **story** — a full solution: the agent writes the story and specs, then builds every Databricks
  resource (data, pipeline, dashboard, Genie, app…) end to end, without stopping. ~20-40 min.
- **architecture** — an architecture diagram only, for the user to review and edit; nothing is
  built. A few minutes. The user builds from it later in Solution Builder.
- **workshop** — a Genie Code workshop: one HTML page of prompts an attendee follows to build the
  solution live, plus its data. ~15-30 min.

Pick the kind from what the user asked for (a demo to show → story; "draw / diagram / architecture"
→ architecture; a hands-on session or workshop → workshop), then read that kind's guide:
`GET /api/mcp/guide?mode=<kind>`. It has the options and how to create it.

The user's existing projects (theirs and shared with them, newest first):
`GET /api/mcp/projects`, or `?query=<words>` to search name, description and customer. Each has
its `url`. `?id=<project_id>` gives one project, where it stands and `resources`: the links to
what it deployed (app, dashboard, Genie…), to give the user.

Before creating anything, the kind's guide asks you to gather the context from the sources you
can reach (Salesforce, Slack, email, docs…) and confirm a summary with the user. Don't create from
a one-line ask.
"""

_CREATE = """## 4. Create it

`POST /api/mcp/create` `{{"mode": "{mode}", "request": "…"{extra}}}`

- `request`: the brief from step 2.
{extra_doc}
It starts at once and answers with `url`: give the user that link. The project is theirs: they own
it and everything it builds. To change anything afterwards, they continue in Solution Builder there.

`GET /api/mcp/projects?id=<project_id>`: `running`, `stage`, the agent's last message, and
`resources`, the links to what it deployed (app, dashboard, Genie…). {timing}: don't poll in a loop,
give the link and check when the user asks.
"""

# What to gather before creating, per kind. The agent's `request` is all the build agent
# gets (a long one is kept verbatim as its brief), so it must carry the real context.
_SOURCES = """Look in every source you can reach, for this user and this customer: the Salesforce account
and its use cases (UCOs: stage, products, blockers), Slack channels and threads about the account,
emails, meeting notes and call transcripts, docs and decks (Google Drive, Glean), and any knowledge
catalog. Note where each fact comes from."""

_GATHER = {
    "story": """Find:
- **The customer**: name, industry, what they do, who the demo is for (exec, data team, business users).
- **The use case**: the business problem, the decision or workflow it changes, the outcome they want
  (numbers if any were discussed).
- **Their data**: the systems and data sources they named (ERP, CRM, IoT, files…), tables or entities
  that matter, volumes, real-time vs batch.
- **What to show**: products discussed or being evaluated, what they compare us with, objections.
- **The audience**: personas who will use the demo, and the questions they'd ask (Genie questions,
  dashboard KPIs).""",
    "architecture": """Find:
- **The customer**: name, industry, cloud (AWS / Azure / GCP), and their current platform.
- **Today's architecture**: the systems they run and how data moves between them (sources, ETL,
  warehouse, BI, ML, apps), and what hurts (cost, latency, silos, governance).
- **The target**: what Databricks replaces or adds, which products were discussed, integrations that
  must stay (Snowflake, Kafka, SAP, Power BI…), networking or security constraints (PrivateLink,
  regions, compliance).
- **The use case it serves**, so the diagram tells one story rather than listing every product.
- **An existing diagram**: if a drawing exists (a deck slide, a whiteboard), describe it in detail:
  boxes, groups, arrows and labels.""",
    "workshop": """Find:
- **The audience**: who attends (analysts, data engineers, business users), how many, their skill
  level with Databricks, and how long the session is.
- **The story**: the customer or industry the exercises should feel like, and the business problem
  the attendees will solve.
- **What they must leave knowing**: the products to cover (pipelines, dashboards, Genie, ML…), and
  anything to avoid.""",
}

_PREPARE = """## 1. Gather the context first

Don't create from the user's one-line ask: a demo built on the real context is the point.
{sources}

{gather}

Never invent a fact about the customer: what you didn't find, leave out or ask the user.
If nothing names a use case (an industry and a problem at least), ask the user before going on.

## 2. Write the request

`request` is all Solution Builder's agent gets, and it is kept verbatim: write it as a brief, not a
one-liner. Structure it with the headings above, in plain sentences, with the specifics you found
(names, systems, numbers, products, personas), and end with a line on the sources you used. A few
paragraphs is right; a page is fine.

## 3. Confirm with the user

Show the user a short summary (the customer, the use case, {confirm}) and wait for their OK or
corrections. {confirm_why}
"""

_CONFIRM = {
    "story": ("the data and what will be built", "The build provisions real Databricks resources and runs for 20-40 minutes."),
    "architecture": ("the systems and the target", "So the diagram shows their architecture, not a generic one."),
    "workshop": ("the audience and the topics", "The workshop's story and exercises follow from it."),
}


_INTRO = {
    "story": "# Story: a full solution, built end to end\n\nThe agent writes the story and the specs, then builds every Databricks resource without stopping. ~20-40 min.\n",
    "architecture": "# Architecture: a diagram to review before building\n\nThe agent draws the architecture diagram only; nothing is built. The user reviews and edits it, then builds from it in Solution Builder.\n",
    "workshop": "# Workshop: a Genie Code workshop\n\nOne HTML page of prompts an attendee follows to build the solution live in Genie Code, plus its generated data. No Databricks resources are provisioned.\n",
}


def _mode_capabilities(mode: str) -> list[dict]:
    """The capabilities a mode offers. The workshop pool also holds a few blocks the
    home-page picker hides (abac, notebooks-eda…), as the home page's workshop does."""
    if mode == "workshop":
        return [c for c in get_capabilities() if c["id"] in WORKSHOP_CAPABILITIES]
    if mode == "story":
        return [c for c in get_capabilities() if not c.get("disabled")]
    return []


def _default_capabilities(mode: str) -> list[str]:
    return list({"story": opening_prompt.STORY_DEFAULT_CAPABILITIES,
                 "workshop": opening_prompt.WORKSHOP_DEFAULT_CAPABILITIES}.get(mode, []))


def guide_text(mode: Mode | None) -> str:
    """The overview, or one mode's guide with its options (read live, as the home page does)."""
    if mode is None:
        return OVERVIEW
    if mode == "architecture":
        styles = "\n".join(
            f"- `{k}`{' (default)' if k == opening_prompt.DEFAULT_DIAGRAM_STYLE else ''}: {v['blurb']}"
            for k, v in opening_prompt.DIAGRAM_STYLES.items()
        )
        options = f"## Diagram styles\n\n{styles}\n"
        options += ("\n## From an existing project\n\nTo draw a project that already runs in a workspace (a pipeline, job, dashboard, app…), "
                    "don't describe it from memory: `GET /api/mcp/scan-prompt?workspace=<url>&start=<resource url or name>&detail=high|detailed` "
                    "returns the steps to explore it read-only with the Databricks CLI and write the brief, with every resource and its link. "
                    "Run them where the CLI can reach that workspace, then create the architecture with the brief as `request`.\n")
        extra, extra_doc, timing = ', "style": "marketing"', "- `style`: one of the styles above. Omit for `marketing`.\n", "It takes a few minutes"
    else:
        defaults = set(_default_capabilities(mode))
        rows = "\n".join(
            f"| `{c['id']}` | {c['name']} | {c['category']} | {'yes' if c['id'] in defaults else ''} |"
            for c in _mode_capabilities(mode)
        )
        options = f"## Capabilities\n\n| id | name | category | default |\n|---|---|---|---|\n{rows}\n"
        extra = ', "capabilities": ["…"]'
        extra_doc = ("- `capabilities`: ids from the table. Omit for the defaults (the home page's \"Simple\" set);\n"
                     "  pass them only when the user asked for specific products. The list is exactly what gets built.\n")
        timing = "A build runs for many minutes" if mode == "story" else "It runs for 15-30 minutes"
    prepare = _PREPARE.format(sources=_SOURCES, gather=_GATHER[mode], confirm=_CONFIRM[mode][0], confirm_why=_CONFIRM[mode][1])
    return f"{_INTRO[mode]}\n{prepare}\n{options}\n{_CREATE.format(mode=mode, extra=extra, extra_doc=extra_doc, timing=timing)}"


@router.get("/mcp/scan-prompt", response_class=PlainTextResponse, operation_id="mcpScanPrompt")
def mcp_scan_prompt(_caller: McpCaller, workspace: str | None = None, start: str | None = None, detail: Detail = "high") -> str:
    return scan_prompt(workspace, start, detail)


@router.get("/mcp/guide", response_class=PlainTextResponse, operation_id="mcpGuide")
def mcp_guide(_caller: McpCaller, mode: Mode | None = None) -> str:
    return guide_text(mode)


class McpCreateIn(BaseModel):
    mode: Mode = "story"
    request: str = Field(..., min_length=1, description="What the user asked for, in their words.")
    capabilities: list[str] | None = Field(None, description="story/workshop: capability ids (GET /mcp/guide?mode=…). Omit for the defaults.")
    style: str | None = Field(None, description="architecture: a diagram style id (GET /mcp/guide?mode=architecture).")


class McpProject(BaseModel):
    project_id: str
    name: str
    mode: str
    stage: str
    owner: str
    # Caller's access when the project is shared with them ('viewer' | 'editor'); None when theirs.
    shared_role: str | None = None
    updated_at: datetime | None = None
    running: bool
    url: str


class McpProjectDetail(McpProject):
    last_message: str | None = None
    # What's deployed, with the links to open it (the UI's resource grid).
    resources: list[DeployedResourceLink] = Field(default_factory=list)
    capabilities: list[CapabilityBuildStatus] = Field(default_factory=list)
    all_built: bool = False
    extraction_error: str | None = None


class McpProjectList(BaseModel):
    projects: list[McpProject]
    total: int


def _item(request: Request, project: Project, shared_role: str | None = None) -> McpProject:
    return McpProject(
        project_id=project.id,
        name=project.name,
        mode=project.mode,
        stage=project.stage,
        owner=project.user_email,
        shared_role=shared_role,
        updated_at=project.updated_at,
        running=get_stream_manager().get_project_stream(project.id) is not None,
        url=_project_url(request, project.id, project.mode),
    )


def _capabilities(body: McpCreateIn) -> list[str]:
    if body.mode == "architecture":
        return []  # the home page sends none: the agent takes the components from the request
    if not body.capabilities:
        return _default_capabilities(body.mode)
    allowed = {c["id"] for c in _mode_capabilities(body.mode)}
    unknown = [c for c in body.capabilities if c not in allowed]
    if unknown:
        raise HTTPException(400, f"Unknown capabilities for {body.mode}: {', '.join(unknown)} (GET /api/mcp/guide?mode={body.mode} lists them)")
    return list(dict.fromkeys(body.capabilities))


@router.post("/mcp/create", response_model=McpProject, operation_id="mcpCreate")
async def mcp_create(
    body: McpCreateIn,
    request: Request,
    caller: McpCaller,
    session: Dependencies.Session,
    ws: Dependencies.Client,
    config: Dependencies.Config,
    background_tasks: BackgroundTasks,
) -> McpProject:
    """Create the project and start its first agent turn, as the home page does."""
    if body.style and body.style not in opening_prompt.DIAGRAM_STYLES:
        raise HTTPException(400, f"Unknown style {body.style!r}: one of {', '.join(opening_prompt.DIAGRAM_STYLES)}")
    request_text = body.request.strip()
    capabilities = _capabilities(body)
    email = caller.user_email or ""

    # Deployed, an MCP call has no token of the user's: it can only build as the
    # deployer SP in a remote target workspace. Without one, refuse before creating anything.
    if caller.delegated_by and not await asyncio.to_thread(_deploy_target, session, email, config):
        raise HTTPException(409, "This Solution Builder has no remote deploy target, so it can't build for a user without their own session")

    style = (body.style or opening_prompt.DEFAULT_DIAGRAM_STYLE) if body.mode == "architecture" else None
    prompt = opening_prompt.opening_prompt(body.mode, request_text, capabilities, style)
    create_body = ProjectCreateRequest(
        description=opening_prompt.project_description(body.mode, request_text, capabilities),
        capabilities=capabilities,
        initial_prompt=prompt,
        architecture_first=body.mode == "architecture",
        mode=body.mode,
        source_brief=request_text,
    )
    # The app SP stands in for the OBO client: there is no user token on this path.
    project = await asyncio.to_thread(
        create_project, create_body, session, caller, request, ws, ws, config, background_tasks
    )
    # The page would start the turn when the user opens it; nobody opens it here.
    await invoke_agent(
        InvokeAgentRequest(project_id=project.id, message=prompt, save_user_message=False),
        session, caller, config, request,
    )
    logger.info(f"[mcp] created {body.mode} project {project.id} for {email} via {caller.delegated_by or 'local'}")
    return McpProject(
        project_id=project.id,
        name=project.name,
        mode=body.mode,
        stage=project.stage,
        owner=email,
        updated_at=project.updated_at,
        running=True,
        url=_project_url(request, project.id, body.mode),
    )


@router.get("/mcp/projects", response_model=McpProjectDetail | McpProjectList, operation_id="mcpProjects")
def mcp_projects(
    request: Request,
    caller: McpCaller,
    session: Dependencies.Session,
    config: Dependencies.Config,
    ws: Dependencies.Client,
    id: str | None = None,
    query: str | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> McpProjectDetail | McpProjectList:
    """The user's projects (theirs and those shared with them), newest first; `query`
    searches name, description and customer. With `id`: that project, where it stands
    and the links to what it deployed."""
    email = caller.user_email or ""
    if id:
        project = _get_authorized_project(session, id, email, config.template_admin_emails)
        # The same call the UI's resource grid makes: links into the workspace the
        # project deployed to, build status per capability, and the stage refresh.
        deployed = get_deployed_resources(id, session, caller, config, ws, request)
        session.refresh(project)
        last = session.exec(
            select(Message)
            .where(Message.project_id == id, Message.role == "assistant")
            .order_by(Message.created_at.desc())  # type: ignore[attr-defined]
            .limit(1)
        ).first()
        return McpProjectDetail(
            **_item(request, project).model_dump(),
            last_message=(last.content[:4000] if last else None),
            resources=[r for r in deployed.resources if r.url],
            capabilities=deployed.capabilities,
            all_built=deployed.all_built,
            extraction_error=deployed.extraction_error,
        )

    shares = {
        s.project_id: s.role
        for s in session.exec(
            select(ProjectShare).where(
                ProjectShare.shared_with_email == email,
                ProjectShare.status == ShareStatus.ACCEPTED.value,
            )
        ).all()
    }
    stmt = select(Project).where(or_(Project.user_email == email, Project.id.in_(list(shares))))  # type: ignore[attr-defined]
    if query and query.strip():
        like = f"%{query.strip()}%"
        stmt = stmt.where(or_(
            Project.name.ilike(like),  # type: ignore[attr-defined]
            Project.description.ilike(like),  # type: ignore[union-attr]
            Project.customer.ilike(like),  # type: ignore[union-attr]
        ))
    projects = session.exec(stmt.order_by(Project.updated_at.desc())).all()  # type: ignore[attr-defined]
    return McpProjectList(
        projects=[_item(request, p, None if p.user_email == email else shares.get(p.id)) for p in projects[:limit]],
        total=len(projects),
    )
