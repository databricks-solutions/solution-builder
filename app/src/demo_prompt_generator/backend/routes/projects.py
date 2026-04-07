"""Projects CRUD endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlmodel import func, select

from ..core import Dependencies, create_router
from ..models import (
    Message,
    Project,
    ProjectCreateRequest,
    ProjectFile,
    ProjectListItem,
    ProjectOut,
    ProjectUpdateRequest,
)
from ..services.file_sync import FileSyncService
from ..services.skills_manager import (
    create_project_directory,
    ensure_project_skills,
)

router = create_router()


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
):
    """Create a new project."""
    user_email = _get_user_email(headers)

    # Create DB record
    project = Project(
        user_email=user_email,
        name=body.name,
        description=body.description,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    # Create project directory with initial README
    initial_readme = f"# {body.name}\n\n{body.description or 'A new Databricks Asset Generator project.'}\n"
    create_project_directory(project.id, initial_readme)

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        project_type=project.project_type,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=0,
        file_count=1,  # README.md
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
