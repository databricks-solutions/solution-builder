"""Project files endpoints."""

from __future__ import annotations

import logging
import traceback

from fastapi import HTTPException, Request
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import (
    Project,
    ProjectFile,
    ProjectFileContent,
    ProjectFileOut,
)
from ..services.file_sync import FileSyncService

logger = logging.getLogger(__name__)
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
    "/projects/{project_id}/files",
    response_model=list[ProjectFileOut],
    operation_id="listProjectFiles",
)
def list_project_files(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """List all files in a project."""
    try:
        user_email = _get_user_email(headers)
        logger.info(f"list_project_files: user={user_email}, project={project_id}")
        _get_user_project(session, project_id, user_email)

        file_sync: FileSyncService = request.app.state.file_sync
        # Pass session to avoid creating new connection (PGLite issue)
        files = file_sync.get_project_files_list(project_id, session=session)
        logger.info(f"list_project_files: found {len(files)} files")

        return [
            ProjectFileOut(
                path=f["path"],
                name=f["name"],
                size=f["size"],
                last_modified=f["last_modified"],
                synced_at=f["synced_at"],
            )
            for f in files
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_project_files error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/projects/{project_id}/files/{file_path:path}",
    response_model=ProjectFileContent,
    operation_id="getProjectFile",
)
def get_project_file(
    project_id: str,
    file_path: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """Get the content of a specific file."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    file_sync: FileSyncService = request.app.state.file_sync
    # Pass session to avoid creating new connection (PGLite issue)
    content = file_sync.get_file_content(project_id, file_path, session=session)

    if content is None:
        raise HTTPException(status_code=404, detail="File not found")

    # Get file metadata from DB
    file_record = session.exec(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id)
        .where(ProjectFile.relative_path == file_path)
    ).first()

    return ProjectFileContent(
        path=file_path,
        content=content,
        size=file_record.file_size if file_record else len(content),
        last_modified=file_record.last_modified if file_record else None,
    )
