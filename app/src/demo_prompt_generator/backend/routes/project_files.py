"""Project files endpoints."""

from __future__ import annotations

import io
import json
import logging
import os
import threading
import time
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ..core import Dependencies, create_router
from ..core.auth import (
    detect_mode,
    request_user_pat,
    resolve_host,
    write_project_auth_file,
)
from ..models import (
    DeployedResourceLink,
    DeployedResourcesOut,
    ProjectFile,
    ProjectFileContent,
    ProjectFileOut,
)
from ..services.file_sync import FileSyncService, decompress_content
from .projects import _get_authorized_project

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
    # Per-project FMAPI auth files (see core/fmapi_auth.py).
    if segment == ".anthropic_token" or segment.startswith(".anthropic_token."):
        return True
    if segment == "get_anthropic_token.sh" or segment.startswith(".get_anthropic_token.sh."):
        return True
    return False


# Two kinds of exclusion. The listing UI is stricter than the on-disk /
# Lakebase sync layer:
#
#   _is_excluded_from_sync(rel_path) — what to keep off Lakebase entirely.
#     Allows `.claude/projects/**` (Claude Code transcripts: needed for
#     session resume across container restarts) but rejects every other
#     `.claude/` child (settings.json, skills/, .credentials.json,
#     statsig/, todos/, ide/ — auth material or per-container caches).
#
#   _is_hidden_from_listing(rel_path) — what to hide from the file viewer.
#     Adds `.claude/**` to the deny list: transcripts are an
#     implementation detail of session resume, not a user-facing file.
#
# Most callsites want _is_hidden_from_listing. The sync layer
# (file_sync.py, the watcher) is the only place that should use the
# more permissive _is_excluded_from_sync.
def _is_excluded_from_sync(rel_path: str | Path) -> bool:
    """Sync-layer exclusion. Use this when deciding what to send to
    Lakebase. Permits `.claude/projects/**` so transcripts persist."""
    parts = Path(rel_path).parts
    if not parts:
        return False
    if parts[0] == ".claude":
        if len(parts) >= 2 and parts[1] == "projects":
            # Skip the literal `.claude/projects/` prefix when checking
            # the rest of the path.
            return any(_is_excluded_segment(p) for p in parts[2:])
        return True
    return any(_is_excluded_segment(p) for p in parts)


def _is_hidden_from_listing(rel_path: str | Path) -> bool:
    """Listing/UI exclusion. Stricter than _is_excluded_from_sync — we
    don't want transcripts (or anything else under `.claude/`) showing up
    in the file viewer."""
    parts = Path(rel_path).parts
    if not parts:
        return False
    if parts[0] == ".claude":
        return True
    return any(_is_excluded_segment(p) for p in parts)


# Kept for back-compat — most callers want the stricter listing rule.
_is_excluded_path = _is_hidden_from_listing


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

# Per-project restore locks. After a redeploy, project_dir is empty and any
# request that touches it (GET /projects/<id>, GET /projects/<id>/files,
# GET /projects/<id>/download) needs to restore from DB. The frontend fires
# several of these in parallel (Promise.all in the route loader), so without
# a lock two requests both decide to restore, and whichever one populates
# the file cache while the other is still mid-write captures a partial
# snapshot. The lock makes the first request do the restore + cache evict
# atomically; the second request waits, then sees the populated dir and
# falls through. Locks are pruned when projects are deleted.
_restore_locks: dict[str, threading.Lock] = {}
_restore_locks_lock = threading.Lock()


def _get_restore_lock(project_id: str) -> threading.Lock:
    """Return (creating if missing) the restore lock for one project."""
    with _restore_locks_lock:
        lock = _restore_locks.get(project_id)
        if lock is None:
            lock = threading.Lock()
            _restore_locks[project_id] = lock
        return lock


def ensure_project_files_restored(
    project_id: str,
    project_dir: Path,
    file_sync,
    session,
) -> None:
    """Restore project files from DB if the project_dir is missing or empty.

    Serialized per project so concurrent route handlers don't both run
    `restore_project_from_db` and step on each other's cache. Always evicts
    the file cache after a real restore so the next listing call walks fresh
    disk state instead of returning a partial mid-restore snapshot.

    The check runs INSIDE the lock — checking outside first would be racy:
    `restore_project_from_db` creates `.claude/skills/` and `.databrickscfg`
    early in its work, so a concurrent call seeing `any(iterdir())` would
    skip the wait and return mid-restore (cache walk sees only the helper
    files, all of which are excluded → empty file list shown to user).
    The lock is uncontended after the first restore, so the cost is a
    microsecond-scale acquire — not worth the optimization.
    """
    with _get_restore_lock(project_id):
        if project_dir.exists() and any(project_dir.iterdir()):
            return
        logger.info(f"Project folder missing or empty, restoring from DB: {project_id}")
        file_sync.restore_project_from_db(project_id, session=session)
        cache_evict_project(project_id)


def _make_file_entry(project_dir: Path, file_path: Path) -> dict | None:
    """Build a file entry dict from an absolute path, or None if ignored/missing."""
    try:
        rel_path = file_path.relative_to(project_dir)
    except ValueError:
        return None
    # Path-aware exclusion so .claude/projects/** is kept (transcripts) while
    # the rest of .claude/ is filtered.
    if _is_excluded_path(rel_path):
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
        "is_hidden": False,
    }


# Heavyweight directories we NEVER want to walk into even when "show
# hidden" is on (would walk thousands of files). Different from
# `_is_excluded_segment` which mixes truly-hidden-but-cheap entries
# (.databrickscfg) with truly-bulky entries (node_modules) — for the
# debug listing we want to see the cheap ones.
_HIDDEN_WALK_PRUNE_DIRS = {
    "node_modules",
    "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache",
    "dist", "build", ".next", ".turbo", ".parcel-cache", "__dist__",
    ".git",
}


def _is_bulky_dir(segment: str) -> bool:
    if segment in _HIDDEN_WALK_PRUNE_DIRS:
        return True
    # .venv*, venv*  — language virtualenvs that explode the listing.
    if segment.startswith(".venv") or (
        segment.startswith("venv") and (segment == "venv" or segment.startswith("venv-") or segment.startswith("venv."))
    ):
        return True
    return False


def _build_listing_with_hidden(project_dir: Path) -> list[dict]:
    """Walk the project directory once for the debug "show all files" view.

    Includes files normally filtered by `_is_excluded_segment` (e.g.
    `.databrickscfg`, `.claude/skills/...`, hidden tempfiles) so users
    can troubleshoot deployed-mode auth (the on-disk `.databrickscfg` IS
    the user's PAT proxy in deployed mode — see backend/AUTH.md).

    Skips bulky language artifact dirs (node_modules, .venv*, dist/) —
    walking those would return tens of thousands of paths and freeze the
    UI. Hidden walk does NOT touch the in-memory cache; the cache stays
    domain-filtered for the hot path.

    Each entry carries `is_hidden=True` if the standard listing would
    have filtered it out, so the UI can badge / sort accordingly.
    """
    entries: list[dict] = []
    if not project_dir.exists():
        return entries
    for root, dirs, filenames in os.walk(project_dir):
        dirs[:] = [d for d in dirs if not _is_bulky_dir(d)]
        root_path = Path(root)
        for name in filenames:
            file_path = root_path / name
            try:
                rel_path = file_path.relative_to(project_dir)
            except ValueError:
                continue
            try:
                stat = file_path.stat()
            except OSError:
                continue
            # Mark as hidden if the standard filter would have dropped it.
            # Path-aware so .claude/projects/** (transcripts, kept) isn't
            # mis-flagged as hidden even though .claude/ is normally hidden.
            is_hidden = _is_excluded_path(rel_path)
            entries.append({
                "path": str(rel_path),
                "name": name,
                "size": stat.st_size,
                "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "is_hidden": is_hidden,
            })
    return sorted(entries, key=lambda f: f["path"])


def _build_cache_from_walk(project_id: str, project_dir: Path) -> dict[str, dict]:
    """Walk the filesystem once and build the cache dict."""
    entries: dict[str, dict] = {}
    if not project_dir.exists():
        return entries
    for root, dirs, filenames in os.walk(project_dir):
        root_path = Path(root)
        # Prune sub-dirs using full relative paths so we can keep
        # .claude/projects/** while still skipping .claude/skills/ etc.
        kept_dirs = []
        for d in dirs:
            child_rel = (root_path / d).relative_to(project_dir)
            if _is_excluded_path(child_rel):
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs
        for name in filenames:
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
        # _make_file_entry already runs the full path-aware filter (so
        # .claude/projects/**/x.jsonl is kept while .claude/settings.json
        # is dropped). No need to re-check segment here.
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


def _ensure_project_databrickscfg(project_dir: Path, headers) -> None:
    """Refresh `<project_dir>/.databrickscfg` from the current request's
    PAT. Deployed mode only — no-op locally.

    Called from any project-scoped route the user might hit when
    re-opening a project (list files, get file, deployed-resources, …).
    Without this the file lands only when /invoke_agent fires, which
    means a freshly-restored project (post-container-restart) has no
    auth file until the user sends their first chat message — and any
    `databricks` CLI call before that point fails.

    Best-effort: errors are logged and swallowed so they never break
    the request.
    """
    if detect_mode(headers) != "deployed":
        return
    pat = request_user_pat(headers)
    if pat is None:
        return
    host = resolve_host(headers)
    if not host:
        logger.warning(
            "deployed mode + PAT present but no host resolvable — "
            "skipping .databrickscfg write for project_dir %s", project_dir,
        )
        return
    try:
        write_project_auth_file(project_dir, host, pat)
    except Exception:
        logger.exception(
            "failed to write .databrickscfg for project_dir %s", project_dir,
        )


@router.get(
    "/projects/{project_id}/files",
    response_model=list[ProjectFileOut],
    operation_id="listProjectFiles",
)
def list_project_files(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
    force: bool = False,
    include_hidden: bool = False,
):
    """List all files in a project from the local filesystem.

    Default mode is served from an in-memory cache that the file watcher
    keeps in sync with the filesystem. Pass `?force=true` to evict and
    rebuild from a fresh `os.walk` (useful when the UI's Refresh button
    is clicked, or if the cache is suspect).

    Pass `?include_hidden=true` for the debug "show all files" view —
    it walks disk fresh and includes files normally filtered out
    (`.databrickscfg`, `.claude/skills/...`, hidden tempfiles) with
    `is_hidden=true`. This bypasses the cache entirely (the cache stays
    domain-filtered for the hot path) and skips bulky language artifact
    dirs (node_modules, .venv*, dist/) so it doesn't return tens of
    thousands of paths.
    """
    try:
        user_email = _get_user_email(headers)
        _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

        project_dir = _PROJECTS_BASE_RESOLVED / project_id

        ensure_project_files_restored(
            project_id,
            project_dir,
            request.app.state.file_sync,
            session,
        )
        # Keep <project_dir>/.databrickscfg fresh on every project open in
        # deployed mode. The agent route refreshes it again right before
        # spawning, but doing it here too means the file exists from the
        # moment the user opens a project — useful if anything before the
        # first agent invocation (the user opening a terminal, manual psql,
        # etc.) needs to authenticate.
        _ensure_project_databrickscfg(project_dir, headers)

        if include_hidden:
            # Debug view — walk fresh, include hidden, do NOT cache.
            files = _build_listing_with_hidden(project_dir)
        else:
            files = _get_cached_files(project_id, project_dir, force=force)

        return [
            ProjectFileOut(
                path=f["path"],
                name=f["name"],
                size=f["size"],
                last_modified=f["last_modified"],
                synced_at=f["last_modified"],  # Use last_modified as synced_at for filesystem files
                is_hidden=f.get("is_hidden", False),
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
    config: Dependencies.Config,
    request: Request,
    response: Response,
):
    """Get the content of a specific file.

    Disk is the source of truth. The DB is just a backup so projects can
    be restored to disk after a container restart (see
    `ensure_project_files_restored`). Read order:
    1. Stat disk — if present, read it and stat() for size/mtime. Done.
    2. Otherwise fall through to the DB (rare: file is gitignored by the
       watcher, e.g. `.claude/skills/`, or the project hasn't been
       restored yet on this container).

    `.databrickscfg`, `.anthropic_token`, and `.claude/settings.json`
    carry secrets and are redacted before being returned.

    Perf debugging: response carries `Server-Timing` and `X-Debug-Timings`
    headers naming each phase so we can see where the wall-clock goes.
    """
    t0 = time.perf_counter()
    timings: list[tuple[str, float]] = []

    def mark(name: str) -> None:
        nonlocal t0
        t1 = time.perf_counter()
        timings.append((name, (t1 - t0) * 1000.0))
        t0 = t1

    user_email = _get_user_email(headers)
    mark("user_email")

    # Auth check — owner OR admin. Covers pool checkout + pool_pre_ping
    # SELECT 1 + the query itself on first session.exec().
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)
    mark("auth_query")

    project_dir = _PROJECTS_BASE_RESOLVED / project_id
    disk_path = (project_dir / file_path).resolve()
    # Defense in depth: refuse path-escape attempts (`..` segments).
    try:
        disk_path.relative_to(project_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")

    content: str | None = None
    file_size: int | None = None
    file_mtime: datetime | None = None

    if disk_path.is_file():
        # Hot path: serve straight from disk. No DB hit.
        try:
            content = disk_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            import base64
            content = base64.b64encode(disk_path.read_bytes()).decode("ascii")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Read failed: {e}")
        try:
            stat = disk_path.stat()
            file_size = stat.st_size
            file_mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        except OSError:
            file_size = len(content)
        mark("disk_read")
    else:
        # Disk miss — fall back to DB. Either the project hasn't been
        # restored on this container yet, or the file is one the watcher
        # ignores by design (won't ever appear on disk). Last DB hit also
        # gets us the metadata in the same query.
        file_record = session.exec(
            select(ProjectFile)
            .where(ProjectFile.project_id == project_id)
            .where(ProjectFile.relative_path == file_path)
        ).first()
        mark("db_fallback_query")
        if file_record is None:
            raise HTTPException(status_code=404, detail="File not found")
        try:
            raw = decompress_content(file_record.content_compressed)
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            import base64
            content = base64.b64encode(raw).decode("ascii")
        except Exception as e:
            logger.error(f"Failed to decompress {file_path}: {e}")
            raise HTTPException(status_code=500, detail="Failed to decompress file")
        file_size = file_record.file_size
        file_mtime = file_record.last_modified
        mark("db_fallback_decode")

    # Redact secrets. `.databrickscfg` keeps everything except the token
    # line; the other two are wholesale-redacted because the entire body
    # is sensitive (see backend/AUTH.md, backend/core/fmapi_auth.py).
    basename = Path(file_path).name
    if basename == ".databrickscfg" or basename.startswith(".databrickscfg."):
        redacted_lines: list[str] = []
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.lower().startswith("token") and "=" in stripped:
                redacted_lines.append(
                    line.split("=", 1)[0] + "= [REDACTED — see backend/AUTH.md]"
                )
            else:
                redacted_lines.append(line)
        content = "\n".join(redacted_lines)
    elif basename == ".anthropic_token" or basename.startswith(".anthropic_token."):
        content = "[REDACTED — see backend/core/fmapi_auth.py]"
    elif basename == "settings.json" and ".claude/" in file_path:
        content = "[REDACTED apiKeyHelper path — see backend/core/fmapi_auth.py]"
    mark("redact")

    total_ms = sum(d for _, d in timings)
    response.headers["Server-Timing"] = ", ".join(
        f"{name};dur={dur:.1f}" for name, dur in timings
    ) + f", total;dur={total_ms:.1f}"
    response.headers["X-Debug-Timings"] = json.dumps(
        {"steps": [{"name": n, "ms": round(d, 1)} for n, d in timings],
         "total_ms": round(total_ms, 1)}
    )

    return ProjectFileContent(
        path=file_path,
        content=content,
        size=file_size if file_size is not None else len(content),
        last_modified=file_mtime,
    )



@router.get(
    "/projects/{project_id}/download",
    operation_id="downloadProjectAsZip",
)
def download_project_as_zip(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Download all project files as a zip archive."""
    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    project_dir = _PROJECTS_BASE_RESOLVED / project_id

    ensure_project_files_restored(
        project_id,
        project_dir,
        request.app.state.file_sync,
        session,
    )

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")

    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in project_dir.rglob("*"):
            # Skip directories
            if file_path.is_dir():
                continue

            # Skip excluded patterns — but keep .claude/projects/** so the
            # download bundles the transcript alongside the project sources.
            rel_path = file_path.relative_to(project_dir)
            if _is_excluded_path(rel_path):
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


# URL patterns indexed by the canonical key produced by resources_extractor.
# The extractor flattens the agent's free-form resources.json into this
# shape, so the URL builder doesn't need to know about format drift.
_RESOURCE_URL_PATTERNS: dict[str, tuple[str, str]] = {
    "pipeline_id": ("{host}/pipelines/{id}", "Pipeline"),
    "dashboard_id": ("{host}/sql/dashboardsv3/{id}", "Dashboard"),
    "genie_space_id": ("{host}/genie/rooms/{id}", "Genie Space"),
    "warehouse_id": ("{host}/sql/warehouses/{id}", "SQL Warehouse"),
    "knowledge_assistant_id": ("{host}/ml/bricks/ka/configure/{id}", "Knowledge Assistant"),
    "multi_agent_supervisor_id": ("{host}/ml/bricks/sa/configure/{id}", "Multi-Agent Supervisor"),
    "mlflow_experiment_path": ("{host}#workspace{id}", "MLflow Experiment"),
}


def _build_deployed_links(
    resources: dict[str, str],
    host: str | None,
    workspace_id: int | str | None = None,
) -> list[DeployedResourceLink]:
    """Build deployed resource links from the LLM-normalized flat dict
    (output of services.resources_extractor.extract_resources).

    `workspace_id` is required for the Apps v2 URL (the `?o=` query param
    is what scopes the page to the user's workspace). Other resource URLs
    don't need it.
    """
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

    # Databricks App — extractor gives us app_name + app_id separately.
    # Apps v2 URL is /apps-v2/app/<name>/overview?o=<workspace_id>.
    # workspace_id is plumbed in by the caller (it has the WorkspaceClient).
    app_name = resources.get("app_name")
    if app_name:
        if host and workspace_id:
            url = f"{host}/apps-v2/app/{app_name}/overview?o={workspace_id}"
        elif host:
            url = f"{host}/apps-v2/app/{app_name}/overview"
        else:
            url = None
        links.append(DeployedResourceLink(
            resource_type="app",
            label="App",
            url=url,
            resource_id=str(app_name),
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
    config: Dependencies.Config,
    ws: Dependencies.Client,
    request: Request,
):
    """Get deployed Databricks resource links parsed from resources.json."""
    user_email = _get_user_email(headers)
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

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

    # Extract a canonical flat dict via the mini LLM (cached by content
    # hash). The agent writes resources.json in unpredictable shapes;
    # the LLM normalizes them into the keys our URL builder expects.
    from ..services.resources_extractor import extract_resources
    try:
        raw_text = content.decode("utf-8") if isinstance(content, (bytes, bytearray)) else content
    except UnicodeDecodeError:
        logger.warning(f"resources.json for project {project_id} is not UTF-8")
        return DeployedResourcesOut(extraction_error="resources.json is not valid UTF-8")
    resources, extraction_error = extract_resources(project_id, raw_text, ws, config)

    # Get workspace host + numeric ID. workspace_id powers the Apps v2
    # `?o=<id>` query param (the page redirects to a login screen without
    # it). Best-effort: if the SDK call fails, app links work but omit
    # the param.
    host = None
    workspace_id: int | str | None = None
    try:
        host = str(ws.config.host).rstrip("/") if ws.config.host else None
    except Exception:
        logger.warning("Could not resolve workspace host for resource URLs")
    try:
        workspace_id = ws.get_workspace_id()
    except Exception:
        logger.warning("Could not resolve workspace_id; app links will omit ?o=")

    links = _build_deployed_links(resources, host, workspace_id)

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

    return DeployedResourcesOut(
        resources=links,
        deployed_at=deployed_at,
        extraction_error=extraction_error,
    )
