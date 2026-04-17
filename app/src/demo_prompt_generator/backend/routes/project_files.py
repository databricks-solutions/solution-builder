"""Project files endpoints."""

from __future__ import annotations

import io
import json
import logging
import os
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import (
    DeployedResourceLink,
    DeployedResourcesOut,
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
EXCLUDED_PATTERNS = {".claude", ".databricks", "__pycache__", ".git", ".DS_Store", "node_modules"}


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



@router.get(
    "/projects/{project_id}/download",
    operation_id="downloadProjectAsZip",
)
def download_project_as_zip(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """Download all project files as a zip archive."""
    user_email = _get_user_email(headers)
    project = _get_user_project(session, project_id, user_email)

    project_dir = Path(PROJECTS_BASE_DIR).resolve() / project_id

    # If folder doesn't exist, restore from DB first
    if not project_dir.exists():
        logger.info(f"Project folder missing, restoring from DB: {project_id}")
        file_sync: FileSyncService = request.app.state.file_sync
        file_sync.restore_project_from_db(project_id, session=session)

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")

    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in project_dir.rglob("*"):
            # Skip directories
            if file_path.is_dir():
                continue

            # Skip excluded patterns
            rel_path = file_path.relative_to(project_dir)
            if any(part in EXCLUDED_PATTERNS for part in rel_path.parts):
                continue

            # Add file to zip
            zip_file.write(file_path, rel_path)

    zip_buffer.seek(0)

    # Generate a clean filename from project name
    safe_name = "".join(c if c.isalnum() or c in "._- " else "_" for c in project.name)
    filename = f"{safe_name}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# URL patterns for deployed Databricks resources: key -> (url_template, label)
_RESOURCE_URL_PATTERNS: dict[str, tuple[str, str]] = {
    "pipeline_id": ("{host}/pipelines/{id}", "Pipeline"),
    "dashboard_id": ("{host}/sql/dashboards/{id}", "Dashboard"),
    "genie_space_id": ("{host}/genie/rooms/{id}", "Genie Space"),
    "sql_warehouse_id": ("{host}/sql/warehouses/{id}", "SQL Warehouse"),
    "knowledge_assistant_id": ("{host}/genie/rooms/{id}", "Knowledge Assistant"),
    "multi_agent_supervisor_id": ("{host}/genie/rooms/{id}", "Multi-Agent Supervisor"),
    "app_name": ("{host}/apps/{id}", "App"),
}


def _build_deployed_links(
    data: dict, host: str | None
) -> list[DeployedResourceLink]:
    """Build deployed resource links from resources.json data.

    Supports both the new format (created_resources nested object) and
    the legacy flat format where resource IDs are top-level keys.
    """
    # New format nests resource IDs under "created_resources";
    # fall back to the top-level dict for the legacy flat format.
    resources = data.get("created_resources", data)

    links: list[DeployedResourceLink] = []
    host = (host or "").rstrip("/")

    # Catalog Explorer link (combined catalog + schema)
    catalog = resources.get("catalog")
    schema = resources.get("schema")
    if catalog and schema and host:
        links.append(DeployedResourceLink(
            resource_type="catalog_explorer",
            label="Catalog Explorer",
            url=f"{host}/explore/data/{catalog}/{schema}",
        ))

    # Workspace folder link
    workspace_folder = resources.get("workspace_folder")
    if workspace_folder and host:
        links.append(DeployedResourceLink(
            resource_type="workspace_folder",
            label="Workspace",
            url=f"{host}#workspace{workspace_folder}",
        ))

    # Standard ID-based resources
    for key, (url_template, label) in _RESOURCE_URL_PATTERNS.items():
        resource_id = resources.get(key)
        if not resource_id:
            continue
        url = url_template.format(host=host, id=resource_id) if host else None
        links.append(DeployedResourceLink(
            resource_type=key.removesuffix("_id").removesuffix("_name"),
            label=label,
            url=url,
            resource_id=str(resource_id),
        ))

    return links


@router.get(
    "/projects/{project_id}/deployed-resources",
    response_model=DeployedResourcesOut,
    operation_id="getDeployedResources",
)
def get_deployed_resources(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    ws: Dependencies.Client,
    request: Request,
):
    """Get deployed Databricks resource links parsed from resources.json."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    file_sync: FileSyncService = request.app.state.file_sync
    # Try root-level resources.json first (new convention), then legacy path
    content = file_sync.get_file_content(
        project_id, "resources.json", session=session
    )
    if content is None:
        content = file_sync.get_file_content(
            project_id, "instructions/resources.json", session=session
        )

    if content is None:
        return DeployedResourcesOut()

    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Invalid resources.json for project {project_id}")
        return DeployedResourcesOut()

    # Get workspace host
    host = None
    try:
        host = str(ws.config.host).rstrip("/") if ws.config.host else None
    except Exception:
        logger.warning("Could not resolve workspace host for resource URLs")

    links = _build_deployed_links(data, host)

    # Get deployment timestamp from the file record (check both paths)
    deployed_at = None
    file_record = session.exec(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id)
        .where(ProjectFile.relative_path == "resources.json")
    ).first()
    if not file_record:
        file_record = session.exec(
            select(ProjectFile)
            .where(ProjectFile.project_id == project_id)
            .where(ProjectFile.relative_path == "instructions/resources.json")
        ).first()
    if file_record:
        deployed_at = file_record.last_modified

    return DeployedResourcesOut(resources=links, deployed_at=deployed_at)
