"""Templates API endpoints for the template library feature."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlmodel import func, select

from ..core import Dependencies, create_router
from ..core._config import AppConfig
from ..models import (
    CreateProjectFromTemplateRequest,
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
from ..services.llm_service import LLMService
from ..services.template_service import TemplateService
from .projects import _find_shared_warehouse, _generate_schema_name, DEFAULT_CATALOG

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

    return [
        TemplateListItem(
            id=t.id,
            name=t.name,
            status=t.status,
            owner_email=t.owner_email,
            industry=t.industry,
            description=t.description,
            capabilities=_parse_capabilities(t.capabilities),
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
        full_description=template.full_description,
        capabilities=_parse_capabilities(template.capabilities),
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
    ws: Dependencies.UserClient,
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
    ws: Dependencies.UserClient,
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
    ws: Dependencies.UserClient,
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
        full_description=template.full_description,
        capabilities=_parse_capabilities(template.capabilities),
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
    ws: Dependencies.UserClient,
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
    ws: Dependencies.UserClient,
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
            default_catalog=DEFAULT_CATALOG,
            default_schema=default_schema,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=0,
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
    ws: Dependencies.UserClient,
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
        full_description=template.full_description,
        capabilities=_parse_capabilities(template.capabilities),
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
    ws: Dependencies.UserClient,
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
        full_description=updated_template.full_description,
        capabilities=_parse_capabilities(updated_template.capabilities),
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
    ws: Dependencies.UserClient,
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
            default_catalog=DEFAULT_CATALOG,
            default_schema=default_schema,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
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
    ws: Dependencies.UserClient,
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
