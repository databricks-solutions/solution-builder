"""Projects CRUD endpoints."""

from __future__ import annotations

import re
import shutil
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlmodel import func, select, text

from ..core import Dependencies, create_router
from ..core._config import logger
from ..services.llm_service import LLMService
from ..models import (
    Message,
    Project,
    ProjectCreateRequest,
    ProjectFile,
    ProjectListItem,
    ProjectOut,
    ProjectResourcesUpdateRequest,
    ProjectShare,
    ProjectShareOut,
    ProjectShareRequest,
    ProjectStar,
    ProjectUpdateRequest,
    Template,
    compute_project_stage,
)
from ..services.file_sync import FileSyncService
from ..services.skills_manager import (
    create_project_directory,
    ensure_project_skills,
    get_project_directory,
)
from .resources import list_clusters, list_warehouses

router = create_router()

# Default resource settings
DEFAULT_CATALOG = "ai_demo_gen"
DEFAULT_SCHEMA_PREFIX = "demo_"


def _find_shared_warehouse(ws) -> tuple[str | None, str | None]:
    """Find a warehouse with 'shared' in the name (uses cached list).

    Returns (warehouse_id, warehouse_name) tuple.
    """
    try:
        warehouses = list_warehouses(ws)
        for w in warehouses:
            if "shared" in w.name.lower():
                logger.info(f"Found shared warehouse: {w.name} ({w.id})")
                return w.id, w.name
    except Exception as e:
        logger.warning(f"Failed to find shared warehouse: {e}")
    return None, None


def _find_shared_cluster(ws) -> tuple[str | None, str | None]:
    """Find a cluster with 'shared' in the name (uses cached list).

    Returns (cluster_id, cluster_name) tuple.
    Returns (None, None) if no shared cluster found - cluster is optional.
    """
    try:
        clusters = list_clusters(ws)
        for c in clusters:
            if "shared" in c.name.lower():
                logger.info(f"Found shared cluster: {c.name} ({c.id})")
                return c.id, c.name
        logger.info("No shared cluster found, leaving cluster_id empty")
    except Exception as e:
        logger.warning(f"Failed to find shared cluster: {e}")
    return None, None


def _generate_schema_name(project_name: str) -> str:
    """Generate a valid schema name from project name."""
    # Convert to lowercase, replace non-alphanumeric with underscore
    clean_name = re.sub(r"[^a-z0-9]+", "_", project_name.lower())
    # Remove leading/trailing underscores
    clean_name = clean_name.strip("_")
    # Limit length
    clean_name = clean_name[:50]
    return f"{DEFAULT_SCHEMA_PREFIX}{clean_name}"


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


def _resolve_template_name(session, source_template_id: str | None) -> str | None:
    """Look up the template name for a source_template_id, if set."""
    if not source_template_id:
        return None
    template = session.get(Template, source_template_id)
    return template.name if template else None


def _get_user_project(session, project_id: str, user_email: str) -> Project:
    """Fetch a project by ID, verifying ownership."""
    row = session.get(Project, project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    if row.user_email != user_email:
        raise HTTPException(status_code=404, detail="Project not found")
    return row


@router.get(
    "/projects",
    response_model=list[ProjectListItem],
    operation_id="listProjects",
)
def list_projects(session: Dependencies.Session, headers: Dependencies.Headers):
    """Return the current user's projects, newest first."""
    user_email = _get_user_email(headers)

    # Get user's starred project IDs
    starred_ids = set(
        session.exec(
            select(ProjectStar.project_id).where(ProjectStar.user_email == user_email)
        ).all()
    )

    # Get projects with counts
    stmt = (
        select(Project)
        .where(Project.user_email == user_email)
        .order_by(Project.created_at.desc())
    )
    projects = session.exec(stmt).all()

    # Batch-resolve template names for projects created from templates
    template_ids = {p.source_template_id for p in projects if p.source_template_id}
    template_name_map: dict[str, str] = {}
    if template_ids:
        templates = session.exec(
            select(Template).where(Template.id.in_(template_ids))  # type: ignore[attr-defined]
        ).all()
        template_name_map = {t.id: t.name for t in templates}

    # Batch-load file paths and counts for all projects in one query
    project_ids = [p.id for p in projects]
    files_by_project: dict[str, list[str]] = {pid: [] for pid in project_ids}
    if project_ids:
        rows = session.exec(
            select(ProjectFile.project_id, ProjectFile.relative_path)
            .where(ProjectFile.project_id.in_(project_ids))  # type: ignore[attr-defined]
        ).all()
        for pid, path in rows:
            files_by_project[pid].append(path)

    result = []
    for p in projects:
        # Get message count
        msg_count = session.exec(
            select(func.count()).select_from(Message).where(Message.project_id == p.id)
        ).one()

        file_paths = files_by_project.get(p.id, [])
        stage = compute_project_stage(file_paths)

        # Persist stage if it changed
        if stage != p.stage:
            p.stage = stage
            session.add(p)

        result.append(
            ProjectListItem(
                id=p.id,
                name=p.name,
                description=p.description,
                project_type=p.project_type,
                stage=stage,
                created_at=p.created_at,
                updated_at=p.updated_at,
                message_count=msg_count,
                file_count=len(file_paths),
                is_starred=p.id in starred_ids,
                owner_email=p.user_email,
                source_template_id=p.source_template_id,
                source_template_name=template_name_map.get(p.source_template_id) if p.source_template_id else None,
            )
        )

    session.commit()
    return result


@router.post(
    "/projects",
    response_model=ProjectOut,
    operation_id="createProject",
)
def create_project(
    body: ProjectCreateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.UserClient,
    config: Dependencies.Config,
):
    """Create a new project with default resources."""
    user_email = _get_user_email(headers)

    # Use LLM to generate project name, description, and schema from user prompt
    llm_service = LLMService(ws, config)
    metadata = llm_service.generate_project_metadata(body.description)
    project_name = metadata["name"]
    project_description = metadata.get("description") or body.description[:200]
    default_schema = f"{DEFAULT_SCHEMA_PREFIX}{metadata['schema_name']}"

    # Find default resources (returns tuples of id, name)
    warehouse_id, warehouse_name = _find_shared_warehouse(ws)

    # Create DB record with default resources (cluster left empty - user sets it manually)
    project = Project(
        user_email=user_email,
        name=project_name,
        description=project_description,
        warehouse_id=warehouse_id,
        warehouse_name=warehouse_name,
        cluster_id=None,
        cluster_name=None,
        default_catalog=DEFAULT_CATALOG,
        default_schema=default_schema,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    # Create project directory with placeholder README
    initial_readme = f"# {project_name}\n\n_README will be generated once the demo story is designed._\n"
    create_project_directory(project.id, initial_readme)

    # Save context document as a project file if provided
    if body.context_document:
        project_dir = get_project_directory(project.id)
        context_dir = project_dir / "context"
        context_dir.mkdir(exist_ok=True)
        (context_dir / "source-document.md").write_text(body.context_document, encoding="utf-8")

    # Sync files to database so they appear in the file list
    file_sync: FileSyncService = request.app.state.file_sync
    file_sync.full_sync_project(project.id, session=session)

    # Get actual file count from DB
    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == project.id)
    ).one()

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
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.get(
    "/projects/{project_id}",
    response_model=ProjectOut,
    operation_id="getProject",
)
def get_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """Get a single project by ID. Also ensures local files exist."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    # Ensure local project directory exists and files are restored from DB
    file_sync: FileSyncService = request.app.state.file_sync
    file_sync.restore_project_from_db(project_id, session=session)
    ensure_project_skills(project_id)

    # Get counts and recompute stage from files
    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()

    file_paths = [
        row for row in session.exec(
            select(ProjectFile.relative_path)
            .where(ProjectFile.project_id == project.id)
        ).all()
    ]
    file_count = len(file_paths)
    stage = compute_project_stage(file_paths)
    if stage != project.stage:
        project.stage = stage
        session.add(project)
        session.commit()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        project_type=project.project_type,
        stage=stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )

@router.patch(
    "/projects/{project_id}",
    response_model=ProjectOut,
    operation_id="updateProject",
)
def update_project(
    project_id: str,
    body: ProjectUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Update a project's name or description."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description

    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    session.commit()
    session.refresh(project)

    # Get counts
    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()

    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == project.id)
    ).one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.patch(
    "/projects/{project_id}/resources",
    response_model=ProjectOut,
    operation_id="updateProjectResources",
)
def update_project_resources(
    project_id: str,
    body: ProjectResourcesUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Update a project's resource settings (cluster, warehouse, catalog, schema)."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    # Update only the provided fields
    if body.cluster_id is not None:
        project.cluster_id = body.cluster_id if body.cluster_id else None
    if body.cluster_name is not None:
        project.cluster_name = body.cluster_name if body.cluster_name else None
    if body.warehouse_id is not None:
        project.warehouse_id = body.warehouse_id if body.warehouse_id else None
    if body.warehouse_name is not None:
        project.warehouse_name = body.warehouse_name if body.warehouse_name else None
    if body.default_catalog is not None:
        project.default_catalog = body.default_catalog if body.default_catalog else None
    if body.default_schema is not None:
        project.default_schema = body.default_schema if body.default_schema else None

    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    session.commit()
    session.refresh(project)

    # Get counts
    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()

    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == project.id)
    ).one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.delete(
    "/projects/{project_id}",
    operation_id="deleteProject",
)
def delete_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """Delete a project and all associated data."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    # Clear source_project_id on any linked templates (don't delete the template)
    session.execute(
        text("UPDATE templates SET source_project_id = NULL WHERE source_project_id = :pid"),
        {"pid": project_id}
    )

    # Delete messages
    messages = session.exec(
        select(Message).where(Message.project_id == project_id)
    ).all()
    for msg in messages:
        session.delete(msg)

    # Delete files from DB (pass session to avoid new connection)
    file_sync: FileSyncService = request.app.state.file_sync
    file_sync.delete_project_files(project_id, session=session)

    # Delete project
    session.delete(project)
    session.commit()

    try:
        project_dir = get_project_directory(project_id)
        if project_dir.exists():
            shutil.rmtree(project_dir)
    except Exception as e:
        logger.warning(f"Failed to remove project directory for {project_id}: {e}")

    return {"success": True, "deleted_project_id": project_id}


@router.post(
    "/projects/{project_id}/sync",
    operation_id="syncProject",
)
def sync_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """Trigger full bidirectional sync for a project."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    file_sync: FileSyncService = request.app.state.file_sync
    # Pass session to avoid new connection
    stats = file_sync.full_sync_project(project_id, session=session)

    # Recompute stage after sync
    file_paths = [
        row for row in session.exec(
            select(ProjectFile.relative_path)
            .where(ProjectFile.project_id == project.id)
        ).all()
    ]
    stage = compute_project_stage(file_paths)
    if stage != project.stage:
        project.stage = stage
        session.add(project)
        session.commit()

    return stats


# ---------------------------------------------------------------------------
# Starring
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/star",
    operation_id="toggleProjectStar",
)
def toggle_project_star(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Toggle the starred status of a project. Returns the new state."""
    user_email = _get_user_email(headers)
    # Verify the user owns the project OR it's shared with them
    _get_accessible_project(session, project_id, user_email)

    existing = session.exec(
        select(ProjectStar)
        .where(ProjectStar.user_email == user_email, ProjectStar.project_id == project_id)
    ).first()

    if existing:
        session.delete(existing)
        session.commit()
        return {"starred": False, "project_id": project_id}
    else:
        star = ProjectStar(user_email=user_email, project_id=project_id)
        session.add(star)
        session.commit()
        return {"starred": True, "project_id": project_id}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------


def _get_accessible_project(session, project_id: str, user_email: str) -> Project:
    """Fetch a project the user can access — either owned or shared with them."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.user_email == user_email:
        return project
    # Check if shared with user
    share = session.exec(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.shared_with_email == user_email,
        )
    ).first()
    if share:
        return project
    raise HTTPException(status_code=404, detail="Project not found")


@router.post(
    "/projects/{project_id}/share",
    response_model=ProjectShareOut,
    operation_id="shareProject",
)
def share_project(
    project_id: str,
    body: ProjectShareRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Share a project with another user via email."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    if body.email.lower() == user_email.lower():
        raise HTTPException(status_code=400, detail="Cannot share a project with yourself")

    # Check if already shared
    existing = session.exec(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.shared_with_email == body.email,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Project already shared with this user")

    share = ProjectShare(
        project_id=project_id,
        owner_email=user_email,
        shared_with_email=body.email,
        message=body.message,
    )
    session.add(share)
    session.commit()
    session.refresh(share)

    return ProjectShareOut(
        id=share.id,
        project_id=share.project_id,
        owner_email=share.owner_email,
        shared_with_email=share.shared_with_email,
        message=share.message,
        created_at=share.created_at,
    )


@router.get(
    "/projects/{project_id}/shares",
    response_model=list[ProjectShareOut],
    operation_id="listProjectShares",
)
def list_project_shares(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """List all users a project is shared with (owner only)."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    shares = session.exec(
        select(ProjectShare).where(ProjectShare.project_id == project_id)
    ).all()

    return [
        ProjectShareOut(
            id=s.id,
            project_id=s.project_id,
            owner_email=s.owner_email,
            shared_with_email=s.shared_with_email,
            message=s.message,
            created_at=s.created_at,
        )
        for s in shares
    ]


@router.delete(
    "/projects/{project_id}/share/{share_id}",
    operation_id="unshareProject",
)
def unshare_project(
    project_id: str,
    share_id: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Remove a share (owner only)."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    share = session.exec(
        select(ProjectShare).where(
            ProjectShare.id == share_id,
            ProjectShare.project_id == project_id,
        )
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    session.delete(share)
    session.commit()
    return {"success": True}


@router.get(
    "/shared-projects",
    response_model=list[ProjectListItem],
    operation_id="listSharedProjects",
)
def list_shared_projects(session: Dependencies.Session, headers: Dependencies.Headers):
    """Return projects shared with the current user by others."""
    user_email = _get_user_email(headers)

    # Get user's starred project IDs
    starred_ids = set(
        session.exec(
            select(ProjectStar.project_id).where(ProjectStar.user_email == user_email)
        ).all()
    )

    shares = session.exec(
        select(ProjectShare)
        .where(ProjectShare.shared_with_email == user_email)
        .order_by(ProjectShare.created_at.desc())
    ).all()

    result = []
    for share in shares:
        project = session.get(Project, share.project_id)
        if not project:
            continue

        msg_count = session.exec(
            select(func.count()).select_from(Message).where(Message.project_id == project.id)
        ).one()

        file_paths = [
            row for row in session.exec(
                select(ProjectFile.relative_path)
                .where(ProjectFile.project_id == project.id)
            ).all()
        ]
        stage = compute_project_stage(file_paths)

        result.append(
            ProjectListItem(
                id=project.id,
                name=project.name,
                description=project.description,
                project_type=project.project_type,
                stage=stage,
                created_at=project.created_at,
                updated_at=project.updated_at,
                message_count=msg_count,
                file_count=len(file_paths),
                is_starred=project.id in starred_ids,
                shared_by=share.owner_email,
                shared_message=share.message,
                owner_email=project.user_email,
                source_template_id=project.source_template_id,
                source_template_name=_resolve_template_name(session, project.source_template_id),
            )
        )

    return result
