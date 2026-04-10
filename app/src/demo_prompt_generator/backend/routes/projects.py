"""Projects CRUD endpoints."""

from __future__ import annotations

import re
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
    ProjectUpdateRequest,
)
from ..services.file_sync import FileSyncService
from ..services.skills_manager import (
    create_project_directory,
    ensure_project_skills,
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

    # Get projects with counts
    stmt = (
        select(Project)
        .where(Project.user_email == user_email)
        .order_by(Project.created_at.desc())
    )
    projects = session.exec(stmt).all()

    result = []
    for p in projects:
        # Get message count
        msg_count = session.exec(
            select(func.count()).select_from(Message).where(Message.project_id == p.id)
        ).one()

        # Get file count
        file_count = session.exec(
            select(func.count())
            .select_from(ProjectFile)
            .where(ProjectFile.project_id == p.id)
        ).one()

        result.append(
            ProjectListItem(
                id=p.id,
                name=p.name,
                project_type=p.project_type,
                created_at=p.created_at,
                updated_at=p.updated_at,
                message_count=msg_count,
                file_count=file_count,
            )
        )

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

    # Use LLM to generate project name and schema from description
    llm_service = LLMService(ws, config)
    metadata = llm_service.generate_project_metadata(body.description)
    project_name = metadata["name"]
    default_schema = f"{DEFAULT_SCHEMA_PREFIX}{metadata['schema_name']}"

    # Find default resources (returns tuples of id, name)
    warehouse_id, warehouse_name = _find_shared_warehouse(ws)

    # Create DB record with default resources (cluster left empty - user sets it manually)
    project = Project(
        user_email=user_email,
        name=project_name,
        description=body.description,
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

    # Create project directory with minimal README (Claude will write the full one)
    initial_readme = f"# {project_name}\n\n_Project README will be generated by the assistant._\n"
    create_project_directory(project.id, initial_readme)

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

    # Optionally: remove local directory (be careful with this!)
    # import shutil
    # project_dir = get_project_directory(project_id)
    # if project_dir.exists():
    #     shutil.rmtree(project_dir)

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
    _get_user_project(session, project_id, user_email)

    file_sync: FileSyncService = request.app.state.file_sync
    # Pass session to avoid new connection
    stats = file_sync.full_sync_project(project_id, session=session)

    return stats
