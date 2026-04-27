"""Project files endpoints."""

from __future__ import annotations

import io
import json
import logging
import os
import threading
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
# Resolved once at import — used on hot paths (cache, watcher events).
_PROJECTS_BASE_RESOLVED = Path(PROJECTS_BASE_DIR).resolve()

# Files/folders to exclude from listing. Keep in sync with
# file_watcher.IGNORE_PATTERNS and file_sync.PRUNE_DIRS.
#
# Exact names for directory pruning (matched per-segment in the walk).
EXCLUDED_PATTERNS = {
    # Managed elsewhere
    ".claude",
    ".databricks",
    # Language package/artifact dirs
    "node_modules",
    "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache",
    # Build output
    "dist", "build", ".next", ".turbo", ".parcel-cache", "__dist__",
    # VCS + OS
    ".git",
    ".DS_Store",
}


def _is_excluded_segment(segment: str) -> bool:
    """True if a path segment (dir or file basename) should be hidden from
    the file listing. Extends EXCLUDED_PATTERNS with glob rules for variant
    names the set can't express literally:
      - .venv*, venv* (covers .venv, venv, .venv-datagen, etc.)
      - .tmp*         (hidden tempfile pattern like .tmpXXXXXX)
      - *.tmp, *.tmp.* (tmp suffix/middle)
    Keep in sync with file_watcher.IGNORE_PATTERNS."""
    if segment in EXCLUDED_PATTERNS:
        return True
    if segment.startswith(".venv") or (
        segment.startswith("venv") and (segment == "venv" or segment.startswith("venv-") or segment.startswith("venv."))
    ):
        return True
    if segment.startswith(".tmp"):
        return True
    if segment.endswith(".tmp") or ".tmp." in segment:
        return True
    if segment == ".databrickscfg" or segment.startswith(".databrickscfg."):
        return True
    return False


# ---------------------------------------------------------------------------
# In-memory file listing cache
#
# Keyed by project_id. Each entry is a dict[relative_path → file dict].
# Reads convert the dict to a sorted list.
#
# Invalidation:
# - First read for a project: full walk populates the cache.
# - Any watcher event: `cache_resync_dir` re-lists the parent directory from
#   disk and replaces that dir's slice of the cache. This handles
#   create/modify/delete/move uniformly: whatever disk shows wins.
# - `?force=true` query param: evicts the entry, next read rebuilds.
#
# Why a directory resync (not single-path stat): atomic writes briefly leave
# the destination path nonexistent (rename window). A single re-stat in that
# window returns ENOENT and would wrongly drop the entry. Re-listing the
# directory is robust — by the time we read it, the rename has settled and
# disk reflects truth.
# ---------------------------------------------------------------------------

_file_cache: dict[str, dict[str, dict]] = {}
_cache_lock = threading.RLock()


def _make_file_entry(project_dir: Path, file_path: Path) -> dict | None:
    """Build a file entry dict from an absolute path, or None if ignored/missing."""
    try:
        rel_path = file_path.relative_to(project_dir)
    except ValueError:
        return None
    # Reject if any path segment (dir or basename) matches an exclusion rule.
    for part in rel_path.parts:
        if _is_excluded_segment(part):
            return None
    try:
        stat = file_path.stat()
    except OSError:
        return None
    return {
        "path": str(rel_path),
        "name": file_path.name,
        "size": stat.st_size,
        "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def _build_cache_from_walk(project_id: str, project_dir: Path) -> dict[str, dict]:
    """Walk the filesystem once and build the cache dict."""
    entries: dict[str, dict] = {}
    if not project_dir.exists():
        return entries
    for root, dirs, filenames in os.walk(project_dir):
        dirs[:] = [d for d in dirs if not _is_excluded_segment(d)]
        root_path = Path(root)
        for name in filenames:
            if _is_excluded_segment(name):
                continue
            entry = _make_file_entry(project_dir, root_path / name)
            if entry is not None:
                entries[entry["path"]] = entry
    return entries


def _get_cached_files(project_id: str, project_dir: Path, force: bool = False) -> list[dict]:
    """Return the sorted file list for a project, rebuilding the cache if needed.

    We release the lock while doing the initial `os.walk` so concurrent readers
    don't serialize on a slow cold-start. If two callers race on the first read,
    both will walk (idempotent) and whichever writes last wins — but both see a
    correct snapshot and neither blocks the other.
    """
    # Fast path: entry already cached.
    with _cache_lock:
        if not force:
            entries = _file_cache.get(project_id)
            if entries is not None:
                files = list(entries.values())
                logger.info(
                    f"[cache] hit {project_id} ({len(files)} files)"
                )
                return sorted(files, key=lambda f: f["path"])
        logger.info(
            f"[cache] {'force rebuild' if force else 'miss'} for {project_id}"
        )
        # else: miss or force — fall through to rebuild outside the lock.
        _file_cache.pop(project_id, None)

    # Slow path: walk outside the lock so we don't block other readers/watcher events.
    fresh = _build_cache_from_walk(project_id, project_dir)

    # Publish. If a watcher event arrived between the pop and now, its resync
    # ran against an empty cache (no-op path in cache_resync_dir when the
    # project isn't cached). The walk we just did reflects current disk state,
    # so we're consistent.
    with _cache_lock:
        _file_cache[project_id] = fresh
        files = list(fresh.values())

    return sorted(files, key=lambda f: f["path"])


def _list_dir_entries(project_dir: Path, dir_abs: Path) -> dict[str, dict]:
    """Re-list the immediate non-recursive contents of one directory from disk.

    Returns dict[relative_path → entry] for the live (non-excluded) files in
    that directory. Files inside subdirectories of `dir_abs` are NOT included
    — those have their own watcher events when they change.
    """
    entries: dict[str, dict] = {}
    if not dir_abs.is_dir():
        return entries
    try:
        children = list(dir_abs.iterdir())
    except OSError:
        return entries
    for child in children:
        if not child.is_file():
            continue
        if _is_excluded_segment(child.name):
            continue
        entry = _make_file_entry(project_dir, child)
        if entry is not None:
            entries[entry["path"]] = entry
    return entries


def cache_resync_dir(project_id: str, relative_path: str) -> None:
    """Watcher hook: a path under the project changed.

    Rebuilds the cache slice for the directory containing `relative_path` by
    listing it from disk (non-recursive). Any cached entry that previously
    lived in that directory but no longer exists on disk is dropped — this
    covers deletions, moves out, and atomic-replace cleanup naturally, with
    no special-casing per event type.

    No-op when the project hasn't been cached yet — the next GET /files does
    a full walk and includes everything.
    """
    project_dir = _PROJECTS_BASE_RESOLVED / project_id

    # Resolve the directory to resync. For a top-level file (no slash in
    # rel_path) the parent is the project root itself.
    rel_parent = str(Path(relative_path).parent)
    if rel_parent == ".":
        dir_abs = project_dir
        dir_prefix = ""
    else:
        dir_abs = project_dir / rel_parent
        dir_prefix = rel_parent + "/"

    # Snapshot what's on disk now (outside the lock — disk I/O shouldn't
    # block other readers / watcher events).
    live = _list_dir_entries(project_dir, dir_abs)

    with _cache_lock:
        entries = _file_cache.get(project_id)
        if entries is None:
            return

        # Drop cached entries that are immediate children of this directory,
        # then merge in what disk shows. A path is an immediate child iff it
        # starts with dir_prefix AND has no further slash beyond it.
        dropped = 0
        for cached_path in list(entries.keys()):
            if not cached_path.startswith(dir_prefix):
                continue
            if "/" in cached_path[len(dir_prefix):]:
                continue
            del entries[cached_path]
            dropped += 1
        entries.update(live)

        logger.info(
            f"[cache] resync {project_id}/{rel_parent or '.'}: "
            f"{dropped} dropped, {len(live)} from disk (project total {len(entries)})"
        )


def cache_evict_project(project_id: str) -> None:
    """Drop the whole cache for a project (e.g. after a bulk restore from DB)."""
    with _cache_lock:
        _file_cache.pop(project_id, None)


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
    force: bool = False,
):
    """List all files in a project from the local filesystem.

    Served from an in-memory cache that the file watcher keeps in sync with the
    filesystem. Pass `?force=true` to evict and rebuild from a fresh `os.walk`
    (useful when the UI's Refresh button is clicked, or if the cache is suspect).
    """
    try:
        user_email = _get_user_email(headers)
        _get_user_project(session, project_id, user_email)

        project_dir = _PROJECTS_BASE_RESOLVED / project_id

        # If folder doesn't exist, restore from DB first (and drop stale cache).
        if not project_dir.exists():
            logger.info(f"Project folder missing, restoring from DB: {project_id}")
            file_sync: FileSyncService = request.app.state.file_sync
            file_sync.restore_project_from_db(project_id, session=session)
            cache_evict_project(project_id)

        files = _get_cached_files(project_id, project_dir, force=force)

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

    project_dir = _PROJECTS_BASE_RESOLVED / project_id

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
# The `app` resource is nested (object with name/id/deployment_note), handled
# separately in _build_deployed_links; not included here.
_RESOURCE_URL_PATTERNS: dict[str, tuple[str, str]] = {
    "pipeline_id": ("{host}/pipelines/{id}", "Pipeline"),
    "dashboard_id": ("{host}/sql/dashboardsv3/{id}", "Dashboard"),
    "genie_space_id": ("{host}/genie/rooms/{id}", "Genie Space"),
    "sql_warehouse_id": ("{host}/sql/warehouses/{id}", "SQL Warehouse"),
    "knowledge_assistant_id": ("{host}/ml/bricks/ka/configure/{id}", "Knowledge Assistant"),
    "knowledge_assistant_endpoint": ("{host}/ml/endpoints/{id}", "KA Endpoint"),
    "multi_agent_supervisor_id": ("{host}/ml/bricks/sa/configure/{id}", "Multi-Agent Supervisor"),
    "multi_agent_supervisor_endpoint": ("{host}/ml/endpoints/{id}", "MAS Endpoint"),
    "mlflow_experiment_path": ("{host}#workspace{id}", "MLflow Experiment"),
}


def _build_deployed_links(
    data: dict, host: str | None
) -> list[DeployedResourceLink]:
    """Build deployed resource links from resources.json data.

    Supports the created_resources nested object with *_id keys,
    and the legacy flat format where resource IDs are top-level.
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
            resource_type=key.removesuffix("_id").removesuffix("_name").removesuffix("_path"),
            label=label,
            url=url,
            resource_id=str(resource_id),
        ))

    # Databricks App — stored as a nested object { name, id, deployment_note }.
    # The canonical URL uses the app name (human-readable), not the internal id.
    app = resources.get("app")
    if isinstance(app, dict) and app.get("name"):
        name = app["name"]
        url = f"{host}/apps/{name}" if host else None
        links.append(DeployedResourceLink(
            resource_type="app",
            label="App",
            url=url,
            resource_id=str(name),
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
            project_id, "specifications/resources.json", session=session
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
            .where(ProjectFile.relative_path == "specifications/resources.json")
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
