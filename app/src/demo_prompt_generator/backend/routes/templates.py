"""Templates API endpoints for the template library feature."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import load_only
from sqlmodel import func, select

from ..core import Dependencies, create_router
from ..core._config import AppConfig
from ..models import (
    CreateProjectFromTemplateRequest,
    LiveDemo,
    Message,
    OfficialTemplate,
    ProjectOut,
    Template,
    TemplateContent,
    TemplateDetail,
    TemplateFile,
    TemplateFileContent,
    TemplateListItem,
    TemplateScreenshot,
    TemplateSearchResult,
    TemplateStatusUpdateRequest,
    TemplateType,
    generate_uuid,
    resource_suffix,
)
from ..services.cpu_pool import run_cpu
from ..services.llm_service import LLMService
from ..services.template_service import TemplateService
from ..services.zip_builders import ZIP_TIMEOUT_S, build_template_zip
from .projects import _find_shared_warehouse, _generate_schema_name, _resolve_unique_schema_name

router = create_router()


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


def _get_template_service(ws, config: AppConfig, engine) -> TemplateService:
    """Create a TemplateService instance."""
    llm_service = LLMService(ws, config)
    return TemplateService(engine, llm_service)


def _parse_capabilities(capabilities_json: Optional[str]) -> Optional[list[str]]:
    """Parse capabilities JSON string to list."""
    if not capabilities_json:
        return None
    try:
        return json.loads(capabilities_json)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_live_demo(live_demo_json: Optional[str]) -> Optional[LiveDemo]:
    """Parse the seeder-stored live-demo JSON (None when absent/invalid/empty)."""
    if not live_demo_json:
        return None
    try:
        live = LiveDemo.model_validate_json(live_demo_json)
    except Exception:
        return None
    return live if live.assets else None


def _build_adapt_prompt(template_name: str, instructions: str) -> str:
    """User message seeded after a fork WHEN the user gave adapt instructions.
    Framed so the agent orients itself in the cloned demo before making changes."""
    return (
        f"This project was bootstrapped from an existing template ({template_name}) — "
        "a complete, coherent demo (README story, specifications, and implementation "
        "assets like data generation, dashboard, Genie space, and any pipeline/app).\n\n"
        "Before changing anything, take a moment to read the README, the files under "
        "`specifications/`, and `resources.json` so you understand the story, the data "
        "model, and how the pieces connect.\n\n"
        "Then adapt the project per these instructions, propagating every change "
        "coherently across the story, specs, and assets (data → pipeline → dashboard → "
        "Genie/agents must stay aligned):\n\n"
        f"{instructions.strip()}"
    )


def _build_fork_greeting(template_name: str) -> str:
    """First-message greeting shown after a fork — frames the project as the user's own."""
    return (
        f"👋 I've cloned **{template_name}** into a fresh project for you — "
        "this is your own editable copy.\n\n"
        "Before I dig into the files, tell me what you'd like to adapt:\n\n"
        "- **Different industry or customer?** (e.g. \"switch from Retail to Healthcare\")\n"
        "- **Change the data model or scenarios?**\n"
        "- **Add or remove capabilities?** (Genie, dashboards, agents, pipelines)\n"
        "- **Just rename and rebrand?**\n\n"
        "Reply with what you have in mind, or say \"explain the current demo\" "
        "and I'll walk you through it first."
    )


@router.get(
    "/templates",
    response_model=list[TemplateListItem],
    operation_id="listTemplates",
)
def list_templates(
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    status: Optional[str] = None,
    industry: Optional[str] = None,
    type: Optional[str] = None,
):
    """List templates with optional filters.

    Non-admins only see APPROVED templates or their own submissions.
    Admins see all templates.
    """
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    # Load ONLY the lightweight metadata columns the list item needs — never the
    # heavy per-row columns (`screenshot` LargeBinary ~0.5–1 MB, the pgvector
    # `embedding`, `full_description`/`narrative`). A bare `select(Template)`
    # hydrates the whole row incl. those blobs for every match and throws them
    # away, which made the list slow (esp. over a remote Lakebase branch).
    # `load_only(...)` keeps `t` a real Template (so attribute access still
    # type-checks) while omitting the blobs from the SELECT. `has_screenshot`/
    # counts come from the two cheap queries below (no blobs loaded).
    # (SQLModel types model attrs as their value type, so mypy can't see them as
    #  ORM columns for load_only — the one-line call carries a single arg-type
    #  ignore; correct at runtime.)
    _list_cols = (Template.id, Template.name, Template.status, Template.owner_email, Template.industry, Template.description, Template.customer, Template.capabilities, Template.official, Template.template_type, Template.live_demo, Template.submitted_at, Template.reviewed_at)
    query = select(Template).options(load_only(*_list_cols))  # type: ignore[arg-type]

    # Always include user's own templates (for "My Templates" section)
    # Plus filter by status based on admin/non-admin permissions
    if is_admin:
        # Admins can filter by any status, but always see their own templates too
        if status:
            query = query.where(
                (Template.status == status) | (Template.owner_email == user_email)
            )
    else:
        # Non-admins see their own submissions + filtered approved templates
        if status:
            query = query.where(
                (Template.status == status) | (Template.owner_email == user_email)
            )
        else:
            query = query.where(
                (Template.status == "APPROVED") | (Template.owner_email == user_email)
            )

    if industry:
        query = query.where(Template.industry == industry)

    # Template-kind filter (SOLUTION / WORKSHOP / GENIE_WORKSHOP / ARCHITECTURE).
    # When an explicit `type` is given, filter to it (case-insensitive — stored
    # values are uppercase, so ?type=workshop and ?type=WORKSHOP both work). When
    # NOT given, exclude WORKSHOP by default — workshop training templates are
    # surfaced only via an explicit `?type=WORKSHOP` link, never in the general
    # gallery/home search.
    if type:
        query = query.where(Template.template_type == type.upper())
    else:
        query = query.where(Template.template_type != TemplateType.WORKSHOP.value)

    query = query.order_by(Template.submitted_at.desc())

    templates = session.exec(query).all()

    # `has_screenshot` without loading the ~half-MB blob per row: one cheap query
    # for the set of template_ids that have a non-null hero screenshot.
    ids_with_shot = set(session.exec(
        select(Template.id).where(Template.screenshot.isnot(None))
    ).all())
    # Extra-screenshot counts per template (one grouped query, no blobs loaded).
    extra_counts: dict[str, int] = {
        tid: n
        for tid, n in session.exec(
            select(TemplateScreenshot.template_id, func.count())
            .group_by(TemplateScreenshot.template_id)
        ).all()
    }

    return [
        TemplateListItem(
            id=t.id,
            name=t.name,
            status=t.status,
            owner_email=t.owner_email,
            industry=t.industry,
            description=t.description,
            customer=t.customer,
            capabilities=_parse_capabilities(t.capabilities),
            official=t.official,
            template_type=t.template_type,
            has_screenshot=t.id in ids_with_shot,
            screenshot_count=(1 if t.id in ids_with_shot else 0) + extra_counts.get(t.id, 0),
            has_live_demo=_parse_live_demo(t.live_demo) is not None,
            submitted_at=t.submitted_at,
            reviewed_at=t.reviewed_at,
        )
        for t in templates
    ]


@router.get(
    "/templates/official",
    response_model=list[OfficialTemplate],
    operation_id="listOfficialTemplates",
)
def list_official_templates(session: Dependencies.Session):
    """All official (curated) APPROVED templates with their details and, when the
    demo is deployed in THIS app's workspace, its live links (app, dashboard,
    Genie, pipeline, job, …). Handy for building a demo catalog. Must stay
    registered BEFORE `/templates/{template_id}` (else "official" is read as an id)."""
    cols = (Template.id, Template.name, Template.industry, Template.customer, Template.description, Template.narrative, Template.capabilities, Template.template_type, Template.live_demo)
    rows = session.exec(
        select(Template)
        .options(load_only(*cols))  # type: ignore[arg-type]  # no screenshot/embedding blobs
        .where(Template.official == True, Template.status == "APPROVED")  # noqa: E712
        .order_by(Template.industry, Template.name)
    ).all()
    ids_with_shot = set(session.exec(select(Template.id).where(Template.screenshot.isnot(None))).all())
    extra_counts: dict[str, int] = {
        tid: n
        for tid, n in session.exec(
            select(TemplateScreenshot.template_id, func.count()).group_by(TemplateScreenshot.template_id)
        ).all()
    }
    return [
        OfficialTemplate(
            id=t.id,
            name=t.name,
            industry=t.industry,
            customer=t.customer,
            description=t.description,
            narrative=t.narrative,
            capabilities=_parse_capabilities(t.capabilities),
            template_type=t.template_type,
            screenshot_url=f"/api/templates/{t.id}/screenshot" if t.id in ids_with_shot else None,
            screenshot_count=(1 if t.id in ids_with_shot else 0) + extra_counts.get(t.id, 0),
            live_demo=_parse_live_demo(t.live_demo),
        )
        for t in rows
    ]


@router.get(
    "/templates/{template_id}",
    response_model=TemplateDetail,
    operation_id="getTemplate",
)
def get_template(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Get detailed template information."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Check access: admins see all, others see APPROVED or own submissions
    if not is_admin and template.status != "APPROVED" and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="Template not found")

    # Get file count
    file_count = session.exec(
        select(func.count())
        .select_from(TemplateContent)
        .where(TemplateContent.template_id == template_id)
    ).one()

    # Total gallery images = hero (if any) + extra rows.
    extra_count = session.exec(
        select(func.count())
        .select_from(TemplateScreenshot)
        .where(TemplateScreenshot.template_id == template_id)
    ).one()
    screenshot_count = (1 if template.screenshot is not None else 0) + extra_count

    return TemplateDetail(
        id=template.id,
        name=template.name,
        status=template.status,
        owner_email=template.owner_email,
        industry=template.industry,
        description=template.description,
        narrative=template.narrative,
        customer=template.customer,
        full_description=template.full_description,
        capabilities=_parse_capabilities(template.capabilities),
        official=template.official,
        template_type=template.template_type,
        has_screenshot=template.screenshot is not None,
        screenshot_count=screenshot_count,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
        reviewed_by=template.reviewed_by,
        source_project_id=template.source_project_id,
        file_count=file_count,
        live_demo=_parse_live_demo(template.live_demo),
    )


@router.get(
    "/templates/{template_id}/files",
    response_model=list[TemplateFile],
    operation_id="listTemplateFiles",
)
def list_template_files(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Get file tree for a template."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    # Verify access
    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if not is_admin and template.status != "APPROVED" and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="Template not found")

    # Get files — the tree only needs path + size, so skip the compressed blobs.
    files = session.exec(
        select(TemplateContent)
        .options(load_only(TemplateContent.relative_path, TemplateContent.file_size))  # type: ignore[arg-type]
        .where(TemplateContent.template_id == template_id)
    ).all()

    return [
        TemplateFile(
            path=f.relative_path,
            name=Path(f.relative_path).name,
            size=f.file_size,
            is_dir=False,
        )
        for f in files
    ]


@router.get(
    "/templates/{template_id}/files/{file_path:path}",
    response_model=TemplateFileContent,
    operation_id="getTemplateFileContent",
)
def get_template_file_content(
    template_id: str,
    file_path: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
    ws: Dependencies.Client,
):
    """Get content of a specific template file."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    # Verify access
    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if not is_admin and template.status != "APPROVED" and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="Template not found")

    # Create service and get content
    template_service = _get_template_service(ws, config, request.app.state.engine)
    content = template_service.get_template_file_content(template_id, file_path, session)

    if content is None:
        raise HTTPException(status_code=404, detail="File not found")

    # Get file size
    file = session.exec(
        select(TemplateContent)
        .where(TemplateContent.template_id == template_id)
        .where(TemplateContent.relative_path == file_path)
    ).first()

    return TemplateFileContent(
        path=file_path,
        content=content,
        size=file.file_size if file else len(content),
    )


@router.get(
    "/templates/{template_id}/screenshot",
    operation_id="getTemplateScreenshot",
    responses={200: {"content": {"image/png": {}}}},
)
def get_template_screenshot(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Serve a template's hero screenshot (PNG bytes). 404 if none.

    Same visibility rule as the detail endpoint: admins see all; others see
    APPROVED templates or their own submissions."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if not is_admin and template.status != "APPROVED" and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="Template not found")
    if not template.screenshot:
        raise HTTPException(status_code=404, detail="No screenshot for this template")

    return Response(
        content=template.screenshot,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get(
    "/templates/{template_id}/screenshot/{index}",
    operation_id="getTemplateScreenshotAt",
    responses={200: {"content": {"image/png": {}}}},
)
def get_template_screenshot_at(
    template_id: str,
    index: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Serve the Nth gallery image (PNG). index 0 = the hero
    (`Template.screenshot`); index >= 1 = the extra with `ordinal == index`.
    404 if that image doesn't exist. Same visibility rule as the detail endpoint."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if not is_admin and template.status != "APPROVED" and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="Template not found")

    if index == 0:
        image = template.screenshot
    else:
        shot = session.exec(
            select(TemplateScreenshot).where(
                TemplateScreenshot.template_id == template_id,
                TemplateScreenshot.ordinal == index,
            )
        ).first()
        image = shot.image if shot else None

    if not image:
        raise HTTPException(status_code=404, detail="No screenshot at this index")

    return Response(
        content=image,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get(
    "/templates/{template_id}/export",
    operation_id="exportTemplate",
    responses={200: {"content": {"application/zip": {}}}},
)
def _load_export_entries(
    session, template_id: str, user_email: str, admin_emails: list[str]
) -> tuple[str, list[tuple[str, bytes]]]:
    """DB side of the export: visibility check, then every stored file as
    (relative_path, compressed content) sorted by path (parent-first order is
    built by the zip builder)."""
    is_admin = user_email in admin_emails

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if not is_admin and template.status != "APPROVED" and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="Template not found")

    files = session.exec(
        select(TemplateContent).where(TemplateContent.template_id == template_id)
    ).all()
    if not files:
        raise HTTPException(status_code=404, detail="Template has no files")
    entries = [
        (f.relative_path, f.content_compressed)
        for f in sorted(files, key=lambda x: x.relative_path)
    ]
    return template.id, entries


async def export_template(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Download a template as a zip — the deployable DAB bundle.

    Zips every stored TemplateContent file at its relative path. For an official
    demo the zip root has `databricks.yml` + `dab_instructions.md`, so it unzips
    into a ready-to-`databricks bundle deploy` project. Same visibility rule as
    the detail endpoint. The DB read stays on a thread; the zip (decompress +
    build) runs in the CPU pool (services/zip_builders.py)."""
    user_email = _get_user_email(headers)
    template_key, entries = await asyncio.to_thread(
        _load_export_entries, session, template_id, user_email, config.template_admin_emails
    )
    zip_bytes = await run_cpu(build_template_zip, entries, timeout=ZIP_TIMEOUT_S)
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in (template_key or "template"))
    # One body, not StreamingResponse(BytesIO), which sends a zip line by line
    # (see project_files.download_project_as_zip).
    return Response(
        zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe}.zip"'},
    )


class TemplateOfficialUpdateRequest(BaseModel):
    """Request body for toggling a template's official flag."""
    official: bool


@router.patch(
    "/templates/{template_id}/official",
    response_model=TemplateListItem,
    operation_id="updateTemplateOfficial",
)
def update_template_official(
    template_id: str,
    body: TemplateOfficialUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Toggle a template's `official` (curated) flag. Admin-only."""
    user_email = _get_user_email(headers)
    if user_email not in config.template_admin_emails:
        raise HTTPException(status_code=403, detail="Admin access required")

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.official = body.official
    session.add(template)
    session.commit()
    session.refresh(template)

    return TemplateListItem(
        id=template.id,
        name=template.name,
        status=template.status,
        owner_email=template.owner_email,
        industry=template.industry,
        description=template.description,
        customer=template.customer,
        capabilities=_parse_capabilities(template.capabilities),
        official=template.official,
        template_type=template.template_type,
        has_screenshot=template.screenshot is not None,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
    )


class SearchTemplatesRequest(BaseModel):
    """Request body for template search."""
    query: str
    limit: int = 3


@router.post(
    "/templates/search",
    response_model=list[TemplateSearchResult],
    operation_id="searchTemplates",
)
def search_templates(
    body: SearchTemplatesRequest,
    session: Dependencies.Session,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Semantic search for templates using embeddings."""
    try:
        template_service = _get_template_service(ws, config, request.app.state.engine)

        results = template_service.search_templates(
            query=body.query,
            session=session,
            limit=body.limit,
            status="APPROVED",
        )

        return [
            TemplateSearchResult(
                id=r["id"],
                name=r["name"],
                description=r["description"],
                industry=r["industry"],
                capabilities=r["capabilities"],
                similarity=r["similarity"],
            )
            for r in results
        ]
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Template search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.post(
    "/templates/from-project/{project_id}",
    response_model=TemplateDetail,
    operation_id="submitTemplateFromProject",
)
def submit_template_from_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Submit a project as a template for review."""
    user_email = _get_user_email(headers)

    template_service = _get_template_service(ws, config, request.app.state.engine)

    try:
        template = template_service.submit_template(
            project_id=project_id,
            owner_email=user_email,
            session=session,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    file_count = session.exec(
        select(func.count())
        .select_from(TemplateContent)
        .where(TemplateContent.template_id == template.id)
    ).one()

    return TemplateDetail(
        id=template.id,
        name=template.name,
        status=template.status,
        owner_email=template.owner_email,
        industry=template.industry,
        description=template.description,
        customer=template.customer,
        full_description=template.full_description,
        capabilities=_parse_capabilities(template.capabilities),
        official=template.official,
        template_type=template.template_type,
        has_screenshot=template.screenshot is not None,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
        reviewed_by=template.reviewed_by,
        source_project_id=template.source_project_id,
        file_count=file_count,
        live_demo=_parse_live_demo(template.live_demo),
    )


@router.post(
    "/templates/{template_id}/status",
    response_model=TemplateListItem,
    operation_id="updateTemplateStatus",
)
def update_template_status(
    template_id: str,
    body: TemplateStatusUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Update template status (admin only)."""
    user_email = _get_user_email(headers)

    if user_email not in config.template_admin_emails:
        raise HTTPException(status_code=403, detail="Not authorized to review templates")

    if body.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")

    template_service = _get_template_service(ws, config, request.app.state.engine)

    template = template_service.update_template_status(
        template_id=template_id,
        status=body.status,
        reviewer_email=user_email,
        session=session,
    )

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return TemplateListItem(
        id=template.id,
        name=template.name,
        status=template.status,
        owner_email=template.owner_email,
        industry=template.industry,
        description=template.description,
        customer=template.customer,
        capabilities=_parse_capabilities(template.capabilities),
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
    )


@router.post(
    "/templates/{template_id}/create-project",
    response_model=ProjectOut,
    operation_id="createProjectFromTemplate",
)
def create_project_from_template(
    template_id: str,
    body: CreateProjectFromTemplateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    config: Dependencies.Config,
):
    """Create a new project from a template."""
    user_email = _get_user_email(headers)

    # Verify template exists and is approved
    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.status != "APPROVED":
        raise HTTPException(status_code=400, detail="Template is not approved")

    # Find default resources (same as regular project creation)
    warehouse_id, warehouse_name = _find_shared_warehouse(ws)

    # Mint the project id up front so the schema carries THIS fork's per-project
    # suffix (`demo_<slug>_<sfx>`). This is the fix for the shared-schema
    # ownership war: without it every fork of the same template resolved to the
    # identical `demo_<slug>` schema and clobbered each other's pipeline/tables.
    # The suffix makes a same-template collision astronomically unlikely (a shared
    # 6-hex prefix); _resolve_unique_schema_name stays as the schema existence-check
    # backstop (mirrors the create path).
    project_id = generate_uuid()
    sfx = resource_suffix(project_id)
    base_schema = f"{_generate_schema_name(body.name)}_{sfx}"
    default_schema = _resolve_unique_schema_name(
        user_ws,
        warehouse_id=warehouse_id,
        catalog=config.default_catalog,
        base_schema=base_schema,
    )

    template_service = _get_template_service(ws, config, request.app.state.engine)

    try:
        project = template_service.create_project_from_template(
            template_id=template_id,
            project_name=body.name,
            user_email=user_email,
            session=session,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            default_catalog=config.default_catalog,
            default_schema=default_schema,
            project_id=project_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Seed the opening message. Two modes:
    #  - "tune for my use case" (adapt_instructions given) → a USER message with
    #    the adapt prompt, so the agent immediately reviews the demo + applies the
    #    changes on the first turn.
    #  - "use as is" (no instructions) → a friendly ASSISTANT greeting inviting
    #    the user to describe what to adapt (a canned message they never typed).
    adapt = (body.adapt_instructions or "").strip()
    if adapt:
        # The fork's resource suffix reaches the agent via the system prompt (its
        # schema ends with it) + resources.json, not this message.
        session.add(Message(
            project_id=project.id,
            role="user",
            content=_build_adapt_prompt(template.name, adapt),
        ))
    else:
        session.add(Message(
            project_id=project.id,
            role="assistant",
            content=_build_fork_greeting(template.name),
        ))
    session.commit()
    message_count = 1

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        customer=project.customer,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=message_count,
        file_count=0,  # Will be counted on next fetch
        source_template_id=project.source_template_id,
        source_template_name=template.name if template else None,
    )


@router.get(
    "/templates/by-project/{project_id}",
    response_model=TemplateDetail,
    operation_id="getTemplateByProject",
)
def get_template_by_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Get template linked to a project."""
    user_email = _get_user_email(headers)

    template_service = _get_template_service(ws, config, request.app.state.engine)
    template = template_service.get_template_by_project(project_id, session)

    if not template:
        raise HTTPException(status_code=404, detail="No template linked to this project")

    # Check access: must be owner or admin
    is_admin = user_email in config.template_admin_emails
    if not is_admin and template.owner_email != user_email:
        raise HTTPException(status_code=404, detail="No template linked to this project")

    # Get file count
    file_count = session.exec(
        select(func.count())
        .select_from(TemplateContent)
        .where(TemplateContent.template_id == template.id)
    ).one()

    return TemplateDetail(
        id=template.id,
        name=template.name,
        status=template.status,
        owner_email=template.owner_email,
        industry=template.industry,
        description=template.description,
        customer=template.customer,
        full_description=template.full_description,
        capabilities=_parse_capabilities(template.capabilities),
        official=template.official,
        template_type=template.template_type,
        has_screenshot=template.screenshot is not None,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
        reviewed_by=template.reviewed_by,
        source_project_id=template.source_project_id,
        file_count=file_count,
        live_demo=_parse_live_demo(template.live_demo),
    )


@router.put(
    "/templates/{template_id}/update-from-project/{project_id}",
    response_model=TemplateDetail,
    operation_id="updateTemplateFromProject",
)
def update_template_from_project(
    template_id: str,
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Update template content from project files (owner only)."""
    user_email = _get_user_email(headers)

    # Check template exists and user is owner
    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.owner_email != user_email:
        raise HTTPException(status_code=403, detail="Only the template owner can update it")

    template_service = _get_template_service(ws, config, request.app.state.engine)

    try:
        updated_template = template_service.update_template_from_project(
            template_id=template_id,
            project_id=project_id,
            session=session,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get file count
    file_count = session.exec(
        select(func.count())
        .select_from(TemplateContent)
        .where(TemplateContent.template_id == updated_template.id)
    ).one()

    return TemplateDetail(
        id=updated_template.id,
        name=updated_template.name,
        status=updated_template.status,
        owner_email=updated_template.owner_email,
        industry=updated_template.industry,
        description=updated_template.description,
        customer=updated_template.customer,
        full_description=updated_template.full_description,
        capabilities=_parse_capabilities(updated_template.capabilities),
        official=updated_template.official,
        has_screenshot=updated_template.screenshot is not None,
        submitted_at=updated_template.submitted_at,
        reviewed_at=updated_template.reviewed_at,
        reviewed_by=updated_template.reviewed_by,
        source_project_id=updated_template.source_project_id,
        file_count=file_count,
    )


@router.post(
    "/templates/{template_id}/open-project",
    response_model=ProjectOut,
    operation_id="openTemplateProject",
)
def open_template_project(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Get or create the source project for a template (owner only)."""
    user_email = _get_user_email(headers)

    # Check template exists and user is owner
    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.owner_email != user_email:
        raise HTTPException(status_code=403, detail="Only the template owner can edit it")

    # Find default resources (same as regular project creation)
    warehouse_id, warehouse_name = _find_shared_warehouse(ws)
    default_schema = _generate_schema_name(template.name)

    template_service = _get_template_service(ws, config, request.app.state.engine)

    try:
        project = template_service.get_or_create_source_project(
            template_id=template_id,
            user_email=user_email,
            session=session,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            default_catalog=config.default_catalog,
            default_schema=default_schema,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        customer=project.customer,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=0,
        file_count=0,
        source_template_id=project.source_template_id,
        source_template_name=None,
    )


class TemplateOwnerUpdateRequest(BaseModel):
    """Request body for updating template owner."""
    owner_email: str


@router.patch(
    "/templates/{template_id}/owner",
    response_model=TemplateListItem,
    operation_id="updateTemplateOwner",
)
def update_template_owner(
    template_id: str,
    body: TemplateOwnerUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Update template owner (admin only)."""
    user_email = _get_user_email(headers)

    if user_email not in config.template_admin_emails:
        raise HTTPException(status_code=403, detail="Not authorized to update template owner")

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.owner_email = body.owner_email
    session.add(template)
    session.commit()
    session.refresh(template)

    return TemplateListItem(
        id=template.id,
        name=template.name,
        status=template.status,
        owner_email=template.owner_email,
        industry=template.industry,
        description=template.description,
        customer=template.customer,
        capabilities=_parse_capabilities(template.capabilities),
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
    )


@router.delete(
    "/templates/{template_id}",
    operation_id="deleteTemplate",
)
def delete_template(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Delete a template (admin or owner only)."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    template = session.exec(
        select(Template).where(Template.id == template_id)
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Only admin or owner can delete
    if not is_admin and template.owner_email != user_email:
        raise HTTPException(status_code=403, detail="Not authorized to delete this template")

    template_service = _get_template_service(ws, config, request.app.state.engine)
    template_service.delete_template(template_id, session)

    return {"success": True, "deleted_template_id": template_id}
