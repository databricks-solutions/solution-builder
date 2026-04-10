"""Project files endpoints."""

from __future__ import annotations

import logging
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path

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

PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Files/folders to exclude from listing
EXCLUDED_PATTERNS = {".claude", "__pycache__", ".git", ".DS_Store", "node_modules"}


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


def _list_files_from_filesystem(project_dir: Path) -> list[dict]:
    """List all files in a project directory from the filesystem."""
    files = []

    if not project_dir.exists():
        return files

    for file_path in project_dir.rglob("*"):
        # Skip directories
        if file_path.is_dir():
            continue

        # Skip excluded patterns
        rel_path = file_path.relative_to(project_dir)
        if any(part in EXCLUDED_PATTERNS for part in rel_path.parts):
            continue

        try:
            stat = file_path.stat()
            files.append({
                "path": str(rel_path),
                "name": file_path.name,
                "size": stat.st_size,
                "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
        except OSError:
            # Skip files we can't stat
            continue

    return sorted(files, key=lambda f: f["path"])


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
    """List all files in a project from the local filesystem."""
    try:
        user_email = _get_user_email(headers)
        logger.info(f"list_project_files: user={user_email}, project={project_id}")
        _get_user_project(session, project_id, user_email)

        project_dir = Path(PROJECTS_BASE_DIR).resolve() / project_id

        # If folder doesn't exist, restore from DB first
        if not project_dir.exists():
            logger.info(f"Project folder missing, restoring from DB: {project_id}")
            file_sync: FileSyncService = request.app.state.file_sync
            file_sync.restore_project_from_db(project_id, session=session)

        # List files directly from filesystem
        files = _list_files_from_filesystem(project_dir)
        logger.info(f"list_project_files: found {len(files)} files")

        return [
            ProjectFileOut(
                path=f["path"],
                name=f["name"],
                size=f["size"],
                last_modified=f["last_modified"],
                synced_at=f["last_modified"],  # Use last_modified as synced_at for filesystem files
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
