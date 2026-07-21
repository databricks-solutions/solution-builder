"""Templates API endpoints for the template library feature."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import func, select

from ..core import Dependencies, create_router
from ..core._config import AppConfig
from ..models import (
    CreateProjectFromTemplateRequest,
    Message,
    ProjectOut,
    Template,
    TemplateContent,
    TemplateDetail,
    TemplateFile,
    TemplateFileContent,
    TemplateListItem,
    TemplateSearchResult,
    TemplateStatusUpdateRequest,
)
from ..services.file_sync import decompress_content
from ..services.llm_service import LLMService
from ..services.template_service import TemplateService
from .projects import _find_shared_warehouse, _generate_schema_name

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
):
    """List templates with optional filters.

    Non-admins only see APPROVED templates or their own submissions.
    Admins see all templates.
    """
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

    query = select(Template)

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

    query = query.order_by(Template.submitted_at.desc())

    templates = session.exec(query).all()

    # `has_screenshot` without loading the ~half-MB blob per row: one cheap query
    # for the set of template_ids that have a non-null screenshot.
    ids_with_shot = set(session.exec(
        select(Template.id).where(Template.screenshot.isnot(None))
    ).all())

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
            has_screenshot=t.id in ids_with_shot,
            submitted_at=t.submitted_at,
            reviewed_at=t.reviewed_at,
        )
        for t in templates
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
        has_screenshot=template.screenshot is not None,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
        reviewed_by=template.reviewed_by,
        source_project_id=template.source_project_id,
        file_count=file_count,
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

    # Get files
    files = session.exec(
        select(TemplateContent).where(TemplateContent.template_id == template_id)
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
    "/templates/{template_id}/export",
    operation_id="exportTemplate",
    responses={200: {"content": {"application/zip": {}}}},
)
def export_template(
    template_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Download a template as a zip — the deployable DAB bundle.

    Zips every stored TemplateContent file at its relative path. For an official
    demo the zip root has `databricks.yml` + `dab_instructions.md`, so it unzips
    into a ready-to-`databricks bundle deploy` project. Same visibility rule as
    the detail endpoint."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails

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

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            try:
                zf.writestr(f.relative_path, decompress_content(f.content_compressed))
            except Exception:
                # Skip an unreadable file rather than fail the whole download.
                continue
    zip_buffer.seek(0)

    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in (template.id or "template"))
    return StreamingResponse(
        zip_buffer,
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
        has_screenshot=template.screenshot is not None,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
        reviewed_by=template.reviewed_by,
        source_project_id=template.source_project_id,
        file_count=file_count,
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
    default_schema = _generate_schema_name(body.name)

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
        has_screenshot=template.screenshot is not None,
        submitted_at=template.submitted_at,
        reviewed_at=template.reviewed_at,
        reviewed_by=template.reviewed_by,
        source_project_id=template.source_project_id,
        file_count=file_count,
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
